import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  InsightGenerationResult,
  InsightSummary,
  Paginated,
  PeriodType,
} from '@sip/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { ApiException } from '../common/errors/api-exception';
import { AnalyticsService } from '../analytics/analytics.service';
import {
  evaluateInsightRule,
  insightTitle,
  storedInsightDefinitionSchema,
  type MetricFacts,
} from './insight-rules';
import type { ListInsightsDto } from './insights.dto';

const INSIGHT_SELECT = {
  id: true,
  title: true,
  narrative: true,
  category: true,
  severity: true,
  periodType: true,
  periodStart: true,
  createdAt: true,
  insightRule: { select: { code: true, name: true } },
  evidence: {
    select: { metricId: true, label: true, value: true, changePct: true, detail: true },
  },
} as const;

type InsightRow = Prisma.InsightGetPayload<{ select: typeof INSIGHT_SELECT }>;

/**
 * The insight engine (plan §28).
 *
 * Deterministic rules over figures the metrics engine produced. An insight is
 * written only when every condition of its rule holds, and always with one
 * evidence row per figure it quotes — an insight without evidence is a bug, not an
 * insight, so the two are written in the same transaction.
 */
@Injectable()
export class InsightsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly analytics: AnalyticsService,
  ) {}

  async list(organizationId: string, query: ListInsightsDto): Promise<Paginated<InsightSummary>> {
    const where: Prisma.InsightWhereInput = {
      organizationId,
      ...(query.severity ? { severity: query.severity } : {}),
      ...(query.category ? { category: query.category } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.insight.findMany({
        where,
        orderBy: [{ periodStart: 'desc' }, { createdAt: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: INSIGHT_SELECT,
      }),
      this.prisma.insight.count({ where }),
    ]);

    return { items: rows.map(toSummary), page: query.page, pageSize: query.pageSize, total };
  }

  async detail(organizationId: string, id: string): Promise<InsightSummary> {
    const insight = await this.prisma.insight.findFirst({
      where: { id, organizationId },
      select: INSIGHT_SELECT,
    });

    if (!insight) {
      throw ApiException.notFound('Insight');
    }

    return toSummary(insight);
  }

  /**
   * Evaluates every active rule against a period.
   *
   * Idempotent per (rule, period): an insight already written for that pair is left
   * alone rather than duplicated, so re-running after a correction does not fill
   * the feed with copies.
   */
  async generate(
    organizationId: string,
    period: { periodType: PeriodType; periodStart: Date },
  ): Promise<InsightGenerationResult> {
    const rules = await this.prisma.insightRule.findMany({
      where: { organizationId, isActive: true },
      select: { id: true, code: true, name: true, definition: true },
    });

    const result: InsightGenerationResult = {
      created: 0,
      unchanged: 0,
      rulesEvaluated: rules.length,
    };

    if (rules.length === 0) {
      return result;
    }

    const facts = await this.factsFor(organizationId, period);

    for (const rule of rules) {
      const parsed = storedInsightDefinitionSchema.safeParse(rule.definition);

      if (!parsed.success) {
        // A rule nobody can read is a rule nobody should act on.
        continue;
      }

      const evaluation = evaluateInsightRule(parsed.data, facts);

      if (!evaluation.fires) {
        continue;
      }

      const existing = await this.prisma.insight.findFirst({
        where: {
          organizationId,
          insightRuleId: rule.id,
          periodType: period.periodType,
          periodStart: period.periodStart,
        },
        select: { id: true },
      });

      if (existing) {
        result.unchanged += 1;
        continue;
      }

      await this.write(organizationId, rule, parsed.data, period, facts, evaluation.conditions);
      result.created += 1;
    }

    return result;
  }

  private async write(
    organizationId: string,
    rule: { id: string; name: string },
    definition: {
      narrative: string;
      evidence: string[];
      severity: string;
      category?: string | null;
    },
    period: { periodType: PeriodType; periodStart: Date },
    facts: Map<string, MetricFacts>,
    conditions: Array<{
      metric: string;
      measure: string;
      operator: string;
      threshold: number;
      actual: number | null;
    }>,
  ): Promise<void> {
    const metrics = await this.prisma.metric.findMany({
      where: { organizationId, code: { in: definition.evidence } },
      select: { id: true, code: true },
    });
    const idByCode = new Map(metrics.map((metric) => [metric.code, metric.id]));

    // The insight and its evidence are written together: a half-written insight
    // would be exactly the unexplainable kind the plan forbids.
    await this.prisma.$transaction(async (tx) => {
      const insight = await tx.insight.create({
        data: {
          organizationId,
          insightRuleId: rule.id,
          title: insightTitle(rule.name),
          narrative: definition.narrative,
          category: definition.category ?? null,
          severity: definition.severity as Prisma.InsightCreateInput['severity'],
          periodType: period.periodType,
          periodStart: period.periodStart,
        },
        select: { id: true },
      });

      for (const code of definition.evidence) {
        const metric = facts.get(code);
        const condition = conditions.find((entry) => entry.metric === code);

        await tx.insightEvidence.create({
          data: {
            insightId: insight.id,
            metricId: idByCode.get(code) ?? null,
            label: metric?.name ?? code,
            value: metric?.value === null || metric?.value === undefined ? null : metric.value,
            changePct:
              metric?.changePct === null || metric?.changePct === undefined
                ? null
                : new Prisma.Decimal(metric.changePct.toFixed(4)),
            detail: condition
              ? ({
                  measure: condition.measure,
                  operator: condition.operator,
                  threshold: condition.threshold,
                  actual: condition.actual,
                } as unknown as Prisma.InputJsonValue)
              : Prisma.DbNull,
          },
        });
      }
    });
  }

  /**
   * The figures the rules read, taken from the analytics engine so a condition is
   * evaluated against exactly the number the dashboard shows for that period
   * (ADR-0010).
   */
  private async factsFor(
    organizationId: string,
    period: { periodType: PeriodType; periodStart: Date },
  ): Promise<Map<string, MetricFacts>> {
    const context = await this.analytics.contextForPeriod(organizationId, period);
    const facts = new Map<string, MetricFacts>();

    for (const metric of context.metrics) {
      const summary = this.analytics.summarise(context, metric);

      facts.set(metric.code, {
        code: metric.code,
        name: metric.name,
        value: summary.current === null ? null : Number(summary.current),
        changePct: summary.changePct === null ? null : Number(summary.changePct),
        varianceToTargetPct:
          summary.varianceToTargetPct === null ? null : Number(summary.varianceToTargetPct),
      });
    }

    return facts;
  }
}

function toSummary(insight: InsightRow): InsightSummary {
  return {
    id: insight.id,
    ruleCode: insight.insightRule?.code ?? null,
    ruleName: insight.insightRule?.name ?? null,
    title: insight.title,
    narrative: insight.narrative,
    category: insight.category,
    severity: insight.severity,
    periodType: insight.periodType,
    periodStart: insight.periodStart ? insight.periodStart.toISOString().slice(0, 10) : null,
    evidence: insight.evidence.map((item) => ({
      metricId: item.metricId,
      label: item.label,
      value: item.value ? item.value.toString() : null,
      changePct: item.changePct ? item.changePct.toString() : null,
      detail: (item.detail ?? null) as Record<string, unknown> | null,
    })),
    createdAt: insight.createdAt.toISOString(),
  };
}
