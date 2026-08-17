import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  DecisionCentre,
  DecisionDetail,
  DecisionPriority,
  DecisionStatus,
  DecisionSummary,
  Paginated,
} from '@sip/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { ApiException } from '../common/errors/api-exception';
import { AuditService } from '../audit/audit.service';
import { GoalsService } from '../goals/goals.service';
import type {
  CreateDecisionActionDto,
  CreateDecisionDto,
  ListDecisionsDto,
  ReviewDecisionDto,
  UpdateDecisionActionDto,
  UpdateDecisionDto,
} from './decisions.dto';

const DECISION_SELECT = {
  id: true,
  title: true,
  problemStatement: true,
  context: true,
  ownerId: true,
  status: true,
  priority: true,
  decisionDate: true,
  expectedOutcome: true,
  reviewDate: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
  owner: { select: { fullName: true } },
  _count: { select: { metrics: true, alerts: true, insights: true, goals: true } },
  actions: { select: { isCompleted: true } },
  reviews: { orderBy: { reviewedAt: 'desc' }, take: 1, select: { result: true } },
} as const;

type DecisionRow = Prisma.DecisionGetPayload<{ select: typeof DECISION_SELECT }>;

/** How many statuses count as "still being worked on" in the decision centre. */
const OPEN_STATUSES: DecisionStatus[] = ['DRAFT', 'OPEN', 'APPROVED', 'IN_PROGRESS'];

/**
 * Decisions and the decision centre (plan §30–§32).
 *
 * A decision is a record of what management chose to do and why, so the evidence is
 * not decoration: every decision carries at least one metric, alert, insight or
 * goal, and the review that follows is judged against the outcome that was expected
 * when the decision was taken. Nothing here is ever silently rewritten — the reviews
 * accumulate, and the audit log carries the before-and-after of every edit.
 */
@Injectable()
export class DecisionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly goals: GoalsService,
  ) {}

  async list(
    organizationId: string,
    query: ListDecisionsDto,
  ): Promise<Paginated<DecisionSummary>> {
    const where: Prisma.DecisionWhereInput = {
      organizationId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.priority ? { priority: query.priority } : {}),
      ...(query.ownerId ? { ownerId: query.ownerId } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.decision.findMany({
        where,
        orderBy: [{ updatedAt: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: DECISION_SELECT,
      }),
      this.prisma.decision.count({ where }),
    ]);

    return {
      items: rows.map(toSummary),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  async detail(organizationId: string, id: string): Promise<DecisionDetail> {
    const decision = await this.prisma.decision.findFirst({
      where: { id, organizationId },
      select: {
        ...DECISION_SELECT,
        actions: {
          orderBy: [{ isCompleted: 'asc' }, { dueDate: 'asc' }, { createdAt: 'asc' }],
          select: {
            id: true,
            title: true,
            description: true,
            ownerId: true,
            dueDate: true,
            isCompleted: true,
            completedAt: true,
          },
        },
        metrics: {
          select: { metric: { select: { id: true, code: true, name: true, unit: true } } },
        },
        alerts: {
          select: {
            alert: { select: { id: true, title: true, severity: true, periodStart: true } },
          },
        },
        insights: {
          select: { insight: { select: { id: true, title: true, periodStart: true } } },
        },
        goals: {
          select: {
            goal: { select: { id: true, title: true, status: true, progressPct: true } },
          },
        },
        reviews: {
          orderBy: { reviewedAt: 'desc' },
          select: {
            id: true,
            expectedOutcome: true,
            actualOutcome: true,
            result: true,
            notes: true,
            reviewedAt: true,
            reviewerId: true,
          },
        },
      },
    });

    if (!decision) {
      throw ApiException.notFound('Decision');
    }

    const personIds = [
      ...new Set(
        [
          ...decision.actions.map((action) => action.ownerId),
          ...decision.reviews.map((review) => review.reviewerId),
        ].filter((value): value is string => Boolean(value)),
      ),
    ];
    const people = await this.prisma.user.findMany({
      where: { id: { in: personIds } },
      select: { id: true, fullName: true },
    });
    const names = new Map(people.map((person) => [person.id, person.fullName]));

    const summary = toSummary({
      ...decision,
      actions: decision.actions.map((action) => ({ isCompleted: action.isCompleted })),
      reviews: decision.reviews.slice(0, 1).map((review) => ({ result: review.result })),
    });

    return {
      ...summary,
      evidence: {
        metrics: decision.metrics.map((link) => ({
          metricId: link.metric.id,
          code: link.metric.code,
          name: link.metric.name,
          unit: link.metric.unit,
        })),
        alerts: decision.alerts.map((link) => ({
          alertId: link.alert.id,
          title: link.alert.title,
          severity: link.alert.severity,
          periodStart: link.alert.periodStart?.toISOString().slice(0, 10) ?? null,
        })),
        insights: decision.insights.map((link) => ({
          insightId: link.insight.id,
          title: link.insight.title,
          periodStart: link.insight.periodStart?.toISOString().slice(0, 10) ?? null,
        })),
        goals: decision.goals.map((link) => ({
          goalId: link.goal.id,
          title: link.goal.title,
          status: link.goal.status,
          progressPct: link.goal.progressPct?.toString() ?? null,
        })),
      },
      actions: decision.actions.map((action) => ({
        id: action.id,
        title: action.title,
        description: action.description,
        ownerId: action.ownerId,
        ownerName: action.ownerId ? (names.get(action.ownerId) ?? null) : null,
        dueDate: action.dueDate?.toISOString().slice(0, 10) ?? null,
        isCompleted: action.isCompleted,
        completedAt: action.completedAt?.toISOString() ?? null,
      })),
      reviews: decision.reviews.map((review) => ({
        id: review.id,
        expectedOutcome: review.expectedOutcome,
        actualOutcome: review.actualOutcome,
        result: review.result,
        notes: review.notes,
        reviewerName: review.reviewerId ? (names.get(review.reviewerId) ?? null) : null,
        reviewedAt: review.reviewedAt.toISOString(),
      })),
    };
  }

  async create(
    organizationId: string,
    actorId: string,
    dto: CreateDecisionDto,
    ipAddress?: string,
  ): Promise<DecisionDetail> {
    await this.assertReferencesExist(organizationId, dto);

    const decision = await this.prisma.decision.create({
      data: {
        organizationId,
        title: dto.title,
        problemStatement: dto.problemStatement,
        context: dto.context ?? null,
        ownerId: dto.ownerId ?? null,
        status: dto.status ?? 'DRAFT',
        priority: dto.priority ?? 'MEDIUM',
        decisionDate: dto.decisionDate ? new Date(dto.decisionDate) : null,
        expectedOutcome: dto.expectedOutcome ?? null,
        reviewDate: dto.reviewDate ? new Date(dto.reviewDate) : null,
        notes: dto.notes ?? null,
        metrics: { create: unique(dto.metricIds).map((metricId) => ({ metricId })) },
        alerts: { create: unique(dto.alertIds).map((alertId) => ({ alertId })) },
        insights: { create: unique(dto.insightIds).map((insightId) => ({ insightId })) },
        goals: { create: unique(dto.goalIds).map((goalId) => ({ goalId })) },
      },
      select: { id: true },
    });

    await this.audit.record({
      actorId,
      organizationId,
      action: 'decision.created',
      entityType: 'decision',
      entityId: decision.id,
      after: {
        title: dto.title,
        status: dto.status ?? 'DRAFT',
        priority: dto.priority ?? 'MEDIUM',
        evidence:
          unique(dto.metricIds).length +
          unique(dto.alertIds).length +
          unique(dto.insightIds).length +
          unique(dto.goalIds).length,
      },
      ipAddress,
    });

    return this.detail(organizationId, decision.id);
  }

  async update(
    organizationId: string,
    id: string,
    actorId: string,
    dto: UpdateDecisionDto,
    ipAddress?: string,
  ): Promise<DecisionDetail> {
    const before = await this.prisma.decision.findFirst({
      where: { id, organizationId },
      select: { id: true, title: true, status: true, priority: true, expectedOutcome: true },
    });

    if (!before) {
      throw ApiException.notFound('Decision');
    }

    await this.assertReferencesExist(organizationId, dto);

    await this.prisma.decision.update({
      where: { id },
      data: {
        title: dto.title,
        problemStatement: dto.problemStatement,
        status: dto.status,
        priority: dto.priority,
        context: dto.context === undefined ? undefined : (dto.context ?? null),
        ownerId: dto.ownerId === undefined ? undefined : (dto.ownerId ?? null),
        expectedOutcome:
          dto.expectedOutcome === undefined ? undefined : (dto.expectedOutcome ?? null),
        notes: dto.notes === undefined ? undefined : (dto.notes ?? null),
        decisionDate:
          dto.decisionDate === undefined
            ? undefined
            : dto.decisionDate
              ? new Date(dto.decisionDate)
              : null,
        reviewDate:
          dto.reviewDate === undefined
            ? undefined
            : dto.reviewDate
              ? new Date(dto.reviewDate)
              : null,
      },
    });

    // Each evidence list is replaced only when it is supplied, so a caller editing
    // the notes does not quietly drop the reasoning.
    await this.replaceEvidence(id, dto);

    await this.audit.record({
      actorId,
      organizationId,
      action: 'decision.updated',
      entityType: 'decision',
      entityId: id,
      before: {
        title: before.title,
        status: before.status,
        priority: before.priority,
        expectedOutcome: before.expectedOutcome,
      },
      after: { ...dto },
      ipAddress,
    });

    return this.detail(organizationId, id);
  }

  async addAction(
    organizationId: string,
    id: string,
    actorId: string,
    dto: CreateDecisionActionDto,
  ): Promise<DecisionDetail> {
    await this.assertDecisionExists(organizationId, id);

    if (dto.ownerId) {
      await this.assertMember(organizationId, dto.ownerId);
    }

    await this.prisma.decisionAction.create({
      data: {
        decisionId: id,
        title: dto.title,
        description: dto.description ?? null,
        ownerId: dto.ownerId ?? null,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
      },
    });

    await this.audit.record({
      actorId,
      organizationId,
      action: 'decision.action.created',
      entityType: 'decision',
      entityId: id,
      after: { title: dto.title },
    });

    return this.detail(organizationId, id);
  }

  async setActionState(
    organizationId: string,
    id: string,
    actionId: string,
    actorId: string,
    dto: UpdateDecisionActionDto,
  ): Promise<DecisionDetail> {
    await this.assertDecisionExists(organizationId, id);

    const action = await this.prisma.decisionAction.findFirst({
      where: { id: actionId, decisionId: id },
      select: { id: true, title: true, isCompleted: true },
    });

    if (!action) {
      throw ApiException.notFound('Decision action');
    }

    await this.prisma.decisionAction.update({
      where: { id: actionId },
      data: {
        isCompleted: dto.isCompleted,
        completedAt: dto.isCompleted ? new Date() : null,
      },
    });

    await this.audit.record({
      actorId,
      organizationId,
      action: 'decision.action.updated',
      entityType: 'decision',
      entityId: id,
      before: { title: action.title, isCompleted: action.isCompleted },
      after: { title: action.title, isCompleted: dto.isCompleted },
    });

    return this.detail(organizationId, id);
  }

  async removeAction(
    organizationId: string,
    id: string,
    actionId: string,
    actorId: string,
  ): Promise<DecisionDetail> {
    await this.assertDecisionExists(organizationId, id);

    const action = await this.prisma.decisionAction.findFirst({
      where: { id: actionId, decisionId: id },
      select: { id: true, title: true },
    });

    if (!action) {
      throw ApiException.notFound('Decision action');
    }

    await this.prisma.decisionAction.delete({ where: { id: actionId } });

    await this.audit.record({
      actorId,
      organizationId,
      action: 'decision.action.deleted',
      entityType: 'decision',
      entityId: id,
      before: { title: action.title },
    });

    return this.detail(organizationId, id);
  }

  /**
   * Recording how a decision turned out (plan §32).
   *
   * The outcome that was expected is copied onto the review as it stood at the time,
   * so a later edit to the decision cannot change what the review was judged
   * against. Reviews accumulate; none is ever replaced.
   */
  async review(
    organizationId: string,
    id: string,
    actorId: string,
    dto: ReviewDecisionDto,
    ipAddress?: string,
  ): Promise<DecisionDetail> {
    const decision = await this.prisma.decision.findFirst({
      where: { id, organizationId },
      select: { id: true, status: true, expectedOutcome: true },
    });

    if (!decision) {
      throw ApiException.notFound('Decision');
    }

    if (decision.status === 'DRAFT') {
      throw ApiException.conflict('A decision that has not been taken cannot be reviewed yet.');
    }

    await this.prisma.decisionReview.create({
      data: {
        decisionId: id,
        reviewerId: actorId,
        expectedOutcome: decision.expectedOutcome,
        actualOutcome: dto.actualOutcome,
        result: dto.result,
        notes: dto.notes ?? null,
      },
    });

    await this.audit.record({
      actorId,
      organizationId,
      action: 'decision.reviewed',
      entityType: 'decision',
      entityId: id,
      after: { result: dto.result, actualOutcome: dto.actualOutcome },
      ipAddress,
    });

    return this.detail(organizationId, id);
  }

  /**
   * The decision centre (plan §30): everything currently asking for management
   * attention, in one place. It is a read over what the engines already produced —
   * nothing here is calculated afresh.
   */
  async centre(organizationId: string): Promise<DecisionCentre> {
    const [alerts, insights, open, reviewed, goals] = await Promise.all([
      this.prisma.alert.findMany({
        where: { organizationId, status: { in: ['OPEN', 'ACKNOWLEDGED'] } },
        orderBy: [{ periodStart: 'desc' }, { createdAt: 'desc' }],
        take: 40,
        select: {
          id: true,
          title: true,
          severity: true,
          periodStart: true,
          metric: { select: { name: true } },
        },
      }),
      // An opportunity is an insight the engine raised without calling it a problem:
      // severity INFO is what the packs use for "this is going well, press it".
      this.prisma.insight.findMany({
        where: { organizationId, severity: 'INFO' },
        orderBy: [{ periodStart: 'desc' }, { createdAt: 'desc' }],
        take: 10,
        select: { id: true, title: true, narrative: true, periodStart: true },
      }),
      this.prisma.decision.findMany({
        where: { organizationId, status: { in: OPEN_STATUSES } },
        orderBy: [{ priority: 'desc' }, { updatedAt: 'desc' }],
        take: 10,
        select: DECISION_SELECT,
      }),
      this.prisma.decision.findMany({
        where: { organizationId, reviews: { some: {} } },
        orderBy: { updatedAt: 'desc' },
        take: 10,
        select: DECISION_SELECT,
      }),
      this.goals.list(organizationId, {}),
    ]);

    const alertEntry = (alert: (typeof alerts)[number]) => ({
      id: alert.id,
      title: alert.title,
      severity: alert.severity,
      metricName: alert.metric?.name ?? null,
      periodStart: alert.periodStart?.toISOString().slice(0, 10) ?? null,
    });

    return {
      criticalIssues: alerts.filter((a) => a.severity === 'CRITICAL').slice(0, 10).map(alertEntry),
      warnings: alerts
        .filter((a) => a.severity === 'HIGH' || a.severity === 'WARNING')
        .slice(0, 10)
        .map(alertEntry),
      opportunities: insights.map((insight) => ({
        id: insight.id,
        title: insight.title,
        narrative: insight.narrative,
        periodStart: insight.periodStart?.toISOString().slice(0, 10) ?? null,
      })),
      openDecisions: open.map(toSummary),
      recentlyReviewed: reviewed.map(toSummary),
      goalsAtRisk: goals.filter(
        (goal) => goal.status === 'AT_RISK' || goal.status === 'OFF_TRACK',
      ),
    };
  }

  private async replaceEvidence(id: string, dto: UpdateDecisionDto): Promise<void> {
    if (
      dto.metricIds === undefined &&
      dto.alertIds === undefined &&
      dto.insightIds === undefined &&
      dto.goalIds === undefined
    ) {
      return;
    }

    const existing = await this.prisma.decision.findUniqueOrThrow({
      where: { id },
      select: { _count: { select: { metrics: true, alerts: true, insights: true, goals: true } } },
    });

    // Evidence can be edited, but not edited away: the record has to keep saying
    // why the decision was taken. Counted before anything is deleted, so a refused
    // edit leaves the decision exactly as it was.
    const after = {
      metrics: dto.metricIds === undefined ? existing._count.metrics : unique(dto.metricIds).length,
      alerts: dto.alertIds === undefined ? existing._count.alerts : unique(dto.alertIds).length,
      insights:
        dto.insightIds === undefined ? existing._count.insights : unique(dto.insightIds).length,
      goals: dto.goalIds === undefined ? existing._count.goals : unique(dto.goalIds).length,
    };

    if (evidenceCountOf(after) === 0) {
      throw ApiException.validation('The request could not be processed.', [
        { field: 'metricIds', message: 'A decision must keep at least one piece of evidence' },
      ]);
    }

    const operations: Prisma.PrismaPromise<unknown>[] = [];

    if (dto.metricIds !== undefined) {
      operations.push(
        this.prisma.decisionMetric.deleteMany({ where: { decisionId: id } }),
        this.prisma.decisionMetric.createMany({
          data: unique(dto.metricIds).map((metricId) => ({ decisionId: id, metricId })),
        }),
      );
    }

    if (dto.alertIds !== undefined) {
      operations.push(
        this.prisma.decisionAlert.deleteMany({ where: { decisionId: id } }),
        this.prisma.decisionAlert.createMany({
          data: unique(dto.alertIds).map((alertId) => ({ decisionId: id, alertId })),
        }),
      );
    }

    if (dto.insightIds !== undefined) {
      operations.push(
        this.prisma.decisionInsight.deleteMany({ where: { decisionId: id } }),
        this.prisma.decisionInsight.createMany({
          data: unique(dto.insightIds).map((insightId) => ({ decisionId: id, insightId })),
        }),
      );
    }

    if (dto.goalIds !== undefined) {
      operations.push(
        this.prisma.decisionGoal.deleteMany({ where: { decisionId: id } }),
        this.prisma.decisionGoal.createMany({
          data: unique(dto.goalIds).map((goalId) => ({ decisionId: id, goalId })),
        }),
      );
    }

    await this.prisma.$transaction(operations);
  }

  private async assertDecisionExists(organizationId: string, id: string): Promise<void> {
    const found = await this.prisma.decision.count({ where: { id, organizationId } });

    if (found === 0) {
      throw ApiException.notFound('Decision');
    }
  }

  private async assertMember(organizationId: string, userId: string): Promise<void> {
    const member = await this.prisma.organizationUser.findFirst({
      where: { organizationId, userId },
      select: { id: true },
    });

    if (!member) {
      throw ApiException.validation('The request could not be processed.', [
        { field: 'ownerId', message: 'That person is not a member of this organization' },
      ]);
    }
  }

  /**
   * Every referenced record must belong to this organization. Without this check a
   * decision could cite another tenant's alert by id and leak its title back through
   * the detail endpoint.
   */
  private async assertReferencesExist(
    organizationId: string,
    dto: CreateDecisionDto | UpdateDecisionDto,
  ): Promise<void> {
    const checks: Array<[string, string[], () => Promise<number>]> = [
      [
        'metricIds',
        unique(dto.metricIds),
        () =>
          this.prisma.metric.count({
            where: { organizationId, id: { in: unique(dto.metricIds) } },
          }),
      ],
      [
        'alertIds',
        unique(dto.alertIds),
        () =>
          this.prisma.alert.count({
            where: { organizationId, id: { in: unique(dto.alertIds) } },
          }),
      ],
      [
        'insightIds',
        unique(dto.insightIds),
        () =>
          this.prisma.insight.count({
            where: { organizationId, id: { in: unique(dto.insightIds) } },
          }),
      ],
      [
        'goalIds',
        unique(dto.goalIds),
        () =>
          this.prisma.goal.count({
            where: { organizationId, id: { in: unique(dto.goalIds) } },
          }),
      ],
    ];

    for (const [field, ids, count] of checks) {
      if (ids.length === 0) {
        continue;
      }

      if ((await count()) !== ids.length) {
        throw ApiException.validation('The request could not be processed.', [
          { field, message: 'That evidence does not belong to this organization' },
        ]);
      }
    }

    if (dto.ownerId) {
      await this.assertMember(organizationId, dto.ownerId);
    }
  }
}

function unique(ids: string[] | undefined): string[] {
  return [...new Set(ids ?? [])];
}

function evidenceCountOf(counts: {
  metrics: number;
  alerts: number;
  insights: number;
  goals: number;
}): number {
  return counts.metrics + counts.alerts + counts.insights + counts.goals;
}

function toSummary(decision: DecisionRow): DecisionSummary {
  return {
    id: decision.id,
    title: decision.title,
    problemStatement: decision.problemStatement,
    context: decision.context,
    ownerId: decision.ownerId,
    ownerName: decision.owner?.fullName ?? null,
    status: decision.status as DecisionStatus,
    priority: decision.priority as DecisionPriority,
    decisionDate: decision.decisionDate?.toISOString().slice(0, 10) ?? null,
    expectedOutcome: decision.expectedOutcome,
    reviewDate: decision.reviewDate?.toISOString().slice(0, 10) ?? null,
    notes: decision.notes,
    evidenceCount: evidenceCountOf(decision._count),
    openActions: decision.actions.filter((action) => !action.isCompleted).length,
    totalActions: decision.actions.length,
    lastReviewResult: decision.reviews[0]?.result ?? null,
    createdAt: decision.createdAt.toISOString(),
    updatedAt: decision.updatedAt.toISOString(),
  };
}
