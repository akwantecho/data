import type { INestApplication } from '@nestjs/common';
import request from 'supertest';

/**
 * The only suite that runs with rate limiting switched on (plan §44).
 *
 * The application is imported dynamically, after the environment is set, because
 * `ConfigModule.forRoot()` validates the environment when the module is imported —
 * a static import would be evaluated before the assignment below.
 */
describe('Rate limiting (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    process.env.THROTTLE_ENABLED = 'true';
    const { createTestApp } = await import('./helpers/test-app');
    ({ app } = await createTestApp({ rateLimiting: true }));
  });

  afterAll(async () => {
    process.env.THROTTLE_ENABLED = 'false';
    await app?.close();
  });

  it('blocks brute-force attempts against login with a safe error envelope', async () => {
    const attempt = () =>
      request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'attacker@example.test', password: 'GuessNumber1!' });

    let blocked: request.Response | undefined;

    // The login handler allows 10 attempts per minute per IP.
    for (let index = 0; index < 15 && !blocked; index += 1) {
      const response = await attempt();
      if (response.status === 429) {
        blocked = response;
      }
    }

    expect(blocked).toBeDefined();
    expect(blocked?.body).toMatchObject({ code: 'RATE_LIMITED' });
    expect(blocked?.body).not.toHaveProperty('stack');
  });

  it('leaves the health endpoint reachable for monitoring', async () => {
    await request(app.getHttpServer()).get('/api/health').expect(200);
  });
});
