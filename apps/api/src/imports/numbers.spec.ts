import { parseNumericValue } from './numbers';

describe('parseNumericValue', () => {
  it('reads a plain number', () => {
    expect(parseNumericValue('1234.56')).toEqual({ value: '1234.56', isPercentage: false });
    expect(parseNumericValue('0')).toEqual({ value: '0', isPercentage: false });
  });

  it('reads thousands separators', () => {
    expect(parseNumericValue('1,234,567.89')?.value).toBe('1234567.89');
    expect(parseNumericValue('1,234')?.value).toBe('1234');
  });

  it('reads European notation', () => {
    expect(parseNumericValue('1.234.567,89')?.value).toBe('1234567.89');
    expect(parseNumericValue('1234,56')?.value).toBe('1234.56');
  });

  it('treats a comma that cannot be a thousands group as a decimal comma', () => {
    // No locale writes 1,23 or 1,2345 as a group of three, so both are decimals.
    expect(parseNumericValue('1,23')?.value).toBe('1.23');
    expect(parseNumericValue('1,2345')?.value).toBe('1.2345');
  });

  it('reads negatives, including accounting parentheses', () => {
    expect(parseNumericValue('-500')?.value).toBe('-500');
    expect(parseNumericValue('(1,250.75)')?.value).toBe('-1250.75');
    expect(parseNumericValue('(0)')?.value).toBe('0');
  });

  it('strips currency symbols and codes', () => {
    expect(parseNumericValue('$1,200')?.value).toBe('1200');
    expect(parseNumericValue('OMR 4 500')?.value).toBe('4500');
    expect(parseNumericValue('€ 99,50')?.value).toBe('99.50');
  });

  it('flags percentages and keeps the number', () => {
    expect(parseNumericValue('12.5%')).toEqual({ value: '12.5', isPercentage: true });
  });

  it('returns a string so precision survives the trip to DECIMAL', () => {
    const parsed = parseNumericValue('12345678901234.123456');

    expect(parsed?.value).toBe('12345678901234.123456');
    expect(typeof parsed?.value).toBe('string');
  });

  it('rejects anything that is not a number', () => {
    for (const raw of ['', '   ', 'n/a', 'N/A', '-', 'twelve', '12abc', '1.2.3', '--5']) {
      expect(parseNumericValue(raw)).toBeNull();
    }
  });
});
