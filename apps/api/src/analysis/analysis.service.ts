import { Injectable, Logger } from '@nestjs/common';
import type { AnalysisRun, AnalysisRunResult, PeriodType } from '@sip/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { AlertsService } from '../alerts/alerts.service';
import { GoalsService } from '../goals/goals.service';
import { InsightsService } from '../insights/insights.service';
import { OrganizationHealthService } from '../organization-health/organization-health.service';

/**
 * Running the three engines together (plan §49).
 *
 * The demonstration the plan asks for is one motion — import a month, watch the
 * metrics recalculate, the health score move, an alert fire and an insight explain
 * it — so the three engines run in that order behind a single call, and an import
 * commit triggers it.
 *
 * Health first, because an alert about a period should not be raised against a
 * score that has not caught up with it. Goals follow the three engines: a goal
 * reads the same metric figures, so it is refreshed once the period's analysis has
 * settled (plan §29).
 */
@Injectable()
export class AnalysisService {
  private readonly logger = new Logger(AnalysisService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly health: OrganizationHealthService,
    private readonly alerts: AlertsService,
    private readonly insights: InsightsService,
    private readonly goals: GoalsService,
  ) {}

  /** Runs everything for the periods given, or for the latest period with data. */
  async run(
    organizationId: string,
    periods?: Array<{ periodType: PeriodType; periodStart: Date }>,
    actorId?: string,
  ): Promise<AnalysisRun> {
    const scope = periods ?? (await this.latestPeriod(organizationId));
    const results: AnalysisRunResult[] = [];

    for (const period of scope) {
      const health = await this.health.recalculate(organizationId, [period]);
      const alerts = await this.alerts.evaluate(organizationId, period, actorId);
      const insights = await this.insights.generate(organizationId, period);

      results.push({
        period: period.periodStart.toISOString().slice(0, 10),
        health,
        alerts,
        insights,
      });
    }

    if (results.length === 0) {
      this.logger.warn(`No periods with data for organization ${organizationId}; nothing analysed`);
    }

    // Once for the run, not once per period: a goal spans its own window rather
    // than a single reporting period.
    const goals = await this.goals.recalculate(organizationId, actorId);

    return { periods: results, goals };
  }

  private async latestPeriod(
    organizationId: string,
  ): Promise<Array<{ periodType: PeriodType; periodStart: Date }>> {
    const latest = await this.prisma.metricValue.findFirst({
      where: { organizationId },
      orderBy: { periodStart: 'desc' },
      select: { periodType: true, periodStart: true },
    });

    return latest ? [latest] : [];
  }
}
