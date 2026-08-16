import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { PrismaService } from '../src/prisma/prisma.service';
import { createOrganization, createUser } from './helpers/fixtures';
import { cleanupFixtures, createTestApp, TEST_PASSWORD } from './helpers/test-app';

/**
 * The Sprint 1 gate (plan §42): a user of organization A must not be able to read
 * or write organization B's data, and platform access must be separated from
 * tenant access in both directions.
 */
describe('Tenant isolation (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const organizationIds: string[] = [];
  const userIds: string[] = [];

  let alpha: { id: string; slug: string; name: string };
  let beta: { id: string; slug: string; name: string };
  let alphaAdmin: { email: string };
  let alphaAnalyst: { email: string };
  let betaAdmin: { email: string };
  let platformAdmin: { email: string };

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());

    alpha = await createOrganization(prisma, { name: 'Alpha Medical' });
    beta = await createOrganization(prisma, { name: 'Beta Resorts' });
    organizationIds.push(alpha.id, beta.id);

    alphaAdmin = await createUser(prisma, {
      memberships: [{ organizationId: alpha.id, role: 'ORGANIZATION_ADMIN', isDefault: true }],
    });
    alphaAnalyst = await createUser(prisma, {
      memberships: [{ organizationId: alpha.id, role: 'ANALYST', isDefault: true }],
    });
    betaAdmin = await createUser(prisma, {
      memberships: [{ organizationId: beta.id, role: 'ORGANIZATION_ADMIN', isDefault: true }],
    });
    platformAdmin = await createUser(prisma, { platformRole: 'PLATFORM_ADMIN' });

    userIds.push(
      ...(await prisma.user
        .findMany({
          where: {
            email: {
              in: [alphaAdmin.email, alphaAnalyst.email, betaAdmin.email, platformAdmin.email],
            },
          },
          select: { id: true },
        })
        .then((rows) => rows.map((row) => row.id))),
    );
  });

  afterAll(async () => {
    await cleanupFixtures(prisma, { organizationIds, userIds });
    await app?.close();
  });

  async function signIn(email: string) {
    const agent = request.agent(app.getHttpServer());
    await agent.post('/api/auth/login').send({ email, password: TEST_PASSWORD }).expect(200);
    return agent;
  }

  describe('organization data', () => {
    it('returns only the caller’s own organization', async () => {
      const alphaAgent = await signIn(alphaAdmin.email);
      const betaAgent = await signIn(betaAdmin.email);

      const alphaResponse = await alphaAgent.get('/api/organizations/current').expect(200);
      const betaResponse = await betaAgent.get('/api/organizations/current').expect(200);

      expect(alphaResponse.body.id).toBe(alpha.id);
      expect(betaResponse.body.id).toBe(beta.id);
      expect(alphaResponse.body.id).not.toBe(betaResponse.body.id);
    });

    it('cannot be redirected to another organization through the request body', async () => {
      const alphaAgent = await signIn(alphaAdmin.email);

      // The client tries to smuggle a foreign organizationId into the payload.
      const response = await alphaAgent
        .patch('/api/organizations/current')
        .send({ name: 'Renamed by Alpha', organizationId: beta.id, id: beta.id })
        .expect(200);

      expect(response.body.id).toBe(alpha.id);

      const betaRow = await prisma.organization.findUniqueOrThrow({ where: { id: beta.id } });
      expect(betaRow.name).toBe('Beta Resorts');
    });

    it('cannot switch scope by presenting another organization’s id', async () => {
      const alphaAgent = await signIn(alphaAdmin.email);

      await alphaAgent
        .post('/api/auth/switch-organization')
        .send({ organizationId: beta.id })
        .expect(403);

      const stillAlpha = await alphaAgent.get('/api/organizations/current').expect(200);
      expect(stillAlpha.body.id).toBe(alpha.id);
    });

    it('loses access as soon as the membership is removed, without waiting for token expiry', async () => {
      const organization = await createOrganization(prisma);
      const user = await createUser(prisma, {
        memberships: [{ organizationId: organization.id, role: 'ANALYST', isDefault: true }],
      });
      organizationIds.push(organization.id);
      userIds.push(user.id);

      const agent = await signIn(user.email);
      await agent.get('/api/organizations/current').expect(200);

      await prisma.organizationUser.deleteMany({
        where: { organizationId: organization.id, userId: user.id },
      });

      // Same, still-valid access token — the guard re-reads membership.
      await agent.get('/api/organizations/current').expect(403);
    });

    it('loses access when the organization is suspended', async () => {
      const organization = await createOrganization(prisma);
      const user = await createUser(prisma, {
        memberships: [{ organizationId: organization.id, role: 'ANALYST', isDefault: true }],
      });
      organizationIds.push(organization.id);
      userIds.push(user.id);

      const agent = await signIn(user.email);
      await agent.get('/api/organizations/current').expect(200);

      await prisma.organization.update({
        where: { id: organization.id },
        data: { status: 'SUSPENDED' },
      });

      await agent.get('/api/organizations/current').expect(403);
    });
  });

  describe('roles', () => {
    it('lets an analyst read but not modify the organization', async () => {
      const analystAgent = await signIn(alphaAnalyst.email);

      await analystAgent.get('/api/organizations/current').expect(200);

      const response = await analystAgent
        .patch('/api/organizations/current')
        .send({ name: 'Analyst rename attempt' })
        .expect(403);

      expect(response.body.code).toBe('FORBIDDEN');
    });

    it('lets an organization admin modify it, and records an audit entry', async () => {
      const adminAgent = await signIn(alphaAdmin.email);

      await adminAgent
        .patch('/api/organizations/current')
        .send({ timezone: 'Asia/Dubai' })
        .expect(200);

      const entry = await prisma.auditLog.findFirst({
        where: { organizationId: alpha.id, action: 'organization.updated' },
        orderBy: { createdAt: 'desc' },
      });

      expect(entry).not.toBeNull();
      expect(entry?.after).toMatchObject({ timezone: 'Asia/Dubai' });
    });
  });

  describe('platform separation', () => {
    it('refuses platform routes to tenant users', async () => {
      const alphaAgent = await signIn(alphaAdmin.email);

      const response = await alphaAgent.get('/api/platform/organizations').expect(403);

      expect(response.body.code).toBe('FORBIDDEN');
      expect(JSON.stringify(response.body)).not.toContain('Beta Resorts');
    });

    it('refuses tenant routes to platform staff, who have no membership', async () => {
      const platformAgent = await signIn(platformAdmin.email);

      await platformAgent.get('/api/organizations/current').expect(403);
    });

    it('lets platform staff list organizations across tenants', async () => {
      const platformAgent = await signIn(platformAdmin.email);

      const response = await platformAgent
        .get('/api/platform/organizations')
        .query({ pageSize: 100 })
        .expect(200);

      const ids = response.body.items.map((item: { id: string }) => item.id);
      expect(ids).toEqual(expect.arrayContaining([alpha.id, beta.id]));
      expect(response.body).toMatchObject({ page: 1, pageSize: 100 });
    });

    it('lets platform staff suspend a tenant, which locks its members out', async () => {
      const organization = await createOrganization(prisma);
      const member = await createUser(prisma, {
        memberships: [
          { organizationId: organization.id, role: 'ORGANIZATION_ADMIN', isDefault: true },
        ],
      });
      organizationIds.push(organization.id);
      userIds.push(member.id);

      const memberAgent = await signIn(member.email);
      await memberAgent.get('/api/organizations/current').expect(200);

      const platformAgent = await signIn(platformAdmin.email);
      await platformAgent
        .patch(`/api/platform/organizations/${organization.id}/status`)
        .send({ status: 'SUSPENDED' })
        .expect(200);

      await memberAgent.get('/api/organizations/current').expect(403);
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: member.email, password: TEST_PASSWORD })
        .expect(403);
    });

    it('rejects an unauthenticated caller on platform routes', async () => {
      await request(app.getHttpServer()).get('/api/platform/organizations').expect(401);
    });
  });
});
