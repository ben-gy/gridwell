// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Ben Richardson — https://benrichardson.dev
// Additional terms under AGPL-3.0 section 7(b) apply; see ADDITIONAL-TERMS.md.
/**
 * The DuckDB-Wasm engine.
 *
 * Every asset is imported through Vite's `?url` so it ships inside our own
 * bundle and is served from our own origin. The documented quick-start uses
 * `getJsDelivrBundles()`, which would fetch ~35 MB from a CDN at runtime — that
 * is a third party watching every person who opens the tool, and it breaks the
 * offline promise. Vendoring costs bundle size and buys back both.
 */

import * as duckdb from '@duckdb/duckdb-wasm';
import type { Table } from 'apache-arrow';
import ehWasm from '@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url';
import ehWorker from '@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url';

import { columnKind } from './schema';
import {
  PREVIEW_LIMIT,
  buildExportSql,
  countQuery,
  createViewSql,
  detectFormat,
  quoteIdent,
  stripTrailingSemicolon,
  withPreviewLimit,
} from './sql';
import { VIEW } from './sql';
import type { ColumnInfo, ExportFormat, QueryResult, SourceInfo } from './types';

/**
 * Only the `eh` (exception-handling) build ships.
 *
 * `coi` is excluded because it needs COOP/COEP headers, which GitHub Pages
 * cannot set on a static site — `selectBundle` would pick it and then fail to
 * spawn pthreads.
 *
 * `mvp` is excluded because the fallback it offers is illusory: a browser old
 * enough to lack WASM exception handling also cannot run the ES2022 module
 * bundle this app is compiled to, so it would fail a few milliseconds later
 * anyway. Shipping it cost 39 MB of deploy weight to serve nobody. The `mvp`
 * slot below is required by the type and points at the same assets; the probe
 * in `init` guarantees it is never the one selected.
 */
const EH_BUNDLE = { mainModule: ehWasm, mainWorker: ehWorker };
const BUNDLES: duckdb.DuckDBBundles = { mvp: EH_BUNDLE, eh: EH_BUNDLE };

/**
 * The smallest valid module that uses an exception-handling opcode. If the
 * engine rejects it, this browser cannot run our DuckDB build.
 */
const EH_PROBE = new Uint8Array([
  0, 97, 115, 109, 1, 0, 0, 0, 1, 4, 1, 96, 0, 0, 3, 2, 1, 0, 10, 8, 1, 6, 0, 6, 64, 25, 11, 11,
]);

export class EngineUnsupportedError extends Error {}

export class Engine {
  private db: duckdb.AsyncDuckDB | null = null;
  private conn: duckdb.AsyncDuckDBConnection | null = null;
  private worker: Worker | null = null;
  private registered: string | null = null;

  /** Boot the engine. Safe to call once; subsequent calls resolve immediately. */
  async init(): Promise<void> {
    if (this.db) return;
    if (typeof WebAssembly === 'undefined') {
      throw new EngineUnsupportedError('This browser has no WebAssembly support.');
    }
    if (!WebAssembly.validate(EH_PROBE)) {
      throw new EngineUnsupportedError(
        'This browser is missing WebAssembly exception handling, which the query engine needs.',
      );
    }

    const bundle = await duckdb.selectBundle(BUNDLES);
    if (!bundle.mainWorker) {
      throw new EngineUnsupportedError('No compatible DuckDB build for this browser.');
    }

    // The worker scripts duckdb ships are classic (they use importScripts), so
    // no `{ type: 'module' }` here even though the rest of the app is ESM.
    this.worker = new Worker(bundle.mainWorker);
    // VoidLogger, not ConsoleLogger: the event-log drawer is our only output
    // surface, and a query log in devtools is data the user did not ask us to
    // put there.
    this.db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), this.worker);
    await this.db.instantiate(bundle.mainModule, bundle.pthreadWorker);
    this.conn = await this.db.connect();
  }

  get ready(): boolean {
    return this.conn !== null;
  }

  private require(): duckdb.AsyncDuckDBConnection {
    if (!this.conn) throw new Error('The query engine is not ready yet.');
    return this.conn;
  }

  /**
   * Hand DuckDB a `File` and describe what is in it.
   *
   * `BROWSER_FILEREADER` means DuckDB issues ranged reads against the handle
   * rather than us buffering the file into JS memory first — which is what
   * makes a 2 GB CSV open at all.
   */
  async openFile(file: File): Promise<SourceInfo> {
    const conn = this.require();
    const db = this.db!;
    const format = detectFormat(file.name);

    if (this.registered) {
      await db.dropFile(this.registered).catch(() => undefined);
    }
    await db.registerFileHandle(
      file.name,
      file,
      duckdb.DuckDBDataProtocol.BROWSER_FILEREADER,
      true,
    );
    this.registered = file.name;

    await conn.query(createViewSql(file.name, format));

    const described = await conn.query(`DESCRIBE ${quoteIdent(VIEW)}`);
    const columns: ColumnInfo[] = described.toArray().map((row) => {
      const record = row as unknown as { column_name: string; column_type: string };
      const type = String(record.column_type ?? '');
      return { name: String(record.column_name ?? ''), type, kind: columnKind(type) };
    });

    if (!columns.length) {
      throw new Error('No columns were found in that file. Is it empty?');
    }

    const counted = await conn.query(`SELECT COUNT(*)::BIGINT AS n FROM ${quoteIdent(VIEW)}`);
    const rowCount = Number(counted.getChildAt(0)?.get(0) ?? 0);

    return { fileName: file.name, format, bytes: file.size, rowCount, columns };
  }

  /**
   * Run a read-only statement and materialise up to `PREVIEW_LIMIT` rows.
   *
   * The count runs as a second statement rather than being derived from the
   * result, because the whole point is to know the true size of a result whose
   * display we just capped.
   */
  async runQuery(sql: string): Promise<QueryResult> {
    const conn = this.require();
    const started = performance.now();
    const table = await conn.query(withPreviewLimit(sql, PREVIEW_LIMIT));
    const elapsedMs = performance.now() - started;

    const columns: ColumnInfo[] = table.schema.fields.map((field) => {
      const type = field.type.toString();
      return { name: field.name, type, kind: columnKind(type) };
    });
    const rows = materialise(table, columns.length);

    let truncated = false;
    if (rows.length >= PREVIEW_LIMIT) {
      const counted = await conn.query(countQuery(sql));
      truncated = Number(counted.getChildAt(0)?.get(0) ?? 0) > rows.length;
    }

    return { columns, rows, fetched: rows.length, elapsedMs, truncated };
  }

  /**
   * Write the full (uncapped) result of `sql` out in `format` and return the
   * bytes. `COPY … TO` lands in DuckDB's in-WASM filesystem; we read it back
   * and immediately drop it so a second export of a big result does not stack
   * two copies in WASM memory.
   */
  async exportQuery(sql: string, format: ExportFormat): Promise<Uint8Array> {
    const conn = this.require();
    const db = this.db!;
    const target = `gridwell-export.${format}`;

    await conn.query(buildExportSql(sql, format, target));
    try {
      return await db.copyFileToBuffer(target);
    } finally {
      await db.dropFile(target).catch(() => undefined);
    }
  }

  /** Read a small sample as text — used by the "peek at raw bytes" affordance. */
  async explain(sql: string): Promise<string> {
    const conn = this.require();
    const table = await conn.query(`EXPLAIN ${stripTrailingSemicolon(sql)}`);
    return table
      .toArray()
      .map((row) => String((row as unknown as { explain_value?: string }).explain_value ?? ''))
      .join('\n');
  }

  async close(): Promise<void> {
    await this.conn?.close().catch(() => undefined);
    await this.db?.terminate().catch(() => undefined);
    this.worker?.terminate();
    this.conn = null;
    this.db = null;
    this.worker = null;
    this.registered = null;
  }
}

/**
 * Arrow → row-major JS values.
 *
 * Column-at-a-time rather than `table.toArray()`: the latter builds a proxy
 * object per row with a property per column, which for 20k × 40 is ~800k
 * property lookups and a lot of garbage. Reading vectors directly is markedly
 * faster and the grid wants positional access anyway.
 */
function materialise(table: Table, columnCount: number): unknown[][] {
  const vectors = Array.from({ length: columnCount }, (_, i) => table.getChildAt(i));
  const rowCount = table.numRows;
  const rows: unknown[][] = new Array(rowCount);

  for (let r = 0; r < rowCount; r++) {
    const row: unknown[] = new Array(columnCount);
    for (let c = 0; c < columnCount; c++) {
      row[c] = vectors[c]?.get(r) ?? null;
    }
    rows[r] = row;
  }
  return rows;
}
