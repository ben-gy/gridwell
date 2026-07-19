import { describe, expect, it } from 'vitest';

import {
  exportFileName,
  formatBytes,
  formatCell,
  formatCount,
  formatDuration,
  formatTemporal,
  formatThroughput,
  formatTimestamp,
  formatValue,
  isFloatType,
} from '../src/format';
import type { ColumnKind } from '../src/types';

describe('formatBytes', () => {
  it('leaves bytes alone below 1 KB', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(999)).toBe('999 B');
  });

  it('steps up through the units', () => {
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1024 * 1024 * 2.5)).toBe('2.5 MB');
    expect(formatBytes(1024 ** 3 * 3)).toBe('3.0 GB');
  });

  it('drops the decimal once the number is large enough not to need it', () => {
    expect(formatBytes(1024 * 512)).toBe('512 KB');
  });

  it('stops at the largest unit rather than inventing one', () => {
    expect(formatBytes(1024 ** 5)).toBe('1024 TB');
  });

  it('rejects nonsense', () => {
    expect(formatBytes(-1)).toBe('—');
    expect(formatBytes(Number.NaN)).toBe('—');
  });
});

describe('formatCount', () => {
  it('groups thousands', () => {
    expect(formatCount(4200000)).toBe('4,200,000');
  });

  it('handles bigint without precision loss', () => {
    expect(formatCount(9007199254740993n)).toBe('9,007,199,254,740,993');
  });

  it('rounds a float to a whole count', () => {
    expect(formatCount(1234.6)).toBe('1,235');
  });

  it('handles zero and non-finite input', () => {
    expect(formatCount(0)).toBe('0');
    expect(formatCount(Number.POSITIVE_INFINITY)).toBe('—');
  });
});

describe('formatDuration', () => {
  it('floors sub-millisecond timings', () => {
    expect(formatDuration(0.2)).toBe('<1 ms');
  });

  it('shows milliseconds under a second', () => {
    expect(formatDuration(420)).toBe('420 ms');
  });

  it('switches to seconds with sensible precision', () => {
    expect(formatDuration(1500)).toBe('1.50 s');
    expect(formatDuration(42_000)).toBe('42.0 s');
  });

  it('switches to minutes past a minute', () => {
    expect(formatDuration(95_000)).toBe('1m 35s');
  });

  it('rejects nonsense', () => {
    expect(formatDuration(-1)).toBe('—');
  });
});

describe('formatThroughput', () => {
  it('reports bytes per second', () => {
    expect(formatThroughput(1024 * 1024, 1000)).toBe('1.0 MB/s');
  });

  it('guards against a zero elapsed time', () => {
    expect(formatThroughput(100, 0)).toBe('—');
  });
});

describe('formatTimestamp', () => {
  it('zero-pads to HH:MM:SS', () => {
    const date = new Date(2026, 0, 1, 9, 5, 3);
    expect(formatTimestamp(date)).toBe('09:05:03');
  });
});

describe('formatCell', () => {
  it('renders null and undefined as empty so the grid can style them', () => {
    expect(formatCell(null)).toBe('');
    expect(formatCell(undefined)).toBe('');
  });

  it('keeps bigint precision that Number would lose', () => {
    expect(formatCell(9007199254740993n)).toBe('9,007,199,254,740,993');
  });

  it('groups integers but leaves float precision alone', () => {
    expect(formatCell(1234567)).toBe('1,234,567');
    expect(formatCell(0.30000000000000004)).toBe('0.30000000000000004');
  });

  it('renders booleans as words', () => {
    expect(formatCell(true)).toBe('true');
    expect(formatCell(false)).toBe('false');
  });

  it('renders a date as ISO and an invalid date as empty', () => {
    expect(formatCell(new Date(Date.UTC(2026, 6, 20)))).toBe('2026-07-20T00:00:00.000Z');
    expect(formatCell(new Date(Number.NaN))).toBe('');
  });

  it('hex-encodes binary and truncates a long blob', () => {
    expect(formatCell(new Uint8Array([0, 15, 255]))).toBe('0x000fff');
    expect(formatCell(new Uint8Array(40))).toMatch(/…$/);
  });

  it('serialises nested values, including bigints inside them', () => {
    expect(formatCell({ a: 1 })).toBe('{"a":1}');
    expect(formatCell({ a: 1n })).toBe('{"a":"1"}');
  });

  it('survives a circular object rather than throwing into the grid', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => formatCell(circular)).not.toThrow();
  });

  it('preserves an empty string as empty', () => {
    expect(formatCell('')).toBe('');
  });

  it('passes non-finite numbers through visibly', () => {
    expect(formatCell(Number.NaN)).toBe('NaN');
    expect(formatCell(Number.POSITIVE_INFINITY)).toBe('Infinity');
  });
});

describe('formatTemporal', () => {
  it('renders a day-precision value as a bare date', () => {
    // Arrow hands Date32 back as epoch milliseconds, not a Date object.
    expect(formatTemporal(1771113600000)).toBe('2026-02-15');
  });

  it('renders a value with a time component in full', () => {
    expect(formatTemporal(1771113600000 + 3_600_000)).toBe('2026-02-15 01:00:00.000');
  });

  it('accepts bigint, which nanosecond timestamps arrive as', () => {
    expect(formatTemporal(1771113600000n)).toBe('2026-02-15');
  });

  it('handles the epoch itself', () => {
    expect(formatTemporal(0)).toBe('1970-01-01');
  });

  it('handles a pre-epoch date', () => {
    expect(formatTemporal(-86_400_000)).toBe('1969-12-31');
  });

  it('falls back to the raw value rather than throwing on nonsense', () => {
    expect(formatTemporal(Number.NaN)).toBe('NaN');
    expect(formatTemporal(8.64e15 * 2)).toBe('17280000000000000');
  });
});

describe('isFloatType', () => {
  it.each(['Float64', 'DOUBLE', 'REAL', 'DECIMAL(18,2)', 'numeric'])(
    'recognises %s as floating point',
    (type) => {
      expect(isFloatType(type)).toBe(true);
    },
  );

  it.each(['Int64', 'BIGINT', 'INTEGER', 'VARCHAR'])('does not claim %s', (type) => {
    expect(isFloatType(type)).toBe(false);
  });
});

describe('formatValue', () => {
  const col = (type: string, kind: ColumnKind) => ({ type, kind });

  it('converts a temporal number instead of grouping it as a count', () => {
    expect(formatValue(1771113600000, col('Date32<DAY>', 'temporal'))).toBe('2026-02-15');
    expect(formatValue(1771113600000, col('Int64', 'number'))).toBe('1,771,113,600,000');
  });

  it('keeps a float column internally consistent — no separators on whole values', () => {
    // 164400 and 164394.52 live in the same Float64 column; styling one with
    // separators and the other without is the bug this prevents.
    expect(formatValue(164400, col('Float64', 'number'))).toBe('164400');
    expect(formatValue(164394.52, col('Float64', 'number'))).toBe('164394.52');
  });

  it('still groups integer columns, where every value gets separators', () => {
    expect(formatValue(120000, col('Int64', 'number'))).toBe('120,000');
  });

  it('leaves other kinds to the ordinary formatter', () => {
    expect(formatValue('Perth', col('Utf8', 'text'))).toBe('Perth');
    expect(formatValue(true, col('Bool', 'boolean'))).toBe('true');
  });

  it('passes a real Date through unchanged for a temporal column', () => {
    expect(formatValue(new Date(Date.UTC(2026, 1, 15)), col('Timestamp', 'temporal'))).toBe(
      '2026-02-15T00:00:00.000Z',
    );
  });

  it('keeps null empty regardless of column', () => {
    expect(formatValue(null, col('Date32<DAY>', 'temporal'))).toBe('');
    expect(formatValue(null, col('Float64', 'number'))).toBe('');
  });
});

describe('exportFileName', () => {
  it('swaps the extension', () => {
    expect(exportFileName('sales-export.csv', 'parquet')).toBe('sales-export.parquet');
  });

  it('marks the file when the format is unchanged, so a filtered subset cannot silently shadow the original', () => {
    expect(exportFileName('customers.csv', 'csv')).toBe('customers-filtered.csv');
    expect(exportFileName('events.json', 'json')).toBe('events-filtered.json');
  });

  it('does not mark it when the extension genuinely changes', () => {
    expect(exportFileName('customers.csv', 'json')).toBe('customers.json');
  });

  it('only strips the last extension', () => {
    expect(exportFileName('2026.q1.data.csv', 'json')).toBe('2026.q1.data.json');
  });

  it('appends when there is no extension', () => {
    expect(exportFileName('data', 'csv')).toBe('data.csv');
  });

  it('falls back to a usable name for a dotfile-only input', () => {
    expect(exportFileName('.csv', 'json')).toBe('gridwell.json');
  });
});
