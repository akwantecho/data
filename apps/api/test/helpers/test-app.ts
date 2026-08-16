import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { hash } from '@node-rs/argon2';
import { AppModule } from '../../src/app.module';
import { AllExceptionsFilter } from '../../src/common/errors/all-exceptions.filter';
import { PrismaService } from '../../src/prisma/prisma.service';

/**
 * Boots the real application (real auth guards, real Prisma) against the
 * configured database. Integration tests must exercise the same stack production
 * runs.
 *
 * Rate limiting is off by default: a suite signs in dozens of times from one IP
 * and would otherwise trip the login limit. `rate-limit.e2e-spec.ts` keeps the
 * real guard and asserts the limit is enforced.
 */
export async function createTestApp(
  options: { rateLimiting?: boolean } = {},
): Promise<{ app: INestApplication; prisma: PrismaService }> {
  process.env.THROTTLE_ENABLED = options.rateLimiting ? 'true' : 'false';

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

  const app = moduleRef.createNestApplication();
  app.use(cookieParser());
  app.setGlobalPrefix('api');
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.init();

  return { app, prisma: app.get(PrismaService) };
}

const ARGON2_OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export const TEST_PASSWORD = 'IntegrationPassword1!';

let cachedHash: string | undefined;

export async function testPasswordHash(): Promise<string> {
  cachedHash ??= await hash(TEST_PASSWORD, ARGON2_OPTIONS);
  return cachedHash;
}

/** Unique suffix so parallel or repeated runs never collide on unique columns. */
export function unique(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Removes everything a fixture created, children first. */
export async function cleanupFixtures(
  prisma: PrismaService,
  ids: { organizationIds: string[]; userIds: string[] },
): Promise<void> {
  await prisma.auditLog.deleteMany({
    where: {
      OR: [{ organizationId: { in: ids.organizationIds } }, { actorId: { in: ids.userIds } }],
    },
  });
  await prisma.refreshToken.deleteMany({ where: { userId: { in: ids.userIds } } });
  await prisma.organizationUser.deleteMany({
    where: { organizationId: { in: ids.organizationIds } },
  });
  await prisma.organization.deleteMany({ where: { id: { in: ids.organizationIds } } });
  await prisma.user.deleteMany({ where: { id: { in: ids.userIds } } });
}
