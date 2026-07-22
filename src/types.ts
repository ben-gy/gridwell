// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Ben Richardson — https://benrichardson.dev
// Additional terms under AGPL-3.0 section 7(b) apply; see ADDITIONAL-TERMS.md.
export type LogLevel = 'info' | 'good' | 'warn' | 'bad';

/** File formats DuckDB can open directly from a registered handle. */
export type SourceFormat = 'csv' | 'tsv' | 'json' | 'parquet';

/** Formats we can write back out. */
export type ExportFormat = 'csv' | 'json' | 'parquet';

/**
 * Broad display categories, derived from the Arrow type of a result column.
 * The grid only cares about alignment and how to render a cell, not about the
 * 40-odd concrete Arrow types.
 */
export type ColumnKind = 'number' | 'text' | 'boolean' | 'temporal' | 'binary' | 'nested';

export interface ColumnInfo {
  name: string;
  /** The DuckDB/Arrow type as reported by the engine, shown verbatim in the UI. */
  type: string;
  kind: ColumnKind;
}

export type FilterOperator =
  | '='
  | '!='
  | '>'
  | '>='
  | '<'
  | '<='
  | 'contains'
  | 'starts with'
  | 'ends with'
  | 'is null'
  | 'is not null';

export interface Filter {
  column: string;
  operator: FilterOperator;
  value: string;
}

export interface SortSpec {
  column: string;
  direction: 'asc' | 'desc';
}

export interface QuerySpec {
  /** Columns to project. Empty means `*`. */
  columns: string[];
  filters: Filter[];
  sort: SortSpec | null;
  limit: number | null;
}

export interface QueryResult {
  columns: ColumnInfo[];
  /** Row-major values, already converted to JS primitives. */
  rows: unknown[][];
  /** Rows actually materialised into `rows` (may be capped for display). */
  fetched: number;
  /** Milliseconds the engine spent on the query. */
  elapsedMs: number;
  /** True when `fetched` hit the display cap and more rows exist. */
  truncated: boolean;
}

export interface SourceInfo {
  fileName: string;
  format: SourceFormat;
  bytes: number;
  rowCount: number;
  columns: ColumnInfo[];
}
