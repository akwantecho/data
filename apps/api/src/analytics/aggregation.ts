import { Prisma } from '@prisma/client';
import type { AggregationMethod } from '@sip/shared-types';
import {
  collectDependencies,
  evaluateFormula,
  parseFormula,
  type Node,
} from '../metrics/formula/formula';

/**
 * Read-time aggregation.
 *
 * Sprint 4 stores one value per metric, period and slice. A dashboard asks a
 * different question — "what was revenue this quarter, across the whole
 * organization?" — and answering it means reducing along two axes: across the
 * slices inside a period, and across the periods inside the window.
 *
 * Nothing here writes. These are read-time figures; the stored values remain the
 * only record of what was reported.
 */

export type AggregationType = 'SUM' | 'AVERAGE' | 'LAST' | 'MIN' | 'MAX' | 'FORMULA';

export interface MetricShape {
  code: string;
  aggregationType: AggregationType;
  /** Present for FORMULA metrics. */
  formula: string | null;
}

/** A stored value, already narrowed to the metrics and window in question. */
export interface StoredValue {
  metricCode: string;
  periodStart: string;
  branchId: string | null;
  departmentId: string | null;
  value: Prisma.Decimal;
}

export interface SliceFilter {
  branchId: string | null;
  departmentId: string | null;
}

/**
 * Reduces the slices reported for one period into a single figure.
 *
 * Values live at three levels: the organization (no branch, no department), a
 * branch, or a department inside a branch. Two rules follow from that:
 *
 * 1. **A figure reported at the requested level wins.** An organization that
 *    reports both a company total and per-branch figures would otherwise be
 *    counted twice, and the total it reported is the one it stands behind.
 * 2. **Roll up one level at a time.** Falling straight through to departments
 *    while branch figures exist would add a department's revenue on top of the
 *    branch that already contains it.
 */
export function combineSlices(
  values: StoredValue[],
  type: AggregationType,
  filter: SliceFilter,
): Prisma.Decimal | null {
  if (values.length === 0) {
    return null;
  }

  const levels = filter.departmentId
    ? // A department is the finest level there is: nothing rolls up into it.
      [
        (value: StoredValue) =>
          value.branchId === filter.branchId && value.departmentId === filter.departmentId,
      ]
    : filter.branchId
      ? [
          (value: StoredValue) => value.branchId === filter.branchId && value.departmentId === null,
          (value: StoredValue) => value.branchId === filter.branchId,
        ]
      : [
          (value: StoredValue) => value.branchId === null && value.departmentId === null,
          (value: StoredValue) => value.branchId !== null && value.departmentId === null,
          (value: StoredValue) => value.departmentId !== null,
        ];

  for (const matches of levels) {
    const level = values.filter(matches);

    if (level.length > 0) {
      return reduce(
        level.map((value) => value.value),
        type,
        'SLICE',
      );
    }
  }

  return null;
}

/** Reduces a window's per-period figures into one. */
export function combinePeriods(
  points: Array<{ periodStart: string; value: Prisma.Decimal }>,
  type: AggregationType,
): Prisma.Decimal | null {
  if (points.length === 0) {
    return null;
  }

  if (type === 'LAST') {
    const latest = [...points].sort((a, b) => a.periodStart.localeCompare(b.periodStart)).at(-1);
    return latest?.value ?? null;
  }

  return reduce(
    points.map((point) => point.value),
    type,
    'PERIOD',
  );
}

/**
 * How a set of values collapses into one.
 *
 * Across **slices**, `LAST` behaves like `SUM`: "last" is a statement about time,
 * and a stock metric such as units under management is the sum of the branches
 * holding them at that moment, not one branch's figure.
 */
function reduce(
  values: Prisma.Decimal[],
  type: AggregationType,
  axis: 'SLICE' | 'PERIOD',
): Prisma.Decimal | null {
  if (values.length === 0) {
    return null;
  }

  switch (type) {
    case 'AVERAGE':
      return values
        .reduce((total, value) => total.plus(value), new Prisma.Decimal(0))
        .dividedBy(values.length)
        .toDecimalPlaces(6);
    case 'MIN':
      return values.reduce((min, value) => (value.lessThan(min) ? value : min));
    case 'MAX':
      return values.reduce((max, value) => (value.greaterThan(max) ? value : max));
    case 'LAST':
      return axis === 'SLICE'
        ? values.reduce((total, value) => total.plus(value), new Prisma.Decimal(0))
        : (values.at(-1) ?? null);
    case 'FORMULA':
    case 'SUM':
    default:
      return values.reduce((total, value) => total.plus(value), new Prisma.Decimal(0));
  }
}

export interface WindowAggregate {
  value: Prisma.Decimal | null;
  method: AggregationMethod;
  series: Array<{ periodStart: string; value: Prisma.Decimal }>;
  /** Periods in the window with no usable value. */
  missingPeriods: number;
}

/**
 * Aggregates one metric over a window.
 *
 * A **formula metric is recomputed from its aggregated inputs**, never averaged
 * from its own stored values. A quarter's RevPAR is quarterly revenue divided by
 * quarterly available rooms — not the mean of three monthly RevPARs, which is a
 * different number and one nobody reported. The same recursion handles a formula
 * whose input is itself a formula.
 *
 * When an input has no aggregate for the window, the metric has none either: a
 * partial denominator would produce a confident wrong answer.
 */
export function aggregateMetric(
  code: string,
  metrics: Map<string, MetricShape>,
  values: StoredValue[],
  periods: string[],
  filter: SliceFilter,
  seen: Set<string> = new Set(),
): WindowAggregate {
  const metric = metrics.get(code);

  if (!metric || seen.has(code)) {
    // A cycle cannot reach here through the API (they are refused at save time),
    // but a value read straight from the database is not the API's to trust.
    return { value: null, method: 'NONE', series: [], missingPeriods: periods.length };
  }

  if (metric.aggregationType === 'FORMULA') {
    // A formula metric with no expression cannot be aggregated: summing the values
    // a previous formula produced would present a stale figure as a current one.
    return metric.formula
      ? aggregateFormula(metric, metrics, values, periods, filter, new Set([...seen, code]))
      : { value: null, method: 'NONE', series: [], missingPeriods: periods.length };
  }

  const series = seriesFor(code, metric.aggregationType, values, periods, filter);

  return {
    value: combinePeriods(series, metric.aggregationType),
    method: metric.aggregationType,
    series,
    missingPeriods: periods.length - series.length,
  };
}

/** Per-period figures for a stored metric, in period order, gaps omitted. */
function seriesFor(
  code: string,
  type: AggregationType,
  values: StoredValue[],
  periods: string[],
  filter: SliceFilter,
): Array<{ periodStart: string; value: Prisma.Decimal }> {
  const byPeriod = new Map<string, StoredValue[]>();

  for (const value of values) {
    if (value.metricCode !== code) {
      continue;
    }

    const bucket = byPeriod.get(value.periodStart);

    if (bucket) {
      bucket.push(value);
    } else {
      byPeriod.set(value.periodStart, [value]);
    }
  }

  const series: Array<{ periodStart: string; value: Prisma.Decimal }> = [];

  for (const periodStart of periods) {
    const combined = combineSlices(byPeriod.get(periodStart) ?? [], type, filter);

    if (combined !== null) {
      series.push({ periodStart, value: combined });
    }
  }

  return series;
}

function aggregateFormula(
  metric: MetricShape,
  metrics: Map<string, MetricShape>,
  values: StoredValue[],
  periods: string[],
  filter: SliceFilter,
  seen: Set<string>,
): WindowAggregate {
  let node: Node;

  try {
    node = parseFormula(metric.formula as string);
  } catch {
    return { value: null, method: 'NONE', series: [], missingPeriods: periods.length };
  }

  const inputs = new Map<string, WindowAggregate>();

  for (const input of collectDependencies(node)) {
    inputs.set(input, aggregateMetric(input, metrics, values, periods, filter, seen));
  }

  // Per period: evaluate the formula on that period's aggregated inputs, so the
  // series a chart draws is consistent with the window figure beneath it.
  const series: Array<{ periodStart: string; value: Prisma.Decimal }> = [];

  for (const periodStart of periods) {
    const scope = new Map<string, Prisma.Decimal>();
    let complete = true;

    for (const [code, aggregate] of inputs) {
      const point = aggregate.series.find((entry) => entry.periodStart === periodStart);

      if (!point) {
        complete = false;
        break;
      }

      scope.set(code, point.value);
    }

    if (!complete) {
      continue;
    }

    const result = evaluateFormula(node, scope);

    if (result.ok) {
      series.push({ periodStart, value: result.value });
    }
  }

  const windowScope = new Map<string, Prisma.Decimal>();

  for (const [code, aggregate] of inputs) {
    if (aggregate.value === null) {
      return {
        value: null,
        method: 'RECOMPUTED_FROM_INPUTS',
        series,
        missingPeriods: periods.length - series.length,
      };
    }

    windowScope.set(code, aggregate.value);
  }

  const result = evaluateFormula(node, windowScope);

  return {
    value: result.ok ? result.value : null,
    method: 'RECOMPUTED_FROM_INPUTS',
    series,
    missingPeriods: periods.length - series.length,
  };
}

/**
 * The period starts a metric can be evaluated over: its own, plus those of every
 * metric it is derived from. A formula's window is only as wide as its inputs.
 */
export function periodsFor(
  code: string,
  metrics: Map<string, MetricShape>,
  values: StoredValue[],
  seen: Set<string> = new Set(),
): string[] {
  const metric = metrics.get(code);

  if (!metric || seen.has(code)) {
    return [];
  }

  const periods = new Set<string>();

  for (const value of values) {
    if (value.metricCode === code) {
      periods.add(value.periodStart);
    }
  }

  if (metric.aggregationType === 'FORMULA' && metric.formula) {
    try {
      for (const input of collectDependencies(parseFormula(metric.formula))) {
        for (const period of periodsFor(input, metrics, values, new Set([...seen, code]))) {
          periods.add(period);
        }
      }
    } catch {
      // An unparseable stored formula simply contributes no periods of its own.
    }
  }

  return [...periods].sort();
}
