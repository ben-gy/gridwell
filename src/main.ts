// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Ben Richardson — https://benrichardson.dev
// Additional terms under AGPL-3.0 section 7(b) apply; see ADDITIONAL-TERMS.md.
/**
 * Application bootstrap and wiring. Heavy lifting lives in `duck.ts` (engine),
 * `grid.ts` (rendering) and `sql.ts` (query construction); this file owns the
 * state machine that connects them to the DOM.
 */

import './styles/main.css';

import { Engine, EngineUnsupportedError } from './duck';
import { EventLog } from './eventlog';
import { exportFileName, formatBytes, formatCount, formatDuration, formatValue } from './format';
import { ResultGrid } from './grid';
import { initGlossary } from './glossary';
import { buildQuery, validateUserSql } from './sql';
import {
  canShareFile,
  copyText,
  describeError,
  downloadBlob,
  initDropZone,
  initModals,
  shareFile,
  toast,
} from './ui';
import type { ExportFormat, FilterOperator, QuerySpec, SourceInfo } from './types';

const OPERATORS: FilterOperator[] = [
  '=',
  '!=',
  '>',
  '>=',
  '<',
  '<=',
  'contains',
  'starts with',
  'ends with',
  'is null',
  'is not null',
];

const MIME: Record<ExportFormat, string> = {
  csv: 'text/csv',
  json: 'application/json',
  parquet: 'application/vnd.apache.parquet',
};

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

// ── State ──────────────────────────────────────────────────────────
const engine = new Engine();
let source: SourceInfo | null = null;
let spec: QuerySpec = { columns: [], filters: [], sort: null, limit: null };
/** Set once the user edits the SQL by hand; stops the builder overwriting it. */
let sqlIsCustom = false;
let lastRunSql = '';
let lastExport: File | null = null;
let busy = false;

// ── Elements ───────────────────────────────────────────────────────
const intro = $('intro');
const loading = $('loading');
const workspace = $('workspace');
const fatal = $('fatal');
const sqlEditor = $<HTMLTextAreaElement>('sql-editor');
const columnList = $<HTMLUListElement>('column-list');
const filterRows = $('filter-rows');
const sortColumn = $<HTMLSelectElement>('sort-column');
const sortDirection = $<HTMLSelectElement>('sort-direction');
const limitInput = $<HTMLInputElement>('limit-input');
const queryStatus = $('query-status');
const resultNote = $('result-note');
const cellInspector = $('cell-inspector');
const shareButton = $<HTMLButtonElement>('share-result');

const log = new EventLog($('eventlog'), $<HTMLButtonElement>('eventlog-toggle'));
const grid = new ResultGrid($('grid'), (selection) => {
  if (!selection) {
    cellInspector.hidden = true;
    return;
  }
  cellInspector.hidden = false;
  $('cell-label').textContent = `${selection.columnName} · row ${formatCount(selection.row + 1)}`;
  $('cell-value').textContent =
    selection.value === null || selection.value === undefined
      ? 'NULL'
      : formatValue(selection.value, { type: selection.columnType, kind: selection.kind });
});

// ── View switching ─────────────────────────────────────────────────
type View = 'intro' | 'loading' | 'workspace' | 'fatal';

function show(view: View): void {
  intro.hidden = view !== 'intro';
  loading.hidden = view !== 'loading';
  workspace.hidden = view !== 'workspace';
  fatal.hidden = view !== 'fatal';
}

function setProgress(percent: number, title: string, detail?: string): void {
  const clamped = Math.max(0, Math.min(100, percent));
  $('progress-fill').style.width = `${clamped}%`;
  $('progress').setAttribute('aria-valuenow', String(Math.round(clamped)));
  $('loading-title').textContent = title;
  if (detail !== undefined) $('loading-detail').textContent = detail;
}

function showFatal(title: string, detail: string): void {
  $('fatal-title').textContent = title;
  $('fatal-detail').textContent = detail;
  show('fatal');
}

// ── Engine lifecycle ───────────────────────────────────────────────
let enginePromise: Promise<void> | null = null;

function ensureEngine(): Promise<void> {
  if (!enginePromise) {
    log.add('info', 'Starting the DuckDB engine (local, in this tab)');
    enginePromise = engine.init().then(
      () => {
        log.add('good', 'Engine ready — no network calls made');
      },
      (error) => {
        // Reset so a retry can genuinely try again rather than re-await a
        // permanently rejected promise.
        enginePromise = null;
        throw error;
      },
    );
  }
  return enginePromise;
}

// ── Opening a file ─────────────────────────────────────────────────
async function openFile(file: File): Promise<void> {
  if (busy) return;
  busy = true;
  lastExport = null;
  shareButton.hidden = true;

  show('loading');
  setProgress(8, 'Starting the query engine…', 'About 35 MB, cached after the first visit.');
  log.add('info', `Opening ${file.name} (${formatBytes(file.size)}) — read locally, never sent`);

  let opened = false;
  try {
    await ensureEngine();

    setProgress(45, 'Reading the file…', 'Detecting the delimiter, header row and column types.');
    const started = performance.now();
    const info = await engine.openFile(file);
    const elapsed = performance.now() - started;

    setProgress(100, 'Ready', '');
    source = info;
    log.add(
      'good',
      `Read ${formatCount(info.rowCount)} rows × ${info.columns.length} columns in ${formatDuration(elapsed)}`,
    );

    resetBuilder();
    renderSource(info);
    renderColumns(info);
    show('workspace');
    opened = true;
  } catch (error) {
    const message = describeError(error);
    log.add('bad', `Could not open the file: ${message}`);
    if (error instanceof EngineUnsupportedError) {
      showFatal('This browser cannot run Gridwell', `${message} Try a recent Chrome, Edge, Firefox or Safari.`);
    } else {
      showFatal('That file could not be opened', message);
    }
  } finally {
    busy = false;
  }

  // Outside the `finally` deliberately: `runQuery` refuses to start while
  // `busy` is set, so awaiting it inside the try made the opening query a
  // silent no-op and the grid came up empty.
  if (opened) await runQuery();
}

function renderSource(info: SourceInfo): void {
  $('source-name').textContent = info.fileName;
  $('source-rows').textContent = `${formatCount(info.rowCount)} rows`;
  $('source-cols').textContent = `${info.columns.length} columns`;
  $('source-size').textContent = formatBytes(info.bytes);
}

function renderColumns(info: SourceInfo): void {
  columnList.innerHTML = '';
  info.columns.forEach((column) => {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'column-chip is-on';
    button.dataset.column = column.name;
    button.title = `${column.name} — ${column.type}`;

    const name = document.createElement('span');
    name.className = 'column-name';
    name.textContent = column.name;
    const type = document.createElement('span');
    type.className = `column-type kind-${column.kind}`;
    type.textContent = column.type;

    button.append(name, type);
    button.addEventListener('click', () => toggleColumn(column.name, button));
    item.append(button);
    columnList.append(item);
  });

  sortColumn.innerHTML = '<option value="">(none)</option>';
  info.columns.forEach((column) => {
    const option = document.createElement('option');
    option.value = column.name;
    option.textContent = column.name;
    sortColumn.append(option);
  });
}

function toggleColumn(name: string, button: HTMLButtonElement): void {
  const on = button.classList.toggle('is-on');
  if (on) spec.columns = spec.columns.filter((c) => c !== name);
  else spec.columns = [...spec.columns, name];
  syncSql();
}

/**
 * The chips track *excluded* columns internally but the query needs the
 * included ones — inverting here keeps "everything is on by default" working
 * without writing every column name into the SQL for the common case.
 */
function projectedColumns(): string[] {
  if (!source) return [];
  const excluded = new Set(spec.columns);
  if (!excluded.size) return [];
  return source.columns.map((c) => c.name).filter((name) => !excluded.has(name));
}

// ── Filter builder ─────────────────────────────────────────────────
function addFilterRow(): void {
  if (!source) return;
  spec.filters.push({ column: source.columns[0].name, operator: '=', value: '' });
  renderFilters();
  syncSql();
}

function renderFilters(): void {
  if (!source) return;
  filterRows.innerHTML = '';

  spec.filters.forEach((filter, index) => {
    const row = document.createElement('div');
    row.className = 'filter-row';

    const column = document.createElement('select');
    column.className = 'input';
    column.setAttribute('aria-label', 'Filter column');
    source!.columns.forEach((c) => {
      const option = document.createElement('option');
      option.value = c.name;
      option.textContent = c.name;
      option.selected = c.name === filter.column;
      column.append(option);
    });
    column.addEventListener('change', () => {
      spec.filters[index].column = column.value;
      syncSql();
    });

    const operator = document.createElement('select');
    operator.className = 'input input-operator';
    operator.setAttribute('aria-label', 'Filter operator');
    OPERATORS.forEach((op) => {
      const option = document.createElement('option');
      option.value = op;
      option.textContent = op;
      option.selected = op === filter.operator;
      operator.append(option);
    });

    const value = document.createElement('input');
    value.className = 'input';
    value.type = 'text';
    value.placeholder = 'value';
    value.value = filter.value;
    value.setAttribute('aria-label', 'Filter value');

    const applyOperator = () => {
      spec.filters[index].operator = operator.value as FilterOperator;
      // A null check takes no operand; leaving a stale box on screen invites
      // someone to type into it and wonder why nothing changes.
      value.hidden = isNullary(spec.filters[index].operator);
      syncSql();
    };
    operator.addEventListener('change', applyOperator);
    value.hidden = isNullary(filter.operator);

    let debounce: number | undefined;
    value.addEventListener('input', () => {
      spec.filters[index].value = value.value;
      window.clearTimeout(debounce);
      debounce = window.setTimeout(syncSql, 300);
    });

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'filter-remove';
    remove.setAttribute('aria-label', 'Remove this filter');
    remove.textContent = '×';
    remove.addEventListener('click', () => {
      spec.filters.splice(index, 1);
      renderFilters();
      syncSql();
    });

    row.append(column, operator, value, remove);
    filterRows.append(row);
  });
}

function isNullary(operator: FilterOperator): boolean {
  return operator === 'is null' || operator === 'is not null';
}

function currentSpec(): QuerySpec {
  return {
    columns: projectedColumns(),
    filters: spec.filters,
    sort: sortColumn.value
      ? { column: sortColumn.value, direction: sortDirection.value === 'desc' ? 'desc' : 'asc' }
      : null,
    limit: limitInput.value ? Number(limitInput.value) : null,
  };
}

/** Regenerate the SQL from the builder — unless the user has taken it over. */
function syncSql(): void {
  if (sqlIsCustom) return;
  sqlEditor.value = buildQuery(currentSpec());
}

function resetBuilder(): void {
  spec = { columns: [], filters: [], sort: null, limit: null };
  sqlIsCustom = false;
  sortColumn.value = '';
  sortDirection.value = 'asc';
  limitInput.value = '';
  columnList
    .querySelectorAll<HTMLButtonElement>('.column-chip')
    .forEach((chip) => chip.classList.add('is-on'));
  renderFilters();
  syncSql();
}

// ── Running ────────────────────────────────────────────────────────
async function runQuery(): Promise<void> {
  if (busy || !engine.ready) return;
  const sql = sqlEditor.value.trim();

  const valid = validateUserSql(sql);
  if (!valid.ok) {
    queryStatus.textContent = valid.reason;
    queryStatus.dataset.tone = 'bad';
    log.add('warn', `Query rejected: ${valid.reason}`);
    return;
  }

  busy = true;
  queryStatus.textContent = 'Running…';
  queryStatus.dataset.tone = 'info';
  lastExport = null;
  shareButton.hidden = true;

  try {
    const result = await engine.runQuery(sql);
    lastRunSql = sql;
    grid.setData(result.columns, result.rows);

    queryStatus.textContent = `${formatCount(result.fetched)} rows in ${formatDuration(result.elapsedMs)}`;
    queryStatus.dataset.tone = 'good';
    resultNote.textContent = result.truncated
      ? `Showing the first ${formatCount(result.fetched)} rows. Exporting writes the complete result, not just what is on screen.`
      : '';
    log.add(
      'good',
      `Query returned ${formatCount(result.fetched)} rows in ${formatDuration(result.elapsedMs)}`,
    );
  } catch (error) {
    const message = describeError(error);
    // DuckDB's binder errors carry a caret diagram and candidate bindings over
    // several lines. That detail is genuinely useful, so it goes to the log in
    // full; the inline status gets the first line, which is the actual problem.
    queryStatus.textContent = message.split('\n')[0];
    queryStatus.dataset.tone = 'bad';
    log.add('bad', `Query failed: ${message}`);
  } finally {
    busy = false;
  }
}

// ── Exporting ──────────────────────────────────────────────────────
async function exportAs(format: ExportFormat): Promise<void> {
  if (busy || !source || !lastRunSql) {
    toast('Run a query first.', 'bad');
    return;
  }
  busy = true;
  log.add('info', `Writing the full result as ${format.toUpperCase()} — locally`);

  try {
    const started = performance.now();
    const bytes = await engine.exportQuery(lastRunSql, format);
    const elapsed = performance.now() - started;

    const name = exportFileName(source.fileName, format);
    // Copy into a fresh ArrayBuffer: the view handed back points into WASM
    // memory, which can be moved or freed out from under a long-lived Blob.
    const file = new File([new Uint8Array(bytes)], name, { type: MIME[format] });
    lastExport = file;
    shareButton.hidden = !canShareFile(file);

    downloadBlob(file, name);
    log.add(
      'good',
      `Exported ${name} (${formatBytes(file.size)}) in ${formatDuration(elapsed)} — saved by your browser, not uploaded`,
    );
    toast(`${name} — ${formatBytes(file.size)}`);
  } catch (error) {
    const message = describeError(error);
    log.add('bad', `Export failed: ${message}`);
    toast(`Export failed: ${message}`, 'bad');
  } finally {
    busy = false;
  }
}

// ── Wiring ─────────────────────────────────────────────────────────
function init(): void {
  initModals();
  initGlossary();

  initDropZone({
    zone: $('dropzone'),
    input: $<HTMLInputElement>('file-input'),
    onFile: (file) => void openFile(file),
  });

  $('run-query').addEventListener('click', () => void runQuery());
  $('add-filter').addEventListener('click', addFilterRow);
  $('reset-query').addEventListener('click', () => {
    resetBuilder();
    void runQuery();
  });

  $('columns-all').addEventListener('click', () => {
    spec.columns = [];
    columnList
      .querySelectorAll<HTMLButtonElement>('.column-chip')
      .forEach((chip) => chip.classList.add('is-on'));
    syncSql();
  });

  sortColumn.addEventListener('change', syncSql);
  sortDirection.addEventListener('change', syncSql);
  limitInput.addEventListener('input', syncSql);

  // Once someone types in the editor the builder stops fighting them for it.
  sqlEditor.addEventListener('input', () => {
    if (!sqlIsCustom) {
      sqlIsCustom = true;
      log.add('info', 'SQL edited by hand — the builder will no longer overwrite it');
    }
  });
  sqlEditor.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      void runQuery();
    }
  });

  $('copy-sql').addEventListener('click', async () => {
    const ok = await copyText(sqlEditor.value);
    toast(ok ? 'SQL copied' : 'Could not access the clipboard', ok ? 'info' : 'bad');
  });

  $('copy-cell').addEventListener('click', async () => {
    const ok = await copyText($('cell-value').textContent ?? '');
    toast(ok ? 'Cell copied' : 'Could not access the clipboard', ok ? 'info' : 'bad');
  });

  document.querySelectorAll<HTMLButtonElement>('[data-export]').forEach((button) => {
    button.addEventListener('click', () =>
      void exportAs(button.dataset.export as ExportFormat),
    );
  });

  shareButton.addEventListener('click', async () => {
    if (!lastExport) return;
    try {
      if (await shareFile(lastExport)) log.add('good', 'Shared via the system share sheet');
    } catch (error) {
      toast(`Could not share: ${describeError(error)}`, 'bad');
    }
  });

  $('open-another').addEventListener('click', () => {
    source = null;
    lastRunSql = '';
    grid.clear();
    cellInspector.hidden = true;
    resultNote.textContent = '';
    queryStatus.textContent = '';
    show('intro');
    log.add('info', 'Cleared the session — the previous file is gone from memory');
  });

  $('fatal-retry').addEventListener('click', () => show(source ? 'workspace' : 'intro'));

  // Paste a chunk of CSV straight in — the fastest path from a copied
  // spreadsheet selection to a queryable table.
  document.addEventListener('paste', (event) => {
    if (busy) return;
    const target = event.target as HTMLElement | null;
    if (target && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT')) return;

    const text = event.clipboardData?.getData('text/plain') ?? '';
    if (!text.includes('\n') || text.length < 8) return;
    event.preventDefault();
    const file = new File([text], 'pasted.csv', { type: 'text/csv' });
    log.add('info', 'Ingested pasted text as CSV');
    void openFile(file);
  });

  log.add('info', 'Gridwell loaded. Nothing has been sent anywhere.');

  // Warm the engine while the user is still reading the page, so the first file
  // lands on an already-booted worker. Failure here is not fatal — the real
  // attempt during `openFile` surfaces the error properly.
  void ensureEngine().catch(() => undefined);

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    window.addEventListener('load', () => {
      void navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    });
  }
}

init();
