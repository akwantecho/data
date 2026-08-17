import { Injectable } from '@nestjs/common';
import { Prisma, type PeriodType } from '@prisma/client';
import type {
  MetricDetail,
  MetricSummary,
  MetricTargetSummary,
  MetricThresholdSummary,
  MetricValuePoint,
  ThresholdStatus,
} from '@sip/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { ApiException } from '../common/errors/api-exception';
import { AuditService } from '../audit/audit.service';
import { translateUniqueViolation } from '../branches/branches.service';
import { frequencyForPeriod, parsePeriod } from '../imports/period';
import {
  collectDependencies,
  FormulaError,
  parseFormula,
  topologicalOrder,
} from './formula/formula';
import type {
  CreateMetricDto,
  ManualValueDto,
  SetTargetDto,
  SetThresholdDto,
  UpdateMetricDto,
} from './metrics.dto';

const METRIC_SELECT = {
  id: true,
  code: true,
  name: true,
  description: true,
  category: true,
  unit: true,
  aggregationType: true,
  frequency: true,
  direction: true,
  isSystem: true,
  isActive: true,
  formula: { select: { expression: true, inputs: true } },
  _count: { select: { values: true } },
} as const;

const VALUE_SELECT = {
  periodType: true,
  periodStart: true,
  periodEnd: true,
  value: true,
  branchId: true,
  departmentId: true,
  isCalculated: true,
  sourceType: true,
  updatedAt: true,
  branch: { select: { name: true } },
  department: { select: { name: true } },
} as const;

/**
 * Metric definitions and the values stored against them.
 *
 * Metrics are data, not code (plan §5.3): a KPI is a row here, never a constant in
 * a component. Every value shown to a user is read from or written by this service,
 * so the API stays the single source of numeric truth.
 */
@Injectable()
export class MetricsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(
    organizationId: string,
    filters: { category?: string; search?: string; includeInactive: boolean },
  ): Promise<MetricSummary[]> {
    const metrics = await this.prisma.metric.findMany({
      where: {
        organizationId,
        ...(filters.includeInactive ? {} : { isActive: true }),
        ...(filters.category ? { category: filters.category } : {}),
        ...(filters.search
          ? {
              OR: [
                { name: { contains: filters.search, mode: 'insensitive' } },
                { code: { contains: filters.search.toLowerCase() } },
              ],
            }
          : {}),
      },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
      select: METRIC_SELECT,
    });

    const latest = await this.latestValues(
      organizationId,
      metrics.map((metric) => metric.id),
    );

    return metrics.map((metric) => toSummary(metric, latest.get(metric.id) ?? null));
  }

  /** Everything the metric detail page needs (plan §25). */
  async detail(organizationId: string, id: string): Promise<MetricDetail> {
    const metric = await this.prisma.metric.findFirst({
      where: { id, organizationId },
      select: METRIC_SELECT,
    });

    if (!metric) {
      throw ApiException.notFound('Metric');
    }

    const [series, target, threshold, dependents] = await Promise.all([
      this.prisma.metricValue.findMany({
        // Organization-level series: branch and department roll-ups are Sprint 6.
        where: { organizationId, metricId: id, branchId: null, departmentId: null },
        orderBy: { periodStart: 'desc' },
        take: 24,
        select: VALUE_SELECT,
      }),
      this.prisma.metricTarget.findFirst({
        where: { organizationId, metricId: id, branchId: null },
        orderBy: { periodStart: 'desc' },
      }),
      this.prisma.metricThreshold.findUnique({
        where: { organizationId_metricId: { organizationId, metricId: id } },
      }),
      this.dependentsOf(organizationId, metric.code),
    ]);

    const current = series[0] ?? null;
    const previous = series[1] ?? null;

    const currentPoint = current ? toPoint(current) : null;
    const previousPoint = previous ? toPoint(previous) : null;

    const targetSummary: MetricTargetSummary | null = target
      ? {
          id: target.id,
          periodType: target.periodType,
          periodStart: target.periodStart.toISOString().slice(0, 10),
          periodEnd: target.periodEnd.toISOString().slice(0, 10),
          targetValue: target.targetValue.toString(),
          minValue: target.minValue?.toString() ?? null,
          maxValue: target.maxValue?.toString() ?? null,
          branchId: target.branchId,
        }
      : null;

    const thresholdSummary: MetricThresholdSummary | null = threshold
      ? {
          warningValue: threshold.warningValue?.toString() ?? null,
          criticalValue: threshold.criticalValue?.toString() ?? null,
          isRelativeToTarget: threshold.isRelativeToTarget,
        }
      : null;

    return {
      metric: toSummary(metric, currentPoint),
      dependencies: metric.formula ? (metric.formula.inputs as string[]) : [],
      dependents,
      currentValue: currentPoint,
      previousValue: previousPoint,
      changePct: percentageChange(current?.value ?? null, previous?.value ?? null),
      target: targetSummary,
      varianceToTargetPct: varianceToTarget(current?.value ?? null, target?.targetValue ?? null),
      threshold: thresholdSummary,
      thresholdStatus: evaluateThreshold(
        current?.value ?? null,
        threshold,
        target?.targetValue ?? null,
        metric.direction,
      ),
      // Oldest first, which is the order a chart wants.
      trend: series.map(toPoint).reverse(),
      lastUpdatedAt: current?.updatedAt.toISOString() ?? null,
    };
  }

  async create(
    organizationId: string,
    actorId: string,
    dto: CreateMetricDto,
    ipAddress?: string,
  ): Promise<MetricSummary> {
    await this.assertFormulaIsUsable(organizationId, dto.code, dto.aggregationType, dto.formula);

    const metric = await this.prisma.metric
      .create({
        data: {
          organizationId,
          code: dto.code,
          name: dto.name,
          description: dto.description ?? null,
          category: dto.category ?? null,
          unit: dto.unit,
          aggregationType: dto.aggregationType,
          frequency: dto.frequency,
          direction: dto.direction,
          ...(dto.aggregationType === 'FORMULA' && dto.formula
            ? {
                formula: {
                  create: {
                    expression: dto.formula,
                    inputs: collectDependencies(parseFormula(dto.formula)),
                  },
                },
              }
            : {}),
        },
        select: METRIC_SELECT,
      })
      .catch((error: unknown) => {
        throw translateUniqueViolation(error, dto.code);
      });

    await this.syncDependencies(organizationId, metric.id, dto.formula ?? null);

    await this.audit.record({
      actorId,
      organizationId,
      action: 'metric.created',
      entityType: 'metric',
      entityId: metric.id,
      after: { code: metric.code, name: metric.name, formula: dto.formula ?? null },
      ipAddress,
    });

    return toSummary(metric, null);
  }

  async update(
    organizationId: string,
    id: string,
    actorId: string,
    dto: UpdateMetricDto,
    ipAddress?: string,
  ): Promise<MetricSummary> {
    const before = await this.prisma.metric.findFirst({
      where: { id, organizationId },
      select: METRIC_SELECT,
    });

    if (!before) {
      throw ApiException.notFound('Metric');
    }

    // The code is the metric's identity everywhere else: formulas reference it,
    // CSV mappings target it, and industry packs match on it. Renaming it would
    // leave all three pointing at nothing, so the name is editable and the code
    // is not.
    if (dto.code !== undefined && dto.code !== before.code) {
      throw ApiException.validation('The request could not be processed.', [
        {
          field: 'code',
          message:
            'A metric code cannot be changed after creation — formulas and imports refer to it.',
        },
      ]);
    }

    const aggregationType = dto.aggregationType ?? before.aggregationType;
    const formula = dto.formula === undefined ? (before.formula?.expression ?? null) : dto.formula;

    await this.assertFormulaIsUsable(
      organizationId,
      dto.code ?? before.code,
      aggregationType,
      formula,
      id,
    );

    const { formula: _formula, ...scalars } = dto;

    // The definition and its formula are updated separately: the formula is a
    // one-to-one row that may need creating, replacing or removing entirely.
    await this.prisma.metric
      .update({
        where: { id: before.id },
        data: {
          ...scalars,
          description: dto.description === undefined ? undefined : (dto.description ?? null),
          category: dto.category === undefined ? undefined : (dto.category ?? null),
        },
      })
      .catch((error: unknown) => {
        throw translateUniqueViolation(error, dto.code ?? before.code);
      });

    if (aggregationType === 'FORMULA' && formula) {
      const inputs = collectDependencies(parseFormula(formula));

      await this.prisma.metricFormula.upsert({
        where: { metricId: before.id },
        create: { metricId: before.id, expression: formula, inputs },
        update: { expression: formula, inputs },
      });
    } else {
      await this.prisma.metricFormula.deleteMany({ where: { metricId: before.id } });
    }

    const updated = await this.prisma.metric.findUniqueOrThrow({
      where: { id: before.id },
      select: METRIC_SELECT,
    });

    await this.syncDependencies(organizationId, id, aggregationType === 'FORMULA' ? formula : null);

    await this.audit.record({
      actorId,
      organizationId,
      action: 'metric.updated',
      entityType: 'metric',
      entityId: id,
      before: snapshot(before),
      after: snapshot(updated),
      ipAddress,
    });

    return toSummary(updated, null);
  }

  /** A metric with stored values is deactivated, never deleted. */
  async remove(
    organizationId: string,
    id: string,
    actorId: string,
    ipAddress?: string,
  ): Promise<void> {
    const metric = await this.prisma.metric.findFirst({
      where: { id, organizationId },
      select: {
        id: true,
        code: true,
        name: true,
        isSystem: true,
        _count: { select: { values: true, weights: true, goalMetrics: true } },
      },
    });

    if (!metric) {
      throw ApiException.notFound('Metric');
    }

    if (metric.isSystem) {
      throw ApiException.conflict(
        'This metric comes from the industry pack and cannot be deleted. Deactivate it instead.',
      );
    }

    if (metric._count.values > 0) {
      throw ApiException.conflict(
        'This metric has reported values and cannot be deleted. Deactivate it instead.',
      );
    }

    const dependents = await this.dependentsOf(organizationId, metric.code);

    if (dependents.length > 0) {
      throw ApiException.conflict(
        `Other metrics are calculated from this one: ${dependents.join(', ')}.`,
      );
    }

    await this.prisma.metric.delete({ where: { id: metric.id } });

    await this.audit.record({
      actorId,
      organizationId,
      action: 'metric.deleted',
      entityType: 'metric',
      entityId: id,
      before: { code: metric.code, name: metric.name },
      ipAddress,
    });
  }

  /**
   * Manual data entry (plan §2).
   *
   * It writes the same `metric_values` rows an import does, through the same
   * period parsing and the same frequency check, so a hand-typed number is exactly
   * as trustworthy — and as replaceable — as an imported one.
   */
  async recordManualValue(
    organizationId: string,
    metricId: string,
    actorId: string,
    dto: ManualValueDto,
    ipAddress?: string,
  ): Promise<MetricValuePoint> {
    const metric = await this.prisma.metric.findFirst({
      where: { id: metricId, organizationId },
      select: { id: true, code: true, name: true, frequency: true, aggregationType: true },
    });

    if (!metric) {
      throw ApiException.notFound('Metric');
    }

    if (metric.aggregationType === 'FORMULA') {
      throw ApiException.conflict(
        `"${metric.name}" is calculated from other metrics, so its value cannot be entered by hand.`,
      );
    }

    const period = parsePeriod(dto.period);

    if (!period) {
      throw ApiException.validation('The request could not be processed.', [
        {
          field: 'period',
          message: 'Use 2026-01, 2026-Q1, 2026-W05, 2026 or 2026-01-31',
        },
      ]);
    }

    if (frequencyForPeriod(period.type) !== metric.frequency) {
      throw ApiException.validation('The request could not be processed.', [
        {
          field: 'period',
          message: `"${metric.name}" is reported ${metric.frequency.toLowerCase()}`,
        },
      ]);
    }

    await this.assertSliceBelongsToOrganization(organizationId, dto.branchId, dto.departmentId);

    const identity = {
      organizationId,
      metricId: metric.id,
      branchId: dto.branchId ?? null,
      departmentId: dto.departmentId ?? null,
      periodType: period.type,
      periodStart: period.start,
    };

    // Replace rather than append: one value per metric, period and slice.
    const written = await this.prisma.$transaction(async (tx) => {
      await tx.metricValue.deleteMany({ where: identity });

      return tx.metricValue.create({
        data: {
          ...identity,
          periodEnd: period.end,
          value: dto.value,
          sourceType: 'MANUAL',
          sourceRef: actorId,
          isCalculated: false,
        },
        select: VALUE_SELECT,
      });
    });

    await this.audit.record({
      actorId,
      organizationId,
      action: 'metric_value.entered',
      entityType: 'metric_value',
      entityId: metric.id,
      after: { metricCode: metric.code, period: dto.period, value: dto.value },
      ipAddress,
    });

    return toPoint(written);
  }

  async setTarget(
    organizationId: string,
    metricId: string,
    actorId: string,
    dto: SetTargetDto,
    ipAddress?: string,
  ): Promise<MetricTargetSummary> {
    const metric = await this.requireMetric(organizationId, metricId);
    const period = parsePeriod(dto.period);

    if (!period) {
      throw ApiException.validation('The request could not be processed.', [
        { field: 'period', message: 'Use 2026-01, 2026-Q1, 2026-W05, 2026 or 2026-01-31' },
      ]);
    }

    if (frequencyForPeriod(period.type) !== metric.frequency) {
      throw ApiException.validation('The request could not be processed.', [
        {
          field: 'period',
          message: `"${metric.name}" is reported ${metric.frequency.toLowerCase()}`,
        },
      ]);
    }

    await this.assertSliceBelongsToOrganization(organizationId, dto.branchId, null);

    const identity = {
      organizationId,
      metricId,
      branchId: dto.branchId ?? null,
      periodType: period.type,
      periodStart: period.start,
    };

    const target = await this.prisma.$transaction(async (tx) => {
      await tx.metricTarget.deleteMany({ where: identity });

      return tx.metricTarget.create({
        data: {
          ...identity,
          periodEnd: period.end,
          targetValue: dto.targetValue,
          minValue: dto.minValue ?? null,
          maxValue: dto.maxValue ?? null,
        },
      });
    });

    await this.audit.record({
      actorId,
      organizationId,
      action: 'metric_target.set',
      entityType: 'metric_target',
      entityId: target.id,
      after: { metricCode: metric.code, period: dto.period, targetValue: dto.targetValue },
      ipAddress,
    });

    return {
      id: target.id,
      periodType: target.periodType,
      periodStart: target.periodStart.toISOString().slice(0, 10),
      periodEnd: target.periodEnd.toISOString().slice(0, 10),
      targetValue: target.targetValue.toString(),
      minValue: target.minValue?.toString() ?? null,
      maxValue: target.maxValue?.toString() ?? null,
      branchId: target.branchId,
    };
  }

  async setThreshold(
    organizationId: string,
    metricId: string,
    actorId: string,
    dto: SetThresholdDto,
    ipAddress?: string,
  ): Promise<MetricThresholdSummary> {
    const metric = await this.requireMetric(organizationId, metricId);

    const threshold = await this.prisma.metricThreshold.upsert({
      where: { organizationId_metricId: { organizationId, metricId } },
      create: {
        organizationId,
        metricId,
        warningValue: dto.warningValue ?? null,
        criticalValue: dto.criticalValue ?? null,
        isRelativeToTarget: dto.isRelativeToTarget,
      },
      update: {
        warningValue: dto.warningValue ?? null,
        criticalValue: dto.criticalValue ?? null,
        isRelativeToTarget: dto.isRelativeToTarget,
      },
    });

    await this.audit.record({
      actorId,
      organizationId,
      action: 'metric_threshold.set',
      entityType: 'metric_threshold',
      entityId: threshold.id,
      after: {
        metricCode: metric.code,
        warningValue: dto.warningValue ?? null,
        criticalValue: dto.criticalValue ?? null,
      },
      ipAddress,
    });

    return {
      warningValue: threshold.warningValue?.toString() ?? null,
      criticalValue: threshold.criticalValue?.toString() ?? null,
      isRelativeToTarget: threshold.isRelativeToTarget,
    };
  }

  async trend(
    organizationId: string,
    metricId: string,
    filters: { branchId?: string; limit: number },
  ): Promise<MetricValuePoint[]> {
    await this.requireMetric(organizationId, metricId);

    const values = await this.prisma.metricValue.findMany({
      where: {
        organizationId,
        metricId,
        branchId: filters.branchId ?? null,
        departmentId: null,
      },
      orderBy: { periodStart: 'desc' },
      take: filters.limit,
      select: VALUE_SELECT,
    });

    return values.map(toPoint).reverse();
  }

  private async requireMetric(organizationId: string, metricId: string) {
    const metric = await this.prisma.metric.findFirst({
      where: { id: metricId, organizationId },
      select: { id: true, code: true, name: true, frequency: true },
    });

    if (!metric) {
      throw ApiException.notFound('Metric');
    }

    return metric;
  }

  /**
   * Checks a formula before it is stored: it must parse, reference metrics that
   * exist, and not create a cycle. Catching this at save time is what lets the
   * calculation engine assume its graph is sound.
   */
  private async assertFormulaIsUsable(
    organizationId: string,
    code: string,
    aggregationType: string,
    formula: string | null | undefined,
    metricId?: string,
  ): Promise<void> {
    if (aggregationType !== 'FORMULA') {
      return;
    }

    if (!formula || formula.trim().length === 0) {
      throw ApiException.validation('The request could not be processed.', [
        { field: 'formula', message: 'A formula metric needs an expression' },
      ]);
    }

    let dependencies: string[];

    try {
      dependencies = collectDependencies(parseFormula(formula));
    } catch (error) {
      throw ApiException.validation('The request could not be processed.', [
        {
          field: 'formula',
          message: error instanceof FormulaError ? error.message : 'The formula is not valid',
        },
      ]);
    }

    if (dependencies.length === 0) {
      throw ApiException.validation('The request could not be processed.', [
        { field: 'formula', message: 'A formula must reference at least one other metric' },
      ]);
    }

    const known = await this.prisma.metric.findMany({
      where: { organizationId, code: { in: dependencies } },
      select: { code: true },
    });
    const knownCodes = new Set(known.map((metric) => metric.code.toLowerCase()));
    const unknown = dependencies.filter((dependency) => !knownCodes.has(dependency));

    if (unknown.length > 0) {
      throw ApiException.validation('The request could not be processed.', [
        {
          field: 'formula',
          message: `Unknown metric${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}`,
        },
      ]);
    }

    const others = await this.prisma.metric.findMany({
      where: {
        organizationId,
        aggregationType: 'FORMULA',
        ...(metricId ? { id: { not: metricId } } : {}),
      },
      select: { code: true, formula: { select: { inputs: true } } },
    });

    const graph = [
      { code: code.toLowerCase(), dependencies },
      ...others.map((metric) => ({
        code: metric.code.toLowerCase(),
        dependencies: ((metric.formula?.inputs as string[]) ?? []).map((input) =>
          input.toLowerCase(),
        ),
      })),
    ];

    const { cycle } = topologicalOrder(graph);

    if (cycle) {
      throw ApiException.validation('The request could not be processed.', [
        { field: 'formula', message: `This would create a loop: ${cycle.join(' → ')}` },
      ]);
    }
  }

  /** Mirrors formula inputs into `metric_dependencies` so the graph is queryable. */
  private async syncDependencies(
    organizationId: string,
    metricId: string,
    formula: string | null,
  ): Promise<void> {
    await this.prisma.metricDependency.deleteMany({ where: { metricId } });

    if (!formula) {
      return;
    }

    const codes = collectDependencies(parseFormula(formula));

    if (codes.length === 0) {
      return;
    }

    const dependencies = await this.prisma.metric.findMany({
      where: { organizationId, code: { in: codes } },
      select: { id: true },
    });

    await this.prisma.metricDependency.createMany({
      data: dependencies.map((dependency) => ({ metricId, dependsOnId: dependency.id })),
      skipDuplicates: true,
    });
  }

  /** Formula metrics that read the given code. */
  private async dependentsOf(organizationId: string, code: string): Promise<string[]> {
    const metrics = await this.prisma.metric.findMany({
      where: { organizationId, aggregationType: 'FORMULA' },
      select: { code: true, formula: { select: { inputs: true } } },
    });

    return metrics
      .filter((metric) =>
        ((metric.formula?.inputs as string[]) ?? []).some(
          (input) => input.toLowerCase() === code.toLowerCase(),
        ),
      )
      .map((metric) => metric.code);
  }

  private async assertSliceBelongsToOrganization(
    organizationId: string,
    branchId: string | null | undefined,
    departmentId: string | null | undefined,
  ): Promise<void> {
    if (branchId) {
      const branch = await this.prisma.branch.findFirst({
        where: { id: branchId, organizationId },
        select: { id: true },
      });

      if (!branch) {
        throw ApiException.validation('The request could not be processed.', [
          { field: 'branchId', message: 'Unknown branch for this organization' },
        ]);
      }
    }

    if (departmentId) {
      const department = await this.prisma.department.findFirst({
        where: { id: departmentId, organizationId },
        select: { id: true },
      });

      if (!department) {
        throw ApiException.validation('The request could not be processed.', [
          { field: 'departmentId', message: 'Unknown department for this organization' },
        ]);
      }
    }
  }

  private async latestValues(
    organizationId: string,
    metricIds: string[],
  ): Promise<Map<string, MetricValuePoint>> {
    if (metricIds.length === 0) {
      return new Map();
    }

    const values = await this.prisma.metricValue.findMany({
      where: {
        organizationId,
        metricId: { in: metricIds },
        branchId: null,
        departmentId: null,
      },
      orderBy: { periodStart: 'desc' },
      select: { ...VALUE_SELECT, metricId: true },
    });

    const latest = new Map<string, MetricValuePoint>();

    for (const value of values) {
      if (!latest.has(value.metricId)) {
        latest.set(value.metricId, toPoint(value));
      }
    }

    return latest;
  }
}

type MetricRow = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  category: string | null;
  unit: MetricSummary['unit'];
  aggregationType: MetricSummary['aggregationType'];
  frequency: MetricSummary['frequency'];
  direction: MetricSummary['direction'];
  isSystem: boolean;
  isActive: boolean;
  formula: { expression: string; inputs: Prisma.JsonValue } | null;
  _count: { values: number };
};

type ValueRow = {
  periodType: PeriodType;
  periodStart: Date;
  periodEnd: Date;
  value: Prisma.Decimal;
  branchId: string | null;
  departmentId: string | null;
  isCalculated: boolean;
  sourceType: string;
  updatedAt: Date;
  branch: { name: string } | null;
  department: { name: string } | null;
};

function toSummary(metric: MetricRow, latestValue: MetricValuePoint | null): MetricSummary {
  return {
    id: metric.id,
    code: metric.code,
    name: metric.name,
    description: metric.description,
    category: metric.category,
    unit: metric.unit,
    aggregationType: metric.aggregationType,
    frequency: metric.frequency,
    direction: metric.direction,
    isCalculated: metric.aggregationType === 'FORMULA',
    formula: metric.formula?.expression ?? null,
    isSystem: metric.isSystem,
    isActive: metric.isActive,
    valueCount: metric._count.values,
    latestValue,
  };
}

function toPoint(value: ValueRow): MetricValuePoint {
  return {
    periodType: value.periodType,
    periodStart: value.periodStart.toISOString().slice(0, 10),
    periodEnd: value.periodEnd.toISOString().slice(0, 10),
    value: value.value.toString(),
    branchId: value.branchId,
    branchName: value.branch?.name ?? null,
    departmentId: value.departmentId,
    departmentName: value.department?.name ?? null,
    isCalculated: value.isCalculated,
    sourceType: value.sourceType,
    updatedAt: value.updatedAt.toISOString(),
  };
}

function snapshot(metric: MetricRow) {
  return {
    code: metric.code,
    name: metric.name,
    unit: metric.unit,
    aggregationType: metric.aggregationType,
    frequency: metric.frequency,
    direction: metric.direction,
    isActive: metric.isActive,
    formula: metric.formula?.expression ?? null,
  };
}

/** Period-over-period change. Undefined when the previous value is zero. */
export function percentageChange(
  current: Prisma.Decimal | null,
  previous: Prisma.Decimal | null,
): string | null {
  if (!current || !previous || previous.isZero()) {
    return null;
  }

  return current.minus(previous).dividedBy(previous).times(100).toDecimalPlaces(2).toString();
}

/** Signed distance from the target, as a percentage of the target. */
export function varianceToTarget(
  current: Prisma.Decimal | null,
  target: Prisma.Decimal | null,
): string | null {
  if (!current || !target || target.isZero()) {
    return null;
  }

  return current.minus(target).dividedBy(target).times(100).toDecimalPlaces(2).toString();
}

/**
 * Compares the current value with its thresholds, honouring the metric direction:
 * for `LOWER_IS_BETTER` a value *above* the threshold is bad, and vice versa.
 * Relative thresholds are read as a percentage of the target.
 */
export function evaluateThreshold(
  current: Prisma.Decimal | null,
  threshold: {
    warningValue: Prisma.Decimal | null;
    criticalValue: Prisma.Decimal | null;
    isRelativeToTarget: boolean;
  } | null,
  target: Prisma.Decimal | null,
  direction: MetricSummary['direction'],
): ThresholdStatus {
  if (!current || !threshold || direction === 'INFORMATIONAL') {
    return 'UNKNOWN';
  }

  const resolve = (value: Prisma.Decimal | null): Prisma.Decimal | null => {
    if (!value) {
      return null;
    }

    if (!threshold.isRelativeToTarget) {
      return value;
    }

    return target ? target.times(value).dividedBy(100) : null;
  };

  const critical = resolve(threshold.criticalValue);
  const warning = resolve(threshold.warningValue);

  const breaches = (limit: Prisma.Decimal | null): boolean => {
    if (!limit) {
      return false;
    }

    return direction === 'LOWER_IS_BETTER' ? current.greaterThan(limit) : current.lessThan(limit);
  };

  if (breaches(critical)) {
    return 'CRITICAL';
  }

  if (breaches(warning)) {
    return 'WARNING';
  }

  return 'OK';
}
