/**
 * Mapping the engine's type names onto the handful of display behaviours the
 * grid actually has. Kept separate from the DuckDB module so it can be tested
 * without instantiating a 35 MB WASM engine.
 *
 * Two vocabularies arrive here and both have to work:
 *   - Arrow, from a result set's schema:  `Int32`, `Utf8`, `Timestamp<MICROSECOND>`
 *   - DuckDB, from `DESCRIBE`:            `BIGINT`, `VARCHAR`, `DECIMAL(18,2)`
 */

import type { ColumnKind } from './types';

/**
 * Reduce either vocabulary to a bare lowercase stem: parameters dropped, width
 * suffixes dropped. `Timestamp<MICROSECOND>` → `timestamp`, `Int32` → `int`,
 * `DECIMAL(18,2)` → `decimal`.
 */
export function normaliseType(type: string): string {
  return type
    .trim()
    .toLowerCase()
    .replace(/<.*$/, '')
    .replace(/\(.*$/, '')
    .replace(/\[\]$/, '')
    .replace(/\d+$/, '')
    .trim();
}

// Order matters. `interval` has to be tested before the numeric stems, or the
// `int` prefix claims it.
const PREFIXES: ReadonlyArray<readonly [ColumnKind, readonly string[]]> = [
  ['nested', ['list', 'struct', 'map', 'union', 'array', 'largelist', 'fixedsizelist']],
  ['boolean', ['bool', 'logical']],
  ['temporal', ['date', 'time', 'timestamp', 'datetime', 'interval']],
  ['binary', ['blob', 'bytea', 'binary', 'varbinary', 'bit', 'largebinary', 'fixedsizebinary']],
  [
    'number',
    [
      'int', 'uint', 'bigint', 'ubigint', 'smallint', 'usmallint', 'tinyint', 'utinyint',
      'hugeint', 'uhugeint', 'float', 'double', 'real', 'decimal', 'numeric',
    ],
  ],
];

export function columnKind(type: string): ColumnKind {
  const stem = normaliseType(type);
  if (!stem) return 'text';
  // `[]` suffix survives normalisation only when it was the whole marker of a
  // list type, e.g. DuckDB's `INTEGER[]`.
  if (/\[\]/.test(type)) return 'nested';
  for (const [kind, stems] of PREFIXES) {
    if (stems.some((s) => stem.startsWith(s))) return kind;
  }
  return 'text';
}

/** Numbers right-align so digits line up; everything else reads left. */
export function alignmentFor(kind: ColumnKind): 'left' | 'right' {
  return kind === 'number' ? 'right' : 'left';
}

/**
 * A short label for the type badge. Real types get long (`DECIMAL(18,2)`,
 * `TIMESTAMP WITH TIME ZONE`) and blow out the column header, so the badge
 * truncates and the full type goes in the tooltip.
 */
export function shortType(type: string, max = 14): string {
  const cleaned = type.replace(/\s+/g, ' ').trim();
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, max - 1)}…`;
}
