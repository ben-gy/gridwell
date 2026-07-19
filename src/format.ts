/** Presentation helpers. Pure, so the test suite can pin every edge case. */

import type { ColumnKind } from './types';

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;

  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  // One decimal below 10 (2.4 MB reads better than 2 MB), none above.
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${BYTE_UNITS[unit]}`;
}

/** Thousands separators, and never scientific notation for integers. */
export function formatCount(value: number | bigint): string {
  if (typeof value === 'bigint') return value.toLocaleString('en-US');
  if (!Number.isFinite(value)) return '—';
  return Math.round(value).toLocaleString('en-US');
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1) return '<1 ms';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

export function formatThroughput(bytes: number, ms: number): string {
  if (ms <= 0 || bytes <= 0) return '—';
  return `${formatBytes((bytes / ms) * 1000)}/s`;
}

export function formatTimestamp(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/**
 * Render a single result cell as text.
 *
 * DuckDB hands back BigInt for 64-bit integers, `Date` for temporal types and
 * typed arrays for BLOBs — none of which stringify usefully on their own.
 * `null` returns the empty string; the grid styles the empty cell instead of
 * printing a word that could be confused with real data.
 */
export function formatCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'bigint') return value.toLocaleString('en-US');
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return String(value);
    // Integers get separators; floats keep their own precision so we never
    // silently round someone's data in the only view they have of it.
    return Number.isInteger(value) ? value.toLocaleString('en-US') : String(value);
  }
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? '' : value.toISOString();
  if (value instanceof Uint8Array) return `0x${bytesToHex(value, 16)}`;
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value, jsonSafe);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function jsonSafe(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() : value;
}

function bytesToHex(bytes: Uint8Array, max: number): string {
  const shown = Array.from(bytes.slice(0, max))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return bytes.length > max ? `${shown}…` : shown;
}

/**
 * Render a temporal value.
 *
 * Arrow hands date and timestamp columns back as plain epoch milliseconds, not
 * `Date` objects — so without this a date column renders as `1,771,113,600,000`,
 * which is both useless and alarming in a tool whose job is showing you your
 * own data faithfully.
 *
 * Day-precision values (an exact multiple of a day) print as a bare date; the
 * `T00:00:00.000Z` on every row of a date column is noise.
 */
export function formatTemporal(value: number | bigint): string {
  const ms = typeof value === 'bigint' ? Number(value) : value;
  if (!Number.isFinite(ms)) return String(value);
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return String(value);
  const iso = date.toISOString();
  return ms % 86_400_000 === 0 ? iso.slice(0, 10) : iso.replace('T', ' ').replace('Z', '');
}

/**
 * Format a cell knowing which column it came from.
 *
 * The column context matters for more than dates. Thousands separators are
 * applied per-*value* by `formatCell`, which inside a floating-point column
 * produces `164,400` on one row and `164394.52` on the next — the same
 * quantity styled two different ways, in the one place a person is trying to
 * compare figures down a column. So separators are reserved for integer-typed
 * columns, where every value gets them.
 */
export function formatValue(value: unknown, column: { type: string; kind: ColumnKind }): string {
  if (column.kind === 'temporal' && (typeof value === 'number' || typeof value === 'bigint')) {
    return formatTemporal(value);
  }
  if (column.kind === 'number' && typeof value === 'number' && isFloatType(column.type)) {
    return Number.isFinite(value) ? String(value) : String(value);
  }
  return formatCell(value);
}

const FLOAT_STEMS = ['float', 'double', 'real', 'decimal', 'numeric'];

export function isFloatType(type: string): boolean {
  const stem = type
    .trim()
    .toLowerCase()
    .replace(/<.*$/, '')
    .replace(/\(.*$/, '')
    .replace(/\d+$/, '');
  return FLOAT_STEMS.some((s) => stem.startsWith(s));
}

/**
 * `sales-export.csv` + `parquet` → `sales-export.parquet`
 *
 * When the export format matches the source format the naive result is the
 * source filename exactly — which lands a *filtered subset* in Downloads under
 * the same name as the complete original. That is a good way to lose data, so
 * those get marked instead.
 */
export function exportFileName(sourceName: string, extension: string): string {
  const stem = sourceName.replace(/\.[^./\\]+$/, '') || 'gridwell';
  const candidate = `${stem}.${extension}`;
  return candidate === sourceName ? `${stem}-filtered.${extension}` : candidate;
}
