import { describe, expect, it } from 'vitest';

import {
  PREVIEW_LIMIT,
  buildExportSql,
  buildFilterClause,
  buildQuery,
  countQuery,
  createViewSql,
  detectFormat,
  literalFor,
  quoteIdent,
  quoteLiteral,
  readerFor,
  stripTrailingSemicolon,
  validateUserSql,
  withPreviewLimit,
} from '../src/sql';
import type { QuerySpec } from '../src/types';

const base: QuerySpec = { columns: [], filters: [], sort: null, limit: null };

describe('quoteIdent', () => {
  it('wraps a plain name', () => {
    expect(quoteIdent('amount')).toBe('"amount"');
  });

  it('doubles embedded quotes', () => {
    expect(quoteIdent('my "odd" col')).toBe('"my ""odd"" col"');
  });

  it('survives a name that is entirely quotes', () => {
    expect(quoteIdent('""')).toBe('""""""');
  });

  it('preserves spaces and newlines that real exports contain', () => {
    expect(quoteIdent('first name\n')).toBe('"first name\n"');
  });

  it('handles an empty name', () => {
    expect(quoteIdent('')).toBe('""');
  });
});

describe('quoteLiteral', () => {
  it('wraps a plain value', () => {
    expect(quoteLiteral('acme')).toBe("'acme'");
  });

  it('doubles single quotes', () => {
    expect(quoteLiteral("O'Brien")).toBe("'O''Brien'");
  });

  it('does not treat a backslash as an escape', () => {
    expect(quoteLiteral('a\\b')).toBe("'a\\b'");
  });

  it('handles an empty string', () => {
    expect(quoteLiteral('')).toBe("''");
  });
});

describe('literalFor', () => {
  it('leaves integers unquoted so numeric comparison stays numeric', () => {
    expect(literalFor('100')).toBe('100');
  });

  it('leaves negative and decimal numbers unquoted', () => {
    expect(literalFor('-12.5')).toBe('-12.5');
  });

  it('uppercases booleans', () => {
    expect(literalFor('true')).toBe('TRUE');
    expect(literalFor('False')).toBe('FALSE');
  });

  it('maps a bare null to SQL NULL', () => {
    expect(literalFor('null')).toBe('NULL');
  });

  it('quotes anything else', () => {
    expect(literalFor('100 apples')).toBe("'100 apples'");
    expect(literalFor('2024-01-01')).toBe("'2024-01-01'");
  });

  it('quotes a value that is only whitespace rather than emitting bare space', () => {
    expect(literalFor('   ')).toBe("'   '");
  });
});

describe('detectFormat', () => {
  it.each([
    ['sales.csv', 'csv'],
    ['SALES.CSV', 'csv'],
    ['export.tsv', 'tsv'],
    ['export.tab', 'tsv'],
    ['events.json', 'json'],
    ['events.ndjson', 'json'],
    ['events.jsonl', 'json'],
    ['facts.parquet', 'parquet'],
    ['facts.pq', 'parquet'],
  ])('maps %s to %s', (name, expected) => {
    expect(detectFormat(name)).toBe(expected);
  });

  it('falls back to csv for an unknown or missing extension', () => {
    expect(detectFormat('data')).toBe('csv');
    expect(detectFormat('data.txt')).toBe('csv');
  });

  it('uses the last extension, not the first', () => {
    expect(detectFormat('archive.csv.parquet')).toBe('parquet');
  });
});

describe('readerFor', () => {
  it('scans the whole CSV before fixing types', () => {
    expect(readerFor('a.csv', 'csv')).toBe("read_csv_auto('a.csv', sample_size=-1)");
  });

  it('passes a tab delimiter for TSV', () => {
    expect(readerFor('a.tsv', 'tsv')).toContain("delim='\\t'");
  });

  it('uses the parquet and json readers', () => {
    expect(readerFor('a.parquet', 'parquet')).toBe("read_parquet('a.parquet')");
    expect(readerFor('a.json', 'json')).toBe("read_json_auto('a.json')");
  });

  it('escapes a quote in the file name', () => {
    expect(readerFor("bob's data.csv", 'csv')).toContain("'bob''s data.csv'");
  });
});

describe('createViewSql', () => {
  it('creates the view the rest of the app queries', () => {
    expect(createViewSql('a.csv', 'csv')).toBe(
      `CREATE OR REPLACE VIEW "data" AS SELECT * FROM read_csv_auto('a.csv', sample_size=-1)`,
    );
  });
});

describe('buildFilterClause', () => {
  it('builds a numeric comparison without quoting the number', () => {
    expect(buildFilterClause({ column: 'amount', operator: '>', value: '500' })).toBe(
      '"amount" > 500',
    );
  });

  it('quotes a text equality', () => {
    expect(buildFilterClause({ column: 'city', operator: '=', value: 'Perth' })).toBe(
      `"city" = 'Perth'`,
    );
  });

  it('builds a case-insensitive contains', () => {
    expect(buildFilterClause({ column: 'name', operator: 'contains', value: 'ltd' })).toBe(
      `CAST("name" AS VARCHAR) ILIKE '%ltd%'`,
    );
  });

  it('anchors starts with and ends with correctly', () => {
    expect(buildFilterClause({ column: 'n', operator: 'starts with', value: 'A' })).toContain(
      `ILIKE 'A%'`,
    );
    expect(buildFilterClause({ column: 'n', operator: 'ends with', value: 'Z' })).toContain(
      `ILIKE '%Z'`,
    );
  });

  it('escapes LIKE wildcards a user typed literally', () => {
    expect(buildFilterClause({ column: 'n', operator: 'contains', value: '50%' })).toBe(
      `CAST("n" AS VARCHAR) ILIKE '%50\\%%'`,
    );
    expect(buildFilterClause({ column: 'n', operator: 'contains', value: 'a_b' })).toContain(
      'a\\_b',
    );
  });

  it('drops the operand for null checks', () => {
    expect(buildFilterClause({ column: 'x', operator: 'is null', value: 'ignored' })).toBe(
      '"x" IS NULL',
    );
    expect(buildFilterClause({ column: 'x', operator: 'is not null', value: '' })).toBe(
      '"x" IS NOT NULL',
    );
  });
});

describe('buildQuery', () => {
  it('selects everything by default', () => {
    expect(buildQuery(base)).toBe('SELECT *\nFROM "data"');
  });

  it('projects named columns', () => {
    expect(buildQuery({ ...base, columns: ['a', 'b'] })).toContain('SELECT "a", "b"');
  });

  it('joins multiple filters with AND', () => {
    const sql = buildQuery({
      ...base,
      filters: [
        { column: 'a', operator: '>', value: '1' },
        { column: 'b', operator: '=', value: 'x' },
      ],
    });
    expect(sql).toContain('WHERE "a" > 1');
    expect(sql).toContain('AND "b" = \'x\'');
  });

  it('omits filters whose value is still blank', () => {
    const sql = buildQuery({ ...base, filters: [{ column: 'a', operator: '=', value: '  ' }] });
    expect(sql).not.toContain('WHERE');
  });

  it('keeps a blank-valued null check, which needs no operand', () => {
    const sql = buildQuery({ ...base, filters: [{ column: 'a', operator: 'is null', value: '' }] });
    expect(sql).toContain('WHERE "a" IS NULL');
  });

  it('adds ORDER BY and LIMIT', () => {
    const sql = buildQuery({ ...base, sort: { column: 'a', direction: 'desc' }, limit: 25 });
    expect(sql).toContain('ORDER BY "a" DESC');
    expect(sql).toContain('LIMIT 25');
  });

  it('ignores a zero or negative limit', () => {
    expect(buildQuery({ ...base, limit: 0 })).not.toContain('LIMIT');
    expect(buildQuery({ ...base, limit: -5 })).not.toContain('LIMIT');
  });

  it('floors a fractional limit rather than emitting invalid SQL', () => {
    expect(buildQuery({ ...base, limit: 10.9 })).toContain('LIMIT 10');
  });
});

describe('wrapping helpers', () => {
  it('strips a trailing semicolon and surrounding space', () => {
    expect(stripTrailingSemicolon('SELECT 1;  ')).toBe('SELECT 1');
    expect(stripTrailingSemicolon('SELECT 1')).toBe('SELECT 1');
  });

  it('wraps a statement in a preview limit', () => {
    expect(withPreviewLimit('SELECT 1;', 5)).toBe('SELECT * FROM (\nSELECT 1\n) LIMIT 5');
  });

  it('defaults to the shared preview cap', () => {
    expect(withPreviewLimit('SELECT 1')).toContain(`LIMIT ${PREVIEW_LIMIT}`);
  });

  it('counts through a subquery', () => {
    expect(countQuery('SELECT 1;')).toBe('SELECT COUNT(*) AS n FROM (\nSELECT 1\n)');
  });
});

describe('buildExportSql', () => {
  it('writes CSV with a header row', () => {
    const sql = buildExportSql('SELECT 1', 'csv', 'out.csv');
    expect(sql).toContain("TO 'out.csv'");
    expect(sql).toContain('FORMAT CSV, HEADER');
  });

  it('writes JSON as an array', () => {
    expect(buildExportSql('SELECT 1', 'json', 'o.json')).toContain('FORMAT JSON, ARRAY true');
  });

  it('compresses parquet', () => {
    expect(buildExportSql('SELECT 1', 'parquet', 'o.parquet')).toContain('COMPRESSION ZSTD');
  });

  it('strips the trailing semicolon so the subquery parses', () => {
    expect(buildExportSql('SELECT 1;', 'csv', 'o.csv')).not.toContain('1;');
  });
});

describe('validateUserSql', () => {
  it('accepts a plain SELECT', () => {
    expect(validateUserSql('SELECT * FROM data')).toEqual({ ok: true });
  });

  it.each(['WITH x AS (SELECT 1) SELECT * FROM x', 'DESCRIBE data', 'SUMMARIZE data', 'FROM data'])(
    'accepts %s',
    (sql) => {
      expect(validateUserSql(sql).ok).toBe(true);
    },
  );

  it('rejects an empty query', () => {
    expect(validateUserSql('   ').ok).toBe(false);
  });

  it.each(['DROP TABLE data', 'INSERT INTO data VALUES (1)', 'ATTACH \'x.db\'', 'INSTALL httpfs'])(
    'rejects %s',
    (sql) => {
      expect(validateUserSql(sql).ok).toBe(false);
    },
  );

  it('rejects a remote path so nothing can be pulled over the network', () => {
    const result = validateUserSql("SELECT * FROM read_csv_auto('https://evil.example/x.csv')");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/Remote paths/);
  });

  it('rejects an s3 path too', () => {
    expect(validateUserSql("SELECT * FROM 's3://bucket/x.parquet'").ok).toBe(false);
  });

  it('rejects a statement that does not start with a read verb', () => {
    expect(validateUserSql('EXPLAIN ANALYZE SELECT 1').ok).toBe(false);
  });

  it('tolerates leading whitespace and a trailing semicolon', () => {
    expect(validateUserSql('\n  SELECT 1;\n').ok).toBe(true);
  });
});
