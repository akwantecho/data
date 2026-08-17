import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { PrismaService } from '../src/prisma/prisma.service';
import { createOrganization, createUser } from './helpers/fixtures';
import { cleanupFixtures, createTestApp, TEST_PASSWORD } from './helpers/test-app';

/**
 * Sprint 4 gate (plan §42): metrics calculate server-side, dependency order is
 * safe, division by zero and missing dependencies are handled, and historical
 * values are stored correctly.
 */
describe('Metrics engine (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const organizationIds: string[] = [];
  const userIds: string[] = [];

  let alpha: { id: string };
  let beta: { id: string };
  let alphaAdmin: { email: string };
  let alphaAnalyst: { email: string };
  let alphaViewer: { email: string };
  let betaAdmin: { email: string };

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());

    alpha = await createOrganization(prisma, { name: 'Alpha Metrics' });
    beta = await createOrganization(prisma, { name: 'Beta Metrics' });
    organizationIds.push(alpha.id, beta.id);

    alphaAdmin = await createUser(prisma, {
      memberships: [{ organizationId: alpha.id, role: 'ORGANIZATION_ADMIN', isDefault: true }],
    });
    alphaAnalyst = await createUser(prisma, {
      memberships: [{ organizationId: alpha.id, role: 'ANALYST', isDefault: true }],
    });
    alphaViewer = await createUser(prisma, {
      memberships: [{ organizationId: alpha.id, role: 'VIEWER', isDefault: true }],
    });
    betaAdmin = await createUser(prisma, {
      memberships: [{ organizationId: beta.id, role: 'ORGANIZATION_ADMIN', isDefault: true }],
    });

    const users = await prisma.user.findMany({
      where: {
        email: {
          in: [alphaAdmin.email, alphaAnalyst.email, alphaViewer.email, betaAdmin.email],
        },
      },
      select: { id: true },
    });
    userIds.push(...users.map((user) => user.id));
  });

  afterAll(async () => {
    await prisma.metricValue.deleteMany({ where: { organizationId: { in: organizationIds } } });
    await prisma.metricTarget.deleteMany({ where: { organizationId: { in: organizationIds } } });
    await prisma.metricThreshold.deleteMany({ where: { organizationId: { in: organizationIds } } });
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

  const storedMetric = (code: string, overrides: Record<string, unknown> = {}) => ({
    code,
    name: code,
    unit: 'CURRENCY',
    aggregationType: 'SUM',
    frequency: 'MONTHLY',
    direction: 'HIGHER_IS_BETTER',
    ...overrides,
  });

  /** Creates the metrics a test needs and returns their ids by code. */
  async function createMetrics(
    agent: ReturnType<typeof request.agent>,
    definitions: Array<Record<string, unknown>>,
  ): Promise<Record<string, string>> {
    const ids: Record<string, string> = {};

    for (const definition of definitions) {
      const response = await agent.post('/api/metrics').send(definition).expect(201);
      ids[response.body.code] = response.body.id;
    }

    return ids;
  }

  /** Unique suffix so each test's metric codes never collide. */
  let sequence = 0;
  const nextCode = (base: string) => `${base}_${(sequence += 1)}`;

  /**
   * A private organization for tests that assert on a whole recalculation run:
   * the skip list is capped, so shared data would make the assertions flaky.
   */
  async function ownOrganization() {
    const organization = await createOrganization(prisma);
    const admin = await createUser(prisma, {
      memberships: [
        { organizationId: organization.id, role: 'ORGANIZATION_ADMIN', isDefault: true },
      ],
    });
    organizationIds.push(organization.id);
    userIds.push(admin.id);

    return { organization, agent: await signIn(admin.email) };
  }

  describe('definitions', () => {
    it('creates, reads, updates and deactivates a metric', async () => {
      const agent = await signIn(alphaAdmin.email);
      const code = nextCode('revenue');

      const created = await agent
        .post('/api/metrics')
        .send(storedMetric(code, { name: 'Revenue', category: 'Financial' }))
        .expect(201);

      expect(created.body).toMatchObject({
        code,
        name: 'Revenue',
        unit: 'CURRENCY',
        isCalculated: false,
        isActive: true,
        valueCount: 0,
      });

      const listed = await agent.get('/api/metrics').expect(200);
      expect(listed.body.map((metric: { id: string }) => metric.id)).toContain(created.body.id);

      const updated = await agent
        .patch(`/api/metrics/${created.body.id}`)
        .send({ name: 'Total Revenue', direction: 'HIGHER_IS_BETTER' })
        .expect(200);
      expect(updated.body.name).toBe('Total Revenue');

      await agent.patch(`/api/metrics/${created.body.id}`).send({ isActive: false }).expect(200);
      const active = await agent.get('/api/metrics').expect(200);
      expect(active.body.map((metric: { id: string }) => metric.id)).not.toContain(created.body.id);

      await agent.delete(`/api/metrics/${created.body.id}`).expect(204);
    });

    it('rejects a duplicate code inside the organization', async () => {
      const agent = await signIn(alphaAdmin.email);
      const code = nextCode('duplicate');

      await agent.post('/api/metrics').send(storedMetric(code)).expect(201);
      const second = await agent.post('/api/metrics').send(storedMetric(code)).expect(409);

      expect(second.body.code).toBe('CONFLICT');
    });

    it('refuses to delete a metric that has values, and offers deactivation', async () => {
      const agent = await signIn(alphaAdmin.email);
      const code = nextCode('with_values');
      const ids = await createMetrics(agent, [storedMetric(code)]);

      await agent
        .post(`/api/metrics/${ids[code]}/values`)
        .send({ period: '2026-01', value: '1000' })
        .expect(201);

      const refused = await agent.delete(`/api/metrics/${ids[code]}`).expect(409);
      expect(refused.body.message).toMatch(/deactivate/i);
    });

    it('lets an analyst define metrics but not delete them', async () => {
      const analyst = await signIn(alphaAnalyst.email);
      const code = nextCode('analyst_metric');

      const created = await analyst.post('/api/metrics').send(storedMetric(code)).expect(201);
      await analyst.delete(`/api/metrics/${created.body.id}`).expect(403);
    });

    it('refuses a viewer entirely', async () => {
      const viewer = await signIn(alphaViewer.email);

      await viewer.get('/api/metrics').expect(200);
      await viewer
        .post('/api/metrics')
        .send(storedMetric(nextCode('viewer')))
        .expect(403);
    });
  });

  describe('formulas', () => {
    it('rejects a formula that references an unknown metric', async () => {
      const agent = await signIn(alphaAdmin.email);

      const response = await agent
        .post('/api/metrics')
        .send(
          storedMetric(nextCode('bad_formula'), {
            aggregationType: 'FORMULA',
            unit: 'PERCENTAGE',
            formula: 'nonexistent / other * 100',
          }),
        )
        .expect(400);

      expect(response.body.details[0]).toMatchObject({ field: 'formula' });
      expect(response.body.details[0].message).toMatch(/Unknown metrics?/);
    });

    it('rejects a formula that is not valid arithmetic', async () => {
      const agent = await signIn(alphaAdmin.email);
      const base = nextCode('base');
      await createMetrics(agent, [storedMetric(base)]);

      const response = await agent
        .post('/api/metrics')
        .send(
          storedMetric(nextCode('broken'), {
            aggregationType: 'FORMULA',
            formula: `${base} / `,
          }),
        )
        .expect(400);

      expect(response.body.details[0].field).toBe('formula');
    });

    it('refuses code disguised as a formula', async () => {
      const agent = await signIn(alphaAdmin.email);

      const response = await agent
        .post('/api/metrics')
        .send(
          storedMetric(nextCode('injection'), {
            aggregationType: 'FORMULA',
            formula: 'process.exit(1)',
          }),
        )
        .expect(400);

      expect(response.body.details[0].field).toBe('formula');
    });

    it('rejects a formula that would create a loop', async () => {
      const agent = await signIn(alphaAdmin.email);
      const base = nextCode('loop_base');
      const first = nextCode('loop_a');

      await createMetrics(agent, [
        storedMetric(base),
        storedMetric(first, { aggregationType: 'FORMULA', formula: base }),
      ]);

      // Pointing the base metric back at its own dependant closes the loop.
      const response = await agent
        .post('/api/metrics')
        .send(
          storedMetric(nextCode('loop_b'), {
            aggregationType: 'FORMULA',
            formula: `${first} + 1`,
          }),
        )
        .expect(201);

      const closing = await agent
        .patch(`/api/metrics/${response.body.id}`)
        .send({ formula: `${response.body.code} + 1` })
        .expect(400);

      expect(closing.body.details[0].message).toMatch(/loop/i);
    });

    it('records the dependency graph both ways', async () => {
      const agent = await signIn(alphaAdmin.email);
      const revenue = nextCode('rev');
      const expenses = nextCode('exp');
      const profit = nextCode('profit');

      const ids = await createMetrics(agent, [
        storedMetric(revenue),
        storedMetric(expenses),
        storedMetric(profit, {
          aggregationType: 'FORMULA',
          formula: `${revenue} - ${expenses}`,
        }),
      ]);

      const detail = await agent.get(`/api/metrics/${ids[profit]}`).expect(200);
      expect(detail.body.dependencies).toEqual([revenue, expenses]);

      const revenueDetail = await agent.get(`/api/metrics/${ids[revenue]}`).expect(200);
      expect(revenueDetail.body.dependents).toContain(profit);

      // The graph is stored, not only derived on read.
      const stored = await prisma.metricDependency.count({ where: { metricId: ids[profit] } });
      expect(stored).toBe(2);
    });

    it('will not delete a metric other formulas depend on', async () => {
      const agent = await signIn(alphaAdmin.email);
      const base = nextCode('needed');
      const derived = nextCode('derived');

      const ids = await createMetrics(agent, [
        storedMetric(base),
        storedMetric(derived, { aggregationType: 'FORMULA', formula: `${base} * 2` }),
      ]);

      const refused = await agent.delete(`/api/metrics/${ids[base]}`).expect(409);
      expect(refused.body.message).toContain(derived);
    });
  });

  describe('calculation', () => {
    it('calculates derived metrics server-side, in dependency order', async () => {
      const agent = await signIn(alphaAdmin.email);
      const revenue = nextCode('c_revenue');
      const expenses = nextCode('c_expenses');
      const profit = nextCode('c_profit');
      const margin = nextCode('c_margin');

      // margin depends on profit, which depends on revenue and expenses — a chain
      // that only produces the right numbers if the engine orders it correctly.
      const ids = await createMetrics(agent, [
        storedMetric(revenue),
        storedMetric(expenses),
        storedMetric(profit, {
          aggregationType: 'FORMULA',
          formula: `${revenue} - ${expenses}`,
        }),
        storedMetric(margin, {
          aggregationType: 'FORMULA',
          unit: 'PERCENTAGE',
          formula: `${profit} / ${revenue} * 100`,
        }),
      ]);

      await agent
        .post(`/api/metrics/${ids[revenue]}/values`)
        .send({ period: '2026-03', value: '100000' })
        .expect(201);
      await agent
        .post(`/api/metrics/${ids[expenses]}/values`)
        .send({ period: '2026-03', value: '87500' })
        .expect(201);

      const result = await agent.post('/api/metrics/recalculate').expect(200);
      expect(result.body.calculated).toBeGreaterThanOrEqual(2);

      const profitDetail = await agent.get(`/api/metrics/${ids[profit]}`).expect(200);
      const marginDetail = await agent.get(`/api/metrics/${ids[margin]}`).expect(200);

      expect(profitDetail.body.currentValue.value).toBe('12500');
      expect(profitDetail.body.currentValue.isCalculated).toBe(true);
      // 12500 / 100000 * 100, computed from a value that was itself calculated.
      expect(marginDetail.body.currentValue.value).toBe('12.5');
    });

    it('skips a metric whose input is missing, with a reason', async () => {
      const { agent } = await ownOrganization();
      const revenue = nextCode('m_revenue');
      const expenses = nextCode('m_expenses');
      const profit = nextCode('m_profit');

      const ids = await createMetrics(agent, [
        storedMetric(revenue),
        storedMetric(expenses),
        storedMetric(profit, {
          aggregationType: 'FORMULA',
          formula: `${revenue} - ${expenses}`,
        }),
      ]);

      // Only revenue is reported for this period.
      await agent
        .post(`/api/metrics/${ids[revenue]}/values`)
        .send({ period: '2026-04', value: '5000' })
        .expect(201);

      const result = await agent.post('/api/metrics/recalculate').expect(200);

      // The skip names the period by its start date.
      const skip = result.body.skipped.find(
        (entry: { metricCode: string; period: string }) =>
          entry.metricCode === profit && entry.period === '2026-04-01',
      );
      expect(skip).toMatchObject({ reason: 'MISSING_INPUT', detail: expenses });

      const detail = await agent.get(`/api/metrics/${ids[profit]}`).expect(200);
      expect(detail.body.currentValue).toBeNull();
    });

    it('skips a division by zero instead of storing infinity', async () => {
      const { agent } = await ownOrganization();
      const revenue = nextCode('z_revenue');
      const profit = nextCode('z_profit');
      const margin = nextCode('z_margin');

      const ids = await createMetrics(agent, [
        storedMetric(revenue),
        storedMetric(profit),
        storedMetric(margin, {
          aggregationType: 'FORMULA',
          unit: 'PERCENTAGE',
          formula: `${profit} / ${revenue} * 100`,
        }),
      ]);

      await agent
        .post(`/api/metrics/${ids[revenue]}/values`)
        .send({ period: '2026-05', value: '0' })
        .expect(201);
      await agent
        .post(`/api/metrics/${ids[profit]}/values`)
        .send({ period: '2026-05', value: '100' })
        .expect(201);

      const result = await agent.post('/api/metrics/recalculate').expect(200);

      expect(
        result.body.skipped.some(
          (entry: { metricCode: string; reason: string }) =>
            entry.metricCode === margin && entry.reason === 'DIVISION_BY_ZERO',
        ),
      ).toBe(true);

      const stored = await prisma.metricValue.findMany({ where: { metricId: ids[margin] } });
      expect(stored).toHaveLength(0);
    });

    it('removes a calculated value that its inputs no longer support', async () => {
      const { agent } = await ownOrganization();
      const revenue = nextCode('s_revenue');
      const doubled = nextCode('s_doubled');

      const ids = await createMetrics(agent, [
        storedMetric(revenue),
        storedMetric(doubled, { aggregationType: 'FORMULA', formula: `${revenue} * 2` }),
      ]);

      await agent
        .post(`/api/metrics/${ids[revenue]}/values`)
        .send({ period: '2026-06', value: '50' })
        .expect(201);
      await agent.post('/api/metrics/recalculate').expect(200);

      expect(await prisma.metricValue.count({ where: { metricId: ids[doubled] } })).toBe(1);

      // The input is withdrawn, so the derived value must not linger.
      await prisma.metricValue.deleteMany({ where: { metricId: ids[revenue] } });
      await agent.post('/api/metrics/recalculate').expect(200);

      expect(await prisma.metricValue.count({ where: { metricId: ids[doubled] } })).toBe(0);
    });

    it('calculates per branch, without mixing slices', async () => {
      const agent = await signIn(alphaAdmin.email);
      const revenue = nextCode('b_revenue');
      const doubled = nextCode('b_doubled');

      const ids = await createMetrics(agent, [
        storedMetric(revenue),
        storedMetric(doubled, { aggregationType: 'FORMULA', formula: `${revenue} * 2` }),
      ]);

      const branch = await agent
        .post('/api/branches')
        .send({ name: 'Metrics Branch', code: `mb_${sequence}` })
        .expect(201);

      await agent
        .post(`/api/metrics/${ids[revenue]}/values`)
        .send({ period: '2026-07', value: '10' })
        .expect(201);
      await agent
        .post(`/api/metrics/${ids[revenue]}/values`)
        .send({ period: '2026-07', value: '40', branchId: branch.body.id })
        .expect(201);

      await agent.post('/api/metrics/recalculate').expect(200);

      const values = await prisma.metricValue.findMany({
        where: { metricId: ids[doubled] },
        orderBy: { value: 'asc' },
      });

      expect(values).toHaveLength(2);
      expect(values[0].value.toString()).toBe('20');
      expect(values[0].branchId).toBeNull();
      expect(values[1].value.toString()).toBe('80');
      expect(values[1].branchId).toBe(branch.body.id);
    });

    it('does not calculate a monthly formula onto a quarterly slice', async () => {
      const agent = await signIn(alphaAdmin.email);
      const quarterly = nextCode('q_revenue');
      const monthly = nextCode('q_derived');

      const ids = await createMetrics(agent, [
        storedMetric(quarterly, { frequency: 'QUARTERLY' }),
        storedMetric(monthly, { aggregationType: 'FORMULA', formula: `${quarterly} * 2` }),
      ]);

      await agent
        .post(`/api/metrics/${ids[quarterly]}/values`)
        .send({ period: '2026-Q1', value: '90' })
        .expect(201);

      await agent.post('/api/metrics/recalculate').expect(200);

      expect(await prisma.metricValue.count({ where: { metricId: ids[monthly] } })).toBe(0);
    });

    it('recalculates automatically when an import commits', async () => {
      const agent = await signIn(alphaAdmin.email);
      const revenue = nextCode('i_revenue');
      const doubled = nextCode('i_doubled');

      const ids = await createMetrics(agent, [
        storedMetric(revenue),
        storedMetric(doubled, { aggregationType: 'FORMULA', formula: `${revenue} * 2` }),
      ]);

      const csv = `Metric,Period,Value\n${revenue},2026-08,250\n`;
      const preview = await agent
        .post('/api/imports/upload')
        .attach('file', Buffer.from(csv), { filename: 'metrics.csv', contentType: 'text/csv' })
        .expect(201);

      const importId = preview.body.import.id;
      await agent
        .post(`/api/imports/${importId}/map`)
        .send({ metricCode: 'Metric', period: 'Period', value: 'Value' })
        .expect(200);
      await agent.post(`/api/imports/${importId}/validate`).expect(200);
      await agent.post(`/api/imports/${importId}/commit`).expect(200);

      const derived = await prisma.metricValue.findFirst({
        where: { metricId: ids[doubled], periodStart: new Date('2026-08-01T00:00:00.000Z') },
      });

      expect(derived?.value.toString()).toBe('500');
      expect(derived?.isCalculated).toBe(true);
      expect(derived?.sourceType).toBe('CALCULATED');
    });
  });

  describe('manual entry', () => {
    it('stores a hand-entered value with its provenance', async () => {
      const agent = await signIn(alphaAnalyst.email);
      const code = nextCode('manual');
      const ids = await createMetrics(agent, [storedMetric(code)]);

      const response = await agent
        .post(`/api/metrics/${ids[code]}/values`)
        .send({ period: '2026-09', value: '1234.56' })
        .expect(201);

      expect(response.body).toMatchObject({
        periodType: 'MONTH',
        periodStart: '2026-09-01',
        periodEnd: '2026-09-30',
        value: '1234.56',
        sourceType: 'MANUAL',
        isCalculated: false,
      });
    });

    it('replaces the previous value for the same period', async () => {
      const agent = await signIn(alphaAdmin.email);
      const code = nextCode('replace');
      const ids = await createMetrics(agent, [storedMetric(code)]);

      await agent
        .post(`/api/metrics/${ids[code]}/values`)
        .send({ period: '2026-10', value: '100' })
        .expect(201);
      await agent
        .post(`/api/metrics/${ids[code]}/values`)
        .send({ period: '2026-10', value: '175' })
        .expect(201);

      const stored = await prisma.metricValue.findMany({ where: { metricId: ids[code] } });
      expect(stored).toHaveLength(1);
      expect(stored[0].value.toString()).toBe('175');
    });

    it('rejects a period that does not match the metric frequency', async () => {
      const agent = await signIn(alphaAdmin.email);
      const code = nextCode('freq');
      const ids = await createMetrics(agent, [storedMetric(code)]);

      const response = await agent
        .post(`/api/metrics/${ids[code]}/values`)
        .send({ period: '2026-10-15', value: '10' })
        .expect(400);

      expect(response.body.details[0].field).toBe('period');
    });

    it('rejects an unparseable period and a non-numeric value', async () => {
      const agent = await signIn(alphaAdmin.email);
      const code = nextCode('bad_input');
      const ids = await createMetrics(agent, [storedMetric(code)]);

      await agent
        .post(`/api/metrics/${ids[code]}/values`)
        .send({ period: 'October', value: '10' })
        .expect(400);
      await agent
        .post(`/api/metrics/${ids[code]}/values`)
        .send({ period: '2026-11', value: 'lots' })
        .expect(400);
    });

    it('refuses to hand-enter a calculated metric', async () => {
      const agent = await signIn(alphaAdmin.email);
      const base = nextCode('calc_base');
      const derived = nextCode('calc_derived');

      const ids = await createMetrics(agent, [
        storedMetric(base),
        storedMetric(derived, { aggregationType: 'FORMULA', formula: `${base} * 2` }),
      ]);

      const response = await agent
        .post(`/api/metrics/${ids[derived]}/values`)
        .send({ period: '2026-11', value: '999' })
        .expect(409);

      expect(response.body.message).toMatch(/calculated from other metrics/i);
    });

    it('rejects a branch from another organization', async () => {
      const agent = await signIn(alphaAdmin.email);
      const betaAgent = await signIn(betaAdmin.email);
      const code = nextCode('slice');
      const ids = await createMetrics(agent, [storedMetric(code)]);

      const betaBranch = await betaAgent
        .post('/api/branches')
        .send({ name: 'Beta Branch', code: `beta_${sequence}` })
        .expect(201);

      const response = await agent
        .post(`/api/metrics/${ids[code]}/values`)
        .send({ period: '2026-12', value: '10', branchId: betaBranch.body.id })
        .expect(400);

      expect(response.body.details[0].field).toBe('branchId');
    });
  });

  describe('targets, thresholds and detail', () => {
    it('reports current value, change, target, variance and threshold status', async () => {
      const agent = await signIn(alphaAdmin.email);
      const code = nextCode('detail');
      const ids = await createMetrics(agent, [storedMetric(code, { name: 'Detail Revenue' })]);

      await agent
        .post(`/api/metrics/${ids[code]}/values`)
        .send({ period: '2027-01', value: '116900' })
        .expect(201);
      await agent
        .post(`/api/metrics/${ids[code]}/values`)
        .send({ period: '2027-02', value: '128400' })
        .expect(201);

      await agent
        .put(`/api/metrics/${ids[code]}/target`)
        .send({ period: '2027-02', targetValue: '130000' })
        .expect(200);
      await agent
        .put(`/api/metrics/${ids[code]}/threshold`)
        .send({ warningValue: '120000', criticalValue: '100000' })
        .expect(200);

      const detail = await agent.get(`/api/metrics/${ids[code]}`).expect(200);

      expect(detail.body.currentValue.value).toBe('128400');
      expect(detail.body.previousValue.value).toBe('116900');
      expect(detail.body.changePct).toBe('9.84');
      expect(detail.body.target.targetValue).toBe('130000');
      expect(detail.body.varianceToTargetPct).toBe('-1.23');
      // 128400 is above the 120000 warning line for a higher-is-better metric.
      expect(detail.body.thresholdStatus).toBe('OK');
      expect(detail.body.trend).toHaveLength(2);
      expect(detail.body.trend[0].periodStart).toBe('2027-01-01');
    });

    it('flags a breached threshold', async () => {
      const agent = await signIn(alphaAdmin.email);
      const code = nextCode('breach');
      const ids = await createMetrics(agent, [
        storedMetric(code, { unit: 'PERCENTAGE', direction: 'LOWER_IS_BETTER' }),
      ]);

      await agent
        .post(`/api/metrics/${ids[code]}/values`)
        .send({ period: '2027-03', value: '18' })
        .expect(201);
      await agent
        .put(`/api/metrics/${ids[code]}/threshold`)
        .send({ warningValue: '10', criticalValue: '15' })
        .expect(200);

      const detail = await agent.get(`/api/metrics/${ids[code]}`).expect(200);
      expect(detail.body.thresholdStatus).toBe('CRITICAL');
    });

    it('replaces a target for the same period rather than duplicating it', async () => {
      const agent = await signIn(alphaAdmin.email);
      const code = nextCode('target');
      const ids = await createMetrics(agent, [storedMetric(code)]);

      await agent
        .put(`/api/metrics/${ids[code]}/target`)
        .send({ period: '2027-04', targetValue: '100' })
        .expect(200);
      await agent
        .put(`/api/metrics/${ids[code]}/target`)
        .send({ period: '2027-04', targetValue: '150' })
        .expect(200);

      const targets = await prisma.metricTarget.findMany({ where: { metricId: ids[code] } });
      expect(targets).toHaveLength(1);
      expect(targets[0].targetValue.toString()).toBe('150');
    });

    it('returns the trend oldest first, for charting', async () => {
      const agent = await signIn(alphaAdmin.email);
      const code = nextCode('trend');
      const ids = await createMetrics(agent, [storedMetric(code)]);

      for (const [period, value] of [
        ['2027-05', '10'],
        ['2027-06', '20'],
        ['2027-07', '30'],
      ]) {
        await agent.post(`/api/metrics/${ids[code]}/values`).send({ period, value }).expect(201);
      }

      const trend = await agent.get(`/api/metrics/${ids[code]}/trend`).expect(200);

      expect(trend.body.map((point: { value: string }) => point.value)).toEqual(['10', '20', '30']);
    });

    it('stores history with exact period bounds', async () => {
      const agent = await signIn(alphaAdmin.email);
      const code = nextCode('history');
      const ids = await createMetrics(agent, [storedMetric(code, { frequency: 'QUARTERLY' })]);

      await agent
        .post(`/api/metrics/${ids[code]}/values`)
        .send({ period: '2027-Q1', value: '300' })
        .expect(201);

      const stored = await prisma.metricValue.findFirstOrThrow({ where: { metricId: ids[code] } });
      expect(stored.periodType).toBe('QUARTER');
      expect(stored.periodStart.toISOString().slice(0, 10)).toBe('2027-01-01');
      expect(stored.periodEnd.toISOString().slice(0, 10)).toBe('2027-03-31');
    });
  });

  describe('tenant isolation', () => {
    it('does not expose another organization’s metrics', async () => {
      const alphaAgent = await signIn(alphaAdmin.email);
      const betaAgent = await signIn(betaAdmin.email);

      const betaMetric = await betaAgent
        .post('/api/metrics')
        .send(storedMetric(nextCode('beta_only')))
        .expect(201);

      const alphaList = await alphaAgent
        .get('/api/metrics')
        .query({ includeInactive: 'true' })
        .expect(200);
      expect(alphaList.body.map((metric: { id: string }) => metric.id)).not.toContain(
        betaMetric.body.id,
      );

      await alphaAgent.get(`/api/metrics/${betaMetric.body.id}`).expect(404);
      await alphaAgent
        .patch(`/api/metrics/${betaMetric.body.id}`)
        .send({ name: 'Hijacked' })
        .expect(404);
      await alphaAgent.delete(`/api/metrics/${betaMetric.body.id}`).expect(404);
      await alphaAgent
        .post(`/api/metrics/${betaMetric.body.id}/values`)
        .send({ period: '2027-01', value: '1' })
        .expect(404);
      await alphaAgent
        .put(`/api/metrics/${betaMetric.body.id}/target`)
        .send({ period: '2027-01', targetValue: '1' })
        .expect(404);

      const untouched = await prisma.metric.findUniqueOrThrow({
        where: { id: betaMetric.body.id },
      });
      expect(untouched.name).toBe(betaMetric.body.name);
    });

    it('allows the same metric code in different organizations', async () => {
      const alphaAgent = await signIn(alphaAdmin.email);
      const betaAgent = await signIn(betaAdmin.email);
      const shared = nextCode('shared_code');

      await alphaAgent.post('/api/metrics').send(storedMetric(shared)).expect(201);
      await betaAgent.post('/api/metrics').send(storedMetric(shared)).expect(201);
    });

    it('recalculates only the caller’s organization', async () => {
      const betaAgent = await signIn(betaAdmin.email);
      const revenue = nextCode('iso_revenue');
      const doubled = nextCode('iso_doubled');

      const ids = await createMetrics(betaAgent, [
        storedMetric(revenue),
        storedMetric(doubled, { aggregationType: 'FORMULA', formula: `${revenue} * 2` }),
      ]);

      await betaAgent
        .post(`/api/metrics/${ids[revenue]}/values`)
        .send({ period: '2027-08', value: '5' })
        .expect(201);
      await betaAgent.post('/api/metrics/recalculate').expect(200);

      const values = await prisma.metricValue.findMany({ where: { metricId: ids[doubled] } });
      expect(values).toHaveLength(1);
      expect(values[0].organizationId).toBe(beta.id);
    });
  });
});
