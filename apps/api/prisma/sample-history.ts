import type { PrismaClient } from '@prisma/client';
import { Prisma } from '@prisma/client';

/**
 * Twelve months of sample metric values (plan §48).
 *
 * The dashboard is unreadable without history — a single month has no trend, no
 * change and no comparison — so the seed reports a year of figures per branch,
 * then lets the real calculation service derive everything formula-driven from
 * them.
 *
 * Deterministic on purpose: the shape of the data comes from the metric code and
 * the month index, never from a random number, so two people demonstrating the
 * product see the same figures and a failing screenshot can be reproduced.
 */

/** Base monthly figure per metric code, at organization level. */
const BASELINES: Record<
  string,
  { base: number; growth: number; season: number; decimals: number }
> = {
  // Universal
  revenue: { base: 420_000, growth: 0.011, season: 0.09, decimals: 2 },
  expenses: { base: 305_000, growth: 0.014, season: 0.05, decimals: 2 },
  customers: { base: 1_850, growth: 0.008, season: 0.07, decimals: 0 },
  satisfaction_score: { base: 8.1, growth: 0.001, season: 0.02, decimals: 2 },
  // Healthcare
  patients: { base: 2_400, growth: 0.009, season: 0.08, decimals: 0 },
  appointments: { base: 3_150, growth: 0.01, season: 0.1, decimals: 0 },
  completed_appointments: { base: 2_780, growth: 0.01, season: 0.09, decimals: 0 },
  cancelled_appointments: { base: 210, growth: 0.004, season: 0.18, decimals: 0 },
  no_show_rate: { base: 7.4, growth: 0.006, season: 0.12, decimals: 2 },
  doctor_utilization: { base: 78, growth: 0.002, season: 0.05, decimals: 2 },
  average_waiting_time: { base: 22, growth: 0.005, season: 0.14, decimals: 1 },
  patient_retention: { base: 68, growth: 0.001, season: 0.04, decimals: 2 },
  treatment_completion_rate: { base: 86, growth: 0.001, season: 0.03, decimals: 2 },
  // Hospitality
  bookings: { base: 1_450, growth: 0.012, season: 0.22, decimals: 0 },
  guests: { base: 2_980, growth: 0.011, season: 0.24, decimals: 0 },
  available_rooms: { base: 4_650, growth: 0, season: 0.02, decimals: 0 },
  occupied_rooms: { base: 3_400, growth: 0.006, season: 0.19, decimals: 0 },
  cancellation_rate: { base: 9.2, growth: 0.003, season: 0.16, decimals: 2 },
  average_length_of_stay: { base: 2.8, growth: 0.002, season: 0.08, decimals: 2 },
  repeat_guest_rate: { base: 31, growth: 0.004, season: 0.05, decimals: 2 },
  booking_lead_time: { base: 34, growth: 0.002, season: 0.11, decimals: 1 },
  // Real estate
  properties: { base: 42, growth: 0.004, season: 0, decimals: 0 },
  units: { base: 780, growth: 0.005, season: 0, decimals: 0 },
  occupied_units: { base: 705, growth: 0.004, season: 0.03, decimals: 0 },
  vacant_units: { base: 75, growth: -0.002, season: 0.2, decimals: 0 },
  rental_yield: { base: 6.4, growth: 0.001, season: 0.04, decimals: 2 },
  collection_rate: { base: 94, growth: 0.0005, season: 0.03, decimals: 2 },
  maintenance_cost: { base: 38_000, growth: 0.009, season: 0.21, decimals: 2 },
  renewal_rate: { base: 72, growth: 0.002, season: 0.06, decimals: 2 },
};

/**
 * The last month does not simply continue the trend.
 *
 * A demonstration needs something to have gone wrong (plan §49): volume up while
 * monetization slips, waiting times climbing as retention falls, a rate crossing
 * the line it was given. These multipliers apply to the final month only, so the
 * health score has a reason to move, an alert has a reason to fire and an insight
 * has something true to say.
 */
const FINAL_MONTH_SHOCKS: Record<string, number> = {
  // Healthcare: more patients through the door, each one worth less.
  revenue: 0.93,
  patients: 1.05,
  appointments: 1.05,
  no_show_rate: 1.28,
  average_waiting_time: 1.22,
  patient_retention: 0.95,
  // Hospitality: rooms filling at a discount, cancellations climbing.
  occupied_rooms: 1.04,
  cancellation_rate: 1.3,
  repeat_guest_rate: 0.95,
  // Real estate: vacancy up, collections slipping.
  vacant_units: 1.35,
  occupied_units: 0.97,
  collection_rate: 0.94,
  maintenance_cost: 1.24,
};

/**
 * Warning and critical limits, as a percentage of the target.
 *
 * Direction decides which side of the target the lines sit on, so the defaults are
 * expressed once rather than per metric.
 */
const RELATIVE_THRESHOLDS = {
  HIGHER_IS_BETTER: { warning: 95, critical: 88 },
  LOWER_IS_BETTER: { warning: 108, critical: 120 },
} as const;

const MONTHS = 12;

export interface SampleHistoryResult {
  values: number;
  targets: number;
  thresholds: number;
}

export async function seedSampleHistory(
  prisma: PrismaClient,
  organizationId: string,
  /** Distinguishes organizations so two tenants do not show identical figures. */
  variance: number,
): Promise<SampleHistoryResult> {
  const metrics = await prisma.metric.findMany({
    where: { organizationId, isActive: true },
    select: { id: true, code: true, aggregationType: true, unit: true, direction: true },
  });

  // The metrics the installed health model weighs are the ones worth a target: a
  // score can only be as complete as the benchmarks behind it.
  const weighted = await prisma.healthMetricWeight.findMany({
    where: { healthCategory: { healthModel: { organizationId } } },
    select: { metric: { select: { code: true } } },
  });
  const scorable = new Set(weighted.map((row) => row.metric.code));

  const branches = await prisma.branch.findMany({
    where: { organizationId, isActive: true },
    orderBy: { code: 'asc' },
    select: { id: true },
  });

  const months = recentMonths(MONTHS);
  const result: SampleHistoryResult = { values: 0, targets: 0, thresholds: 0 };

  for (const metric of metrics) {
    const baseline = BASELINES[metric.code];

    // Formula metrics are left to the calculation service, and a metric this
    // module has no shape for is left empty rather than filled with a guess.
    if (!baseline || metric.aggregationType === 'FORMULA') {
      continue;
    }

    for (const [index, month] of months.entries()) {
      const isFinalMonth = index === months.length - 1;

      for (const [branchIndex, branch] of branches.entries()) {
        const shock = isFinalMonth ? (FINAL_MONTH_SHOCKS[metric.code] ?? 1) : 1;
        const value =
          branchFigure(
            baseline,
            index,
            variance,
            branchIndex,
            branches.length,
            metric.aggregationType,
          ) * shock;

        // PostgreSQL treats NULLs as distinct in a unique index, so the composite
        // key cannot be used while `departmentId` is null — matched explicitly, the
        // same way the import commit does it.
        const existingValue = await prisma.metricValue.findFirst({
          where: {
            organizationId,
            metricId: metric.id,
            branchId: branch.id,
            departmentId: null,
            periodType: 'MONTH',
            periodStart: month.start,
          },
          select: { id: true },
        });

        const amount = round(value, baseline.decimals);

        if (existingValue) {
          await prisma.metricValue.update({
            where: { id: existingValue.id },
            data: { value: amount },
          });
        } else {
          await prisma.metricValue.create({
            data: {
              organizationId,
              metricId: metric.id,
              branchId: branch.id,
              periodType: 'MONTH',
              periodStart: month.start,
              periodEnd: month.end,
              value: amount,
              sourceType: 'CSV',
            },
          });
        }

        result.values += 1;
      }
    }

    // A target on the final month for every metric the health model can score,
    // set from the trend the month *would* have followed had nothing gone wrong.
    // It is aggregated exactly as the engine aggregates the actuals — summed for
    // volumes, averaged for rates — so the two are comparable; a target derived
    // from a different shape would be a target nobody could be judged against.
    if (scorable.has(metric.code)) {
      const latest = months.at(-1) as Month;
      const perBranch = branches.map((_, branchIndex) =>
        branchFigure(
          baseline,
          months.length - 1,
          variance,
          branchIndex,
          branches.length,
          metric.aggregationType,
        ),
      );

      const expected = organizationFigure(perBranch, metric.aggregationType);

      const target = round(
        metric.direction === 'LOWER_IS_BETTER' ? expected * 0.98 : expected * 1.02,
        baseline.decimals,
      );

      const existingTarget = await prisma.metricTarget.findFirst({
        where: {
          organizationId,
          metricId: metric.id,
          branchId: null,
          periodType: 'MONTH',
          periodStart: latest.start,
        },
        select: { id: true },
      });

      if (existingTarget) {
        await prisma.metricTarget.update({
          where: { id: existingTarget.id },
          data: { targetValue: target },
        });
      } else {
        await prisma.metricTarget.create({
          data: {
            organizationId,
            metricId: metric.id,
            periodType: 'MONTH',
            periodStart: latest.start,
            periodEnd: latest.end,
            targetValue: target,
          },
        });
      }

      result.targets += 1;

      const limits =
        RELATIVE_THRESHOLDS[
          metric.direction === 'LOWER_IS_BETTER' ? 'LOWER_IS_BETTER' : 'HIGHER_IS_BETTER'
        ];

      const existingThreshold = await prisma.metricThreshold.findFirst({
        where: { organizationId, metricId: metric.id },
        select: { id: true },
      });

      if (!existingThreshold) {
        await prisma.metricThreshold.create({
          data: {
            organizationId,
            metricId: metric.id,
            warningValue: limits.warning,
            criticalValue: limits.critical,
            isRelativeToTarget: true,
          },
        });
      }

      result.thresholds += 1;
    }
  }

  return result;
}

interface Month {
  start: Date;
  end: Date;
}

/** The last `count` complete months, oldest first, in UTC. */
function recentMonths(count: number): Month[] {
  const now = new Date();
  const months: Month[] = [];

  for (let offset = count; offset >= 1; offset -= 1) {
    const start = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset + 1, 1, 0, 0, 0, 0),
    );
    const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0, 0, 0, 0, 0));

    months.push({ start, end });
  }

  return months;
}

/**
 * One branch's figure.
 *
 * A metric that sums across branches is split between them; one that averages,
 * or reports a stock, is reported by each branch at its own comparable level.
 * This mirrors how the analytics engine rolls the branches back up (ADR-0010), so
 * the seeded targets and the seeded values are on the same scale.
 */
function branchFigure(
  baseline: (typeof BASELINES)[string],
  monthIndex: number,
  variance: number,
  branchIndex: number,
  branchCount: number,
  aggregationType: string,
): number {
  const raw = figureFor(baseline, monthIndex, variance + branchIndex);

  if (aggregationType === 'SUM') {
    const share = branchCount === 1 ? 1 : branchIndex === 0 ? 0.58 : 0.42;

    return raw * share;
  }

  return raw * (1 - branchIndex * 0.06);
}

/** How those branch figures become the organization's, per ADR-0010. */
function organizationFigure(perBranch: number[], aggregationType: string): number {
  if (perBranch.length === 0) {
    return 0;
  }

  switch (aggregationType) {
    case 'SUM':
    case 'LAST':
      return perBranch.reduce((total, value) => total + value, 0);
    case 'MIN':
      return Math.min(...perBranch);
    case 'MAX':
      return Math.max(...perBranch);
    default:
      return perBranch.reduce((total, value) => total + value, 0) / perBranch.length;
  }
}

/**
 * A figure with a trend and a seasonal wobble, entirely determined by its inputs.
 * The wobble uses a sine so consecutive months move plausibly rather than jumping.
 */
function figureFor(
  baseline: (typeof BASELINES)[string],
  monthIndex: number,
  offset: number,
): number {
  const trend = 1 + baseline.growth * monthIndex;
  const season = 1 + baseline.season * Math.sin((monthIndex + offset * 2) / 1.9);

  return baseline.base * trend * season;
}

function round(value: number, decimals: number): Prisma.Decimal {
  return new Prisma.Decimal(value.toFixed(decimals));
}
