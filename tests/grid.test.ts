import { describe, expect, it } from 'vitest';

import { fillWidth, measureWidths } from '../src/grid';
import { describeError } from '../src/ui';
import type { ColumnInfo } from '../src/types';

const column = (name: string, type = 'VARCHAR'): ColumnInfo => ({
  name,
  type,
  kind: type === 'BIGINT' ? 'number' : 'text',
});

describe('measureWidths', () => {
  it('returns one width per column', () => {
    const widths = measureWidths([column('a'), column('b')], [['x', 'y']]);
    expect(widths).toHaveLength(2);
  });

  it('never goes below the minimum, even for a one-character column', () => {
    const [width] = measureWidths([column('a')], [['x']]);
    expect(width).toBeGreaterThanOrEqual(72);
  });

  it('never exceeds the maximum, however long the value', () => {
    const [width] = measureWidths([column('a')], [['x'.repeat(5000)]]);
    expect(width).toBeLessThanOrEqual(420);
  });

  it('widens for a long value relative to a short one', () => {
    const narrow = measureWidths([column('a')], [['x']])[0];
    const wide = measureWidths([column('a')], [['a fairly long cell value here']])[0];
    expect(wide).toBeGreaterThan(narrow);
  });

  it('accounts for the header when every value is short', () => {
    const short = measureWidths([column('id')], [['1']])[0];
    const long = measureWidths([column('a_very_long_column_name')], [['1']])[0];
    expect(long).toBeGreaterThan(short);
  });

  it('handles an empty result set without throwing', () => {
    expect(() => measureWidths([column('a')], [])).not.toThrow();
    expect(measureWidths([column('a')], [])).toHaveLength(1);
  });

  it('handles zero columns', () => {
    expect(measureWidths([], [])).toEqual([]);
  });

  it('measures nulls as empty rather than as the word null', () => {
    const widths = measureWidths([column('a')], [[null], [null]]);
    expect(widths[0]).toBe(measureWidths([column('a')], [['']])[0]);
  });

  it('only samples the first 200 rows, so a late long value does not widen it', () => {
    const rows: unknown[][] = Array.from({ length: 400 }, () => ['x']);
    rows[399] = ['y'.repeat(300)];
    const [width] = measureWidths([column('a')], rows);
    expect(width).toBe(measureWidths([column('a')], [['x']])[0]);
  });
});

describe('fillWidth', () => {
  it('leaves columns alone when they already overflow', () => {
    expect(fillWidth([500, 500], 800)).toEqual([500, 500]);
  });

  it('fills the viewport exactly when there is slack', () => {
    const filled = fillWidth([100, 100], 500);
    expect(filled.reduce((a, b) => a + b, 0)).toBe(500);
  });

  it('preserves relative proportions', () => {
    const [a, b] = fillWidth([100, 200], 600);
    expect(b).toBeGreaterThan(a);
    expect(b / a).toBeCloseTo(2, 1);
  });

  it('absorbs rounding drift into the last column so the row ends flush', () => {
    const filled = fillWidth([33, 33, 33], 1000);
    expect(filled.reduce((a, b) => a + b, 0)).toBe(1000);
  });

  it('handles a single column', () => {
    expect(fillWidth([100], 400)).toEqual([400]);
  });

  it('is a no-op for degenerate input rather than throwing', () => {
    expect(fillWidth([], 500)).toEqual([]);
    expect(fillWidth([100], 0)).toEqual([100]);
    expect(fillWidth([100], Number.NaN)).toEqual([100]);
  });
});

describe('describeError', () => {
  it('strips the DuckDB exception class prefix', () => {
    expect(describeError(new Error('Binder Error: Referenced column "x" not found'))).toBe(
      'Referenced column "x" not found',
    );
  });

  it('handles the other engine prefixes', () => {
    expect(describeError(new Error('Conversion Error: could not convert'))).toBe(
      'could not convert',
    );
    expect(describeError(new Error('Out of Memory Error: buffer full'))).toBe('buffer full');
  });

  it('leaves an ordinary message alone', () => {
    expect(describeError(new Error('Something specific broke'))).toBe('Something specific broke');
  });

  it('falls back when the message is empty', () => {
    expect(describeError(new Error(''))).toBe('Something went wrong.');
  });

  it('accepts a bare string', () => {
    expect(describeError('plain failure')).toBe('plain failure');
  });

  it('falls back for a non-error value', () => {
    expect(describeError(null)).toBe('Something went wrong.');
    expect(describeError({ weird: true })).toBe('Something went wrong.');
  });
});
