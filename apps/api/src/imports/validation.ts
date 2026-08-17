import type { MetricFrequency, MetricUnit, PeriodType } from '@prisma/client';
import { formatPeriod, frequencyForPeriod, parsePeriod, type ParsedPeriod } from './period';
import { parseNumericValue } from './numbers';

export interface ImportMapping {
  metricCode: string;
  period: string;
  value: string;
  branchCode?: string | null;
  departmentCode?: string | null;
  currency?: string | null;
}

export interface MetricDefinition {
  id: string;
  code: string;
  name: string;
  unit: MetricUnit;
  frequency: MetricFrequency;
  isCalculated: boolean;
}

export interface ValidationContext {
  mapping: ImportMapping;
  /** Organization metrics, keyed by lower-case code. */
  metrics: Map<string, MetricDefinition>;
  /** Branch ids keyed by lower-case code. */
  branches: Map<string, string>;
  /** Department ids keyed by lower-case code. */
  departments: Map<string, string>;
  currencyCode: string;
}

export interface RowIssue {
  code: string;
  message: string;
  column?: string;
  severity: 'ERROR' | 'WARNING';
}

export interface ValidatedRow {
  rowNumber: number;
  status: 'VALID' | 'WARNING' | 'REJECTED';
  issues: RowIssue[];
  /** Present unless the row was rejected. */
  parsed?: {
    metricId: string;
    metricCode: string;
    branchId: string | null;
    departmentId: string | null;
    periodType: PeriodType;
    periodStart: Date;
    periodEnd: Date;
    value: string;
  };
}

export interface ValidationSummary {
  rows: ValidatedRow[];
  rowsReceived: number;
  rowsValid: number;
  rowsWarning: number;
  rowsRejected: number;
}

/**
 * Validates every parsed row against the organization's own configuration
 * (plan §15). Nothing is ever silently dropped: a row is VALID, WARNING (imported
 * with a note) or REJECTED (kept, explained, not imported).
 */
export function validateRows(
  rows: Array<Record<string, string>>,
  context: ValidationContext,
): ValidationSummary {
  const seen = new Map<string, number>();
  const validated: ValidatedRow[] = [];

  rows.forEach((row, index) => {
    const rowNumber = index + 1;
    const issues: RowIssue[] = [];

    const metricRaw = read(row, context.mapping.metricCode);
    const periodRaw = read(row, context.mapping.period);
    const valueRaw = read(row, context.mapping.value);

    const metric = resolveMetric(metricRaw, context, issues);
    const period = resolvePeriod(periodRaw, issues);
    const value = resolveValue(valueRaw, issues);

    if (metric && period) {
      checkFrequency(metric, period, issues);
    }

    if (metric && value) {
      checkRange(metric, value.value, issues);
    }

    const branchId = resolveReference(
      row,
      context.mapping.branchCode,
      context.branches,
      'branch',
      issues,
    );
    const departmentId = resolveReference(
      row,
      context.mapping.departmentCode,
      context.departments,
      'department',
      issues,
    );

    checkCurrency(row, context, metric, issues);

    // Duplicate detection runs on the identity a metric value is stored under.
    if (metric && period) {
      const key = [
        metric.code,
        period.type,
        period.start.toISOString(),
        branchId ?? '-',
        departmentId ?? '-',
      ].join('|');
      const firstSeen = seen.get(key);

      if (firstSeen !== undefined) {
        issues.push({
          code: 'DUPLICATE_ROW',
          message: `Duplicate of row ${firstSeen}: same metric, period, branch and department.`,
          severity: 'ERROR',
        });
      } else {
        seen.set(key, rowNumber);
      }
    }

    const rejected = issues.some((issue) => issue.severity === 'ERROR');
    const status = rejected ? 'REJECTED' : issues.length > 0 ? 'WARNING' : 'VALID';

    validated.push({
      rowNumber,
      status,
      issues,
      parsed:
        rejected || !metric || !period || !value
          ? undefined
          : {
              metricId: metric.id,
              metricCode: metric.code,
              branchId,
              departmentId,
              periodType: period.type,
              periodStart: period.start,
              periodEnd: period.end,
              value: value.value,
            },
    });
  });

  return {
    rows: validated,
    rowsReceived: validated.length,
    rowsValid: validated.filter((row) => row.status === 'VALID').length,
    rowsWarning: validated.filter((row) => row.status === 'WARNING').length,
    rowsRejected: validated.filter((row) => row.status === 'REJECTED').length,
  };
}

function read(row: Record<string, string>, column: string | null | undefined): string {
  if (!column) {
    return '';
  }

  return (row[column] ?? '').trim();
}

function resolveMetric(
  raw: string,
  context: ValidationContext,
  issues: RowIssue[],
): MetricDefinition | null {
  if (raw.length === 0) {
    issues.push({
      code: 'MISSING_METRIC',
      message: 'Metric code is required.',
      column: context.mapping.metricCode,
      severity: 'ERROR',
    });
    return null;
  }

  const metric = context.metrics.get(raw.toLowerCase());

  if (!metric) {
    issues.push({
      code: 'UNKNOWN_METRIC',
      message: `"${raw}" is not a metric in this organization.`,
      column: context.mapping.metricCode,
      severity: 'ERROR',
    });
    return null;
  }

  // Calculated metrics are derived from other metrics; importing them would let a
  // spreadsheet contradict the platform's own arithmetic.
  if (metric.isCalculated) {
    issues.push({
      code: 'CALCULATED_METRIC',
      message: `"${metric.name}" is calculated from other metrics and cannot be imported.`,
      column: context.mapping.metricCode,
      severity: 'ERROR',
    });
    return null;
  }

  return metric;
}

function resolvePeriod(raw: string, issues: RowIssue[]): ParsedPeriod | null {
  if (raw.length === 0) {
    issues.push({ code: 'MISSING_PERIOD', message: 'Period is required.', severity: 'ERROR' });
    return null;
  }

  const period = parsePeriod(raw);

  if (!period) {
    issues.push({
      code: 'INVALID_PERIOD',
      message: `"${raw}" is not a recognised period. Use 2026-01, 2026-Q1, 2026-W05, 2026 or 2026-01-31.`,
      severity: 'ERROR',
    });
    return null;
  }

  if (period.start.getUTCFullYear() < 2000 || period.start.getUTCFullYear() > 2100) {
    issues.push({
      code: 'PERIOD_OUT_OF_RANGE',
      message: `Period ${formatPeriod(period)} is outside the supported range.`,
      severity: 'ERROR',
    });
    return null;
  }

  return period;
}

function resolveValue(raw: string, issues: RowIssue[]): { value: string } | null {
  if (raw.length === 0) {
    issues.push({ code: 'MISSING_VALUE', message: 'Value is required.', severity: 'ERROR' });
    return null;
  }

  const parsed = parseNumericValue(raw);

  if (!parsed) {
    issues.push({
      code: 'INVALID_NUMBER',
      message: `"${raw}" is not a number.`,
      severity: 'ERROR',
    });
    return null;
  }

  return { value: parsed.value };
}

function checkFrequency(metric: MetricDefinition, period: ParsedPeriod, issues: RowIssue[]): void {
  const expected = frequencyForPeriod(period.type);

  if (expected !== metric.frequency) {
    issues.push({
      code: 'FREQUENCY_MISMATCH',
      message: `"${metric.name}" is reported ${metric.frequency.toLowerCase()}, but ${formatPeriod(
        period,
      )} is a ${period.type.toLowerCase()} value.`,
      severity: 'ERROR',
    });
  }
}

/** Unit-aware sanity checks — obviously impossible values are rejected, odd ones warned. */
function checkRange(metric: MetricDefinition, value: string, issues: RowIssue[]): void {
  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    return;
  }

  const negative = numeric < 0;

  if (
    negative &&
    (metric.unit === 'COUNT' ||
      metric.unit === 'DAYS' ||
      metric.unit === 'HOURS' ||
      metric.unit === 'MINUTES')
  ) {
    issues.push({
      code: 'NEGATIVE_NOT_ALLOWED',
      message: `"${metric.name}" cannot be negative.`,
      severity: 'ERROR',
    });
    return;
  }

  if (metric.unit === 'PERCENTAGE' && (numeric < 0 || numeric > 100)) {
    issues.push({
      code: 'PERCENTAGE_OUT_OF_RANGE',
      message: `${numeric} is outside 0–100 for the percentage metric "${metric.name}".`,
      severity: numeric < 0 || numeric > 1000 ? 'ERROR' : 'WARNING',
    });
    return;
  }

  if (metric.unit === 'SCORE' && (numeric < 0 || numeric > 100)) {
    issues.push({
      code: 'SCORE_OUT_OF_RANGE',
      message: `${numeric} is outside 0–100 for the score metric "${metric.name}".`,
      severity: 'WARNING',
    });
    return;
  }

  if (metric.unit === 'COUNT' && !Number.isInteger(numeric)) {
    issues.push({
      code: 'FRACTIONAL_COUNT',
      message: `"${metric.name}" counts whole units; ${numeric} will be stored as given.`,
      severity: 'WARNING',
    });
  }
}

function resolveReference(
  row: Record<string, string>,
  column: string | null | undefined,
  lookup: Map<string, string>,
  label: 'branch' | 'department',
  issues: RowIssue[],
): string | null {
  const raw = read(row, column);

  if (raw.length === 0) {
    return null;
  }

  const id = lookup.get(raw.toLowerCase());

  if (!id) {
    issues.push({
      code: label === 'branch' ? 'UNKNOWN_BRANCH' : 'UNKNOWN_DEPARTMENT',
      message: `"${raw}" is not an active ${label} in this organization.`,
      column: column ?? undefined,
      severity: 'ERROR',
    });
    return null;
  }

  return id;
}

/** A currency column must agree with the organization's currency. */
function checkCurrency(
  row: Record<string, string>,
  context: ValidationContext,
  metric: MetricDefinition | null,
  issues: RowIssue[],
): void {
  const raw = read(row, context.mapping.currency);

  if (raw.length === 0) {
    return;
  }

  if (raw.toUpperCase() !== context.currencyCode.toUpperCase()) {
    issues.push({
      code: 'UNSUPPORTED_CURRENCY',
      message: `Values must be in ${context.currencyCode}; this row is in ${raw.toUpperCase()}.`,
      column: context.mapping.currency ?? undefined,
      severity: 'ERROR',
    });
    return;
  }

  if (metric && metric.unit !== 'CURRENCY') {
    issues.push({
      code: 'CURRENCY_ON_NON_CURRENCY_METRIC',
      message: `"${metric.name}" is not a currency metric; the currency column is ignored.`,
      column: context.mapping.currency ?? undefined,
      severity: 'WARNING',
    });
  }
}
