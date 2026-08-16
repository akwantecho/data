/* eslint-disable no-console */
import { PrismaClient } from '@prisma/client';
import { hash } from '@node-rs/argon2';

/**
 * Development seed (Sprint 1 scope: identity and tenancy).
 *
 * Creates the platform admin, three industries and three organizations with
 * members, so the login flow and tenant isolation are demonstrable immediately.
 * Metrics, imports and industry pack content are seeded in later sprints.
 *
 * Idempotent: safe to run repeatedly.
 */
const prisma = new PrismaClient();

const DEV_PASSWORD = process.env.SEED_PASSWORD ?? 'Password123!';

const ARGON2_OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

const INDUSTRIES = [
  { code: 'healthcare', name: 'Healthcare', description: 'Clinics, hospitals and medical groups' },
  { code: 'hospitality', name: 'Hospitality & Tourism', description: 'Hotels, resorts and travel' },
  { code: 'real_estate', name: 'Real Estate', description: 'Property management and leasing' },
];

const ORGANIZATIONS = [
  {
    slug: 'alpha-medical',
    name: 'Alpha Medical Group',
    industry: 'healthcare',
    countryCode: 'OM',
    currencyCode: 'OMR',
    timezone: 'Asia/Muscat',
    branches: [
      { code: 'muscat', name: 'Muscat Clinic' },
      { code: 'salalah', name: 'Salalah Clinic' },
    ],
  },
  {
    slug: 'azure-resorts',
    name: 'Azure Coast Resorts',
    industry: 'hospitality',
    countryCode: 'OM',
    currencyCode: 'OMR',
    timezone: 'Asia/Muscat',
    branches: [
      { code: 'seeb', name: 'Seeb Beach Resort' },
      { code: 'nizwa', name: 'Nizwa Heritage Hotel' },
    ],
  },
  {
    slug: 'meridian-estates',
    name: 'Meridian Estates',
    industry: 'real_estate',
    countryCode: 'AE',
    currencyCode: 'AED',
    timezone: 'Asia/Dubai',
    branches: [
      { code: 'downtown', name: 'Downtown Portfolio' },
      { code: 'marina', name: 'Marina Portfolio' },
    ],
  },
];

async function main(): Promise<void> {
  const passwordHash = await hash(DEV_PASSWORD, ARGON2_OPTIONS);

  await prisma.user.upsert({
    where: { email: 'platform@sip.local' },
    update: {},
    create: {
      email: 'platform@sip.local',
      fullName: 'Platform Administrator',
      passwordHash,
      platformRole: 'PLATFORM_ADMIN',
    },
  });

  for (const industry of INDUSTRIES) {
    await prisma.industry.upsert({
      where: { code: industry.code },
      update: { name: industry.name, description: industry.description },
      create: industry,
    });
  }

  for (const definition of ORGANIZATIONS) {
    const industry = await prisma.industry.findUniqueOrThrow({
      where: { code: definition.industry },
    });

    const organization = await prisma.organization.upsert({
      where: { slug: definition.slug },
      update: {},
      create: {
        name: definition.name,
        slug: definition.slug,
        industryId: industry.id,
        countryCode: definition.countryCode,
        currencyCode: definition.currencyCode,
        timezone: definition.timezone,
      },
    });

    for (const branch of definition.branches) {
      await prisma.branch.upsert({
        where: { organizationId_code: { organizationId: organization.id, code: branch.code } },
        update: { name: branch.name },
        create: { organizationId: organization.id, code: branch.code, name: branch.name },
      });
    }

    const members = [
      {
        email: `admin@${definition.slug}.local`,
        name: 'Organization Admin',
        role: 'ORGANIZATION_ADMIN' as const,
      },
      { email: `analyst@${definition.slug}.local`, name: 'Data Analyst', role: 'ANALYST' as const },
      { email: `viewer@${definition.slug}.local`, name: 'Report Viewer', role: 'VIEWER' as const },
    ];

    for (const member of members) {
      const user = await prisma.user.upsert({
        where: { email: member.email },
        update: {},
        create: { email: member.email, fullName: member.name, passwordHash },
      });

      await prisma.organizationUser.upsert({
        where: {
          organizationId_userId: { organizationId: organization.id, userId: user.id },
        },
        update: { role: member.role },
        create: {
          organizationId: organization.id,
          userId: user.id,
          role: member.role,
          isDefault: true,
        },
      });
    }
  }

  console.log('Seed complete.');
  console.log(`  Platform admin: platform@sip.local / ${DEV_PASSWORD}`);
  for (const organization of ORGANIZATIONS) {
    console.log(`  ${organization.name}: admin@${organization.slug}.local / ${DEV_PASSWORD}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
