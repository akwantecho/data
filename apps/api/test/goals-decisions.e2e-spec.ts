import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { PrismaService } from '../src/prisma/prisma.service';
import { createOrganization, createUser } from './helpers/fixtures';
import { cleanupFixtures, createTestApp, TEST_PASSWORD, unique } from './helpers/test-app';

/**
 * Sprint 8 gate (plan §42): metric-linked goals update themselves, and a decision's
 * history stays auditable.
 *
 * The organization reports revenue over three months, rising from 800 to 1,000
 * against a goal of 1,200 from a baseline of 800 — so every progress figure in this
 * suite has one arithmetically correct answer, and the test asserts that answer
 * rather than "some number appeared".
 */
describe('Goals and decisions (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const organizationIds: string[] = [];
  const userIds: string[] = [];

  let organization: { id: string };
  let other: { id: string };
  let admin: { id: string; email: string };
  let viewer: { email: string };
  let otherAdmin: { email: string };
  let branch: string;

  let revenueMetricId: string;
  let foreignMetricId: string;
  let alertId: string;
  let insightId: string;

  const JANUARY = new Date('2026-01-01T00:00:00.000Z');
  const MARCH = new Date('2026-03-01T00:00:00.000Z');

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());

    organization = await createOrganization(prisma, { name: 'Goals Co' });
    other = await createOrganization(prisma, { name: 'Other Goals Co' });
    organizationIds.push(organization.id, other.id);

    admin = await createUser(prisma, {
      memberships: [
        { organizationId: organization.id, role: 'ORGANIZATION_ADMIN', isDefault: true },
      ],
    });
    viewer = await createUser(prisma, {
      memberships: [{ organizationId: organization.id, role: 'VIEWER', isDefault: true }],
    });
    otherAdmin = await createUser(prisma, {
      memberships: [{ organizationId: other.id, role: 'ORGANIZATION_ADMIN', isDefault: true }],
    });

    const users = await prisma.user.findMany({
      where: { email: { in: [admin.email, viewer.email, otherAdmin.email] } },
      select: { id: true, email: true },
    });
    userIds.push(...users.map((user) => user.id));
    admin.id = users.find((user) => user.email === admin.email)!.id;

    const suffix = unique('g').split('-')[1];
    const created = await prisma.branch.create({
      data: { organizationId: organization.id, code: `main_${suffix}`, name: 'Main' },
    });
    branch = created.id;

    const agent = await signIn(admin.email);

    const revenue = await agent
      .post('/api/metrics')
      .send({
        code: 'revenue',
        name: 'Revenue',
        unit: 'CURRENCY',
        direction: 'HIGHER_IS_BETTER',
        frequency: 'MONTHLY',
        category: 'Financial',
        aggregationType: 'SUM',
      })
      .expect(201);
    revenueMetricId = revenue.body.id;

    // A metric belonging to another tenant, used to prove references are checked.
    const foreign = await prisma.metric.create({
      data: {
        organizationId: other.id,
        code: 'revenue',
        name: 'Revenue',
        unit: 'CURRENCY',
        direction: 'HIGHER_IS_BETTER',
        frequency: 'MONTHLY',
        aggregationType: 'SUM',
      },
      select: { id: true },
    });
    foreignMetricId = foreign.id;

    await writeRevenue(JANUARY, 800);
    await writeRevenue(new Date('2026-02-01T00:00:00.000Z'), 900);
    await writeRevenue(MARCH, 1000);

    // An alert and an insight to cite as evidence. Both are written directly, as
    // the engines that produce them are Sprint 7's subject, not this suite's.
    const alert = await prisma.alert.create({
      data: {
        organizationId: organization.id,
        metricId: revenueMetricId,
        severity: 'HIGH',
        status: 'OPEN',
        title: 'Revenue target missed',
        description: 'Revenue came in below target for March.',
        periodType: 'MONTH',
        periodStart: MARCH,
        evidence: { statement: 'Revenue 1000 against a target of 1200.', figures: [] },
      },
      select: { id: true },
    });
    alertId = alert.id;

    const insight = await prisma.insight.create({
      data: {
        organizationId: organization.id,
        title: 'Revenue growth is slowing',
        narrative: 'Month-on-month growth fell from 12.5% to 11.1%.',
        category: 'Financial',
        severity: 'INFO',
        periodType: 'MONTH',
        periodStart: MARCH,
      },
      select: { id: true },
    });
    insightId = insight.id;
  });

  afterAll(async () => {
    await prisma.decisionReview.deleteMany({
      where: { decision: { organizationId: { in: organizationIds } } },
    });
    await prisma.decisionAction.deleteMany({
      where: { decision: { organizationId: { in: organizationIds } } },
    });
    await prisma.decision.deleteMany({ where: { organizationId: { in: organizationIds } } });
    await prisma.goalUpdate.deleteMany({
      where: { goal: { organizationId: { in: organizationIds } } },
    });
    await prisma.goal.deleteMany({ where: { organizationId: { in: organizationIds } } });
    await prisma.alert.deleteMany({ where: { organizationId: { in: organizationIds } } });
    await prisma.insight.deleteMany({ where: { organizationId: { in: organizationIds } } });
    await prisma.metricValue.deleteMany({ where: { organizationId: { in: organizationIds } } });
    await prisma.metric.deleteMany({ where: { organizationId: { in: organizationIds } } });
    await prisma.branch.deleteMany({ where: { organizationId: { in: organizationIds } } });
    await cleanupFixtures(prisma, { organizationIds, userIds });
    await app?.close();
  });

  async function signIn(email: string) {
    const agent = request.agent(app.getHttpServer());
    await agent.post('/api/auth/login').send({ email, password: TEST_PASSWORD }).expect(200);
    return agent;
  }

  async function writeRevenue(periodStart: Date, value: number) {
    const periodEnd = new Date(
      Date.UTC(periodStart.getUTCFullYear(), periodStart.getUTCMonth() + 1, 0),
    );

    await prisma.metricValue.create({
      data: {
        organizationId: organization.id,
        metricId: revenueMetricId,
        branchId: branch,
        periodType: 'MONTH',
        periodStart,
        periodEnd,
        value,
        sourceType: 'MANUAL',
      },
    });
  }

  /** The goal every test in this suite reads. Created once, in the first test. */
  let goalId: string;

  describe('goals', () => {
    it('calculates progress from the linked metric the moment it is created', async () => {
      const agent = await signIn(admin.email);

      const response = await agent
        .post('/api/goals')
        .send({
          title: 'Lift quarterly revenue to 1,200',
          description: 'The board target for the first quarter.',
          metricId: revenueMetricId,
          baselineValue: '800',
          targetValue: '1200',
          startDate: '2026-01-01',
          dueDate: '2026-03-31',
          status: 'ACTIVE',
          ownerId: admin.id,
        })
        .expect(201);

      goalId = response.body.id;

      // Revenue sums to 2,700 over the window, which is past the target, so the
      // goal reads as achieved. The point is that nobody typed the figure.
      expect(response.body.currentValue).toBe('2700');
      expect(response.body.progressPct).toBe('100');
      expect(response.body.status).toBe('ACHIEVED');
      expect(response.body.primaryMetric).toMatchObject({ code: 'revenue', isPrimary: true });
      expect(response.body.ownerName).toBe('Test User');
    });

    it('records every change it made to the goal, and nothing when nothing changed', async () => {
      const agent = await signIn(admin.email);

      const before = await agent.get(`/api/goals/${goalId}`).expect(200);
      const entries = before.body.updates.length;

      expect(entries).toBeGreaterThanOrEqual(1);
      expect(before.body.updates[0]).toMatchObject({ status: 'ACHIEVED', currentValue: '2700' });

      const recalculated = await agent.post('/api/goals/recalculate').expect(200);
      expect(recalculated.body.changed).toBe(0);

      const after = await agent.get(`/api/goals/${goalId}`).expect(200);
      expect(after.body.updates).toHaveLength(entries);
    });

    it('follows the metric when the metric moves', async () => {
      const agent = await signIn(admin.email);

      // A goal over a window the reported months barely reach: 800 of a 4,000 climb
      // from a 400 baseline is 10%.
      const created = await agent
        .post('/api/goals')
        .send({
          title: 'Reach 4,400 in the half year',
          metricId: revenueMetricId,
          baselineValue: '400',
          targetValue: '4400',
          startDate: '2026-01-01',
          dueDate: '2026-06-30',
          status: 'ACTIVE',
        })
        .expect(201);

      expect(created.body.currentValue).toBe('2700');
      expect(created.body.progressPct).toBe('57.5');

      await writeRevenue(new Date('2026-04-01T00:00:00.000Z'), 1300);

      const run = await agent.post('/api/goals/recalculate').expect(200);
      expect(run.body.changed).toBeGreaterThanOrEqual(1);

      const detail = await agent.get(`/api/goals/${created.body.id}`).expect(200);

      // 4,000 of the 4,000 climb — the goal moved because the metric did.
      expect(detail.body.currentValue).toBe('4000');
      expect(detail.body.progressPct).toBe('90');
      // The extra month carried the goal from far behind to within reach, so the
      // history says which way the status moved rather than only that it moved.
      expect(detail.body.updates[0].note).toBe('Status changed from OFF_TRACK to ON_TRACK.');
      expect(detail.body.updates[0].status).toBe('ON_TRACK');

      await agent.delete(`/api/goals/${created.body.id}`).expect(204);
      await prisma.metricValue.deleteMany({
        where: { organizationId: organization.id, periodStart: new Date('2026-04-01') },
      });
    });

    it('takes a note from a person without disturbing the calculated figures', async () => {
      const agent = await signIn(admin.email);

      const response = await agent
        .post(`/api/goals/${goalId}/notes`)
        .send({ note: 'March invoicing ran a week early.' })
        .expect(201);

      expect(response.body.updates[0].note).toBe('March invoicing ran a week early.');
      expect(response.body.updates[0].actorName).toBe('Test User');
      expect(response.body.currentValue).toBe('2700');
    });

    it('refuses a metric that belongs to another organization', async () => {
      const agent = await signIn(admin.email);

      const response = await agent
        .post('/api/goals')
        .send({
          title: 'A goal on somebody else’s metric',
          metricId: foreignMetricId,
          targetValue: '100',
          startDate: '2026-01-01',
          dueDate: '2026-03-31',
        })
        .expect(400);

      expect(JSON.stringify(response.body)).toContain('does not belong to this organization');
    });

    it('refuses a due date before the start date', async () => {
      const agent = await signIn(admin.email);

      await agent
        .post('/api/goals')
        .send({
          title: 'A goal that finishes before it starts',
          targetValue: '100',
          startDate: '2026-03-31',
          dueDate: '2026-01-01',
        })
        .expect(400);
    });

    it('lets a viewer read goals but not change them', async () => {
      const agent = await signIn(viewer.email);

      await agent.get('/api/goals').expect(200);
      await agent
        .post('/api/goals')
        .send({
          title: 'A goal a viewer should not be able to set',
          targetValue: '100',
          startDate: '2026-01-01',
          dueDate: '2026-03-31',
        })
        .expect(403);
    });

    it('shows another organization nothing', async () => {
      const stranger = await signIn(otherAdmin.email);

      const response = await stranger.get('/api/goals').expect(200);
      expect(response.body).toEqual([]);

      await stranger.get(`/api/goals/${goalId}`).expect(404);
    });
  });

  describe('decisions', () => {
    let decisionId: string;

    it('will not record a decision with nothing behind it', async () => {
      const agent = await signIn(admin.email);

      const response = await agent
        .post('/api/decisions')
        .send({
          title: 'Cut advertising spend',
          problemStatement: 'Acquisition cost has risen sharply this quarter.',
        })
        .expect(400);

      expect(JSON.stringify(response.body)).toContain('at least one');
    });

    it('records a decision with its evidence', async () => {
      const agent = await signIn(admin.email);

      const response = await agent
        .post('/api/decisions')
        .send({
          title: 'Reduce paid advertising spend by 15%',
          problemStatement: 'Customer acquisition cost increased 28% against the prior quarter.',
          context: 'Discussed at the March management meeting.',
          status: 'OPEN',
          priority: 'HIGH',
          decisionDate: '2026-03-20',
          expectedOutcome: 'Improve contribution margin within 60 days.',
          reviewDate: '2026-05-20',
          ownerId: admin.id,
          metricIds: [revenueMetricId],
          alertIds: [alertId],
          insightIds: [insightId],
          goalIds: [goalId],
        })
        .expect(201);

      decisionId = response.body.id;

      expect(response.body.evidenceCount).toBe(4);
      expect(response.body.evidence.metrics[0]).toMatchObject({ code: 'revenue' });
      expect(response.body.evidence.alerts[0]).toMatchObject({ title: 'Revenue target missed' });
      expect(response.body.evidence.insights[0]).toMatchObject({
        title: 'Revenue growth is slowing',
      });
      expect(response.body.evidence.goals[0]).toMatchObject({ goalId, status: 'ACHIEVED' });
      expect(response.body.ownerName).toBe('Test User');
    });

    it('refuses evidence belonging to another organization', async () => {
      const agent = await signIn(admin.email);

      const response = await agent
        .post('/api/decisions')
        .send({
          title: 'A decision citing another tenant',
          problemStatement: 'This should never be recorded at all.',
          metricIds: [foreignMetricId],
        })
        .expect(400);

      expect(JSON.stringify(response.body)).toContain('does not belong to this organization');
    });

    it('will not let the evidence be edited away', async () => {
      const agent = await signIn(admin.email);

      const response = await agent
        .patch(`/api/decisions/${decisionId}`)
        .send({ metricIds: [], alertIds: [], insightIds: [], goalIds: [] })
        .expect(400);

      expect(JSON.stringify(response.body)).toContain('at least one');

      // Refused edits leave the record exactly as it was.
      const detail = await agent.get(`/api/decisions/${decisionId}`).expect(200);
      expect(detail.body.evidenceCount).toBe(4);
    });

    it('tracks the actions the decision produced', async () => {
      const agent = await signIn(admin.email);

      const created = await agent
        .post(`/api/decisions/${decisionId}/actions`)
        .send({
          title: 'Pause the two lowest-performing campaigns',
          ownerId: admin.id,
          dueDate: '2026-04-01',
        })
        .expect(201);

      expect(created.body.openActions).toBe(1);
      expect(created.body.totalActions).toBe(1);
      expect(created.body.actions[0].ownerName).toBe('Test User');

      const completed = await agent
        .patch(`/api/decisions/${decisionId}/actions/${created.body.actions[0].id}`)
        .send({ isCompleted: true })
        .expect(200);

      expect(completed.body.openActions).toBe(0);
      expect(completed.body.actions[0].completedAt).not.toBeNull();
    });

    it('reviews the decision against the outcome that was expected at the time', async () => {
      const agent = await signIn(admin.email);

      const reviewed = await agent
        .post(`/api/decisions/${decisionId}/review`)
        .send({
          actualOutcome: 'Contribution margin improved 4 points over the following two months.',
          result: 'POSITIVE',
          notes: 'Spend was reduced 15% as planned.',
        })
        .expect(201);

      expect(reviewed.body.lastReviewResult).toBe('POSITIVE');
      expect(reviewed.body.reviews[0]).toMatchObject({
        result: 'POSITIVE',
        expectedOutcome: 'Improve contribution margin within 60 days.',
        reviewerName: 'Test User',
      });

      // Editing the decision afterwards cannot rewrite what the review judged.
      await agent
        .patch(`/api/decisions/${decisionId}`)
        .send({ expectedOutcome: 'Something else entirely.' })
        .expect(200);

      const detail = await agent.get(`/api/decisions/${decisionId}`).expect(200);
      expect(detail.body.reviews[0].expectedOutcome).toBe(
        'Improve contribution margin within 60 days.',
      );
      expect(detail.body.reviews).toHaveLength(1);
    });

    it('keeps the whole history in the audit log — the acceptance criterion', async () => {
      const entries = await prisma.auditLog.findMany({
        where: { organizationId: organization.id, entityId: decisionId },
        orderBy: { createdAt: 'asc' },
        select: { action: true, actorId: true, before: true, after: true },
      });

      const actions = entries.map((entry) => entry.action);

      expect(actions).toContain('decision.created');
      expect(actions).toContain('decision.action.created');
      expect(actions).toContain('decision.action.updated');
      expect(actions).toContain('decision.reviewed');
      expect(actions).toContain('decision.updated');

      for (const entry of entries) {
        expect(entry.actorId).toBe(admin.id);
      }

      const edit = entries.find((entry) => entry.action === 'decision.updated');
      expect(JSON.stringify(edit?.before)).toContain('Improve contribution margin');
    });

    it('will not review a decision that has not been taken', async () => {
      const agent = await signIn(admin.email);

      const draft = await agent
        .post('/api/decisions')
        .send({
          title: 'A decision still being drafted',
          problemStatement: 'Not yet agreed by anyone.',
          metricIds: [revenueMetricId],
        })
        .expect(201);

      await agent
        .post(`/api/decisions/${draft.body.id}/review`)
        .send({ actualOutcome: 'Nothing happened yet.', result: 'INCONCLUSIVE' })
        .expect(409);
    });

    it('will not delete a goal a decision depends on', async () => {
      const agent = await signIn(admin.email);

      const response = await agent.delete(`/api/goals/${goalId}`).expect(409);

      expect(JSON.stringify(response.body)).toContain('cites this goal');
    });

    it('shows another organization nothing', async () => {
      const stranger = await signIn(otherAdmin.email);

      const list = await stranger.get('/api/decisions').expect(200);
      expect(list.body.items).toEqual([]);

      await stranger.get(`/api/decisions/${decisionId}`).expect(404);
    });
  });

  describe('the decision centre', () => {
    it('gathers what management has to look at', async () => {
      const agent = await signIn(admin.email);

      const response = await agent.get('/api/decisions/centre').expect(200);

      expect(response.body.warnings.map((entry: { id: string }) => entry.id)).toContain(alertId);
      expect(response.body.warnings[0]).toMatchObject({
        severity: 'HIGH',
        metricName: 'Revenue',
        periodStart: '2026-03-01',
      });
      expect(response.body.opportunities.map((entry: { id: string }) => entry.id)).toContain(
        insightId,
      );
      expect(response.body.openDecisions.length).toBeGreaterThanOrEqual(1);
      expect(response.body.recentlyReviewed.length).toBeGreaterThanOrEqual(1);
      expect(response.body.recentlyReviewed[0].lastReviewResult).toBe('POSITIVE');
    });

    it('lists a goal that has fallen behind its schedule', async () => {
      const agent = await signIn(admin.email);

      // A goal a long way behind: no linked metric, so its progress stays at nothing
      // while the calendar runs on.
      const behind = await agent
        .post('/api/goals')
        .send({
          title: 'A goal nobody has moved',
          baselineValue: '0',
          targetValue: '1000',
          startDate: '2026-01-01',
          dueDate: '2026-12-31',
          status: 'ACTIVE',
        })
        .expect(201);

      await prisma.goal.update({
        where: { id: behind.body.id },
        data: { currentValue: 0, progressPct: 0, status: 'OFF_TRACK' },
      });

      const response = await agent.get('/api/decisions/centre').expect(200);

      expect(response.body.goalsAtRisk.map((goal: { id: string }) => goal.id)).toContain(
        behind.body.id,
      );
    });

    it('shows another organization an empty centre', async () => {
      const stranger = await signIn(otherAdmin.email);

      const response = await stranger.get('/api/decisions/centre').expect(200);

      expect(response.body.criticalIssues).toEqual([]);
      expect(response.body.warnings).toEqual([]);
      expect(response.body.opportunities).toEqual([]);
      expect(response.body.openDecisions).toEqual([]);
      expect(response.body.goalsAtRisk).toEqual([]);
    });

    it('refuses an unauthenticated caller', async () => {
      await request(app.getHttpServer()).get('/api/decisions/centre').expect(401);
      await request(app.getHttpServer()).get('/api/goals').expect(401);
    });
  });
});
