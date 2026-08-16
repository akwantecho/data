import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { PrismaService } from '../src/prisma/prisma.service';
import { createOrganization, createUser } from './helpers/fixtures';
import { cleanupFixtures, createTestApp, TEST_PASSWORD } from './helpers/test-app';

/**
 * Sprint 2 gate: CRUD works, tenant isolation holds on every new endpoint, and
 * references to another organization's rows are rejected.
 */
describe('Organization structure (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const organizationIds: string[] = [];
  const userIds: string[] = [];

  let alpha: { id: string };
  let beta: { id: string };
  let alphaAdmin: { email: string };
  let alphaViewer: { email: string };
  let betaAdmin: { email: string };

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());

    alpha = await createOrganization(prisma, { name: 'Alpha Structure' });
    beta = await createOrganization(prisma, { name: 'Beta Structure' });
    organizationIds.push(alpha.id, beta.id);

    alphaAdmin = await createUser(prisma, {
      memberships: [{ organizationId: alpha.id, role: 'ORGANIZATION_ADMIN', isDefault: true }],
    });
    alphaViewer = await createUser(prisma, {
      memberships: [{ organizationId: alpha.id, role: 'VIEWER', isDefault: true }],
    });
    betaAdmin = await createUser(prisma, {
      memberships: [{ organizationId: beta.id, role: 'ORGANIZATION_ADMIN', isDefault: true }],
    });

    const users = await prisma.user.findMany({
      where: { email: { in: [alphaAdmin.email, alphaViewer.email, betaAdmin.email] } },
      select: { id: true },
    });
    userIds.push(...users.map((user) => user.id));
  });

  afterAll(async () => {
    await prisma.department.deleteMany({ where: { organizationId: { in: organizationIds } } });
    await prisma.branch.deleteMany({ where: { organizationId: { in: organizationIds } } });
    await cleanupFixtures(prisma, { organizationIds, userIds });
    await app?.close();
  });

  async function signIn(email: string) {
    const agent = request.agent(app.getHttpServer());
    await agent.post('/api/auth/login').send({ email, password: TEST_PASSWORD }).expect(200);
    return agent;
  }

  describe('branches', () => {
    it('supports the full lifecycle', async () => {
      const agent = await signIn(alphaAdmin.email);

      const created = await agent
        .post('/api/branches')
        .send({ name: 'Muscat Clinic', code: 'muscat', countryCode: 'OM', timezone: 'Asia/Muscat' })
        .expect(201);

      expect(created.body).toMatchObject({
        name: 'Muscat Clinic',
        code: 'muscat',
        countryCode: 'OM',
        isActive: true,
        departmentCount: 0,
      });

      const listed = await agent.get('/api/branches').expect(200);
      expect(listed.body.map((branch: { id: string }) => branch.id)).toContain(created.body.id);

      const updated = await agent
        .patch(`/api/branches/${created.body.id}`)
        .send({ name: 'Muscat Main Clinic' })
        .expect(200);
      expect(updated.body.name).toBe('Muscat Main Clinic');

      await agent.delete(`/api/branches/${created.body.id}`).expect(204);
      await agent.get(`/api/branches/${created.body.id}`).expect(404);
    });

    it('rejects a duplicate code inside the organization but allows it in another', async () => {
      const alphaAgent = await signIn(alphaAdmin.email);
      const betaAgent = await signIn(betaAdmin.email);

      await alphaAgent.post('/api/branches').send({ name: 'Shared', code: 'shared' }).expect(201);

      const duplicate = await alphaAgent
        .post('/api/branches')
        .send({ name: 'Shared again', code: 'shared' })
        .expect(409);
      expect(duplicate.body.code).toBe('CONFLICT');

      // The same code in a different tenant is fine — codes are scoped per organization.
      await betaAgent.post('/api/branches').send({ name: 'Shared', code: 'shared' }).expect(201);
    });

    it('hides inactive branches unless asked', async () => {
      const agent = await signIn(alphaAdmin.email);

      const branch = await agent
        .post('/api/branches')
        .send({ name: 'Closed Site', code: 'closed_site' })
        .expect(201);
      await agent.patch(`/api/branches/${branch.body.id}`).send({ isActive: false }).expect(200);

      const active = await agent.get('/api/branches').expect(200);
      expect(active.body.map((row: { id: string }) => row.id)).not.toContain(branch.body.id);

      const all = await agent.get('/api/branches').query({ includeInactive: 'true' }).expect(200);
      expect(all.body.map((row: { id: string }) => row.id)).toContain(branch.body.id);
    });

    it('refuses to delete a branch that still has departments', async () => {
      const agent = await signIn(alphaAdmin.email);

      const branch = await agent
        .post('/api/branches')
        .send({ name: 'Busy Branch', code: 'busy_branch' })
        .expect(201);
      await agent
        .post('/api/departments')
        .send({ name: 'Operations', code: 'busy_ops', branchId: branch.body.id })
        .expect(201);

      const refused = await agent.delete(`/api/branches/${branch.body.id}`).expect(409);
      expect(refused.body.message).toMatch(/departments/i);
    });

    it('validates the payload', async () => {
      const agent = await signIn(alphaAdmin.email);

      const response = await agent
        .post('/api/branches')
        .send({ name: 'x', code: 'not valid code', timezone: 'Mars/Olympus' })
        .expect(400);

      expect(response.body.code).toBe('VALIDATION_ERROR');
      expect(response.body.details.length).toBeGreaterThan(0);
    });

    it('lets a viewer read but not write', async () => {
      const viewerAgent = await signIn(alphaViewer.email);

      await viewerAgent.get('/api/branches').expect(200);
      await viewerAgent.post('/api/branches').send({ name: 'Nope', code: 'nope' }).expect(403);
    });
  });

  describe('departments', () => {
    it('creates a department attached to a branch of the same organization', async () => {
      const agent = await signIn(alphaAdmin.email);

      const branch = await agent
        .post('/api/branches')
        .send({ name: 'Salalah', code: 'salalah' })
        .expect(201);

      const department = await agent
        .post('/api/departments')
        .send({ name: 'Finance', code: 'salalah_finance', branchId: branch.body.id })
        .expect(201);

      expect(department.body).toMatchObject({
        name: 'Finance',
        branchId: branch.body.id,
        branchName: 'Salalah',
      });

      const filtered = await agent
        .get('/api/departments')
        .query({ branchId: branch.body.id })
        .expect(200);
      expect(filtered.body).toHaveLength(1);
    });

    it('allows an organization-wide department with no branch', async () => {
      const agent = await signIn(alphaAdmin.email);

      const department = await agent
        .post('/api/departments')
        .send({ name: 'Group Finance', code: 'group_finance' })
        .expect(201);

      expect(department.body.branchId).toBeNull();
      expect(department.body.branchName).toBeNull();
    });

    it('rejects a branch belonging to another organization', async () => {
      const alphaAgent = await signIn(alphaAdmin.email);
      const betaAgent = await signIn(betaAdmin.email);

      const betaBranch = await betaAgent
        .post('/api/branches')
        .send({ name: 'Beta Branch', code: 'beta_branch' })
        .expect(201);

      const response = await alphaAgent
        .post('/api/departments')
        .send({ name: 'Sneaky', code: 'sneaky', branchId: betaBranch.body.id })
        .expect(400);

      expect(response.body.code).toBe('VALIDATION_ERROR');
      expect(response.body.details[0].field).toBe('branchId');
    });

    it('rejects moving a department onto another organization’s branch', async () => {
      const alphaAgent = await signIn(alphaAdmin.email);
      const betaAgent = await signIn(betaAdmin.email);

      const department = await alphaAgent
        .post('/api/departments')
        .send({ name: 'Movable', code: 'movable' })
        .expect(201);
      const betaBranch = await betaAgent
        .post('/api/branches')
        .send({ name: 'Beta Other', code: 'beta_other' })
        .expect(201);

      await alphaAgent
        .patch(`/api/departments/${department.body.id}`)
        .send({ branchId: betaBranch.body.id })
        .expect(400);
    });
  });

  describe('tenant isolation', () => {
    it('does not list another organization’s branches', async () => {
      const alphaAgent = await signIn(alphaAdmin.email);
      const betaAgent = await signIn(betaAdmin.email);

      const betaBranch = await betaAgent
        .post('/api/branches')
        .send({ name: 'Beta Only', code: 'beta_only' })
        .expect(201);

      const alphaList = await alphaAgent
        .get('/api/branches')
        .query({ includeInactive: 'true' })
        .expect(200);

      expect(alphaList.body.map((row: { id: string }) => row.id)).not.toContain(betaBranch.body.id);
    });

    it('cannot read, update or delete another organization’s branch by id', async () => {
      const alphaAgent = await signIn(alphaAdmin.email);
      const betaAgent = await signIn(betaAdmin.email);

      const betaBranch = await betaAgent
        .post('/api/branches')
        .send({ name: 'Beta Guarded', code: 'beta_guarded' })
        .expect(201);

      await alphaAgent.get(`/api/branches/${betaBranch.body.id}`).expect(404);
      await alphaAgent
        .patch(`/api/branches/${betaBranch.body.id}`)
        .send({ name: 'Hijacked' })
        .expect(404);
      await alphaAgent.delete(`/api/branches/${betaBranch.body.id}`).expect(404);

      const untouched = await prisma.branch.findUniqueOrThrow({
        where: { id: betaBranch.body.id },
      });
      expect(untouched.name).toBe('Beta Guarded');
    });

    it('cannot read or update another organization’s department by id', async () => {
      const alphaAgent = await signIn(alphaAdmin.email);
      const betaAgent = await signIn(betaAdmin.email);

      const betaDepartment = await betaAgent
        .post('/api/departments')
        .send({ name: 'Beta Dept', code: 'beta_dept' })
        .expect(201);

      await alphaAgent.get(`/api/departments/${betaDepartment.body.id}`).expect(404);
      await alphaAgent
        .patch(`/api/departments/${betaDepartment.body.id}`)
        .send({ name: 'Hijacked' })
        .expect(404);
    });
  });

  describe('audit trail', () => {
    it('records structural changes with before and after values', async () => {
      const agent = await signIn(alphaAdmin.email);

      const branch = await agent
        .post('/api/branches')
        .send({ name: 'Audited', code: 'audited' })
        .expect(201);
      await agent
        .patch(`/api/branches/${branch.body.id}`)
        .send({ name: 'Audited Twice' })
        .expect(200);

      const entries = await prisma.auditLog.findMany({
        where: { organizationId: alpha.id, entityId: branch.body.id },
        orderBy: { createdAt: 'asc' },
      });

      expect(entries.map((entry) => entry.action)).toEqual(['branch.created', 'branch.updated']);
      expect(entries[1].before).toMatchObject({ name: 'Audited' });
      expect(entries[1].after).toMatchObject({ name: 'Audited Twice' });
    });
  });
});
