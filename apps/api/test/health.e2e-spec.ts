import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/errors/all-exceptions.filter';

/**
 * Sprint 0 smoke test: the application boots against a real PostgreSQL instance
 * and the health endpoint reports a live database connection.
 */
describe('Health (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('GET /api/health returns ok with a reachable database', async () => {
    const response = await request(app.getHttpServer()).get('/api/health').expect(200);

    expect(response.body).toMatchObject({
      status: 'ok',
      service: 'strategic-intelligence-api',
      checks: { database: 'up' },
    });
    expect(typeof response.body.uptimeSeconds).toBe('number');
  });

  it('returns the standard error envelope for unknown routes', async () => {
    const response = await request(app.getHttpServer()).get('/api/does-not-exist').expect(404);

    expect(response.body).toEqual({
      code: 'NOT_FOUND',
      message: expect.any(String),
      details: [],
    });
    expect(response.body).not.toHaveProperty('stack');
  });
});
