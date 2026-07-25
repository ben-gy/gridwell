import { describe, expect, it } from 'vitest';

import { buildExampleCsv, EXAMPLE_COLUMNS, EXAMPLE_FILE_NAME, exampleFile } from '../src/example';

describe('buildExampleCsv', () => {
  it('emits the header followed by the requested number of rows', () => {
    const lines = buildExampleCsv(10).trimEnd().split('\n');
    expect(lines[0]).toBe(EXAMPLE_COLUMNS.join(','));
    expect(lines).toHaveLength(11); // header + 10 rows
  });

  it('is deterministic for a given seed', () => {
    expect(buildExampleCsv(50)).toBe(buildExampleCsv(50));
  });

  it('changes with the seed', () => {
    expect(buildExampleCsv(50, 1)).not.toBe(buildExampleCsv(50, 2));
  });

  it('gives every row the full set of columns', () => {
    const rows = buildExampleCsv(200).trimEnd().split('\n').slice(1);
    for (const row of rows) {
      // The product name is quoted (it contains a space but no comma, so it is
      // not, actually) — split is safe here because no generated field carries
      // a comma. Assert that assumption holds rather than trusting it silently.
      expect(row.includes('"')).toBe(false);
      expect(row.split(',')).toHaveLength(EXAMPLE_COLUMNS.length);
    }
  });

  it('keeps revenue consistent with units × unit_price', () => {
    const rows = buildExampleCsv(500).trimEnd().split('\n').slice(1);
    const iUnits = EXAMPLE_COLUMNS.indexOf('units');
    const iPrice = EXAMPLE_COLUMNS.indexOf('unit_price');
    const iRevenue = EXAMPLE_COLUMNS.indexOf('revenue');
    for (const row of rows) {
      const cells = row.split(',');
      const expected = Number(cells[iUnits]) * Number(cells[iPrice]);
      expect(Number(cells[iRevenue])).toBeCloseTo(expected, 2);
    }
  });

  it('only ever marks returned as a boolean literal', () => {
    const rows = buildExampleCsv(300).trimEnd().split('\n').slice(1);
    const iReturned = EXAMPLE_COLUMNS.indexOf('returned');
    for (const row of rows) {
      expect(['true', 'false']).toContain(row.split(',')[iReturned]);
    }
  });

  it('ends with a trailing newline, as a real CSV export would', () => {
    expect(buildExampleCsv(3).endsWith('\n')).toBe(true);
  });
});

describe('exampleFile', () => {
  it('wraps the CSV as a named text/csv File', () => {
    const file = exampleFile();
    expect(file.name).toBe(EXAMPLE_FILE_NAME);
    expect(file.type).toBe('text/csv');
    expect(file.size).toBeGreaterThan(0);
  });
});
