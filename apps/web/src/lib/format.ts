import type { MetricUnit } from '@sip/shared-types';

/**
 * Formats a value for display.
 *
 * The value arrives as a decimal **string** from the API and is only converted to
 * a number for rendering — never for arithmetic, which always happens server-side
 * (ADR-0004). Currency precision follows the organization's currency rather than a
 * hardcoded two decimals (plan §10).
 */
export function formatMetricValue(
  value: string | null | undefined,
  unit: MetricUnit,
  currencyCode: string,
  compact = false,
): string {
  if (value === null || value === undefined || value === '') {
    return '—';
  }

  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    return value;
  }

  switch (unit) {
    case 'CURRENCY':
      return new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: currencyCode,
        notation: compact ? 'compact' : 'standard',
        maximumFractionDigits: compact ? 1 : undefined,
      }).format(numeric);

    case 'PERCENTAGE':
      return `${trim(numeric, 2)}%`;

    case 'SCORE':
      return `${trim(numeric, 1)}`;

    case 'COUNT':
      return new Intl.NumberFormat(undefined, {
        maximumFractionDigits: 0,
        notation: compact ? 'compact' : 'standard',
      }).format(numeric);

    case 'DAYS':
      return `${trim(numeric, 1)} d`;
    case 'HOURS':
      return `${trim(numeric, 1)} h`;
    case 'MINUTES':
      return `${trim(numeric, 1)} min`;

    case 'RATIO':
      return trim(numeric, 3);

    default:
      return new Intl.NumberFormat(undefined, {
        maximumFractionDigits: 2,
        notation: compact ? 'compact' : 'standard',
      }).format(numeric);
  }
}

/** Signed percentage, for period-over-period change. */
export function formatChange(value: string | null): string {
  if (value === null) {
    return '—';
  }

  const numeric = Number(value);

  return `${numeric > 0 ? '+' : ''}${trim(numeric, 1)}%`;
}

/** Whether a change is good news, given the metric's direction. */
export function changeTone(
  change: string | null,
  direction: 'HIGHER_IS_BETTER' | 'LOWER_IS_BETTER' | 'TARGET_RANGE' | 'INFORMATIONAL',
): 'positive' | 'negative' | 'neutral' {
  if (change === null || direction === 'INFORMATIONAL' || direction === 'TARGET_RANGE') {
    return 'neutral';
  }

  const numeric = Number(change);

  if (numeric === 0) {
    return 'neutral';
  }

  const improving = direction === 'HIGHER_IS_BETTER' ? numeric > 0 : numeric < 0;

  return improving ? 'positive' : 'negative';
}

function trim(value: number, maximumFractionDigits: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits }).format(value);
}
