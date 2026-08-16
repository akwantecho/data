import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { PrismaService } from '../src/prisma/prisma.service';
import { createOrganization, createUser } from './helpers/fixtures';
import { cleanupFixtures, createTestApp, TEST_PASSWORD, unique } from './helpers/test-app';

describe('Team management and industry selection (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const organizationIds: string[] = [];
  const userIds: string[] = [];
  const createdEmails: string[] = [];

  let alpha: { id: string };
  let beta: { id: string };
  let alphaAdmin: { id: string; email: string };
  let alphaAnalyst: { id: string; email: string };
  let betaAdmin: { email: string };

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());

    alpha = await createOrganization(prisma, { name: 'Alpha Team' });
    beta = await createOrganization(prisma, { name: 'Beta Team' });
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

    userIds.push(alphaAdmin.id, alphaAnalyst.id);
    const beta1 = await prisma.user.findUniqueOrThrow({ where: { email: betaAdmin.email } });
    userIds.push(beta1.id);
  });

  afterAll(async () => {
    const created = await prisma.user.findMany({
      where: { email: { in: createdEmails } },
      select: { id: true },
    });
    await cleanupFixtures(prisma, {
      organizationIds,
      userIds: [...userIds, ...created.map((user) => user.id)],
    });
    await app?.close();
  });

  async function signIn(email: string) {
    const agent = request.agent(app.getHttpServer());
    await agent.post('/api/auth/login').send({ email, password: TEST_PASSWORD }).expect(200);
    return agent;
  }

  describe('members', () => {
    it('lists the team to any member', async () => {
      const analystAgent = await signIn(alphaAnalyst.email);

      const response = await analystAgent.get('/api/organization-users').expect(200);

      const emails = response.body.map((member: { email: string }) => member.email);
      expect(emails).toEqual(expect.arrayContaining([alphaAdmin.email, alphaAnalyst.email]));
      expect(emails).not.toContain(betaAdmin.email);
      expect(response.body[0]).not.toHaveProperty('passwordHash');
    });

    it('creates a new user and adds them, letting them sign in', async () => {
      const adminAgent = await signIn(alphaAdmin.email);
      const email = `${unique('member')}@example.test`;
      createdEmails.push(email);

      const created = await adminAgent
        .post('/api/organization-users')
        .send({
          email,
          role: 'ANALYST',
          fullName: 'Newly Added',
          temporaryPassword: 'TemporaryPass1',
        })
        .expect(201);

      expect(created.body).toMatchObject({ email, role: 'ANALYST', isDefault: true });

      const newMember = request.agent(app.getHttpServer());
      const session = await newMember
        .post('/api/auth/login')
        .send({ email, password: 'TemporaryPass1' })
        .expect(200);
      expect(session.body.activeOrganizationId).toBe(alpha.id);
    });

    it('rejects a weak initial password', async () => {
      const adminAgent = await signIn(alphaAdmin.email);

      const response = await adminAgent
        .post('/api/organization-users')
        .send({
          email: `${unique('weak')}@example.test`,
          role: 'ANALYST',
          fullName: 'Weak Password',
          temporaryPassword: 'short',
        })
        .expect(400);

      expect(response.body.code).toBe('VALIDATION_ERROR');
      expect(response.body.details.map((detail: { field: string }) => detail.field)).toContain(
        'temporaryPassword',
      );
    });

    it('adds an existing user of another organization without disturbing that membership', async () => {
      const adminAgent = await signIn(alphaAdmin.email);

      await adminAgent
        .post('/api/organization-users')
        .send({ email: betaAdmin.email, role: 'VIEWER' })
        .expect(201);

      const memberships = await prisma.organizationUser.findMany({
        where: { user: { email: betaAdmin.email } },
        select: { organizationId: true, role: true },
      });

      expect(memberships).toHaveLength(2);
      expect(memberships.find((row) => row.organizationId === beta.id)?.role).toBe(
        'ORGANIZATION_ADMIN',
      );
      expect(memberships.find((row) => row.organizationId === alpha.id)?.role).toBe('VIEWER');
    });

    it('refuses to add the same person twice', async () => {
      const adminAgent = await signIn(alphaAdmin.email);

      await adminAgent
        .post('/api/organization-users')
        .send({ email: alphaAnalyst.email, role: 'VIEWER' })
        .expect(409);
    });

    it('changes a role, and the new role applies to the next request', async () => {
      const adminAgent = await signIn(alphaAdmin.email);
      const analystAgent = await signIn(alphaAnalyst.email);

      // An analyst may not edit the organization…
      await analystAgent.patch('/api/organizations/current').send({ name: 'Nope' }).expect(403);

      await adminAgent
        .patch(`/api/organization-users/${alphaAnalyst.id}`)
        .send({ role: 'ORGANIZATION_ADMIN' })
        .expect(200);

      // …and now may, on the same session, because the guard re-reads membership.
      await analystAgent
        .patch('/api/organizations/current')
        .send({ name: 'Alpha Team Renamed' })
        .expect(200);

      await adminAgent
        .patch(`/api/organization-users/${alphaAnalyst.id}`)
        .send({ role: 'ANALYST' })
        .expect(200);
    });

    it('refuses to remove or demote the last administrator', async () => {
      const organization = await createOrganization(prisma);
      const soleAdmin = await createUser(prisma, {
        memberships: [
          { organizationId: organization.id, role: 'ORGANIZATION_ADMIN', isDefault: true },
        ],
      });
      organizationIds.push(organization.id);
      userIds.push(soleAdmin.id);

      const agent = await signIn(soleAdmin.email);

      const demote = await agent
        .patch(`/api/organization-users/${soleAdmin.id}`)
        .send({ role: 'VIEWER' })
        .expect(409);
      expect(demote.body.message).toMatch(/only administrator/i);

      await agent.delete(`/api/organization-users/${soleAdmin.id}`).expect(409);
    });

    it('removes a member, ending their access immediately', async () => {
      const adminAgent = await signIn(alphaAdmin.email);
      const email = `${unique('temp')}@example.test`;
      createdEmails.push(email);

      await adminAgent
        .post('/api/organization-users')
        .send({
          email,
          role: 'ANALYST',
          fullName: 'Temp Member',
          temporaryPassword: 'TemporaryPass1',
        })
        .expect(201);

      const memberAgent = request.agent(app.getHttpServer());
      const login = await memberAgent
        .post('/api/auth/login')
        .send({ email, password: 'TemporaryPass1' })
        .expect(200);
      await memberAgent.get('/api/branches').expect(200);

      await adminAgent.delete(`/api/organization-users/${login.body.user.id}`).expect(204);

      // Same access token, no membership: refused without waiting for expiry.
      await memberAgent.get('/api/branches').expect(403);

      // The user account itself survives — they may belong to other organizations.
      await expect(
        prisma.user.findUnique({ where: { email }, select: { id: true } }),
      ).resolves.not.toBeNull();
    });

    it('cannot modify a member of another organization', async () => {
      const alphaAgent = await signIn(alphaAdmin.email);
      const betaUser = await prisma.user.findUniqueOrThrow({ where: { email: betaAdmin.email } });

      // Beta's admin was added to Alpha as a VIEWER earlier, so use a Beta-only member.
      const betaOnly = await createUser(prisma, {
        memberships: [{ organizationId: beta.id, role: 'ANALYST', isDefault: true }],
      });
      userIds.push(betaOnly.id);

      await alphaAgent
        .patch(`/api/organization-users/${betaOnly.id}`)
        .send({ role: 'ORGANIZATION_ADMIN' })
        .expect(404);
      await alphaAgent.delete(`/api/organization-users/${betaOnly.id}`).expect(404);

      const untouched = await prisma.organizationUser.findFirst({
        where: { organizationId: beta.id, userId: betaOnly.id },
      });
      expect(untouched?.role).toBe('ANALYST');
      expect(betaUser.id).toBeDefined();
    });

    it('lets an analyst read the team but not change it', async () => {
      const analystAgent = await signIn(alphaAnalyst.email);

      await analystAgent.get('/api/organization-users').expect(200);
      await analystAgent
        .patch(`/api/organization-users/${alphaAdmin.id}`)
        .send({ role: 'VIEWER' })
        .expect(403);
    });
  });

  describe('industry selection', () => {
    it('lists industries and sets one for the organization', async () => {
      const organization = await createOrganization(prisma);
      const admin = await createUser(prisma, {
        memberships: [
          { organizationId: organization.id, role: 'ORGANIZATION_ADMIN', isDefault: true },
        ],
      });
      organizationIds.push(organization.id);
      userIds.push(admin.id);

      const agent = await signIn(admin.email);

      const industries = await agent.get('/api/industries').expect(200);
      expect(industries.body.length).toBeGreaterThan(0);

      const chosen = industries.body[0];
      const updated = await agent
        .put('/api/organizations/current/industry')
        .send({ industryId: chosen.id })
        .expect(200);

      expect(updated.body).toMatchObject({ industryId: chosen.id, industryName: chosen.name });
    });

    it('rejects an unknown industry', async () => {
      const agent = await signIn(alphaAdmin.email);

      await agent
        .put('/api/organizations/current/industry')
        .send({ industryId: '00000000-0000-4000-8000-000000000000' })
        .expect(400);
    });

    it('refuses the change once data exists (plan §37)', async () => {
      const organization = await createOrganization(prisma);
      const admin = await createUser(prisma, {
        memberships: [
          { organizationId: organization.id, role: 'ORGANIZATION_ADMIN', isDefault: true },
        ],
      });
      organizationIds.push(organization.id);
      userIds.push(admin.id);

      const industries = await prisma.industry.findMany({ take: 2, select: { id: true } });
      await prisma.organization.update({
        where: { id: organization.id },
        data: { industryId: industries[0].id },
      });
      await prisma.dataImport.create({
        data: {
          organizationId: organization.id,
          fileName: 'january.csv',
          fileSizeBytes: 1024,
          checksum: unique('checksum'),
        },
      });

      const agent = await signIn(admin.email);
      const response = await agent
        .put('/api/organizations/current/industry')
        .send({ industryId: industries[1].id })
        .expect(409);

      expect(response.body.code).toBe('CONFLICT');

      await prisma.dataImport.deleteMany({ where: { organizationId: organization.id } });
    });

    it('is refused to an analyst', async () => {
      const agent = await signIn(alphaAnalyst.email);
      const industry = await prisma.industry.findFirstOrThrow({ select: { id: true } });

      await agent
        .put('/api/organizations/current/industry')
        .send({ industryId: industry.id })
        .expect(403);
    });
  });
});
