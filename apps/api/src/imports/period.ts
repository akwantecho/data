import type { PeriodType } from '@prisma/client';

export interface ParsedPeriod {
  type: PeriodType;
  /** Inclusive first day of the period, at UTC midnight. */
  start: Date;
  /** Inclusive last day of the period, at UTC midnight. */
  end: Date;
}

/**
 * Parses the period label used by CSV imports.
 *
 * The *shape* of the label decides the period type, so a file cannot silently
 * disagree with itself: `2026-01` is a month, `2026-Q1` a quarter, `2026` a year,
 * `2026-W05` an ISO week and `2026-01-31` a day. Everything is UTC — a metric
 * belongs to a period, not to a moment, so timezone drift must not move it.
 */
export function parsePeriod(raw: string): ParsedPeriod | null {
  const value = raw.trim();

  if (value.length === 0) {
    return null;
  }

  const year = /^(\d{4})$/.exec(value);
  if (year) {
    const y = Number(year[1]);
    return { type: 'YEAR', start: utc(y, 0, 1), end: utc(y, 11, 31) };
  }

  const quarter = /^(\d{4})[-\s]?[Qq]([1-4])$/.exec(value);
  if (quarter) {
    const y = Number(quarter[1]);
    const q = Number(quarter[2]);
    const firstMonth = (q - 1) * 3;
    return {
      type: 'QUARTER',
      start: utc(y, firstMonth, 1),
      end: lastDayOfMonth(y, firstMonth + 2),
    };
  }

  const week = /^(\d{4})[-\s]?[Ww](\d{1,2})$/.exec(value);
  if (week) {
    const y = Number(week[1]);
    const w = Number(week[2]);

    if (w < 1 || w > 53) {
      return null;
    }

    const start = isoWeekStart(y, w);
    // A week number beyond the year's actual weeks rolls into the next year.
    if (start.getUTCFullYear() > y && w > 52) {
      return null;
    }

    return { type: 'WEEK', start, end: addDays(start, 6) };
  }

  const month = /^(\d{4})-(\d{2})$/.exec(value);
  if (month) {
    const y = Number(month[1]);
    const m = Number(month[2]) - 1;

    if (m < 0 || m > 11) {
      return null;
    }

    return { type: 'MONTH', start: utc(y, m, 1), end: lastDayOfMonth(y, m) };
  }

  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (day) {
    const y = Number(day[1]);
    const m = Number(day[2]) - 1;
    const d = Number(day[3]);
    const date = utc(y, m, d);

    // Rejects impossible dates such as 2026-02-30, which Date would roll over.
    if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m || date.getUTCDate() !== d) {
      return null;
    }

    return { type: 'DAY', start: date, end: date };
  }

  return null;
}

/** The metric frequency a period type corresponds to. */
export function frequencyForPeriod(
  type: PeriodType,
): 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'YEARLY' {
  switch (type) {
    case 'DAY':
      return 'DAILY';
    case 'WEEK':
      return 'WEEKLY';
    case 'MONTH':
      return 'MONTHLY';
    case 'QUARTER':
      return 'QUARTERLY';
    case 'YEAR':
      return 'YEARLY';
  }
}

/** Human-readable label, used in validation messages and import summaries. */
export function formatPeriod(period: ParsedPeriod): string {
  const iso = period.start.toISOString().slice(0, 10);

  switch (period.type) {
    case 'YEAR':
      return iso.slice(0, 4);
    case 'QUARTER':
      return `${iso.slice(0, 4)}-Q${Math.floor(period.start.getUTCMonth() / 3) + 1}`;
    case 'MONTH':
      return iso.slice(0, 7);
    default:
      return iso;
  }
}

function utc(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month, day));
}

function lastDayOfMonth(year: number, month: number): Date {
  return new Date(Date.UTC(year, month + 1, 0));
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

/** Monday of the given ISO week (ISO 8601: week 1 contains the year's first Thursday). */
function isoWeekStart(year: number, week: number): Date {
  const january4 = utc(year, 0, 4);
  const dayOfWeek = january4.getUTCDay() || 7;
  const firstMonday = addDays(january4, 1 - dayOfWeek);
  return addDays(firstMonday, (week - 1) * 7);
}
