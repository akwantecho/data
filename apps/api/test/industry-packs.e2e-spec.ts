import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { PackDefinition } from '../src/industry-packs/catalogue';
import { syncPackCatalogue } from '../src/industry-packs/pack-sync';
import type { PrismaService } from '../src/prisma/prisma.service';
import { createOrganization, createUser } from './helpers/fixtures';
import { cleanupFixtures, createTestApp, TEST_PASSWORD, unique } from './helpers/test-app';

/**
 * Sprint 5 gate (plan §42): creating an organization with an industry installs
 * the correct templates, and no organization receives another industry's private
 * configuration.
 *
 * The suite publishes two throwaway packs against two throwaway industries, so it
 * asserts on installation behaviour rather than on the shipped content — which the
 * catalogue unit tests cover. One test does sync the real catalogue, because
 * "the packs we ship actually load" is worth knowing.
 */
describe('Industry packs (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const organizationIds: string[] = [];
  const userIds: string[] = [];
  const industryIds: string[] = [];

  let industryA: string;
  let industryB: string;
  let packA: string;
  let packB: string;

  let alpha: { id: string };
  let beta: { id: string };
  let alphaAdmin: { email: string };
  let alphaAnalyst: { email: string };
  let alphaViewer: { email: string };
  let betaAdmin: { email: string };
  let platformAdmin: { email: string };

  const suffix = unique('pack').replace('-', '_');

  const definitionFor = (industryCode: string, code: string): PackDefinition => ({
    code,
    name: `Pack ${code}`,
    industryCode,
    version: '1.0.0',
    description: 'Throwaway pack used by the integration suite.',
    metrics: [
      {
        code: 'pack_revenue',
        name: 'Pack Revenue',
        category: 'Financial',
        unit: 'CURRENCY',
        aggregationType: 'SUM',
        frequency: 'MONTHLY',
        direction: 'HIGHER_IS_BETTER',
      },
      {
        code: 'pack_units',
        name: 'Pack Units',
        category: 'Operations',
        unit: 'COUNT',
        aggregationType: 'LAST',
        frequency: 'MONTHLY',
        direction: 'HIGHER_IS_BETTER',
      },
      {
        code: 'pack_revenue_per_unit',
        name: 'Pack Revenue per Unit',
        category: 'Financial',
        unit: 'CURRENCY',
        aggregationType: 'FORMULA',
        frequency: 'MONTHLY',
        direction: 'HIGHER_IS_BETTER',
        formula: 'pack_revenue / pack_units',
      },
    ],
    healthModel: {
      name: `${code} health model`,
      categories: [
        {
          code: 'financial',
          name: 'Financial',
          weight: 60,
          metrics: [
            { code: 'pack_revenue', weight: 70 },
            { code: 'pack_revenue_per_unit', weight: 30 },
          ],
        },
        {
          code: 'operations',
          name: 'Operations',
          weight: 40,
          metrics: [{ code: 'pack_units', weight: 100 }],
        },
      ],
    },
    insightRules: [
      {
        code: 'pack_revenue_decline',
        name: 'Pack revenue declined',
        severity: 'HIGH',
        definition: {
          conditions: [
            { metric: 'pack_revenue', measure: 'CHANGE_PCT', operator: 'LT', value: -10 },
          ],
          narrative: 'Revenue fell more than 10% against the previous period.',
          evidence: ['pack_revenue', 'pack_units'],
        },
      },
    ],
    alertRules: [
      {
        code: 'pack_units_below_threshold',
        name: 'Pack units below threshold',
        metric: 'pack_units',
        type: 'METRIC_BELOW_THRESHOLD',
        severity: 'WARNING',
        definition: { usesConfiguredThreshold: true },
      },
    ],
  });

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());

    const first = await prisma.industry.create({
      data: { code: `ind_a_${suffix}`, name: `Industry A ${suffix}` },
    });
    const second = await prisma.industry.create({
      data: { code: `ind_b_${suffix}`, name: `Industry B ${suffix}` },
    });

    industryA = first.id;
    industryB = second.id;
    industryIds.push(industryA, industryB);

    await syncPackCatalogue(prisma, [
      definitionFor(first.code, `pack_a_${suffix}`),
      definitionFor(second.code, `pack_b_${suffix}`),
    ]);

    const packs = await prisma.industryPack.findMany({
      where: { industryId: { in: [industryA, industryB] } },
      select: { id: true, industryId: true },
    });

    packA = packs.find((pack) => pack.industryId === industryA)?.id as string;
    packB = packs.find((pack) => pack.industryId === industryB)?.id as string;

    alpha = await createOrganization(prisma, { name: 'Alpha Packs', industryId: industryA });
    beta = await createOrganization(prisma, { name: 'Beta Packs', industryId: industryB });
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
    platformAdmin = await createUser(prisma, { platformRole: 'PLATFORM_ADMIN' });

    const users = await prisma.user.findMany({
      where: {
        email: {
          in: [
            alphaAdmin.email,
            alphaAnalyst.email,
            alphaViewer.email,
            betaAdmin.email,
            platformAdmin.email,
          ],
        },
      },
      select: { id: true },
    });
    userIds.push(...users.map((user) => user.id));
  });

  afterAll(async () => {
    await prisma.metricValue.deleteMany({ where: { organizationId: { in: organizationIds } } });
    await prisma.metric.deleteMany({ where: { organizationId: { in: organizationIds } } });
    await cleanupFixtures(prisma, { organizationIds, userIds });
    // Removing the throwaway industries takes their packs and template metrics
    // with them; the shipped packs synced by one test below stay, because they are
    // reference data the seed would create anyway.
    await prisma.industry.deleteMany({ where: { id: { in: industryIds } } });
    await app?.close();
  });

  async function signIn(email: string) {
    const agent = request.agent(app.getHttpServer());
    await agent.post('/api/auth/login').send({ email, password: TEST_PASSWORD }).expect(200);
    return agent;
  }

  /** A fresh tenant with no industry, for tests that need a clean installation. */
  async function freshOrganization(industryId?: string) {
    const organization = await createOrganization(prisma, { industryId });
    const admin = await createUser(prisma, {
      memberships: [
        { organizationId: organization.id, role: 'ORGANIZATION_ADMIN', isDefault: true },
      ],
    });

    organizationIds.push(organization.id);
    const user = await prisma.user.findUniqueOrThrow({
      where: { email: admin.email },
      select: { id: true },
    });
    userIds.push(user.id);

    return { organization, agent: await signIn(admin.email) };
  }

  describe('installation', () => {
    it('installs metrics, formulas, the health model and both kinds of rule', async () => {
      const { organization, agent } = await freshOrganization(industryA);

      const response = await agent.post(`/api/industry-packs/${packA}/install`).expect(201);

      expect(response.body).toMatchObject({
        packCode: `pack_a_${suffix}`,
        version: '1.0.0',
        metricsCreated: 3,
        metricsKept: 0,
        healthModelCreated: true,
        healthCategoriesCreated: 2,
        insightRulesCreated: 1,
        alertRulesCreated: 1,
      });

      const metrics = await prisma.metric.findMany({
        where: { organizationId: organization.id },
        select: {
          code: true,
          isSystem: true,
          organizationId: true,
          formula: { select: { expression: true } },
          dependencies: { select: { dependsOn: { select: { code: true } } } },
        },
        orderBy: { code: 'asc' },
      });

      expect(metrics.map((metric) => metric.code)).toEqual([
        'pack_revenue',
        'pack_revenue_per_unit',
        'pack_units',
      ]);
      expect(metrics.every((metric) => metric.isSystem)).toBe(true);

      const calculated = metrics.find((metric) => metric.code === 'pack_revenue_per_unit');
      expect(calculated?.formula?.expression).toBe('pack_revenue / pack_units');
      // The dependency graph is resolved to this organization's own metric rows.
      expect(calculated?.dependencies.map((row) => row.dependsOn.code).sort()).toEqual([
        'pack_revenue',
        'pack_units',
      ]);

      const model = await prisma.healthModel.findFirstOrThrow({
        where: { organizationId: organization.id },
        select: {
          categories: {
            orderBy: { displayOrder: 'asc' },
            select: { code: true, weight: true, weights: { select: { weight: true } } },
          },
        },
      });

      expect(model.categories.map((category) => category.code)).toEqual([
        'financial',
        'operations',
      ]);
      expect(model.categories[0].weight.toString()).toBe('60');
      expect(model.categories[0].weights).toHaveLength(2);

      const [insightRules, alertRules] = await Promise.all([
        prisma.insightRule.findMany({ where: { organizationId: organization.id } }),
        prisma.alertRule.findMany({ where: { organizationId: organization.id } }),
      ]);

      expect(insightRules.map((rule) => rule.code)).toEqual(['pack_revenue_decline']);
      expect(alertRules[0]).toMatchObject({
        code: 'pack_units_below_threshold',
        type: 'METRIC_BELOW_THRESHOLD',
        severity: 'WARNING',
      });
      // The alert points at this organization's own copy of the metric, not the
      // template it was cloned from.
      const packUnits = await prisma.metric.findFirstOrThrow({
        where: { organizationId: organization.id, code: 'pack_units' },
        select: { id: true },
      });
      expect(alertRules[0].metricId).toBe(packUnits.id);

      const installation = await prisma.organizationIndustryPack.findFirstOrThrow({
        where: { organizationId: organization.id },
      });
      expect(installation.version).toBe('1.0.0');
    });

    it('records the installation in the audit trail', async () => {
      const { organization, agent } = await freshOrganization(industryA);
      await agent.post(`/api/industry-packs/${packA}/install`).expect(201);

      const entry = await prisma.auditLog.findFirst({
        where: { organizationId: organization.id, action: 'industry_pack.installed' },
      });

      expect(entry).not.toBeNull();
      expect(entry?.after).toMatchObject({ metricsCreated: 3 });
    });

    it('installed metrics behave exactly like tenant-owned ones', async () => {
      const { organization, agent } = await freshOrganization(industryA);
      await agent.post(`/api/industry-packs/${packA}/install`).expect(201);

      const metrics = await agent.get('/api/metrics').expect(200);
      const revenue = metrics.body.find(
        (metric: { code: string }) => metric.code === 'pack_revenue',
      );
      const units = metrics.body.find((metric: { code: string }) => metric.code === 'pack_units');
      const perUnit = metrics.body.find(
        (metric: { code: string }) => metric.code === 'pack_revenue_per_unit',
      );

      await agent
        .post(`/api/metrics/${revenue.id}/values`)
        .send({ period: '2026-05', value: '240000' })
        .expect(201);
      await agent
        .post(`/api/metrics/${units.id}/values`)
        .send({ period: '2026-05', value: '400' })
        .expect(201);

      // A target and a threshold on a pack metric, exactly as on any other.
      await agent
        .put(`/api/metrics/${revenue.id}/target`)
        .send({ period: '2026-05', targetValue: '250000' })
        .expect(200);
      await agent
        .put(`/api/metrics/${revenue.id}/threshold`)
        .send({ warningValue: '200000', criticalValue: '150000' })
        .expect(200);

      await agent.post('/api/metrics/recalculate').expect(200);

      const calculated = await prisma.metricValue.findFirstOrThrow({
        where: { organizationId: organization.id, metricId: perUnit.id },
      });

      expect(calculated.value.toString()).toBe('600');
      expect(calculated.isCalculated).toBe(true);
      expect(calculated.sourceType).toBe('CALCULATED');

      const detail = await agent.get(`/api/metrics/${revenue.id}`).expect(200);
      expect(detail.body.thresholdStatus).toBe('OK');
      expect(detail.body.varianceToTargetPct).toBe('-4');
    });
  });

  describe('re-installation', () => {
    it('is idempotent: nothing is duplicated and nothing is created twice', async () => {
      const { organization, agent } = await freshOrganization(industryA);

      await agent.post(`/api/industry-packs/${packA}/install`).expect(201);
      const second = await agent.post(`/api/industry-packs/${packA}/install`).expect(201);

      expect(second.body).toMatchObject({
        metricsCreated: 0,
        metricsKept: 3,
        healthModelCreated: false,
        insightRulesCreated: 0,
        insightRulesKept: 1,
        alertRulesCreated: 0,
        alertRulesKept: 1,
      });

      const [metrics, categories, insightRules, alertRules, installations] = await Promise.all([
        prisma.metric.count({ where: { organizationId: organization.id } }),
        prisma.healthCategory.count({
          where: { healthModel: { organizationId: organization.id } },
        }),
        prisma.insightRule.count({ where: { organizationId: organization.id } }),
        prisma.alertRule.count({ where: { organizationId: organization.id } }),
        prisma.organizationIndustryPack.count({ where: { organizationId: organization.id } }),
      ]);

      expect([metrics, categories, insightRules, alertRules, installations]).toEqual([
        3, 2, 1, 1, 1,
      ]);
    });

    it('never overwrites what the organization has customised', async () => {
      const { organization, agent } = await freshOrganization(industryA);
      await agent.post(`/api/industry-packs/${packA}/install`).expect(201);

      const metrics = await agent.get('/api/metrics').expect(200);
      const units = metrics.body.find((metric: { code: string }) => metric.code === 'pack_units');

      await agent
        .patch(`/api/metrics/${units.id}`)
        .send({ name: 'Leasable Units', category: 'Portfolio', isActive: false })
        .expect(200);

      // A tuned health weight is the other thing an organization is likely to change.
      const category = await prisma.healthCategory.findFirstOrThrow({
        where: { healthModel: { organizationId: organization.id }, code: 'financial' },
      });
      await prisma.healthCategory.update({ where: { id: category.id }, data: { weight: 75 } });

      await agent.post(`/api/industry-packs/${packA}/install`).expect(201);

      const after = await prisma.metric.findFirstOrThrow({
        where: { organizationId: organization.id, code: 'pack_units' },
      });
      const weightAfter = await prisma.healthCategory.findUniqueOrThrow({
        where: { id: category.id },
      });

      expect(after.name).toBe('Leasable Units');
      expect(after.category).toBe('Portfolio');
      expect(after.isActive).toBe(false);
      expect(weightAfter.weight.toString()).toBe('75');
    });

    it('adds a metric the organization defined itself without touching it', async () => {
      const { organization, agent } = await freshOrganization(industryA);

      // The organization already reports pack_revenue under its own definition.
      await agent
        .post('/api/metrics')
        .send({
          code: 'pack_revenue',
          name: 'Turnover',
          unit: 'CURRENCY',
          aggregationType: 'SUM',
          frequency: 'MONTHLY',
          direction: 'HIGHER_IS_BETTER',
        })
        .expect(201);

      const result = await agent.post(`/api/industry-packs/${packA}/install`).expect(201);

      expect(result.body).toMatchObject({ metricsCreated: 2, metricsKept: 1 });

      const existing = await prisma.metric.findFirstOrThrow({
        where: { organizationId: organization.id, code: 'pack_revenue' },
      });

      expect(existing.name).toBe('Turnover');
      expect(existing.isSystem).toBe(false);
    });
  });

  describe('choosing an industry', () => {
    it('installs the pack for that industry automatically', async () => {
      const { organization, agent } = await freshOrganization();

      await agent
        .put('/api/organizations/current/industry')
        .send({ industryId: industryA })
        .expect(200);

      const [metrics, categories, insightRules, alertRules] = await Promise.all([
        prisma.metric.count({ where: { organizationId: organization.id } }),
        prisma.healthCategory.count({
          where: { healthModel: { organizationId: organization.id } },
        }),
        prisma.insightRule.count({ where: { organizationId: organization.id } }),
        prisma.alertRule.count({ where: { organizationId: organization.id } }),
      ]);

      expect([metrics, categories, insightRules, alertRules]).toEqual([3, 2, 1, 1]);
    });

    it('reports the installed pack in the organization overview', async () => {
      const { agent } = await freshOrganization();

      await agent
        .put('/api/organizations/current/industry')
        .send({ industryId: industryB })
        .expect(200);

      const overview = await agent.get('/api/industry-packs').expect(200);

      expect(overview.body.industryId).toBe(industryB);
      expect(overview.body.available).toHaveLength(1);
      expect(overview.body.available[0]).toMatchObject({
        code: `pack_b_${suffix}`,
        installedVersion: '1.0.0',
      });
      expect(overview.body.systemMetricCount).toBe(3);
      expect(overview.body.healthModel.categories).toHaveLength(2);
      expect(overview.body.healthModel.categories[0].metrics).toHaveLength(2);
    });

    it('leaves an organization with no industry with nothing to install', async () => {
      const { agent } = await freshOrganization();

      const overview = await agent.get('/api/industry-packs').expect(200);

      expect(overview.body).toMatchObject({
        industryId: null,
        available: [],
        healthModel: null,
        systemMetricCount: 0,
      });
    });
  });

  describe('organization isolation', () => {
    it('hides another industry’s pack completely', async () => {
      const agent = await signIn(betaAdmin.email);

      await agent.get(`/api/industry-packs/${packA}`).expect(404);
      await agent.post(`/api/industry-packs/${packA}/install`).expect(404);

      const overview = await agent.get('/api/industry-packs').expect(200);
      expect(overview.body.available.map((pack: { id: string }) => pack.id)).toEqual([packB]);
    });

    it('installs into one organization without touching another', async () => {
      const first = await freshOrganization(industryA);
      const second = await freshOrganization(industryB);

      await first.agent.post(`/api/industry-packs/${packA}/install`).expect(201);

      const secondMetrics = await prisma.metric.count({
        where: { organizationId: second.organization.id },
      });
      expect(secondMetrics).toBe(0);

      await second.agent.post(`/api/industry-packs/${packB}/install`).expect(201);

      const rows = await prisma.metric.findMany({
        where: {
          organizationId: { in: [first.organization.id, second.organization.id] },
          code: 'pack_revenue',
        },
        select: { id: true, organizationId: true },
      });

      // Same code, two separate rows: cloning, not sharing.
      expect(rows).toHaveLength(2);
      expect(new Set(rows.map((row) => row.id)).size).toBe(2);
    });

    it('keeps platform pack administration away from tenants', async () => {
      const agent = await signIn(alphaAdmin.email);

      await agent.get('/api/platform/industry-packs').expect(403);
      await agent.post('/api/platform/industry-packs/sync').expect(403);
    });

    it('lets only an administrator install', async () => {
      const analyst = await signIn(alphaAnalyst.email);
      const viewer = await signIn(alphaViewer.email);

      await analyst.post(`/api/industry-packs/${packA}/install`).expect(403);
      await viewer.post(`/api/industry-packs/${packA}/install`).expect(403);
      // Reading is open to every member: the pack explains where the metrics came from.
      await viewer.get('/api/industry-packs').expect(200);
    });
  });

  describe('platform administration', () => {
    it('lists every pack across industries and describes one in full', async () => {
      const agent = await signIn(platformAdmin.email);

      const list = await agent.get('/api/platform/industry-packs').expect(200);
      const codes = list.body.map((pack: { code: string }) => pack.code);

      expect(codes).toEqual(expect.arrayContaining([`pack_a_${suffix}`, `pack_b_${suffix}`]));

      const detail = await agent.get(`/api/platform/industry-packs/${packA}`).expect(200);

      expect(detail.body.metrics).toHaveLength(3);
      expect(
        detail.body.metrics.find(
          (metric: { code: string }) => metric.code === 'pack_revenue_per_unit',
        ),
      ).toMatchObject({ formula: 'pack_revenue / pack_units' });
      expect(detail.body.healthModel.categories).toHaveLength(2);
      expect(detail.body.insightRules).toHaveLength(1);
      expect(detail.body.alertRules).toHaveLength(1);
    });

    it('syncs the shipped catalogue and does it idempotently', async () => {
      const agent = await signIn(platformAdmin.email);

      // The shipped packs need their industries; the seed creates these, and this
      // upsert makes the test independent of whether it has run.
      for (const industry of [
        { code: 'healthcare', name: 'Healthcare' },
        { code: 'hospitality', name: 'Hospitality & Tourism' },
        { code: 'real_estate', name: 'Real Estate' },
      ]) {
        await prisma.industry.upsert({
          where: { code: industry.code },
          update: {},
          create: industry,
        });
      }

      const first = await agent.post('/api/platform/industry-packs/sync').expect(201);

      expect(first.body.packs.map((pack: { code: string }) => pack.code)).toEqual([
        'healthcare_core',
        'hospitality_core',
        'real_estate_core',
      ]);

      const second = await agent.post('/api/platform/industry-packs/sync').expect(201);

      // Nothing new the second time: every template metric is found and updated.
      expect(
        second.body.packs.every(
          (pack: { templateMetricsCreated: number }) => pack.templateMetricsCreated === 0,
        ),
      ).toBe(true);

      const templates = await prisma.metric.count({
        where: { organizationId: null, industry: { code: 'healthcare' } },
      });
      expect(templates).toBe(11);
    });

    it('records the sync in the audit trail', async () => {
      const agent = await signIn(platformAdmin.email);
      await agent.post('/api/platform/industry-packs/sync').expect(201);

      const actor = await prisma.user.findUniqueOrThrow({
        where: { email: platformAdmin.email },
        select: { id: true },
      });

      const entry = await prisma.auditLog.findFirst({
        where: { actorId: actor.id, action: 'platform.industry_packs.synced' },
        orderBy: { createdAt: 'desc' },
      });

      expect(entry).not.toBeNull();
    });
  });

  describe('customising an installed pack', () => {
    it('refuses to rename a metric code, because everything else refers to it', async () => {
      const { agent } = await freshOrganization(industryA);
      await agent.post(`/api/industry-packs/${packA}/install`).expect(201);

      const metrics = await agent.get('/api/metrics').expect(200);
      const revenue = metrics.body.find(
        (metric: { code: string }) => metric.code === 'pack_revenue',
      );

      const refused = await agent
        .patch(`/api/metrics/${revenue.id}`)
        .send({ code: 'renamed_revenue' })
        .expect(400);

      expect(refused.body.details[0]).toMatchObject({ field: 'code' });
      expect(refused.body.details[0].message).toContain('cannot be changed');
    });

    it('refuses to delete a pack metric, and deactivates instead', async () => {
      const { agent } = await freshOrganization(industryA);
      await agent.post(`/api/industry-packs/${packA}/install`).expect(201);

      const metrics = await agent.get('/api/metrics').expect(200);
      const units = metrics.body.find((metric: { code: string }) => metric.code === 'pack_units');

      const refused = await agent.delete(`/api/metrics/${units.id}`).expect(409);
      expect(refused.body.message).toContain('industry pack');

      await agent.patch(`/api/metrics/${units.id}`).send({ isActive: false }).expect(200);
    });
  });
});
