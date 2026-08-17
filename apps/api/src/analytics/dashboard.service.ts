import { Injectable } from '@nestjs/common';
import type {
  DashboardAttention,
  DashboardHealth,
  DashboardOverview,
  MetricAnalytics,
  PerformanceSummary,
} from '@sip/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { DataQualityService } from '../data-quality/data-quality.service';
import { expectedProgressFor } from '../goals/goal-progress';
import { AnalyticsService, type AnalyticsContext } from './analytics.service';
import type { AnalyticsFiltersDto } from './analytics.dto';

/** How many KPI cards the dashboard shows before it stops being a dashboard. */
const MAX_KPIS = 6;

/**
 * The executive dashboard (plan §21).
 *
 * One request answers the whole screen, so every panel describes the same window
 * and the same slice — a filter that moved half the page would be worse than no
 * filter at all.
 */
@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly analytics: AnalyticsService,
    private readonly dataQuality: DataQualityService,
  ) {}

  async overview(organizationId: string, filters: AnalyticsFiltersDto): Promise<DashboardOverview> {
    const window = await this.analytics.resolveWindow(organizationId, filters);
    const context = await this.analytics.buildContext(organizationId, window);

    const kpiCodes = await this.chooseKpis(organizationId, context);
    const kpis = kpiCodes
      .map((code) => context.metrics.find((metric) => metric.code === code))
      .filter((metric): metric is (typeof context.metrics)[number] => Boolean(metric))
      .map((metric) => this.analytics.summarise(context, metric));

    const [health, attention, quality] = await Promise.all([
      this.health(organizationId),
      this.attention(organizationId),
      this.quality(organizationId),
    ]);

    return {
      window,
      kpis,
      headline: this.headline(kpis),
      performance: this.performance(context, kpis),
      health,
      dataQuality: quality,
      attention,
      metricCount: context.metrics.length,
    };
  }

  /**
   * Which metrics become KPI cards (ADR-0010).
   *
   * The health model already states what this organization considers important and
   * how much, per industry and editable per tenant — so the highest-weighted metric
   * in each health category is the KPI set, and no industry vocabulary is hardcoded
   * anywhere. An organization without a model falls back to the metrics carrying the
   * most reported values, which is the only evidence available about what it tracks.
   */
  private async chooseKpis(organizationId: string, context: AnalyticsContext): Promise<string[]> {
    const model = await this.prisma.healthModel.findFirst({
      where: { organizationId, isActive: true },
      select: {
        categories: {
          orderBy: [{ weight: 'desc' }, { displayOrder: 'asc' }],
          select: {
            weights: {
              orderBy: { weight: 'desc' },
              select: { metric: { select: { code: true, isActive: true } } },
            },
          },
        },
      },
    });

    const chosen: string[] = [];

    for (const category of model?.categories ?? []) {
      const top = category.weights.find((weight) => weight.metric.isActive);

      if (top && !chosen.includes(top.metric.code)) {
        chosen.push(top.metric.code);
      }
    }

    // The model is the organization's own statement of what matters. Topping it up
    // with whatever else has data would put a metric it did not weigh beside ones
    // it did, so the fallback applies only when there is no model at all.
    if (chosen.length > 0) {
      return chosen.slice(0, MAX_KPIS).filter((code) => context.shapes.has(code));
    }

    const byValueCount = await this.prisma.metric.findMany({
      where: { organizationId, isActive: true },
      orderBy: { values: { _count: 'desc' } },
      take: MAX_KPIS,
      select: { code: true },
    });

    for (const metric of byValueCount) {
      if (chosen.length >= MAX_KPIS) {
        break;
      }

      if (!chosen.includes(metric.code)) {
        chosen.push(metric.code);
      }
    }

    return chosen.filter((code) => context.shapes.has(code));
  }

  /** The trend chart's metric: the first KPI that actually has a series to draw. */
  private headline(kpis: MetricAnalytics[]): MetricAnalytics | null {
    return kpis.find((kpi) => kpi.series.length > 0) ?? kpis[0] ?? null;
  }

  /**
   * Where the organization stands against its own thresholds and targets.
   *
   * This is a real count over every active metric, not the health score — that is
   * a weighted model and belongs to Sprint 7.
   */
  private performance(context: AnalyticsContext, kpis: MetricAnalytics[]): PerformanceSummary {
    const summary: PerformanceSummary = {
      ok: 0,
      warning: 0,
      critical: 0,
      unknown: 0,
      onTarget: 0,
      belowTarget: 0,
      withoutTarget: 0,
    };

    const byCode = new Map(kpis.map((kpi) => [kpi.code, kpi]));

    for (const metric of context.metrics) {
      const analytics = byCode.get(metric.code) ?? this.analytics.summarise(context, metric);

      switch (analytics.thresholdStatus) {
        case 'OK':
          summary.ok += 1;
          break;
        case 'WARNING':
          summary.warning += 1;
          break;
        case 'CRITICAL':
          summary.critical += 1;
          break;
        default:
          summary.unknown += 1;
      }

      if (analytics.target === null || analytics.current === null) {
        summary.withoutTarget += 1;
        continue;
      }

      const meets =
        metric.direction === 'LOWER_IS_BETTER'
          ? Number(analytics.current) <= Number(analytics.target)
          : Number(analytics.current) >= Number(analytics.target);

      if (meets) {
        summary.onTarget += 1;
      } else {
        summary.belowTarget += 1;
      }
    }

    return summary;
  }

  /**
   * The installed health model.
   *
   * Scores are calculated in Sprint 7. Until then the model is shown with no score
   * rather than a placeholder number — a fabricated score on an executive dashboard
   * is worse than an honest blank.
   */
  private async health(organizationId: string): Promise<DashboardHealth | null> {
    const model = await this.prisma.healthModel.findFirst({
      where: { organizationId, isActive: true },
      select: {
        name: true,
        categories: {
          orderBy: { displayOrder: 'asc' },
          select: { code: true, name: true, weight: true },
        },
      },
    });

    if (!model) {
      return null;
    }

    return {
      modelName: model.name,
      overallScore: null,
      band: null,
      categories: model.categories.map((category) => ({
        code: category.code,
        name: category.name,
        weight: category.weight.toString(),
        score: null,
      })),
    };
  }

  /**
   * Open items competing for attention (plan §21). The engines that create them
   * arrive in Sprints 7 and 8; the panels read the real tables now, so they light up
   * the moment those engines write their first row.
   */
  private async attention(organizationId: string): Promise<DashboardAttention> {
    const [alerts, insights, goals, decisions] = await Promise.all([
      this.prisma.alert.findMany({
        where: { organizationId, status: { in: ['OPEN', 'ACKNOWLEDGED'] } },
        orderBy: [{ severity: 'desc' }, { createdAt: 'desc' }],
        take: 5,
        select: { id: true, title: true, severity: true, status: true, createdAt: true },
      }),
      this.prisma.insight.findMany({
        where: { organizationId },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: { id: true, title: true, severity: true, createdAt: true },
      }),
      this.prisma.goal.findMany({
        // Every goal still in flight, worst first: a goal off track is the one the
        // panel exists to surface.
        where: { organizationId, status: { in: ['ACTIVE', 'ON_TRACK', 'AT_RISK', 'OFF_TRACK'] } },
        orderBy: [{ progressPct: 'asc' }, { dueDate: 'asc' }],
        take: 5,
        select: {
          id: true,
          title: true,
          status: true,
          progressPct: true,
          startDate: true,
          dueDate: true,
        },
      }),
      this.prisma.decision.findMany({
        where: { organizationId, status: { in: ['OPEN', 'APPROVED', 'IN_PROGRESS'] } },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: { id: true, title: true, status: true, createdAt: true },
      }),
    ]);

    return {
      alerts: alerts.map((alert) => ({
        id: alert.id,
        title: alert.title,
        severity: alert.severity,
        status: alert.status,
        createdAt: alert.createdAt.toISOString(),
      })),
      insights: insights.map((insight) => ({
        id: insight.id,
        title: insight.title,
        severity: insight.severity,
        createdAt: insight.createdAt.toISOString(),
      })),
      goals: goals.map((goal) => ({
        id: goal.id,
        title: goal.title,
        status: goal.status,
        progressPct: goal.progressPct?.toString() ?? null,
        expectedProgressPct:
          expectedProgressFor(goal.startDate, goal.dueDate, new Date())?.toString() ?? null,
        dueDate: goal.dueDate.toISOString().slice(0, 10),
      })),
      decisions: decisions.map((decision) => ({
        id: decision.id,
        title: decision.title,
        status: decision.status,
        createdAt: decision.createdAt.toISOString(),
      })),
    };
  }

  private async quality(organizationId: string): Promise<DashboardOverview['dataQuality']> {
    const report = await this.dataQuality.report(organizationId);

    // Quality is measured from imports. With none, a score of 0 would read as
    // "your data is terrible" rather than "nothing has been imported yet".
    if (report.lastUpdatedAt === null) {
      return null;
    }

    return {
      score: report.overallScore,
      level: report.confidence,
      lastImportAt: report.lastUpdatedAt,
    };
  }
}
