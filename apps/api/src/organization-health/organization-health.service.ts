import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  HealthCategoryScore,
  HealthCurrent,
  HealthHistoryPoint,
  HealthMetricScore,
  HealthRecalculationResult,
  HealthScoreSummary,
  PeriodType,
} from '@sip/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { periodEndFor } from '../metrics/calculation.service';
import { bandFor, combineWeighted, parseBands, scoreMetric, type BandDefinition } from './scoring';

const MODEL_SELECT = {
  id: true,
  name: true,
  bands: true,
  categories: {
    orderBy: { displayOrder: 'asc' },
    select: {
      code: true,
      name: true,
      weight: true,
      weights: {
        select: {
          weight: true,
          metric: {
            select: {
              id: true,
              code: true,
              name: true,
              direction: true,
              isActive: true,
              thresholds: {
                select: { warningValue: true, criticalValue: true, isRelativeToTarget: true },
                take: 1,
              },
            },
          },
        },
      },
    },
  },
} as const;

type ModelRow = Prisma.HealthModelGetPayload<{ select: typeof MODEL_SELECT }>;

/**
 * The health score engine (plan §26).
 *
 * Weighted two levels deep: metrics inside a category, categories into an overall
 * score. Every score is stored with a breakdown that names each contributing
 * metric, its value, its benchmark and the points it contributed — a score that
 * cannot explain itself is a number nobody can argue with, and arguing with it is
 * the whole point.
 */
@Injectable()
export class OrganizationHealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly analytics: AnalyticsService,
  ) {}

  /** The latest score, the one before it, and the model that produced them. */
  async current(organizationId: string, branchId: string | null): Promise<HealthCurrent> {
    const model = await this.prisma.healthModel.findFirst({
      where: { organizationId, isActive: true },
      select: { id: true, name: true, bands: true },
    });

    if (!model) {
      return {
        modelId: null,
        modelName: null,
        bands: parseBands(null),
        current: null,
        previous: null,
        changePoints: null,
      };
    }

    const scores = await this.prisma.healthScore.findMany({
      where: { organizationId, healthModelId: model.id, branchId },
      orderBy: { periodStart: 'desc' },
      take: 2,
      select: SCORE_SELECT,
    });

    const bands = parseBands(model.bands);
    const current = scores[0] ? toSummary(scores[0], bands) : null;
    const previous = scores[1] ? toSummary(scores[1], bands) : null;

    return {
      modelId: model.id,
      modelName: model.name,
      bands,
      current,
      previous,
      changePoints:
        current?.overallScore !== null && current !== null && previous?.overallScore != null
          ? round(current.overallScore - previous.overallScore)
          : null,
    };
  }

  async history(
    organizationId: string,
    branchId: string | null,
    limit: number,
  ): Promise<HealthHistoryPoint[]> {
    const scores = await this.prisma.healthScore.findMany({
      where: { organizationId, branchId },
      orderBy: { periodStart: 'desc' },
      take: limit,
      select: { periodType: true, periodStart: true, overallScore: true, band: true },
    });

    return scores
      .map((score) => ({
        periodType: score.periodType,
        periodStart: isoDate(score.periodStart),
        overallScore: Number(score.overallScore),
        band: score.band as HealthHistoryPoint['band'],
      }))
      .reverse();
  }

  /**
   * Scores the periods the organization has data for.
   *
   * `periods` narrows the work to what an import touched; without it the whole
   * history is rescored, which is what the manual action does.
   */
  async recalculate(
    organizationId: string,
    periods?: Array<{ periodType: PeriodType; periodStart: Date }>,
  ): Promise<HealthRecalculationResult> {
    const model = await this.prisma.healthModel.findFirst({
      where: { organizationId, isActive: true },
      select: MODEL_SELECT,
    });

    if (!model) {
      return { periodsScored: 0, skipped: [{ period: '—', reason: 'NO_HEALTH_MODEL' }] };
    }

    const metricIds = model.categories.flatMap((category) =>
      category.weights.map((weight) => weight.metric.id),
    );

    if (metricIds.length === 0) {
      return { periodsScored: 0, skipped: [{ period: '—', reason: 'MODEL_WEIGHS_NO_METRICS' }] };
    }

    const scope = periods ?? (await this.periodsWithData(organizationId, metricIds));
    const bands = parseBands(model.bands);
    const result: HealthRecalculationResult = { periodsScored: 0, skipped: [] };

    for (const period of scope) {
      const summary = await this.scorePeriod(organizationId, model, bands, period, null);

      if (summary.overallScore === null) {
        result.skipped.push({ period: isoDate(period.periodStart), reason: 'NOTHING_SCORABLE' });
        continue;
      }

      await this.store(organizationId, model.id, period, null, summary);
      result.periodsScored += 1;
    }

    return result;
  }

  /**
   * Scores one period against the model, without writing anything.
   *
   * Exposed so the alerts and insights engines — and the tests — can ask "what
   * would this period score?" without a round trip through the database.
   */
  async scorePeriod(
    organizationId: string,
    model: ModelRow,
    bands: BandDefinition[],
    period: { periodType: PeriodType; periodStart: Date },
    branchId: string | null,
  ): Promise<HealthScoreSummary> {
    // Read through the analytics engine, so a score uses exactly the figures the
    // dashboard shows for the same period — including branch roll-ups and formulas
    // recomputed from their inputs (ADR-0010).
    const context = await this.analytics.contextForPeriod(organizationId, period, branchId);
    const figures = new Map<
      string,
      {
        value: number | null;
        target: number | null;
        minValue: number | null;
        maxValue: number | null;
      }
    >();

    for (const metric of context.metrics) {
      const summary = this.analytics.summarise(context, metric);

      figures.set(metric.id, {
        value: summary.current === null ? null : Number(summary.current),
        target: summary.target === null ? null : Number(summary.target),
        minValue: null,
        maxValue: null,
      });
    }

    const categories: HealthCategoryScore[] = [];
    let unscored = 0;

    for (const category of model.categories) {
      const metrics: HealthMetricScore[] = [];
      const scorable: Array<{ score: number; weight: number; index: number }> = [];

      for (const weight of category.weights) {
        const metric = weight.metric;
        const figure = figures.get(metric.id) ?? {
          value: null,
          target: null,
          minValue: null,
          maxValue: null,
        };
        const threshold = metric.thresholds[0];
        const value = figure.value;

        const { score, basis } = scoreMetric({
          value,
          target: figure.target,
          minValue: figure.minValue,
          maxValue: figure.maxValue,
          warningValue: threshold?.warningValue ? Number(threshold.warningValue) : null,
          criticalValue: threshold?.criticalValue ? Number(threshold.criticalValue) : null,
          isRelativeToTarget: threshold?.isRelativeToTarget ?? false,
          direction: metric.direction,
        });

        if (score === null || !metric.isActive) {
          unscored += 1;
        } else {
          scorable.push({ score, weight: Number(weight.weight), index: metrics.length });
        }

        metrics.push({
          metricId: metric.id,
          code: metric.code,
          name: metric.name,
          weight: weight.weight.toString(),
          effectiveWeight: '0',
          value: value === null ? null : String(value),
          target: figure.target === null ? null : String(figure.target),
          score: metric.isActive ? score : null,
          basis: metric.isActive ? basis : 'INFORMATIONAL',
          contribution: null,
        });
      }

      const combined = combineWeighted(scorable.map(({ score, weight }) => ({ score, weight })));

      scorable.forEach((entry, position) => {
        const effective = combined.effectiveWeights[position] ?? 0;
        const target = metrics[entry.index];

        target.effectiveWeight = effective.toFixed(2);
        target.contribution = round((entry.score * effective) / 100);
      });

      categories.push({
        code: category.code,
        name: category.name,
        weight: category.weight.toString(),
        effectiveWeight: '0',
        score: combined.score,
        band: bandFor(combined.score, bands),
        metrics,
      });
    }

    const scorableCategories = categories
      .map((category, index) => ({ category, index }))
      .filter((entry) => entry.category.score !== null);

    const overall = combineWeighted(
      scorableCategories.map((entry) => ({
        score: entry.category.score as number,
        weight: Number(entry.category.weight),
      })),
    );

    scorableCategories.forEach((entry, position) => {
      entry.category.effectiveWeight = (overall.effectiveWeights[position] ?? 0).toFixed(2);
    });

    return {
      periodType: period.periodType,
      periodStart: isoDate(period.periodStart),
      periodEnd: isoDate(periodEndFor(period.periodType, period.periodStart)),
      branchId,
      branchName: null,
      overallScore: overall.score,
      band: bandFor(overall.score, bands),
      categories,
      unscoredMetrics: unscored,
      calculatedAt: new Date().toISOString(),
    };
  }

  /** The model as configured, for callers that need to score without re-reading it. */
  async loadModel(organizationId: string): Promise<ModelRow | null> {
    return this.prisma.healthModel.findFirst({
      where: { organizationId, isActive: true },
      select: MODEL_SELECT,
    });
  }

  private async periodsWithData(
    organizationId: string,
    metricIds: string[],
  ): Promise<Array<{ periodType: PeriodType; periodStart: Date }>> {
    const periods = await this.prisma.metricValue.findMany({
      where: { organizationId, metricId: { in: metricIds }, branchId: null, departmentId: null },
      distinct: ['periodType', 'periodStart'],
      orderBy: { periodStart: 'asc' },
      select: { periodType: true, periodStart: true },
    });

    if (periods.length > 0) {
      return periods;
    }

    // Nothing at organization level: the periods the branches reported are the
    // periods the organization lived through.
    const branchPeriods = await this.prisma.metricValue.findMany({
      where: { organizationId, metricId: { in: metricIds } },
      distinct: ['periodType', 'periodStart'],
      orderBy: { periodStart: 'asc' },
      select: { periodType: true, periodStart: true },
    });

    return branchPeriods;
  }

  private async store(
    organizationId: string,
    healthModelId: string,
    period: { periodType: PeriodType; periodStart: Date },
    branchId: string | null,
    summary: HealthScoreSummary,
  ): Promise<void> {
    // PostgreSQL treats NULLs as distinct in a unique index, so a null branch
    // cannot be matched through the composite key — found explicitly instead.
    const existing = await this.prisma.healthScore.findFirst({
      where: {
        organizationId,
        healthModelId,
        branchId,
        periodType: period.periodType,
        periodStart: period.periodStart,
      },
      select: { id: true },
    });

    const data = {
      overallScore: new Prisma.Decimal(summary.overallScore as number),
      band: summary.band as string,
      breakdown: {
        categories: summary.categories,
        unscoredMetrics: summary.unscoredMetrics,
      } as unknown as Prisma.InputJsonValue,
      calculatedAt: new Date(),
    };

    if (existing) {
      await this.prisma.healthScore.update({ where: { id: existing.id }, data });
      return;
    }

    await this.prisma.healthScore.create({
      data: {
        organizationId,
        healthModelId,
        branchId,
        periodType: period.periodType,
        periodStart: period.periodStart,
        periodEnd: periodEndFor(period.periodType, period.periodStart),
        ...data,
      },
    });
  }
}

const SCORE_SELECT = {
  periodType: true,
  periodStart: true,
  periodEnd: true,
  branchId: true,
  overallScore: true,
  band: true,
  breakdown: true,
  calculatedAt: true,
  branch: { select: { name: true } },
} as const;

type ScoreRow = Prisma.HealthScoreGetPayload<{ select: typeof SCORE_SELECT }>;

function toSummary(score: ScoreRow, bands: BandDefinition[]): HealthScoreSummary {
  const breakdown = (score.breakdown ?? {}) as {
    categories?: HealthCategoryScore[];
    unscoredMetrics?: number;
  };

  return {
    periodType: score.periodType,
    periodStart: isoDate(score.periodStart),
    periodEnd: isoDate(score.periodEnd),
    branchId: score.branchId,
    branchName: score.branch?.name ?? null,
    overallScore: Number(score.overallScore),
    band: bandFor(Number(score.overallScore), bands),
    categories: breakdown.categories ?? [],
    unscoredMetrics: breakdown.unscoredMetrics ?? 0,
    calculatedAt: score.calculatedAt.toISOString(),
  };
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
