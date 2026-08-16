import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { PrismaService } from '../src/prisma/prisma.service';
import { createOrganization, createUser } from './helpers/fixtures';
import { cleanupFixtures, createTestApp, TEST_PASSWORD } from './helpers/test-app';

/** Reads a Set-Cookie value by name from a supertest response. */
function cookieValue(response: request.Response, name: string): string | undefined {
  const header = response.headers['set-cookie'];
  const cookies = Array.isArray(header) ? header : header ? [header] : [];
  const match = cookies.find((cookie) => cookie.startsWith(`${name}=`));
  return match?.split(';')[0]?.split('=').slice(1).join('=') || undefined;
}

function cookieAttributes(response: request.Response, name: string): string {
  const header = response.headers['set-cookie'];
  const cookies = Array.isArray(header) ? header : header ? [header] : [];
  return cookies.find((cookie) => cookie.startsWith(`${name}=`)) ?? '';
}

describe('Authentication (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const organizationIds: string[] = [];
  const userIds: string[] = [];

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });

  afterAll(async () => {
    await cleanupFixtures(prisma, { organizationIds, userIds });
    await app?.close();
  });

  async function seedMember(role: 'ORGANIZATION_ADMIN' | 'ANALYST' | 'VIEWER' = 'ANALYST') {
    const organization = await createOrganization(prisma);
    const user = await createUser(prisma, {
      memberships: [{ organizationId: organization.id, role, isDefault: true }],
    });
    organizationIds.push(organization.id);
    userIds.push(user.id);
    return { organization, user };
  }

  describe('POST /api/auth/login', () => {
    it('returns the session and sets httpOnly cookies', async () => {
      const { organization, user } = await seedMember('ORGANIZATION_ADMIN');

      const response = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: user.email, password: TEST_PASSWORD })
        .expect(200);

      expect(response.body).toMatchObject({
        user: { id: user.id, email: user.email },
        activeOrganizationId: organization.id,
        activeRole: 'ORGANIZATION_ADMIN',
      });
      expect(response.body.user).not.toHaveProperty('passwordHash');

      const accessCookie = cookieAttributes(response, 'sip_access');
      const refreshCookie = cookieAttributes(response, 'sip_refresh');
      expect(accessCookie).toContain('HttpOnly');
      expect(accessCookie).toContain('SameSite=Lax');
      expect(refreshCookie).toContain('HttpOnly');
      // The refresh cookie is only sent to the endpoints that rotate it.
      expect(refreshCookie).toContain('Path=/api/auth');
    });

    it('accepts a differently cased email', async () => {
      const { user } = await seedMember();

      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: user.email.toUpperCase(), password: TEST_PASSWORD })
        .expect(200);
    });

    it('rejects a wrong password without revealing whether the account exists', async () => {
      const { user } = await seedMember();

      const wrongPassword = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: user.email, password: 'WrongPassword1!' })
        .expect(401);

      const unknownEmail = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'nobody@example.test', password: 'WrongPassword1!' })
        .expect(401);

      expect(wrongPassword.body).toEqual(unknownEmail.body);
      expect(wrongPassword.body.code).toBe('UNAUTHENTICATED');
    });

    it('rejects a malformed body with field-level details', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'not-an-email' })
        .expect(400);

      expect(response.body.code).toBe('VALIDATION_ERROR');
      expect(response.body.details.map((detail: { field: string }) => detail.field)).toEqual(
        expect.arrayContaining(['email', 'password']),
      );
    });

    it('refuses a disabled user', async () => {
      const organization = await createOrganization(prisma);
      const user = await createUser(prisma, {
        status: 'DISABLED',
        memberships: [{ organizationId: organization.id, role: 'ANALYST' }],
      });
      organizationIds.push(organization.id);
      userIds.push(user.id);

      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: user.email, password: TEST_PASSWORD })
        .expect(401);
    });

    it('refuses a member of a suspended organization', async () => {
      const organization = await createOrganization(prisma, { status: 'SUSPENDED' });
      const user = await createUser(prisma, {
        memberships: [{ organizationId: organization.id, role: 'ANALYST' }],
      });
      organizationIds.push(organization.id);
      userIds.push(user.id);

      const response = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: user.email, password: TEST_PASSWORD })
        .expect(403);

      expect(response.body.code).toBe('FORBIDDEN');
    });
  });

  describe('GET /api/auth/me', () => {
    it('returns the session for a valid cookie', async () => {
      const { user, organization } = await seedMember('VIEWER');
      const agent = request.agent(app.getHttpServer());

      await agent.post('/api/auth/login').send({ email: user.email, password: TEST_PASSWORD });

      const response = await agent.get('/api/auth/me').expect(200);

      expect(response.body.user.email).toBe(user.email);
      expect(response.body.activeOrganizationId).toBe(organization.id);
      expect(response.body.activeRole).toBe('VIEWER');
    });

    it('rejects an unauthenticated request', async () => {
      const response = await request(app.getHttpServer()).get('/api/auth/me').expect(401);

      expect(response.body.code).toBe('UNAUTHENTICATED');
    });

    it('rejects a tampered token', async () => {
      await request(app.getHttpServer())
        .get('/api/auth/me')
        .set('Cookie', 'sip_access=not.a.valid.token')
        .expect(401);
    });
  });

  describe('POST /api/auth/refresh', () => {
    it('rotates the refresh token and issues a new access token', async () => {
      const { user } = await seedMember();
      const agent = request.agent(app.getHttpServer());

      const login = await agent
        .post('/api/auth/login')
        .send({ email: user.email, password: TEST_PASSWORD });
      const firstRefresh = cookieValue(login, 'sip_refresh');

      const refreshed = await agent.post('/api/auth/refresh').expect(200);
      const secondRefresh = cookieValue(refreshed, 'sip_refresh');

      expect(secondRefresh).toBeDefined();
      expect(secondRefresh).not.toBe(firstRefresh);
      expect(refreshed.body.user.email).toBe(user.email);

      // The new access cookie still works.
      await agent.get('/api/auth/me').expect(200);
    });

    it('detects reuse of a rotated token and kills the whole family', async () => {
      const { user } = await seedMember();
      const agent = request.agent(app.getHttpServer());

      const login = await agent
        .post('/api/auth/login')
        .send({ email: user.email, password: TEST_PASSWORD });
      const stolen = cookieValue(login, 'sip_refresh');

      await agent.post('/api/auth/refresh').expect(200);

      // The attacker replays the token that was already rotated.
      await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .set('Cookie', `sip_refresh=${stolen}`)
        .expect(401);

      // ...which also logs out the legitimate session.
      await agent.post('/api/auth/refresh').expect(401);

      const live = await prisma.refreshToken.count({
        where: { userId: user.id, revokedAt: null },
      });
      expect(live).toBe(0);
    });

    it('rejects a request with no refresh cookie', async () => {
      await request(app.getHttpServer()).post('/api/auth/refresh').expect(401);
    });

    it('clears cookies when refresh fails', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .set('Cookie', 'sip_refresh=garbage')
        .expect(401);

      expect(cookieAttributes(response, 'sip_access')).toContain('Expires=Thu, 01 Jan 1970');
    });
  });

  describe('POST /api/auth/logout', () => {
    it('revokes the session and clears cookies', async () => {
      const { user } = await seedMember();
      const agent = request.agent(app.getHttpServer());

      await agent.post('/api/auth/login').send({ email: user.email, password: TEST_PASSWORD });
      await agent.get('/api/auth/me').expect(200);

      await agent.post('/api/auth/logout').expect(204);

      // The cookie jar has been cleared, so the session is gone.
      await agent.get('/api/auth/me').expect(401);
      // ...and the refresh token cannot be used even if it was captured.
      await agent.post('/api/auth/refresh').expect(401);

      const live = await prisma.refreshToken.count({
        where: { userId: user.id, revokedAt: null },
      });
      expect(live).toBe(0);
    });

    it('succeeds without a session', async () => {
      await request(app.getHttpServer()).post('/api/auth/logout').expect(204);
    });
  });

  describe('POST /api/auth/switch-organization', () => {
    it('re-scopes the session to another membership', async () => {
      const first = await createOrganization(prisma);
      const second = await createOrganization(prisma);
      const user = await createUser(prisma, {
        memberships: [
          { organizationId: first.id, role: 'ORGANIZATION_ADMIN', isDefault: true },
          { organizationId: second.id, role: 'VIEWER' },
        ],
      });
      organizationIds.push(first.id, second.id);
      userIds.push(user.id);

      const agent = request.agent(app.getHttpServer());
      const login = await agent
        .post('/api/auth/login')
        .send({ email: user.email, password: TEST_PASSWORD });
      expect(login.body.activeOrganizationId).toBe(first.id);

      const switched = await agent
        .post('/api/auth/switch-organization')
        .send({ organizationId: second.id })
        .expect(200);

      expect(switched.body.activeOrganizationId).toBe(second.id);
      expect(switched.body.activeRole).toBe('VIEWER');

      const current = await agent.get('/api/organizations/current').expect(200);
      expect(current.body.id).toBe(second.id);
    });

    it('refuses an organization the user does not belong to', async () => {
      const { user } = await seedMember();
      const other = await createOrganization(prisma);
      organizationIds.push(other.id);

      const agent = request.agent(app.getHttpServer());
      await agent.post('/api/auth/login').send({ email: user.email, password: TEST_PASSWORD });

      const response = await agent
        .post('/api/auth/switch-organization')
        .send({ organizationId: other.id })
        .expect(403);

      expect(response.body.code).toBe('FORBIDDEN');
    });
  });
});
