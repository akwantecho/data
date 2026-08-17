/**
 * Numeric parsing for imported values.
 *
 * Spreadsheets export numbers in many shapes — thousands separators, currency
 * symbols, trailing percent signs, accounting parentheses for negatives. All of
 * them are accepted; anything ambiguous is rejected rather than guessed, because a
 * silently misread number is worse than a rejected row.
 *
 * The result is a *string*, not a JavaScript number: values are stored as
 * PostgreSQL DECIMAL and must not pass through binary floating point (ADR-0004).
 */
export interface ParsedNumber {
  /** Canonical decimal string, e.g. "-1234.56". */
  value: string;
  /** True when the source carried a percent sign. */
  isPercentage: boolean;
}

const CURRENCY_SYMBOLS = /[$€£¥₹﷼]|\b(?:OMR|AED|SAR|USD|EUR|GBP)\b/gi;

export function parseNumericValue(raw: string): ParsedNumber | null {
  let text = raw.trim();

  if (text.length === 0) {
    return null;
  }

  const isPercentage = text.endsWith('%');
  if (isPercentage) {
    text = text.slice(0, -1).trim();
  }

  // Accounting notation: (1,234) means -1234.
  let negative = false;
  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1).trim();
  }

  text = text.replace(CURRENCY_SYMBOLS, '').trim();
  // Ordinary, non-breaking and narrow no-break spaces are all used as group separators.
  text = text.replace(/[\s\u00A0\u202F]/g, '');

  if (text.startsWith('-')) {
    negative = !negative;
    text = text.slice(1);
  } else if (text.startsWith('+')) {
    text = text.slice(1);
  }

  const normalised = normaliseSeparators(text);

  if (normalised === null || !/^\d+(\.\d+)?$/.test(normalised)) {
    return null;
  }

  const value = `${negative && Number(normalised) !== 0 ? '-' : ''}${normalised}`;

  return { value, isPercentage };
}

/**
 * Resolves thousands separators and the decimal mark.
 *
 * With both separators present the rightmost one is the decimal mark, which reads
 * `1,234.56` and `1.234,56` correctly. With commas only, a run of three-digit
 * groups means grouping (`1,234`); anything else is a decimal comma (`1,23`),
 * because no locale writes a thousands group of two or four digits.
 */
function normaliseSeparators(text: string): string | null {
  const hasComma = text.includes(',');
  const hasDot = text.includes('.');

  if (hasComma && hasDot) {
    // The rightmost separator is the decimal mark.
    return text.lastIndexOf(',') > text.lastIndexOf('.')
      ? stripGroups(text, '.', ',')
      : stripGroups(text, ',', '.');
  }

  if (hasComma) {
    return looksLikeGrouping(text, ',') ? text.replace(/,/g, '') : text.replace(',', '.');
  }

  return text;
}

function stripGroups(text: string, groupSeparator: string, decimalSeparator: string): string {
  return text.split(groupSeparator).join('').replace(decimalSeparator, '.');
}

/** True when every separated group after the first has exactly three digits. */
function looksLikeGrouping(text: string, separator: string): boolean {
  const parts = text.split(separator);

  return (
    parts.length > 1 &&
    parts.slice(1).every((part) => /^\d{3}$/.test(part)) &&
    /^\d{1,3}$/.test(parts[0])
  );
}
