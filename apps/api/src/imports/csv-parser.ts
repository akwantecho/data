import { parse } from 'csv-parse/sync';
import { ApiException } from '../common/errors/api-exception';

export interface ParsedCsv {
  /** Header names in file order, trimmed. */
  columns: string[];
  /** One record per data row, keyed by column name. */
  rows: Array<Record<string, string>>;
}

/** Hard ceiling on rows per file for the MVP; larger files need the async path. */
export const MAX_IMPORT_ROWS = 50_000;

/**
 * Parses an uploaded CSV.
 *
 * Delimiter is auto-detected between comma, semicolon and tab, because European
 * exports commonly use semicolons and a mis-detected delimiter would turn every
 * row into one unusable column. A BOM is stripped so the first header name does
 * not silently gain an invisible character.
 */
export function parseCsv(buffer: Buffer): ParsedCsv {
  // Strips a UTF-8 BOM so the first header name does not gain an invisible character.
  const text = buffer.toString('utf8').replace(/^\uFEFF/, '');

  if (text.trim().length === 0) {
    throw ApiException.validation('The file is empty.');
  }

  let records: Array<Record<string, string>>;
  // csv-parse collapses repeated headers into one key, which would silently drop a
  // column, so the header row is inspected as it is read.
  let header: string[] = [];

  try {
    records = parse(text, {
      columns: (raw: string[]) => {
        header = raw.map((name) => name.trim());
        return header;
      },
      delimiter: [',', ';', '\t'],
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
      bom: true,
    }) as Array<Record<string, string>>;
  } catch (error) {
    throw ApiException.validation('The file could not be read as CSV.', [
      { message: (error as Error).message },
    ]);
  }

  if (records.length === 0) {
    throw ApiException.validation('The file has a header but no data rows.');
  }

  if (records.length > MAX_IMPORT_ROWS) {
    throw ApiException.validation(
      `The file has more than ${MAX_IMPORT_ROWS.toLocaleString('en-US')} rows. Split it and import the parts separately.`,
    );
  }

  const columns = header.filter((name) => name.length > 0);

  if (columns.length === 0) {
    throw ApiException.validation('The file has no usable column headers.');
  }

  const duplicates = columns.filter((name, index) => columns.indexOf(name) !== index);

  if (duplicates.length > 0) {
    throw ApiException.validation(
      `The file has duplicate column headers: ${[...new Set(duplicates)].join(', ')}.`,
    );
  }

  return {
    columns,
    rows: records.map((record) => {
      const row: Record<string, string> = {};
      for (const column of columns) {
        row[column] = record[column] ?? '';
      }
      return row;
    }),
  };
}

/**
 * Guesses which column fills each mapping target, so the mapping screen opens
 * with sensible defaults instead of an empty form.
 */
export function suggestMapping(columns: string[]): Record<string, string | null> {
  const candidates: Record<string, string[]> = {
    metricCode: ['metric', 'metric_code', 'metriccode', 'kpi', 'measure', 'indicator'],
    period: ['period', 'month', 'date', 'periodo', 'week', 'quarter', 'year'],
    value: ['value', 'amount', 'total', 'figure', 'result', 'qty', 'quantity'],
    branchCode: ['branch', 'branch_code', 'branchcode', 'site', 'location', 'property'],
    departmentCode: ['department', 'department_code', 'departmentcode', 'unit', 'team'],
  };

  const normalised = columns.map((column) => ({
    column,
    key: column.toLowerCase().replace(/[\s_-]/g, ''),
  }));

  const mapping: Record<string, string | null> = {};

  for (const [target, aliases] of Object.entries(candidates)) {
    const match = normalised.find((entry) =>
      aliases.some((alias) => entry.key === alias.replace(/[\s_-]/g, '')),
    );

    mapping[target] =
      match?.column ??
      normalised.find((entry) =>
        aliases.some((alias) => entry.key.includes(alias.replace(/[\s_-]/g, ''))),
      )?.column ??
      null;
  }

  return mapping;
}
