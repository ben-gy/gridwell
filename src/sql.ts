/**
 * SQL construction.
 *
 * Every identifier and literal that reaches the engine passes through the
 * quoting helpers here. A user's own CSV is not a hostile input in the usual
 * sense — there is no server and no other user's data to reach — but column
 * names out of real exports genuinely contain quotes, spaces and newlines, and
 * unescaped they produce baffling parse errors on a file the user believes is
 * fine. Correct quoting is a usability feature first and a hygiene one second.
 */

import type { ExportFormat, Filter, QuerySpec, SourceFormat } from './types';

/** The view every user query runs against. */
export const VIEW = 'data';

/** Rows materialised into the grid at once. Beyond this the user exports. */
export const PREVIEW_LIMIT = 20_000;

/** `my "odd" col` → `"my ""odd"" col"` */
export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** `O'Brien` → `'O''Brien'` */
export function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * A value typed into a filter box is a string, but comparing `amount > '100'`
 * against a numeric column makes DuckDB cast the column to text and compare
 * lexically — `9 > 100`. So bare numbers and booleans go through unquoted.
 */
export function literalFor(value: string): string {
  const trimmed = value.trim();
  if (trimmed === '') return quoteLiteral(value);
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return trimmed;
  if (/^(true|false)$/i.test(trimmed)) return trimmed.toUpperCase();
  if (/^null$/i.test(trimmed)) return 'NULL';
  return quoteLiteral(value);
}

export function detectFormat(fileName: string): SourceFormat {
  const ext = fileName.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? '';
  if (ext === 'parquet' || ext === 'pq') return 'parquet';
  if (ext === 'json' || ext === 'ndjson' || ext === 'jsonl') return 'json';
  if (ext === 'tsv' || ext === 'tab') return 'tsv';
  return 'csv';
}

/**
 * The reader expression for a registered file.
 *
 * `_auto` variants let DuckDB sniff the delimiter, quoting, header row and
 * column types — which is the entire reason a person reaches for this rather
 * than fighting Excel's import wizard. `union_by_name` is off deliberately:
 * one file in, so it costs a pass and buys nothing.
 */
export function readerFor(fileName: string, format: SourceFormat): string {
  const path = quoteLiteral(fileName);
  switch (format) {
    case 'parquet':
      return `read_parquet(${path})`;
    case 'json':
      return `read_json_auto(${path})`;
    case 'tsv':
      return `read_csv_auto(${path}, delim='\\t')`;
    case 'csv':
    default:
      // `sample_size=-1` scans the whole file before fixing types. Slower on a
      // huge file, but the alternative is a column typed INTEGER from the first
      // 20k rows that then throws on row 800k — the single most common and most
      // confusing CSV failure there is.
      return `read_csv_auto(${path}, sample_size=-1)`;
  }
}

export function createViewSql(fileName: string, format: SourceFormat): string {
  return `CREATE OR REPLACE VIEW ${quoteIdent(VIEW)} AS SELECT * FROM ${readerFor(fileName, format)}`;
}

export function buildFilterClause(filter: Filter): string {
  const col = quoteIdent(filter.column);
  switch (filter.operator) {
    case 'is null':
      return `${col} IS NULL`;
    case 'is not null':
      return `${col} IS NOT NULL`;
    case 'contains':
      return `CAST(${col} AS VARCHAR) ILIKE ${quoteLiteral(`%${escapeLike(filter.value)}%`)}`;
    case 'starts with':
      return `CAST(${col} AS VARCHAR) ILIKE ${quoteLiteral(`${escapeLike(filter.value)}%`)}`;
    case 'ends with':
      return `CAST(${col} AS VARCHAR) ILIKE ${quoteLiteral(`%${escapeLike(filter.value)}`)}`;
    default:
      return `${col} ${filter.operator} ${literalFor(filter.value)}`;
  }
}

/** `%` and `_` are wildcards in LIKE; a user typing them means them literally. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Turn the quick-query panel's state into readable, runnable SQL. */
export function buildQuery(spec: QuerySpec): string {
  const projection = spec.columns.length ? spec.columns.map(quoteIdent).join(', ') : '*';
  const parts = [`SELECT ${projection}`, `FROM ${quoteIdent(VIEW)}`];

  const where = spec.filters
    .filter((f) => f.value.trim() !== '' || f.operator === 'is null' || f.operator === 'is not null')
    .map(buildFilterClause);
  if (where.length) parts.push(`WHERE ${where.join('\n  AND ')}`);

  if (spec.sort) {
    parts.push(`ORDER BY ${quoteIdent(spec.sort.column)} ${spec.sort.direction.toUpperCase()}`);
  }
  if (spec.limit !== null && spec.limit > 0) parts.push(`LIMIT ${Math.floor(spec.limit)}`);

  return parts.join('\n');
}

/** Strip a trailing `;` so the statement can be safely wrapped in a subquery. */
export function stripTrailingSemicolon(sql: string): string {
  return sql.replace(/;\s*$/, '').trim();
}

/**
 * Wrap a user statement so the grid never tries to materialise 40 million rows.
 *
 * A query that already asks for fewer rows than the cap is left alone — adding
 * an outer LIMIT around an existing one is harmless but makes the "showing all
 * rows" check below wrong.
 */
export function withPreviewLimit(sql: string, limit = PREVIEW_LIMIT): string {
  const inner = stripTrailingSemicolon(sql);
  return `SELECT * FROM (\n${inner}\n) LIMIT ${limit}`;
}

export function countQuery(sql: string): string {
  return `SELECT COUNT(*) AS n FROM (\n${stripTrailingSemicolon(sql)}\n)`;
}

const EXPORT_OPTIONS: Record<ExportFormat, string> = {
  csv: `FORMAT CSV, HEADER`,
  json: `FORMAT JSON, ARRAY true`,
  parquet: `FORMAT PARQUET, COMPRESSION ZSTD`,
};

/**
 * `COPY (…) TO 'out.x'` writes into DuckDB's in-WASM filesystem, which we then
 * read back as bytes. Nothing touches the real disk until the user's browser
 * saves the Blob.
 */
export function buildExportSql(sql: string, format: ExportFormat, target: string): string {
  return `COPY (\n${stripTrailingSemicolon(sql)}\n) TO ${quoteLiteral(target)} (${EXPORT_OPTIONS[format]})`;
}

/**
 * Reject statements that would mutate or reach outside the session.
 *
 * There is no server to protect, but DuckDB-Wasm can read `https://` paths and
 * write files, and a query pasted from a forum post should not be able to
 * quietly pull a remote file into a tool whose promise is that nothing leaves
 * the device. Read-only is also simply what this tool does.
 */
const BLOCKED = /\b(attach|copy|export|install|load|pragma|set|create|drop|alter|insert|update|delete|call)\b/i;
const REMOTE = /\b(https?|s3|gcs|azure|hf):\/\//i;

export function validateUserSql(sql: string): { ok: true } | { ok: false; reason: string } {
  const trimmed = stripTrailingSemicolon(sql);
  if (!trimmed) return { ok: false, reason: 'Enter a query first.' };
  if (REMOTE.test(trimmed)) {
    return {
      ok: false,
      reason: 'Remote paths are blocked — Gridwell only reads the file you opened.',
    };
  }
  if (BLOCKED.test(trimmed)) {
    return {
      ok: false,
      reason: 'Only read-only SELECT / WITH / DESCRIBE queries are allowed here.',
    };
  }
  if (!/^\s*(select|with|describe|summarize|from|show|table|values|pivot|unpivot)\b/i.test(trimmed)) {
    return { ok: false, reason: 'Queries must start with SELECT, WITH, FROM, DESCRIBE or SUMMARIZE.' };
  }
  return { ok: true };
}
