import { Injectable, Logger } from '@nestjs/common';
import { Prisma, type PeriodType } from '@prisma/client';
import type { RecalculationResult, RecalculationSkip } from '@sip/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import {
  collectDependencies,
  evaluateFormula,
  parseFormula,
  topologicalOrder,
  type Node,
} from './formula/formula';

/** One period and slice: the unit a formula is evaluated for. */
interface SliceKey {
  periodType: PeriodType;
  periodStart: Date;
  branchId: string | null;
  departmentId: string | null;
}

interface Slice extends SliceKey {
  values: Map<string, Prisma.Decimal>;
}

interface FormulaMetric {
  id: string;
  code: string;
  frequency: PeriodType;
  ast: Node;
  dependencies: string[];
}

/** Recalculation is bounded: a formula chain deeper than this is a modelling error. */
const MAX_SKIPS_REPORTED = 100;

/**
 * Calculates formula metrics from stored ones (plan §42, Sprint 4).
 *
 * Everything here runs server-side and is written back as `metric_values` with
 * `isCalculated = true`, so the dashboard, reports and the AI context all read the
 * same numbers and no client ever derives a KPI (ADR-0004, plan §5.4).
 *
 * A formula is evaluated **per slice**: the same period, branch and department as
 * its inputs. A branch-level margin therefore uses that branch's revenue, and an
 * organization-level margin uses the organization-level figures — mixing the two
 * would invent a number nobody reported.
 */
@Injectable()
export class CalculationService {
  private readonly logger = new Logger(CalculationService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Recalculates every formula metric for the organization.
   *
   * `periods` narrows the work to the periods an import touched; without it the
   * whole history is recomputed, which is what the manual "recalculate" action does.
   */
  async recalculate(
    organizationId: string,
    periods?: Array<{ periodType: PeriodType; periodStart: Date }>,
  ): Promise<RecalculationResult> {
    const metrics = await this.loadFormulaMetrics(organizationId);

    if (metrics.length === 0) {
      return { calculated: 0, skipped: [] };
    }

    const { order, cycle } = topologicalOrder(
      metrics.map((metric) => ({ code: metric.code, dependencies: metric.dependencies })),
    );

    if (cycle) {
      // Creating a cycle is blocked at save time; reaching here means the data was
      // changed another way, so the whole run stops rather than looping.
      this.logger.error(
        `Circular metric formulas in organization ${organizationId}: ${cycle.join(' → ')}`,
      );
      return {
        calculated: 0,
        skipped: [
          {
            metricCode: cycle[0],
            period: '—',
            reason: 'MISSING_INPUT',
            detail: `Circular dependency: ${cycle.join(' → ')}`,
          },
        ],
      };
    }

    const byCode = new Map(metrics.map((metric) => [metric.code, metric]));
    const slices = await this.loadSlices(organizationId, periods);

    const writes: Prisma.MetricValueUncheckedCreateInput[] = [];
    const skipped: RecalculationSkip[] = [];

    for (const slice of slices) {
      for (const code of order) {
        const metric = byCode.get(code);

        if (!metric || metric.frequency !== slice.periodType) {
          // A monthly formula is not calculated onto a quarterly slice.
          continue;
        }

        const result = evaluateFormula(metric.ast, slice.values);

        if (!result.ok) {
          if (skipped.length < MAX_SKIPS_REPORTED) {
            skipped.push({
              metricCode: code,
              period: slice.periodStart.toISOString().slice(0, 10),
              reason: result.reason,
              detail: result.detail,
            });
          }
          continue;
        }

        // Later formulas in the same slice can read this result.
        slice.values.set(code, result.value);

        writes.push({
          organizationId,
          metricId: metric.id,
          branchId: slice.branchId,
          departmentId: slice.departmentId,
          periodType: slice.periodType,
          periodStart: slice.periodStart,
          periodEnd: periodEndFor(slice.periodType, slice.periodStart),
          value: result.value.toDecimalPlaces(6).toString(),
          sourceType: 'CALCULATED',
          isCalculated: true,
          calculatedAt: new Date(),
        });
      }
    }

    // A targeted run only touches the periods it was given; a full run replaces
    // everything, so nothing calculated can outlive the data behind it.
    await this.replaceCalculatedValues(organizationId, metrics, periods ?? null, writes);

    return { calculated: writes.length, skipped };
  }

  /**
   * Removes stale calculated values and writes the new ones in one transaction.
   *
   * Stale removal matters: if revenue drops to zero, last month's margin must
   * disappear rather than linger as a number nothing supports any more.
   */
  private async replaceCalculatedValues(
    organizationId: string,
    metrics: FormulaMetric[],
    scope: Array<{ periodType: PeriodType; periodStart: Date }> | null,
    writes: Prisma.MetricValueUncheckedCreateInput[],
  ): Promise<void> {
    const metricIds = metrics.map((metric) => metric.id);

    if (metricIds.length === 0) {
      return;
    }

    // On a full run every calculated value is replaced, including those whose
    // inputs have disappeared entirely — a slice with no inputs left produces no
    // slice at all, so scoping the delete to surviving slices would leave the old
    // number behind.
    const periodFilter =
      scope === null
        ? {}
        : {
            OR: scope.map((period) => ({
              periodType: period.periodType,
              periodStart: period.periodStart,
            })),
          };

    if (scope !== null && scope.length === 0) {
      return;
    }

    await this.prisma.$transaction(
      async (tx) => {
        await tx.metricValue.deleteMany({
          where: {
            organizationId,
            metricId: { in: metricIds },
            isCalculated: true,
            ...periodFilter,
          },
        });

        for (let index = 0; index < writes.length; index += 200) {
          await tx.metricValue.createMany({ data: writes.slice(index, index + 200) });
        }
      },
      { timeout: 60_000 },
    );
  }

  private async loadFormulaMetrics(organizationId: string): Promise<FormulaMetric[]> {
    const metrics = await this.prisma.metric.findMany({
      where: { organizationId, isActive: true, aggregationType: 'FORMULA' },
      select: { id: true, code: true, frequency: true, formula: { select: { expression: true } } },
    });

    return metrics.flatMap((metric) => {
      if (!metric.formula) {
        this.logger.warn(`Metric ${metric.code} is FORMULA but has no expression; skipping`);
        return [];
      }

      try {
        const ast = parseFormula(metric.formula.expression);

        return [
          {
            id: metric.id,
            code: metric.code.toLowerCase(),
            frequency: frequencyToPeriodType(metric.frequency),
            ast,
            dependencies: collectDependencies(ast),
          },
        ];
      } catch (error) {
        this.logger.error(
          `Metric ${metric.code} has an invalid formula: ${(error as Error).message}`,
        );
        return [];
      }
    });
  }

  /** Groups every stored value into the slices a formula can be evaluated against. */
  private async loadSlices(
    organizationId: string,
    periods?: Array<{ periodType: PeriodType; periodStart: Date }>,
  ): Promise<Slice[]> {
    const values = await this.prisma.metricValue.findMany({
      where: {
        organizationId,
        isCalculated: false,
        ...(periods && periods.length > 0
          ? {
              OR: periods.map((period) => ({
                periodType: period.periodType,
                periodStart: period.periodStart,
              })),
            }
          : {}),
      },
      select: {
        value: true,
        periodType: true,
        periodStart: true,
        branchId: true,
        departmentId: true,
        metric: { select: { code: true } },
      },
    });

    const slices = new Map<string, Slice>();

    for (const value of values) {
      const key = [
        value.periodType,
        value.periodStart.toISOString(),
        value.branchId ?? '-',
        value.departmentId ?? '-',
      ].join('|');

      const slice = slices.get(key) ?? {
        periodType: value.periodType,
        periodStart: value.periodStart,
        branchId: value.branchId,
        departmentId: value.departmentId,
        values: new Map<string, Prisma.Decimal>(),
      };

      slice.values.set(value.metric.code.toLowerCase(), value.value);
      slices.set(key, slice);
    }

    return [...slices.values()];
  }
}

export function frequencyToPeriodType(
  frequency: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'YEARLY',
): PeriodType {
  switch (frequency) {
    case 'DAILY':
      return 'DAY';
    case 'WEEKLY':
      return 'WEEK';
    case 'MONTHLY':
      return 'MONTH';
    case 'QUARTERLY':
      return 'QUARTER';
    case 'YEARLY':
      return 'YEAR';
  }
}

/** Recomputes the period end from its start, keeping storage self-consistent. */
export function periodEndFor(type: PeriodType, start: Date): Date {
  const year = start.getUTCFullYear();
  const month = start.getUTCMonth();

  switch (type) {
    case 'DAY':
      return start;
    case 'WEEK':
      return new Date(start.getTime() + 6 * 86_400_000);
    case 'MONTH':
      return new Date(Date.UTC(year, month + 1, 0));
    case 'QUARTER':
      return new Date(Date.UTC(year, month + 3, 0));
    case 'YEAR':
      return new Date(Date.UTC(year, 11, 31));
  }
}
