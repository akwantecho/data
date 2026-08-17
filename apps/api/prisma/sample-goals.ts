import type { PrismaClient } from '@prisma/client';
import { Prisma } from '@prisma/client';

/**
 * Sample goals and decisions (plan §48).
 *
 * The demonstration in plan §49 ends with a goal falling behind and a manager
 * recording a decision about it, so the seed has to arrive with both already in
 * place. Every figure here is derived from the history the seed just reported —
 * baselines and targets are read back out of the metric values, never invented —
 * so the goals move for the same reason the dashboard does.
 *
 * Idempotent: goals are keyed on their title within the organization.
 */

interface GoalPlan {
  /** Metric code the goal is measured on. */
  metric: string;
  title: string;
  description: string;
  /** Multiplier applied to what the last twelve months actually produced. */
  ambition: number;
}

/** One stretch goal and one steadier one per industry, on metrics the pack installs. */
const GOAL_PLANS: Record<string, GoalPlan[]> = {
  healthcare: [
    {
      metric: 'revenue',
      title: 'Grow annual revenue by 12%',
      description: 'The board target for the coming year, measured on reported revenue.',
      ambition: 1.12,
    },
    {
      metric: 'patient_retention',
      title: 'Bring patient retention back above 70%',
      description: 'Retention slipped alongside waiting times; this is the recovery target.',
      ambition: 1.05,
    },
  ],
  hospitality: [
    {
      metric: 'revenue',
      title: 'Grow annual revenue by 12%',
      description: 'The board target for the coming year, measured on reported revenue.',
      ambition: 1.12,
    },
    {
      metric: 'repeat_guest_rate',
      title: 'Lift the repeat guest rate to a third of stays',
      description: 'Repeat guests cost nothing to acquire; the target is a third of all stays.',
      ambition: 1.08,
    },
  ],
  real_estate: [
    {
      metric: 'revenue',
      title: 'Grow annual revenue by 12%',
      description: 'The board target for the coming year, measured on reported revenue.',
      ambition: 1.12,
    },
    {
      metric: 'collection_rate',
      title: 'Return the collection rate to 97%',
      description: 'Collections weakened over the year; this is where they need to be.',
      ambition: 1.03,
    },
  ],
};

/**
 * The decision each organization arrives with, in the plan §31 shape: a problem
 * stated in numbers, an expected result, and the evidence it was taken on.
 */
const DECISION_PLANS: Record<
  string,
  { title: string; problem: string; expected: string; action: string }
> = {
  healthcare: {
    title: 'Add an evening clinic session twice a week',
    problem:
      'Appointment volume rose while revenue per patient fell, and waiting times climbed far enough that retention moved with them.',
    expected: 'Waiting times back under 20 minutes and retention recovering within two quarters.',
    action: 'Roster two evening sessions a week from next month',
  },
  hospitality: {
    title: 'Tighten the cancellation policy on discounted rates',
    problem:
      'Occupancy held up only because rooms were sold at a discount, and cancellations rose sharply against the same month last year.',
    expected: 'Cancellation rate back into single figures without losing occupancy.',
    action: 'Move discounted rates to a 48-hour cancellation window',
  },
  real_estate: {
    title: 'Fund a targeted re-letting push on vacant units',
    problem:
      'Vacancy rose while collections weakened, so revenue per unit fell on both sides at once.',
    expected: 'Occupancy back above 92% within two quarters, with collections following.',
    action: 'Commission photography and listings for every unit vacant over 60 days',
  },
};

export interface SampleGoalsResult {
  goals: number;
  decisions: number;
}

export async function seedSampleGoals(
  prisma: PrismaClient,
  organizationId: string,
  industryCode: string,
): Promise<SampleGoalsResult> {
  const plans = GOAL_PLANS[industryCode] ?? [];
  const result: SampleGoalsResult = { goals: 0, decisions: 0 };

  const admin = await prisma.organizationUser.findFirst({
    where: { organizationId, role: 'ORGANIZATION_ADMIN' },
    select: { userId: true },
  });

  const window = await windowFor(prisma, organizationId);

  if (!window) {
    return result;
  }

  const goalIds: string[] = [];
  const metricIds: string[] = [];

  for (const plan of plans) {
    const metric = await prisma.metric.findFirst({
      where: { organizationId, code: plan.metric },
      select: { id: true, aggregationType: true },
    });

    if (!metric) {
      continue;
    }

    const figures = await monthlyFigures(prisma, organizationId, metric.id, metric.aggregationType);

    if (figures.size === 0) {
      continue;
    }

    metricIds.push(metric.id);

    const existing = await prisma.goal.findFirst({
      where: { organizationId, title: plan.title },
      select: { id: true },
    });

    if (existing) {
      goalIds.push(existing.id);
      continue;
    }

    const { baseline, target } = benchmarks(plan, metric.aggregationType, figures, window.from);

    const goal = await prisma.goal.create({
      data: {
        organizationId,
        title: plan.title,
        description: plan.description,
        ownerId: admin?.userId ?? null,
        baselineValue: new Prisma.Decimal(baseline),
        targetValue: new Prisma.Decimal(target),
        startDate: window.from,
        dueDate: window.due,
        status: 'ACTIVE',
        metrics: { create: [{ metricId: metric.id, isPrimary: true }] },
      },
      select: { id: true },
    });

    goalIds.push(goal.id);
    result.goals += 1;
  }

  const decisionPlan = DECISION_PLANS[industryCode];

  if (!decisionPlan || (goalIds.length === 0 && metricIds.length === 0)) {
    return result;
  }

  const existingDecision = await prisma.decision.findFirst({
    where: { organizationId, title: decisionPlan.title },
    select: { id: true },
  });

  if (existingDecision) {
    return result;
  }

  // Whatever the engines raised for the latest period becomes this decision's
  // evidence — the same items an administrator would have clicked "Decide on this"
  // from in the decision centre.
  const [alerts, insights] = await Promise.all([
    prisma.alert.findMany({
      // Open and acknowledged both count: an acknowledged alert is one somebody has
      // seen and not yet resolved, which is exactly what a decision is taken on.
      where: { organizationId, status: { in: ['OPEN', 'ACKNOWLEDGED'] } },
      orderBy: { severity: 'desc' },
      take: 2,
      select: { id: true },
    }),
    prisma.insight.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
      take: 2,
      select: { id: true },
    }),
  ]);

  await prisma.decision.create({
    data: {
      organizationId,
      title: decisionPlan.title,
      problemStatement: decisionPlan.problem,
      context: 'Raised at the monthly management review.',
      ownerId: admin?.userId ?? null,
      status: 'IN_PROGRESS',
      priority: 'HIGH',
      decisionDate: window.decided,
      expectedOutcome: decisionPlan.expected,
      reviewDate: window.review,
      metrics: { create: metricIds.map((metricId) => ({ metricId })) },
      goals: { create: goalIds.map((goalId) => ({ goalId })) },
      alerts: { create: alerts.map((alert) => ({ alertId: alert.id })) },
      insights: { create: insights.map((insight) => ({ insightId: insight.id })) },
      actions: {
        create: [{ title: decisionPlan.action, ownerId: admin?.userId ?? null }],
      },
    },
  });

  result.decisions += 1;

  return result;
}

/**
 * The goal window: six reported months behind, six months ahead.
 *
 * A goal that starts where the history starts and ends where it ends is finished
 * before anyone looks at it, and one that starts today has nothing to show. Half
 * elapsed is the only span that demonstrates anything: there is progress to read,
 * and time left in which it could still go either way.
 */
async function windowFor(
  prisma: PrismaClient,
  organizationId: string,
): Promise<{ from: Date; due: Date; decided: Date; review: Date } | null> {
  const latest = await prisma.metricValue.findFirst({
    where: { organizationId },
    orderBy: { periodStart: 'desc' },
    select: { periodStart: true },
  });

  if (!latest) {
    return null;
  }

  const end = latest.periodStart;
  const year = end.getUTCFullYear();
  const month = end.getUTCMonth();

  return {
    from: new Date(Date.UTC(year, month - 5, 1)),
    due: new Date(Date.UTC(year, month + 7, 1)),
    decided: end,
    review: new Date(Date.UTC(year, month + 3, 1)),
  };
}

/** The goal window's length in months — half of it already reported. */
const WINDOW_MONTHS = 12;

/**
 * The organization-level figure for each reported month.
 *
 * Summed metrics add across branches; everything else averages, which is what the
 * analytics engine does for the same window (ADR-0010). Deriving the baseline and
 * target from these rather than inventing them is what keeps the seeded goal's
 * progress honest — it is measured against the same arithmetic the product uses.
 */
async function monthlyFigures(
  prisma: PrismaClient,
  organizationId: string,
  metricId: string,
  aggregationType: string,
): Promise<Map<number, number>> {
  const values = await prisma.metricValue.findMany({
    where: { organizationId, metricId },
    select: { value: true, periodStart: true },
  });

  const byMonth = new Map<number, number[]>();

  for (const row of values) {
    const key = row.periodStart.getTime();
    byMonth.set(key, [...(byMonth.get(key) ?? []), Number(row.value)]);
  }

  const figures = new Map<number, number>();

  for (const [key, amounts] of byMonth) {
    figures.set(
      key,
      aggregationType === 'SUM'
        ? amounts.reduce((total, amount) => total + amount, 0)
        : amounts.reduce((total, amount) => total + amount, 0) / amounts.length,
    );
  }

  return figures;
}

/**
 * Where the goal starts from and what it is aiming at.
 *
 * A cumulative metric starts from nothing and aims at a year's worth of it, uplifted
 * by the goal's ambition. A rate starts from wherever it stood when the window
 * opened, because "raise retention by 5%" means from there, not from zero.
 */
function benchmarks(
  plan: GoalPlan,
  aggregationType: string,
  figures: Map<number, number>,
  from: Date,
): { baseline: number; target: number } {
  if (aggregationType === 'SUM') {
    const months = [...figures.values()];
    const monthly = months.reduce((total, amount) => total + amount, 0) / months.length;

    return { baseline: 0, target: round(monthly * WINDOW_MONTHS * plan.ambition) };
  }

  const opening = figures.get(from.getTime()) ?? average([...figures.values()]);

  return { baseline: round(opening), target: round(opening * plan.ambition) };
}

function average(values: number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
