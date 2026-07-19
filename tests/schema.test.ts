import { describe, expect, it } from 'vitest';

import { alignmentFor, columnKind, normaliseType, shortType } from '../src/schema';

describe('normaliseType', () => {
  it('drops Arrow type parameters', () => {
    expect(normaliseType('Timestamp<MICROSECOND>')).toBe('timestamp');
  });

  it('drops DuckDB type parameters', () => {
    expect(normaliseType('DECIMAL(18,2)')).toBe('decimal');
  });

  it('drops Arrow width suffixes', () => {
    expect(normaliseType('Int32')).toBe('int');
    expect(normaliseType('Float64')).toBe('float');
  });
});

describe('columnKind', () => {
  it.each(['BIGINT', 'INTEGER', 'Int32', 'Int64', 'Float64', 'DOUBLE', 'DECIMAL(18,2)', 'UBIGINT', 'HUGEINT'])(
    'treats %s as a number',
    (type) => {
      expect(columnKind(type)).toBe('number');
    },
  );

  it.each(['VARCHAR', 'Utf8', 'LargeUtf8', 'TEXT', 'UUID'])('treats %s as text', (type) => {
    expect(columnKind(type)).toBe('text');
  });

  it.each(['BOOLEAN', 'Bool'])('treats %s as boolean', (type) => {
    expect(columnKind(type)).toBe('boolean');
  });

  it.each(['DATE', 'Date32<DAY>', 'TIMESTAMP', 'Timestamp<MICROSECOND>', 'TIME', 'INTERVAL'])(
    'treats %s as temporal',
    (type) => {
      expect(columnKind(type)).toBe('temporal');
    },
  );

  it('does not let the int prefix claim INTERVAL', () => {
    expect(columnKind('INTERVAL')).toBe('temporal');
    expect(columnKind('INTEGER')).toBe('number');
  });

  it.each(['BLOB', 'Binary', 'VARBINARY', 'BIT'])('treats %s as binary', (type) => {
    expect(columnKind(type)).toBe('binary');
  });

  it('does not let the bit prefix claim BIGINT', () => {
    expect(columnKind('BIGINT')).toBe('number');
  });

  it.each(['STRUCT(a INT)', 'List<Int32>', 'MAP(VARCHAR, INT)', 'INTEGER[]'])(
    'treats %s as nested',
    (type) => {
      expect(columnKind(type)).toBe('nested');
    },
  );

  it('falls back to text for an empty or unknown type', () => {
    expect(columnKind('')).toBe('text');
    expect(columnKind('   ')).toBe('text');
    expect(columnKind('SOMETHING_NEW')).toBe('text');
  });

  it('is case insensitive', () => {
    expect(columnKind('bigint')).toBe('number');
    expect(columnKind('BiGiNt')).toBe('number');
  });
});

describe('alignmentFor', () => {
  it('right-aligns numbers only', () => {
    expect(alignmentFor('number')).toBe('right');
    expect(alignmentFor('text')).toBe('left');
    expect(alignmentFor('temporal')).toBe('left');
  });
});

describe('shortType', () => {
  it('leaves a short type alone', () => {
    expect(shortType('BIGINT')).toBe('BIGINT');
  });

  it('truncates a long type with an ellipsis', () => {
    expect(shortType('TIMESTAMP WITH TIME ZONE')).toBe('TIMESTAMP WIT…');
    expect(shortType('TIMESTAMP WITH TIME ZONE').length).toBe(14);
  });

  it('collapses runs of whitespace', () => {
    expect(shortType('BIG   INT')).toBe('BIG INT');
  });

  it('respects a custom maximum', () => {
    expect(shortType('BIGINT', 4)).toBe('BIG…');
  });
});
