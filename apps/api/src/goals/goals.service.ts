import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  GoalDetail,
  GoalProgressResult,
  GoalSummary,
  GoalStatus,
} from '@sip/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { ApiException } from '../common/errors/api-exception';
import { AuditService } from '../audit/audit.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { daysRemaining, expectedProgressFor, progressFor, statusFor } from './goal-progress';
import type { CreateGoalDto, ListGoalsDto, UpdateGoalDto } from './goals.dto';

const GOAL_SELECT = {
  id: true,
  title: true,
  description: true,
  ownerId: true,
  status: true,
  baselineValue: true,
  targetValue: true,
  currentValue: true,
  progressPct: true,
  startDate: true,
  dueDate: true,
  createdAt: true,
  updatedAt: true,
  owner: { select: { fullName: true } },
  metrics: {
    select: {
      isPrimary: true,
      metricId: true,
      metric: { select: { code: true, name: true, unit: true } },
    },
  },
} as const;

type GoalRow = Prisma.GoalGetPayload<{ select: typeof GOAL_SELECT }>;

/**
 * Goals (plan §29).
 *
 * A metric-linked goal is never updated by hand: the metric already says where the
 * organization is, and the goal says where it meant to be. Every recalculation that
 * changes something appends a `goal_updates` row, so the history of how a goal went
 * survives — that history is the point.
 */
@Injectable()
export class GoalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly analytics: AnalyticsService,
  ) {}

  async list(organizationId: string, query: ListGoalsDto): Promise<GoalSummary[]> {
    const goals = await this.prisma.goal.findMany({
      where: {
        organizationId,
        ...(query.status ? { status: query.status } : {}),
        ...(query.ownerId ? { ownerId: query.ownerId } : {}),
      },
      orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }],
      select: GOAL_SELECT,
    });

    return goals.map((goal) => toSummary(goal));
  }

  async detail(organizationId: string, id: string): Promise<GoalDetail> {
    const goal = await this.prisma.goal.findFirst({
      where: { id, organizationId },
      select: {
        ...GOAL_SELECT,
        updates: {
          orderBy: { createdAt: 'desc' },
          take: 50,
          select: {
            id: true,
            currentValue: true,
            progressPct: true,
            status: true,
            note: true,
            createdAt: true,
            actorId: true,
          },
        },
        decisionLinks: {
          select: { decision: { select: { id: true, title: true, status: true } } },
        },
      },
    });

    if (!goal) {
      throw ApiException.notFound('Goal');
    }

    const actorIds = [...new Set(goal.updates.map((update) => update.actorId).filter(Boolean))];
    const actors = await this.prisma.user.findMany({
      where: { id: { in: actorIds as string[] } },
      select: { id: true, fullName: true },
    });
    const names = new Map(actors.map((actor) => [actor.id, actor.fullName]));

    return {
      ...toSummary(goal),
      updates: goal.updates.map((update) => ({
        id: update.id,
        currentValue: update.currentValue?.toString() ?? null,
        progressPct: update.progressPct?.toString() ?? null,
        status: update.status,
        note: update.note,
        actorName: update.actorId ? (names.get(update.actorId) ?? null) : null,
        createdAt: update.createdAt.toISOString(),
      })),
      decisions: goal.decisionLinks.map((link) => link.decision),
    };
  }

  async create(
    organizationId: string,
    actorId: string,
    dto: CreateGoalDto,
    ipAddress?: string,
  ): Promise<GoalDetail> {
    await this.assertReferencesExist(organizationId, dto);

    const goal = await this.prisma.goal.create({
      data: {
        organizationId,
        title: dto.title,
        description: dto.description ?? null,
        ownerId: dto.ownerId ?? null,
        baselineValue: dto.baselineValue ?? null,
        targetValue: dto.targetValue,
        startDate: new Date(dto.startDate),
        dueDate: new Date(dto.dueDate),
        status: dto.status ?? 'DRAFT',
        metrics: {
          create: [
            ...(dto.metricId ? [{ metricId: dto.metricId, isPrimary: true }] : []),
            ...(dto.supportingMetricIds ?? [])
              .filter((metricId) => metricId !== dto.metricId)
              .map((metricId) => ({ metricId, isPrimary: false })),
          ],
        },
      },
      select: { id: true },
    });

    await this.audit.record({
      actorId,
      organizationId,
      action: 'goal.created',
      entityType: 'goal',
      entityId: goal.id,
      after: { title: dto.title, targetValue: dto.targetValue, dueDate: dto.dueDate },
      ipAddress,
    });

    // A metric-linked goal knows its progress the moment it is created.
    await this.recalculate(organizationId, actorId);

    return this.detail(organizationId, goal.id);
  }

  async update(
    organizationId: string,
    id: string,
    actorId: string,
    dto: UpdateGoalDto,
    ipAddress?: string,
  ): Promise<GoalDetail> {
    const before = await this.prisma.goal.findFirst({
      where: { id, organizationId },
      select: { id: true, title: true, status: true, targetValue: true },
    });

    if (!before) {
      throw ApiException.notFound('Goal');
    }

    await this.assertReferencesExist(organizationId, dto);

    const { metricId, supportingMetricIds, startDate, dueDate, ...scalars } = dto;

    await this.prisma.goal.update({
      where: { id },
      data: {
        ...scalars,
        description: dto.description === undefined ? undefined : (dto.description ?? null),
        ownerId: dto.ownerId === undefined ? undefined : (dto.ownerId ?? null),
        baselineValue: dto.baselineValue === undefined ? undefined : (dto.baselineValue ?? null),
        ...(startDate ? { startDate: new Date(startDate) } : {}),
        ...(dueDate ? { dueDate: new Date(dueDate) } : {}),
      },
    });

    // The linked metrics are replaced wholesale when either list is given, so a
    // goal's definition never ends up half old and half new.
    if (metricId !== undefined || supportingMetricIds !== undefined) {
      const current = await this.prisma.goalMetric.findMany({
        where: { goalId: id },
        select: { metricId: true, isPrimary: true },
      });

      const primary = metricId === undefined
        ? (current.find((link) => link.isPrimary)?.metricId ?? null)
        : metricId;
      const supporting =
        supportingMetricIds === undefined
          ? current.filter((link) => !link.isPrimary).map((link) => link.metricId)
          : supportingMetricIds;

      await this.prisma.goalMetric.deleteMany({ where: { goalId: id } });
      await this.prisma.goalMetric.createMany({
        data: [
          ...(primary ? [{ goalId: id, metricId: primary, isPrimary: true }] : []),
          ...supporting
            .filter((candidate) => candidate !== primary)
            .map((candidate) => ({ goalId: id, metricId: candidate, isPrimary: false })),
        ],
      });
    }

    await this.audit.record({
      actorId,
      organizationId,
      action: 'goal.updated',
      entityType: 'goal',
      entityId: id,
      before: { title: before.title, status: before.status, targetValue: before.targetValue },
      after: { ...dto },
      ipAddress,
    });

    await this.recalculate(organizationId, actorId);

    return this.detail(organizationId, id);
  }

  async remove(
    organizationId: string,
    id: string,
    actorId: string,
    ipAddress?: string,
  ): Promise<void> {
    const goal = await this.prisma.goal.findFirst({
      where: { id, organizationId },
      select: { id: true, title: true, _count: { select: { decisionLinks: true } } },
    });

    if (!goal) {
      throw ApiException.notFound('Goal');
    }

    if (goal._count.decisionLinks > 0) {
      // A decision cites this goal as the reason it was taken; deleting it would
      // leave that decision unable to explain itself.
      throw ApiException.conflict(
        'A decision cites this goal as evidence. Cancel the goal instead of deleting it.',
      );
    }

    await this.prisma.goal.delete({ where: { id } });

    await this.audit.record({
      actorId,
      organizationId,
      action: 'goal.deleted',
      entityType: 'goal',
      entityId: id,
      before: { title: goal.title },
      ipAddress,
    });
  }

  /** A note recorded by hand against a goal, alongside the automatic history. */
  async addNote(
    organizationId: string,
    id: string,
    actorId: string,
    note: string,
  ): Promise<GoalDetail> {
    const goal = await this.prisma.goal.findFirst({
      where: { id, organizationId },
      select: { id: true, currentValue: true, progressPct: true, status: true },
    });

    if (!goal) {
      throw ApiException.notFound('Goal');
    }

    await this.prisma.goalUpdate.create({
      data: {
        goalId: id,
        actorId,
        currentValue: goal.currentValue,
        progressPct: goal.progressPct,
        status: goal.status,
        note,
      },
    });

    return this.detail(organizationId, id);
  }

  /**
   * Recalculates every metric-linked goal from its primary metric.
   *
   * The value is read through the analytics engine over the goal's own window, so
   * a goal's progress is the same figure the dashboard would show for that range
   * (ADR-0010). An update row is appended only when something actually changed —
   * otherwise every import would fill the history with identical entries.
   */
  async recalculate(organizationId: string, actorId?: string): Promise<GoalProgressResult> {
    const goals = await this.prisma.goal.findMany({
      where: { organizationId, status: { notIn: ['CANCELLED'] } },
      select: {
        id: true,
        status: true,
        baselineValue: true,
        targetValue: true,
        currentValue: true,
        progressPct: true,
        startDate: true,
        dueDate: true,
        metrics: { where: { isPrimary: true }, select: { metricId: true } },
      },
    });

    const result: GoalProgressResult = { evaluated: goals.length, changed: 0, achieved: 0 };
    const now = new Date();

    for (const goal of goals) {
      const primary = goal.metrics[0];
      let current = goal.currentValue === null ? null : Number(goal.currentValue);

      if (primary) {
        current = await this.currentValueFor(organizationId, primary.metricId, goal.startDate, goal.dueDate);
      }

      const progress = progressFor({
        baseline: goal.baselineValue === null ? null : Number(goal.baselineValue),
        target: Number(goal.targetValue),
        current,
      });
      const expected = expectedProgressFor(goal.startDate, goal.dueDate, now);
      const status = statusFor(goal.status, progress, expected);

      const unchanged =
        numbersMatch(current, goal.currentValue) &&
        numbersMatch(progress, goal.progressPct) &&
        status === goal.status;

      if (unchanged) {
        continue;
      }

      await this.prisma.$transaction([
        this.prisma.goal.update({
          where: { id: goal.id },
          data: {
            currentValue: current === null ? null : new Prisma.Decimal(current),
            progressPct: progress === null ? null : new Prisma.Decimal(progress),
            status,
          },
        }),
        this.prisma.goalUpdate.create({
          data: {
            goalId: goal.id,
            actorId: actorId ?? null,
            currentValue: current === null ? null : new Prisma.Decimal(current),
            progressPct: progress === null ? null : new Prisma.Decimal(progress),
            status,
            note:
              status === goal.status
                ? 'Progress recalculated from the linked metric.'
                : `Status changed from ${goal.status} to ${status}.`,
          },
        }),
      ]);

      result.changed += 1;

      if (status === 'ACHIEVED' && goal.status !== 'ACHIEVED') {
        result.achieved += 1;
      }
    }

    return result;
  }

  /**
   * The metric's figure over the goal's own window — start date to whichever of the
   * due date and today comes first, because a goal is judged on what has happened,
   * not on what the calendar still allows.
   */
  private async currentValueFor(
    organizationId: string,
    metricId: string,
    startDate: Date,
    dueDate: Date,
  ): Promise<number | null> {
    const today = new Date();
    const to = dueDate < today ? dueDate : today;

    const window = await this.analytics.resolveWindow(organizationId, {
      from: startDate.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10),
    });

    const context = await this.analytics.buildContext(organizationId, window);
    const metric = context.metrics.find((candidate) => candidate.id === metricId);

    if (!metric) {
      return null;
    }

    const summary = this.analytics.summarise(context, metric);

    return summary.current === null ? null : Number(summary.current);
  }

  private async assertReferencesExist(
    organizationId: string,
    dto: CreateGoalDto | UpdateGoalDto,
  ): Promise<void> {
    const metricIds = [dto.metricId, ...(dto.supportingMetricIds ?? [])].filter(
      (value): value is string => Boolean(value),
    );

    if (metricIds.length > 0) {
      const found = await this.prisma.metric.count({
        where: { organizationId, id: { in: metricIds } },
      });

      if (found !== new Set(metricIds).size) {
        throw ApiException.validation('The request could not be processed.', [
          { field: 'metricId', message: 'That metric does not belong to this organization' },
        ]);
      }
    }

    if (dto.ownerId) {
      const member = await this.prisma.organizationUser.findFirst({
        where: { organizationId, userId: dto.ownerId },
        select: { id: true },
      });

      if (!member) {
        throw ApiException.validation('The request could not be processed.', [
          { field: 'ownerId', message: 'That person is not a member of this organization' },
        ]);
      }
    }

    if (dto.startDate && dto.dueDate && dto.startDate > dto.dueDate) {
      throw ApiException.validation('The request could not be processed.', [
        { field: 'dueDate', message: 'The due date must be after the start date' },
      ]);
    }
  }
}

function toSummary(goal: GoalRow): GoalSummary {
  const primary = goal.metrics.find((link) => link.isPrimary);
  const now = new Date();

  return {
    id: goal.id,
    title: goal.title,
    description: goal.description,
    ownerId: goal.ownerId,
    ownerName: goal.owner?.fullName ?? null,
    status: goal.status as GoalStatus,
    baselineValue: goal.baselineValue?.toString() ?? null,
    targetValue: goal.targetValue.toString(),
    currentValue: goal.currentValue?.toString() ?? null,
    progressPct: goal.progressPct?.toString() ?? null,
    expectedProgressPct:
      expectedProgressFor(goal.startDate, goal.dueDate, now)?.toString() ?? null,
    startDate: goal.startDate.toISOString().slice(0, 10),
    dueDate: goal.dueDate.toISOString().slice(0, 10),
    daysRemaining: daysRemaining(goal.dueDate, now),
    primaryMetric: primary
      ? {
          metricId: primary.metricId,
          code: primary.metric.code,
          name: primary.metric.name,
          unit: primary.metric.unit,
          isPrimary: true,
        }
      : null,
    supportingMetrics: goal.metrics
      .filter((link) => !link.isPrimary)
      .map((link) => ({
        metricId: link.metricId,
        code: link.metric.code,
        name: link.metric.name,
        unit: link.metric.unit,
        isPrimary: false,
      })),
    createdAt: goal.createdAt.toISOString(),
    updatedAt: goal.updatedAt.toISOString(),
  };
}

/** Decimal-aware equality, so 50 and 50.00 are the same figure. */
function numbersMatch(value: number | null, stored: Prisma.Decimal | null): boolean {
  if (value === null || stored === null) {
    return value === null && stored === null;
  }

  return new Prisma.Decimal(value).equals(stored);
}
