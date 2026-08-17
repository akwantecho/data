import { parseCsv, suggestMapping } from './csv-parser';

const csv = (text: string) => Buffer.from(text, 'utf8');

describe('parseCsv', () => {
  it('reads a comma-separated file', () => {
    const parsed = parseCsv(csv('Metric,Period,Value\nrevenue,2026-01,1000\n'));

    expect(parsed.columns).toEqual(['Metric', 'Period', 'Value']);
    expect(parsed.rows).toEqual([{ Metric: 'revenue', Period: '2026-01', Value: '1000' }]);
  });

  it('auto-detects semicolon and tab delimiters', () => {
    expect(parseCsv(csv('a;b\n1;2\n')).columns).toEqual(['a', 'b']);
    expect(parseCsv(csv('a\tb\n1\t2\n')).columns).toEqual(['a', 'b']);
  });

  it('handles quoted fields containing the delimiter', () => {
    const parsed = parseCsv(csv('Metric,Note\nrevenue,"Muscat, Oman"\n'));

    expect(parsed.rows[0].Note).toBe('Muscat, Oman');
  });

  it('strips a UTF-8 BOM from the first header', () => {
    const parsed = parseCsv(
      Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), csv('Metric\nrevenue\n')]),
    );

    expect(parsed.columns).toEqual(['Metric']);
  });

  it('trims header and cell whitespace', () => {
    const parsed = parseCsv(csv(' Metric , Value \n revenue , 1000 \n'));

    expect(parsed.columns).toEqual(['Metric', 'Value']);
    expect(parsed.rows[0]).toEqual({ Metric: 'revenue', Value: '1000' });
  });

  it('fills missing trailing cells rather than failing the file', () => {
    const parsed = parseCsv(csv('a,b,c\n1,2\n'));

    expect(parsed.rows[0]).toEqual({ a: '1', b: '2', c: '' });
  });

  it('rejects an empty file', () => {
    expect(() => parseCsv(csv('   '))).toThrow(/empty/i);
  });

  it('rejects a header with no rows', () => {
    expect(() => parseCsv(csv('Metric,Value\n'))).toThrow(/no data rows/i);
  });

  it('rejects duplicate headers, which would silently drop a column', () => {
    expect(() => parseCsv(csv('Value,Value\n1,2\n'))).toThrow(/duplicate column/i);
  });
});

describe('suggestMapping', () => {
  it('recognises the obvious names', () => {
    expect(suggestMapping(['Metric', 'Period', 'Value', 'Branch', 'Department'])).toEqual({
      metricCode: 'Metric',
      period: 'Period',
      value: 'Value',
      branchCode: 'Branch',
      departmentCode: 'Department',
    });
  });

  it('recognises common synonyms and spellings', () => {
    const mapping = suggestMapping(['KPI', 'Month', 'Amount', 'Site', 'Team']);

    expect(mapping).toMatchObject({
      metricCode: 'KPI',
      period: 'Month',
      value: 'Amount',
      branchCode: 'Site',
      departmentCode: 'Team',
    });
  });

  it('ignores case, spaces and underscores', () => {
    const mapping = suggestMapping(['metric_code', 'PERIOD', 'Total ']);

    expect(mapping).toMatchObject({ metricCode: 'metric_code', period: 'PERIOD' });
  });

  it('leaves a target null when nothing matches', () => {
    expect(suggestMapping(['alpha', 'beta']).metricCode).toBeNull();
  });
});
