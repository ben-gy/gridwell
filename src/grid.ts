/**
 * The result grid.
 *
 * Windowed rendering: only the rows intersecting the viewport exist in the DOM.
 * A 20,000-row × 30-column result is 600,000 cells; rendering those as real
 * elements costs seconds and hundreds of megabytes, and the user can see forty
 * of them. Rendering ~60 and repositioning on scroll keeps it flat regardless
 * of result size, which is the whole premise of the tool.
 */

import { formatValue } from './format';
import { alignmentFor, shortType } from './schema';
import type { ColumnInfo, ColumnKind } from './types';

const ROW_HEIGHT = 28;
const OVERSCAN = 8;
const MIN_COL_WIDTH = 72;
const MAX_COL_WIDTH = 420;
const CHAR_WIDTH = 7.6;
const WIDTH_SAMPLE = 200;

export interface GridSelection {
  row: number;
  column: number;
  value: unknown;
  columnName: string;
  columnType: string;
  kind: ColumnKind;
}

export class ResultGrid {
  private viewport: HTMLElement;
  private header: HTMLElement;
  private canvas: HTMLElement;
  private columns: ColumnInfo[] = [];
  private rows: unknown[][] = [];
  private widths: number[] = [];
  private renderedStart = -1;
  private renderedEnd = -1;
  private selected: { row: number; column: number } | null = null;
  private onSelect: (selection: GridSelection | null) => void;

  constructor(root: HTMLElement, onSelect: (selection: GridSelection | null) => void) {
    this.onSelect = onSelect;
    // `.grid` goes on an inner wrapper, never on `root` itself. When both
    // landed on the same element, `.grid { height: 100% }` overrode the host's
    // fixed `52vh`, the scroll viewport grew to the full content height, and
    // the windowing below silently rendered every row — 20,000 of them.
    root.innerHTML = `
      <div class="grid">
        <div class="grid-header" role="row"></div>
        <div class="grid-viewport" tabindex="0" role="grid" aria-label="Query results">
          <div class="grid-canvas"></div>
        </div>
      </div>`;
    this.header = root.querySelector('.grid-header') as HTMLElement;
    this.viewport = root.querySelector('.grid-viewport') as HTMLElement;
    this.canvas = root.querySelector('.grid-canvas') as HTMLElement;

    this.viewport.addEventListener('scroll', () => {
      // The header scrolls horizontally with the body but is pinned vertically,
      // so it is translated rather than being inside the scroll container —
      // `position:sticky` on a grid row leaves the cell borders behind.
      this.header.style.transform = `translateX(${-this.viewport.scrollLeft}px)`;
      this.paint();
    });

    this.viewport.addEventListener('click', (event) => {
      const cell = (event.target as HTMLElement).closest('.grid-cell') as HTMLElement | null;
      if (!cell) return;
      const row = Number(cell.dataset.row);
      const column = Number(cell.dataset.col);
      if (!Number.isInteger(row) || !Number.isInteger(column)) return;
      this.select(row, column);
    });

    this.viewport.addEventListener('keydown', (event) => this.onKeyDown(event));
  }

  setData(columns: ColumnInfo[], rows: unknown[][]): void {
    this.columns = columns;
    this.rows = rows;
    this.widths = fillWidth(measureWidths(columns, rows), this.viewport.clientWidth);
    this.selected = null;
    this.onSelect(null);
    this.renderedStart = -1;
    this.renderedEnd = -1;

    this.viewport.scrollTop = 0;
    this.viewport.scrollLeft = 0;
    this.header.style.transform = 'translateX(0px)';
    this.canvas.style.height = `${rows.length * ROW_HEIGHT}px`;
    this.canvas.style.width = `${this.totalWidth()}px`;

    this.renderHeader();
    this.paint();
  }

  clear(): void {
    this.setData([], []);
    this.header.innerHTML = '';
    this.canvas.innerHTML = '';
  }

  private totalWidth(): number {
    return this.widths.reduce((sum, w) => sum + w, 0);
  }

  private renderHeader(): void {
    this.header.style.width = `${this.totalWidth()}px`;
    this.header.innerHTML = '';
    this.columns.forEach((column, index) => {
      const cell = document.createElement('div');
      cell.className = `grid-head-cell align-${alignmentFor(column.kind)}`;
      cell.style.width = `${this.widths[index]}px`;
      cell.title = `${column.name} — ${column.type}`;

      const name = document.createElement('span');
      name.className = 'grid-head-name';
      name.textContent = column.name;

      const type = document.createElement('span');
      type.className = 'grid-head-type';
      type.textContent = shortType(column.type);

      cell.append(name, type);
      this.header.append(cell);
    });
  }

  /** Render only the window of rows currently on screen. */
  private paint(): void {
    if (!this.rows.length) {
      this.canvas.innerHTML = '';
      return;
    }

    const scrollTop = this.viewport.scrollTop;
    const visible = Math.ceil(this.viewport.clientHeight / ROW_HEIGHT);
    const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
    const end = Math.min(this.rows.length, start + visible + OVERSCAN * 2);

    if (start === this.renderedStart && end === this.renderedEnd) return;
    this.renderedStart = start;
    this.renderedEnd = end;

    const fragment = document.createDocumentFragment();
    for (let r = start; r < end; r++) {
      fragment.append(this.buildRow(r));
    }
    this.canvas.replaceChildren(fragment);
  }

  private buildRow(index: number): HTMLElement {
    const row = document.createElement('div');
    row.className = 'grid-row';
    row.style.transform = `translateY(${index * ROW_HEIGHT}px)`;
    row.setAttribute('role', 'row');
    if (index % 2) row.classList.add('is-odd');

    const values = this.rows[index];
    this.columns.forEach((column, c) => {
      const value = values[c];
      const cell = document.createElement('div');
      cell.className = `grid-cell align-${alignmentFor(column.kind)}`;
      cell.style.width = `${this.widths[c]}px`;
      cell.dataset.row = String(index);
      cell.dataset.col = String(c);
      cell.setAttribute('role', 'gridcell');

      if (value === null || value === undefined) {
        cell.classList.add('is-null');
        cell.textContent = 'NULL';
      } else {
        cell.textContent = formatValue(value, column);
      }
      if (this.selected?.row === index && this.selected.column === c) {
        cell.classList.add('is-selected');
      }
      row.append(cell);
    });
    return row;
  }

  private select(row: number, column: number): void {
    this.selected = { row, column };
    this.renderedStart = -1;
    this.renderedEnd = -1;
    this.paint();
    this.onSelect({
      row,
      column,
      value: this.rows[row]?.[column] ?? null,
      columnName: this.columns[column]?.name ?? '',
      columnType: this.columns[column]?.type ?? '',
      kind: this.columns[column]?.kind ?? 'text',
    });
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (!this.selected || !this.rows.length) return;
    const { row, column } = this.selected;
    let next: { row: number; column: number } | null = null;

    switch (event.key) {
      case 'ArrowDown':
        next = { row: Math.min(this.rows.length - 1, row + 1), column };
        break;
      case 'ArrowUp':
        next = { row: Math.max(0, row - 1), column };
        break;
      case 'ArrowRight':
        next = { row, column: Math.min(this.columns.length - 1, column + 1) };
        break;
      case 'ArrowLeft':
        next = { row, column: Math.max(0, column - 1) };
        break;
      default:
        return;
    }

    event.preventDefault();
    this.select(next.row, next.column);
    this.scrollRowIntoView(next.row);
  }

  private scrollRowIntoView(row: number): void {
    const top = row * ROW_HEIGHT;
    const bottom = top + ROW_HEIGHT;
    if (top < this.viewport.scrollTop) this.viewport.scrollTop = top;
    else if (bottom > this.viewport.scrollTop + this.viewport.clientHeight) {
      this.viewport.scrollTop = bottom - this.viewport.clientHeight;
    }
  }
}

/**
 * Size each column from its widest sampled value.
 *
 * Sampling the first 200 rows rather than all 20,000 keeps this O(sample) — and
 * a column whose 8,000th value is unusually long simply gets an ellipsis, which
 * is a far better outcome than a two-second layout pass on every query.
 */
export function measureWidths(columns: ColumnInfo[], rows: unknown[][]): number[] {
  const sample = Math.min(rows.length, WIDTH_SAMPLE);
  return columns.map((column, index) => {
    // The header carries the name and the type badge side by side.
    let longest = column.name.length + shortType(column.type).length + 4;
    for (let r = 0; r < sample; r++) {
      const length = formatValue(rows[r][index], column).length;
      if (length > longest) longest = length;
    }
    const width = Math.round(longest * CHAR_WIDTH) + 22;
    return Math.max(MIN_COL_WIDTH, Math.min(MAX_COL_WIDTH, width));
  });
}

/**
 * Spread any leftover horizontal space across the columns.
 *
 * Content-sized columns on a wide screen leave a band of empty background to
 * the right of the last one, which reads as a rendering fault rather than as a
 * narrow table. Widening proportionally keeps the relative sizing intact.
 */
export function fillWidth(widths: number[], available: number): number[] {
  if (!widths.length || !Number.isFinite(available) || available <= 0) return widths;
  const total = widths.reduce((sum, w) => sum + w, 0);
  if (total >= available) return widths;

  const scale = available / total;
  const scaled = widths.map((w) => Math.floor(w * scale));
  // Floor loses up to one pixel per column; give the remainder to the last one
  // so the row ends exactly flush with the viewport edge.
  const drift = available - scaled.reduce((sum, w) => sum + w, 0);
  scaled[scaled.length - 1] += drift;
  return scaled;
}
