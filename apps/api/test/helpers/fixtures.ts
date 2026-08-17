import type { OrganizationRole, OrganizationStatus } from '@sip/shared-types';
import type { PrismaService } from '../../src/prisma/prisma.service';
import { testPasswordHash, unique } from './test-app';

export interface SeededOrganization {
  id: string;
  slug: string;
  name: string;
}

export interface SeededUser {
  id: string;
  email: string;
}

export async function createOrganization(
  prisma: PrismaService,
  options: { name?: string; status?: OrganizationStatus; industryId?: string } = {},
): Promise<SeededOrganization> {
  const slug = unique('org');

  const organization = await prisma.organization.create({
    data: {
      name: options.name ?? `Test ${slug}`,
      slug,
      countryCode: 'OM',
      currencyCode: 'OMR',
      timezone: 'Asia/Muscat',
      status: options.status ?? 'ACTIVE',
      industryId: options.industryId ?? null,
    },
  });

  return { id: organization.id, slug: organization.slug, name: organization.name };
}

export async function createUser(
  prisma: PrismaService,
  options: {
    platformRole?: 'PLATFORM_ADMIN';
    status?: 'ACTIVE' | 'DISABLED';
    memberships?: Array<{ organizationId: string; role: OrganizationRole; isDefault?: boolean }>;
  } = {},
): Promise<SeededUser> {
  const email = `${unique('user')}@example.test`;

  const user = await prisma.user.create({
    data: {
      email,
      fullName: 'Test User',
      passwordHash: await testPasswordHash(),
      platformRole: options.platformRole ?? null,
      status: options.status ?? 'ACTIVE',
      memberships: options.memberships
        ? {
            create: options.memberships.map((membership) => ({
              organizationId: membership.organizationId,
              role: membership.role,
              isDefault: membership.isDefault ?? false,
            })),
          }
        : undefined,
    },
  });

  return { id: user.id, email: user.email };
}
