import { Test } from '@nestjs/testing';
import { HealthService } from './health.service';
import { PrismaService } from '../prisma/prisma.service';

describe('HealthService', () => {
  const buildService = async (reachable: boolean) => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        HealthService,
        {
          provide: PrismaService,
          useValue: { isReachable: jest.fn().mockResolvedValue(reachable) },
        },
      ],
    }).compile();

    return moduleRef.get(HealthService);
  };

  it('reports ok when the database is reachable', async () => {
    const result = await (await buildService(true)).check();

    expect(result.status).toBe('ok');
    expect(result.checks.database).toBe('up');
    expect(result.service).toBe('strategic-intelligence-api');
  });

  it('reports degraded when the database is unreachable', async () => {
    const result = await (await buildService(false)).check();

    expect(result.status).toBe('degraded');
    expect(result.checks.database).toBe('down');
  });
});
