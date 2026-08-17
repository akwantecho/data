import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  AnalyticsOptions,
  ComparisonBreakdown,
  ComparisonResult,
  ComparisonRow,
  MetricAnalytics,
  MetricAnalyticsDetail,
  ResolvedWindow,
  SeriesPoint,
} from '@sip/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { ApiException } from '../common/errors/api-exception';
import { evaluateThreshold, percentageChange, varianceToTarget } from '../metrics/metrics.service';
import {
  aggregateMetric,
  periodsFor,
  type MetricShape,
  type SliceFilter,
  type StoredValue,
  type WindowAggregate,
} from './aggregation';
import type { AnalyticsFiltersDto, ComparisonDto } from './analytics.dto';

/** How much history the dashboard shows when nobody has asked for a range. */
const DEFAULT_WINDOW_MONTHS = 6;

/** The metric fields analytics needs, loaded once per request. */
const METRIC_SELECT = {
  id: true,
  code: true,
  name: true,
  category: true,
  unit: true,
  direction: true,
  aggregationType: true,
  frequency: true,
  formula: { select: { expression: true } },
  thresholds: {
    select: { warningValue: true, criticalValue: true, isRelativeToTarget: true },
    take: 1,
  },
} as const;

type MetricRow = Prisma.MetricGetPayload<{ select: typeof METRIC_SELECT }>;

/**
 * Read-time analytics (plan §21, §24).
 *
 * Every figure the dashboard and the analytics page show is produced here, from
 * stored values, by the aggregation engine — the client formats and nothing more
 * (plan §5). Two windows are always computed: the one asked for and the equally
 * long one before it, because "up 9.8%" is the number an executive acts on.
 */
@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Everything the filter bar needs, so the client never invents an id. */
  async options(organizationId: string): Promise<AnalyticsOptions> {
    const [metrics, branches, departments, range] = await Promise.all([
      this.prisma.metric.findMany({
        where: { organizationId, isActive: true },
        orderBy: [{ category: 'asc' }, { name: 'asc' }],
        select: { id: true, code: true, name: true, category: true },
      }),
      this.prisma.branch.findMany({
        where: { organizationId, isActive: true },
        orderBy: { name: 'asc' },
        select: { id: true, name: true },
      }),
      this.prisma.department.findMany({
        where: { organizationId, isActive: true },
        orderBy: { name: 'asc' },
        select: { id: true, name: true, branchId: true },
      }),
      this.prisma.metricValue.aggregate({
        where: { organizationId },
        _min: { periodStart: true },
        _max: { periodStart: true },
      }),
    ]);

    return {
      metrics,
      branches,
      departments,
      earliestPeriod: toIsoDate(range._min.periodStart),
      latestPeriod: toIsoDate(range._max.periodStart),
    };
  }

  /**
   * Resolves the requested window.
   *
   * The default ends at the most recent period the organization actually reported
   * and covers the six months up to it: an empty dashboard because "today" has no
   * data yet would be technically correct and useless, and a window long enough to
   * leave no comparable period before it would show every change as unknown.
   */
  async resolveWindow(
    organizationId: string,
    filters: AnalyticsFiltersDto,
  ): Promise<ResolvedWindow> {
    const [branch, department] = await Promise.all([
      filters.branchId
        ? this.prisma.branch.findFirst({
            where: { id: filters.branchId, organizationId },
            select: { id: true, name: true },
          })
        : null,
      filters.departmentId
        ? this.prisma.department.findFirst({
            where: { id: filters.departmentId, organizationId },
            select: { id: true, name: true, branchId: true },
          })
        : null,
    ]);

    if (filters.branchId && !branch) {
      throw ApiException.notFound('Branch');
    }

    if (filters.departmentId && !department) {
      throw ApiException.notFound('Department');
    }

    let to = filters.to;
    let from = filters.from;

    if (!to || !from) {
      const latest = await this.prisma.metricValue.aggregate({
        where: { organizationId },
        _max: { periodStart: true },
      });

      const anchor = toIsoDate(latest._max.periodStart) ?? todayIso();

      to ??= anchor;
      from ??= startOfMonthsBefore(to, DEFAULT_WINDOW_MONTHS - 1);
    }

    const previous = previousWindow(from, to);

    return {
      from,
      to,
      branchId: branch?.id ?? null,
      departmentId: department?.id ?? null,
      branchName: branch?.name ?? null,
      departmentName: department?.name ?? null,
      previousFrom: previous.from,
      previousTo: previous.to,
    };
  }

  /**
   * Loads every metric and every stored value both windows need, in one pass.
   *
   * The whole organization is read rather than only the metrics asked for, because
   * a formula is recomputed from its inputs and those inputs may not be on screen.
   */
  async buildContext(organizationId: string, window: ResolvedWindow): Promise<AnalyticsContext> {
    const metrics = await this.prisma.metric.findMany({
      where: { organizationId },
      orderBy: { name: 'asc' },
      select: METRIC_SELECT,
    });

    const [values, targets] = await Promise.all([
      this.prisma.metricValue.findMany({
        where: {
          organizationId,
          periodStart: { gte: new Date(window.previousFrom), lte: new Date(window.to) },
        },
        select: {
          periodStart: true,
          branchId: true,
          departmentId: true,
          value: true,
          periodType: true,
          metric: { select: { code: true } },
        },
      }),
      this.prisma.metricTarget.findMany({
        where: {
          organizationId,
          periodStart: { gte: new Date(window.previousFrom), lte: new Date(window.to) },
        },
        select: {
          periodStart: true,
          branchId: true,
          targetValue: true,
          metric: { select: { code: true } },
        },
      }),
    ]);

    const shapes = new Map<string, MetricShape>(
      metrics.map((metric) => [
        metric.code,
        {
          code: metric.code,
          aggregationType: metric.aggregationType,
          formula: metric.formula?.expression ?? null,
        },
      ]),
    );

    const periodTypes = new Map<string, string>();
    const stored: StoredValue[] = [];

    for (const value of values) {
      const periodStart = toIsoDate(value.periodStart) as string;

      stored.push({
        metricCode: value.metric.code,
        periodStart,
        branchId: value.branchId,
        departmentId: value.departmentId,
        value: value.value,
      });

      periodTypes.set(`${value.metric.code}:${periodStart}`, value.periodType);
    }

    const storedTargets: StoredValue[] = targets.map((target) => ({
      metricCode: target.metric.code,
      periodStart: toIsoDate(target.periodStart) as string,
      branchId: target.branchId,
      departmentId: null,
      value: target.targetValue,
    }));

    return { window, metrics, shapes, values: stored, targets: storedTargets, periodTypes };
  }

  /** One metric, summarised over the window and the one before it. */
  summarise(context: AnalyticsContext, metric: MetricRow): MetricAnalytics {
    const filter: SliceFilter = {
      branchId: context.window.branchId,
      departmentId: context.window.departmentId,
    };

    const current = this.aggregateWithin(
      context,
      metric,
      context.window.from,
      context.window.to,
      filter,
    );
    const previous = this.aggregateWithin(
      context,
      metric,
      context.window.previousFrom,
      context.window.previousTo,
      filter,
    );

    const target = this.targetFor(context, metric, filter);

    // A window's figure is only comparable to the targets that cover it. Setting one
    // monthly target and then reading a year's revenue against it would report a
    // 900% overshoot; the comparison is made over the periods that have a target.
    const comparable =
      target.periods.length > 0
        ? aggregateMetric(
            metric.code,
            context.shapes,
            this.within(context.values, context.window.from, context.window.to),
            target.periods,
            filter,
          ).value
        : current.value;

    return {
      metricId: metric.id,
      code: metric.code,
      name: metric.name,
      category: metric.category,
      unit: metric.unit,
      direction: metric.direction,
      aggregationType: metric.aggregationType,
      formula: metric.formula?.expression ?? null,
      aggregation: current.method,
      current: current.value?.toString() ?? null,
      previous: previous.value?.toString() ?? null,
      changePct: percentageChange(current.value, previous.value),
      target: target.value?.toString() ?? null,
      targetPeriods: target.periods.length,
      comparedToTarget: comparable?.toString() ?? null,
      varianceToTargetPct: varianceToTarget(comparable, target.value),
      thresholdStatus: evaluateThreshold(
        comparable,
        metric.thresholds[0] ?? null,
        target.value,
        metric.direction,
      ),
      series: this.toSeries(context, metric.code, current),
      previousSeries: this.toSeries(context, metric.code, previous),
      missingPeriods: current.missingPeriods,
    };
  }

  /**
   * The target for the window, and the periods it covers.
   *
   * A target is a figure someone set, never a derived one, so it aggregates by its
   * own rule even when the metric it belongs to is calculated.
   */
  private targetFor(
    context: AnalyticsContext,
    metric: MetricRow,
    filter: SliceFilter,
  ): { value: Prisma.Decimal | null; periods: string[] } {
    const type = metric.aggregationType === 'FORMULA' ? 'AVERAGE' : metric.aggregationType;
    const shapes = new Map<string, MetricShape>([
      [metric.code, { code: metric.code, aggregationType: type, formula: null }],
    ]);

    const targets = this.within(context.targets, context.window.from, context.window.to);
    const periods = periodsFor(metric.code, shapes, targets);

    const aggregate = aggregateMetric(metric.code, shapes, targets, periods, {
      branchId: filter.branchId,
      departmentId: null,
    });

    return { value: aggregate.value, periods: aggregate.series.map((point) => point.periodStart) };
  }

  async metricDetail(
    organizationId: string,
    metricId: string,
    filters: AnalyticsFiltersDto,
  ): Promise<MetricAnalyticsDetail> {
    const window = await this.resolveWindow(organizationId, filters);
    const context = await this.buildContext(organizationId, window);
    const metric = context.metrics.find((candidate) => candidate.id === metricId);

    if (!metric) {
      throw ApiException.notFound('Metric');
    }

    const dependencies = await this.prisma.metricDependency.findMany({
      where: { OR: [{ metricId }, { dependsOnId: metricId }] },
      select: {
        metricId: true,
        dependsOnId: true,
        metric: { select: { id: true, organizationId: true } },
        dependsOn: { select: { id: true, organizationId: true } },
      },
    });

    const inputIds = new Set(
      dependencies
        .filter(
          (row) => row.metricId === metricId && row.dependsOn.organizationId === organizationId,
        )
        .map((row) => row.dependsOnId),
    );
    const dependentIds = new Set(
      dependencies
        .filter(
          (row) => row.dependsOnId === metricId && row.metric.organizationId === organizationId,
        )
        .map((row) => row.metricId),
    );

    const related = context.metrics.filter(
      (candidate) =>
        candidate.id !== metricId &&
        !inputIds.has(candidate.id) &&
        !dependentIds.has(candidate.id) &&
        candidate.category !== null &&
        candidate.category === metric.category,
    );

    return {
      window,
      metric: this.summarise(context, metric),
      inputs: context.metrics
        .filter((candidate) => inputIds.has(candidate.id))
        .map((candidate) => this.summarise(context, candidate)),
      dependents: context.metrics
        .filter((candidate) => dependentIds.has(candidate.id))
        .map((candidate) => this.summarise(context, candidate)),
      related: related.slice(0, 6).map((candidate) => this.summarise(context, candidate)),
    };
  }

  /**
   * One metric across branches or departments, or several metrics side by side
   * (plan §24). Each row is aggregated independently, through the same engine as
   * everything else — a comparison that disagreed with the dashboard would be worse
   * than no comparison.
   */
  async comparison(organizationId: string, dto: ComparisonDto): Promise<ComparisonResult> {
    const window = await this.resolveWindow(organizationId, dto);
    const context = await this.buildContext(organizationId, window);

    if (dto.breakdown === 'METRIC') {
      // Kept in the order they were asked for: the caller chose that order, and a
      // comparison table that silently re-sorts is a comparison nobody trusts.
      const chosen = dto.metricIds
        .map((id) => context.metrics.find((metric) => metric.id === id))
        .filter((metric): metric is (typeof context.metrics)[number] => Boolean(metric));

      if (chosen.length !== dto.metricIds.length) {
        throw ApiException.notFound('Metric');
      }

      return {
        window,
        breakdown: 'METRIC',
        metric: null,
        rows: chosen.map((metric) => {
          const summary = this.summarise(context, metric);

          return {
            key: metric.id,
            label: metric.name,
            current: summary.current,
            previous: summary.previous,
            changePct: summary.changePct,
            target: summary.target,
            varianceToTargetPct: summary.varianceToTargetPct,
            series: summary.series,
          };
        }),
      };
    }

    const metric = dto.metricId
      ? context.metrics.find((candidate) => candidate.id === dto.metricId)
      : context.metrics[0];

    if (!metric) {
      throw ApiException.notFound('Metric');
    }

    const slices = await this.slicesFor(organizationId, dto.breakdown, window);

    const rows: ComparisonRow[] = slices.map((slice) => {
      const scoped: ResolvedWindow = { ...window, ...slice.filter };
      const summary = this.summarise({ ...context, window: scoped }, metric);

      return {
        key: slice.key,
        label: slice.label,
        current: summary.current,
        previous: summary.previous,
        changePct: summary.changePct,
        target: summary.target,
        varianceToTargetPct: summary.varianceToTargetPct,
        series: summary.series,
      };
    });

    return {
      window,
      breakdown: dto.breakdown,
      metric: { id: metric.id, code: metric.code, name: metric.name, unit: metric.unit },
      rows,
    };
  }

  private async slicesFor(
    organizationId: string,
    breakdown: ComparisonBreakdown,
    window: ResolvedWindow,
  ): Promise<Array<{ key: string; label: string; filter: Partial<ResolvedWindow> }>> {
    if (breakdown === 'DEPARTMENT') {
      const departments = await this.prisma.department.findMany({
        where: {
          organizationId,
          isActive: true,
          ...(window.branchId ? { branchId: window.branchId } : {}),
        },
        orderBy: { name: 'asc' },
        select: { id: true, name: true, branchId: true },
      });

      return departments.map((department) => ({
        key: department.id,
        label: department.name,
        filter: { branchId: department.branchId, departmentId: department.id },
      }));
    }

    const branches = await this.prisma.branch.findMany({
      where: { organizationId, isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    });

    return branches.map((branch) => ({
      key: branch.id,
      label: branch.name,
      filter: { branchId: branch.id, departmentId: null },
    }));
  }

  private aggregateWithin(
    context: AnalyticsContext,
    metric: MetricRow,
    from: string,
    to: string,
    filter: SliceFilter,
  ): WindowAggregate {
    const values = this.within(context.values, from, to);
    const periods = periodsFor(metric.code, context.shapes, values);

    return aggregateMetric(metric.code, context.shapes, values, periods, filter);
  }

  private within(values: StoredValue[], from: string, to: string): StoredValue[] {
    return values.filter((value) => value.periodStart >= from && value.periodStart <= to);
  }

  private toSeries(
    context: AnalyticsContext,
    code: string,
    aggregate: WindowAggregate,
  ): SeriesPoint[] {
    return aggregate.series.map((point) => ({
      periodStart: point.periodStart,
      periodType: (context.periodTypes.get(`${code}:${point.periodStart}`) ??
        'MONTH') as SeriesPoint['periodType'],
      value: point.value.toString(),
    }));
  }
}

export interface AnalyticsContext {
  window: ResolvedWindow;
  metrics: MetricRow[];
  shapes: Map<string, MetricShape>;
  values: StoredValue[];
  targets: StoredValue[];
  /** Period type per metric and period, so a series can label its own points. */
  periodTypes: Map<string, string>;
}

export function toIsoDate(date: Date | null | undefined): string | null {
  return date ? date.toISOString().slice(0, 10) : null;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function shiftIsoDate(date: string, days: number): string {
  const shifted = new Date(`${date}T00:00:00.000Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);

  return shifted.toISOString().slice(0, 10);
}

/**
 * The window immediately before this one, of the same length.
 *
 * Measured in **months** when both ends fall on the first of a month, which is how
 * monthly period starts are stored. Counting days instead would compare six months
 * against five and a bit, and report the difference as growth.
 */
export function previousWindow(from: string, to: string): { from: string; to: string } {
  if (isMonthStart(from) && isMonthStart(to)) {
    const months = monthsBetween(from, to) + 1;

    return { from: startOfMonthsBefore(from, months), to: shiftIsoDate(from, -1) };
  }

  const span = daysBetween(from, to);

  return { from: shiftIsoDate(from, -(span + 1)), to: shiftIsoDate(from, -1) };
}

function isMonthStart(date: string): boolean {
  return date.endsWith('-01');
}

export function monthsBetween(from: string, to: string): number {
  const start = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T00:00:00.000Z`);

  return (
    (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + (end.getUTCMonth() - start.getUTCMonth())
  );
}

/** The first day of the month `count` months before the given date. */
export function startOfMonthsBefore(date: string, count: number): string {
  const anchor = new Date(`${date}T00:00:00.000Z`);

  return new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() - count, 1))
    .toISOString()
    .slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00.000Z`);
  const end = Date.parse(`${to}T00:00:00.000Z`);

  return Math.round((end - start) / 86_400_000);
}
