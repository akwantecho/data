/* eslint-disable no-console */
import { PrismaClient } from '@prisma/client';
import { hash } from '@node-rs/argon2';
import { installPack, packForIndustry } from '../src/industry-packs/pack-install';
import { syncPackCatalogue } from '../src/industry-packs/pack-sync';

/**
 * Development seed.
 *
 * Creates the platform admin, three industries and three organizations with
 * members, branches, a CSV data source and a small set of universal metrics — so
 * sign-in, tenant isolation and the import wizard are all demonstrable straight
 * away. It then syncs the industry pack catalogue and installs each organization's
 * pack, exactly as choosing an industry through the API would.
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

/**
 * Universal core metrics every organization can report, whatever its industry.
 * Industry packs add their own on top (plan §17).
 */
const UNIVERSAL_METRICS = [
  {
    code: 'revenue',
    name: 'Revenue',
    unit: 'CURRENCY' as const,
    aggregationType: 'SUM' as const,
    direction: 'HIGHER_IS_BETTER' as const,
    category: 'Financial',
  },
  {
    code: 'expenses',
    name: 'Expenses',
    unit: 'CURRENCY' as const,
    aggregationType: 'SUM' as const,
    direction: 'LOWER_IS_BETTER' as const,
    category: 'Financial',
  },
  {
    code: 'customers',
    name: 'Customers',
    unit: 'COUNT' as const,
    aggregationType: 'SUM' as const,
    direction: 'HIGHER_IS_BETTER' as const,
    category: 'Growth',
  },
  {
    code: 'satisfaction_score',
    name: 'Satisfaction Score',
    unit: 'SCORE' as const,
    aggregationType: 'AVERAGE' as const,
    direction: 'HIGHER_IS_BETTER' as const,
    category: 'Customer',
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

  // Packs are data: this writes the shipped catalogue into the pack tables, and
  // every organization below is then installed from the database, not from code.
  const synced = await syncPackCatalogue(prisma);

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

    for (const metric of UNIVERSAL_METRICS) {
      await prisma.metric.upsert({
        where: { organizationId_code: { organizationId: organization.id, code: metric.code } },
        update: {},
        create: {
          organizationId: organization.id,
          code: metric.code,
          name: metric.name,
          unit: metric.unit,
          aggregationType: metric.aggregationType,
          direction: metric.direction,
          category: metric.category,
          frequency: 'MONTHLY',
        },
      });
    }

    // Choosing an industry installs its pack — the same path the API takes when an
    // administrator selects an industry in settings.
    const packId = await packForIndustry(prisma, industry.id);

    if (packId) {
      const { result } = await installPack(prisma, organization.id, packId);
      console.log(
        `  ${definition.name}: installed ${result.packCode} ` +
          `(+${result.metricsCreated} metrics, ${result.metricsKept} kept, ` +
          `${result.insightRulesCreated} insight rules, ${result.alertRulesCreated} alert rules)`,
      );
    }

    const existingSource = await prisma.dataSource.findFirst({
      where: { organizationId: organization.id, name: 'Monthly CSV upload' },
    });

    if (!existingSource) {
      await prisma.dataSource.create({
        data: { organizationId: organization.id, name: 'Monthly CSV upload', type: 'CSV' },
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
  console.log(`  Industry packs synced: ${synced.packs.map((pack) => pack.code).join(', ')}`);
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
