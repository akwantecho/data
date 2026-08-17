import { formatPeriod, frequencyForPeriod, parsePeriod } from './period';

const iso = (date: Date) => date.toISOString().slice(0, 10);

describe('parsePeriod', () => {
  it('reads a month', () => {
    const period = parsePeriod('2026-02');

    expect(period).toMatchObject({ type: 'MONTH' });
    expect(iso(period!.start)).toBe('2026-02-01');
    expect(iso(period!.end)).toBe('2026-02-28');
  });

  it('handles a leap February', () => {
    expect(iso(parsePeriod('2028-02')!.end)).toBe('2028-02-29');
  });

  it('reads a quarter in either notation', () => {
    for (const label of ['2026-Q3', '2026q3', '2026 Q3']) {
      const period = parsePeriod(label);
      expect(period?.type).toBe('QUARTER');
      expect(iso(period!.start)).toBe('2026-07-01');
      expect(iso(period!.end)).toBe('2026-09-30');
    }
  });

  it('reads a year', () => {
    const period = parsePeriod('2026');

    expect(period?.type).toBe('YEAR');
    expect(iso(period!.start)).toBe('2026-01-01');
    expect(iso(period!.end)).toBe('2026-12-31');
  });

  it('reads a day', () => {
    const period = parsePeriod('2026-03-15');

    expect(period?.type).toBe('DAY');
    expect(iso(period!.start)).toBe('2026-03-15');
    expect(iso(period!.end)).toBe('2026-03-15');
  });

  it('reads an ISO week, starting on Monday', () => {
    const period = parsePeriod('2026-W05');

    expect(period?.type).toBe('WEEK');
    expect(period!.start.getUTCDay()).toBe(1);
    expect(iso(period!.end)).toBe(iso(new Date(period!.start.getTime() + 6 * 86_400_000)));
  });

  it('places ISO week 1 on the week containing the first Thursday', () => {
    // 1 January 2027 is a Friday, so ISO week 1 of 2027 starts on 4 January.
    expect(iso(parsePeriod('2027-W01')!.start)).toBe('2027-01-04');
  });

  it('rejects impossible dates instead of rolling them over', () => {
    expect(parsePeriod('2026-02-30')).toBeNull();
    expect(parsePeriod('2026-13')).toBeNull();
    expect(parsePeriod('2026-Q5')).toBeNull();
    expect(parsePeriod('2026-W54')).toBeNull();
  });

  it('rejects free text and empty input', () => {
    for (const label of ['', '   ', 'January 2026', 'Q1', '26-01', 'next month']) {
      expect(parsePeriod(label)).toBeNull();
    }
  });

  it('uses UTC, so a period never drifts with the local timezone', () => {
    const period = parsePeriod('2026-01')!;

    expect(period.start.getUTCHours()).toBe(0);
    expect(period.start.toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });
});

describe('frequencyForPeriod', () => {
  it('maps every period type to a metric frequency', () => {
    expect(frequencyForPeriod('DAY')).toBe('DAILY');
    expect(frequencyForPeriod('WEEK')).toBe('WEEKLY');
    expect(frequencyForPeriod('MONTH')).toBe('MONTHLY');
    expect(frequencyForPeriod('QUARTER')).toBe('QUARTERLY');
    expect(frequencyForPeriod('YEAR')).toBe('YEARLY');
  });
});

describe('formatPeriod', () => {
  it('renders each period type the way it was written', () => {
    expect(formatPeriod(parsePeriod('2026-02')!)).toBe('2026-02');
    expect(formatPeriod(parsePeriod('2026-Q3')!)).toBe('2026-Q3');
    expect(formatPeriod(parsePeriod('2026')!)).toBe('2026');
    expect(formatPeriod(parsePeriod('2026-03-15')!)).toBe('2026-03-15');
  });
});
