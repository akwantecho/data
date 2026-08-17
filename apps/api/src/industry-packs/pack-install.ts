import type { Prisma, PrismaClient } from '@prisma/client';
import type { IndustryPackInstallResult } from '@sip/shared-types';
import { ApiException } from '../common/errors/api-exception';
import { collectDependencies, parseFormula } from '../metrics/formula/formula';
import { packHealthModelSchema } from './catalogue/pack-definition';
import { parseStoredRules } from './stored-rule';

/**
 * Installing an industry pack into an organization (plan §17).
 *
 * Two rules shape everything here:
 *
 * 1. **Clone, never reference.** Template metrics are copied into the tenant, so
 *    an organization can rename, recategorise or deactivate its own copy without
 *    touching the template every other tenant installs from.
 * 2. **Never overwrite.** Anything already present under the same code is left
 *    exactly as the tenant has it. Installing is therefore repeatable — a pack
 *    that gains a metric can be re-installed to pick it up — and a customization
 *    can never be silently undone by an install.
 *
 * The whole installation is one transaction: a tenant is never left holding half
 * a pack.
 *
 * A plain function rather than a Nest provider, so the seed installs through the
 * same code the API does. The service around it adds the audit entry.
 */
export async function installPack(
  prisma: PrismaClient,
  organizationId: string,
  packId: string,
): Promise<{ result: IndustryPackInstallResult; packId: string }> {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { id: true, industryId: true },
  });

  if (!organization) {
    throw ApiException.notFound('Organization');
  }

  const pack = await prisma.industryPack.findFirst({
    where: { id: packId, isActive: true },
    select: {
      id: true,
      code: true,
      version: true,
      industryId: true,
      packMetrics: {
        orderBy: { displayOrder: 'asc' },
        select: {
          metric: {
            select: {
              code: true,
              name: true,
              description: true,
              category: true,
              unit: true,
              aggregationType: true,
              frequency: true,
              direction: true,
              formula: { select: { expression: true } },
            },
          },
        },
      },
      healthModels: { select: { name: true, definition: true }, take: 1 },
      insightRules: { select: { code: true, name: true, definition: true } },
    },
  });

  if (!pack) {
    throw ApiException.notFound('Industry pack');
  }

  // A pack belongs to exactly one industry, and an organization may only install
  // the pack for its own. This is the tenancy boundary for pack content: no
  // organization can pull another industry's configuration into itself.
  if (organization.industryId !== pack.industryId) {
    throw ApiException.notFound('Industry pack');
  }

  const result = await prisma.$transaction(async (tx) => {
    const metrics = await installMetrics(tx, organizationId, pack.packMetrics);
    const health = await installHealthModel(
      tx,
      organizationId,
      pack.healthModels[0] ?? null,
      metrics.idsByCode,
    );
    const rules = await installRules(tx, organizationId, pack.insightRules, metrics.idsByCode);

    await tx.organizationIndustryPack.upsert({
      where: { organizationId_industryPackId: { organizationId, industryPackId: pack.id } },
      create: { organizationId, industryPackId: pack.id, version: pack.version },
      update: { version: pack.version },
    });

    return {
      packCode: pack.code,
      version: pack.version,
      metricsCreated: metrics.created,
      metricsKept: metrics.kept,
      healthModelCreated: health.created,
      healthCategoriesCreated: health.categories,
      insightRulesCreated: rules.insightsCreated,
      insightRulesKept: rules.insightsKept,
      alertRulesCreated: rules.alertsCreated,
      alertRulesKept: rules.alertsKept,
    } satisfies IndustryPackInstallResult;
  });

  return { result, packId: pack.id };
}

/** The pack published for an industry, if any. */
export async function packForIndustry(
  prisma: PrismaClient,
  industryId: string,
): Promise<string | null> {
  const pack = await prisma.industryPack.findFirst({
    where: { industryId, isActive: true },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });

  return pack?.id ?? null;
}

/**
 * Clones template metrics, then wires up formulas once every code exists —
 * a formula metric may reference a metric that comes later in the same pack.
 */
async function installMetrics(
  tx: Prisma.TransactionClient,
  organizationId: string,
  packMetrics: Array<{ metric: TemplateMetric }>,
): Promise<{ created: number; kept: number; idsByCode: Map<string, string> }> {
  const existing = await tx.metric.findMany({
    where: { organizationId },
    select: { id: true, code: true },
  });

  const idsByCode = new Map(existing.map((metric) => [metric.code, metric.id]));
  const createdCodes: string[] = [];

  for (const { metric } of packMetrics) {
    if (idsByCode.has(metric.code)) {
      continue;
    }

    const created = await tx.metric.create({
      data: {
        organizationId,
        code: metric.code,
        name: metric.name,
        description: metric.description,
        category: metric.category,
        unit: metric.unit,
        aggregationType: metric.aggregationType,
        frequency: metric.frequency,
        direction: metric.direction,
        isSystem: true,
      },
      select: { id: true },
    });

    idsByCode.set(metric.code, created.id);
    createdCodes.push(metric.code);
  }

  for (const { metric } of packMetrics) {
    if (!metric.formula || !createdCodes.includes(metric.code)) {
      continue;
    }

    const metricId = idsByCode.get(metric.code) as string;
    const inputs = collectDependencies(parseFormula(metric.formula.expression));

    await tx.metricFormula.create({
      data: { metricId, expression: metric.formula.expression, inputs },
    });

    for (const input of inputs) {
      const dependsOnId = idsByCode.get(input);

      // Cannot happen for a synced pack — the catalogue schema rejects a formula
      // that reaches outside its own pack — but a hand-inserted pack could, and
      // a dangling dependency row would be worse than a missing one.
      if (!dependsOnId) {
        throw ApiException.conflict(
          `The pack metric "${metric.code}" refers to "${input}", which the pack does not install.`,
        );
      }

      await tx.metricDependency.create({ data: { metricId, dependsOnId } });
    }
  }

  return {
    created: createdCodes.length,
    kept: packMetrics.length - createdCodes.length,
    idsByCode,
  };
}

/**
 * Materialises the health model. An organization that already has one keeps it:
 * weights are the most likely thing for a tenant to have tuned.
 */
async function installHealthModel(
  tx: Prisma.TransactionClient,
  organizationId: string,
  stored: { name: string; definition: unknown } | null,
  idsByCode: Map<string, string>,
): Promise<{ created: boolean; categories: number }> {
  if (!stored) {
    return { created: false, categories: 0 };
  }

  const existing = await tx.healthModel.findFirst({
    where: { organizationId },
    select: { id: true },
  });

  if (existing) {
    return { created: false, categories: 0 };
  }

  const parsed = packHealthModelSchema.safeParse(stored.definition);

  if (!parsed.success) {
    throw ApiException.conflict('The pack health model is not valid and cannot be installed.');
  }

  const model = await tx.healthModel.create({
    data: { organizationId, name: parsed.data.name },
    select: { id: true },
  });

  for (const [index, category] of parsed.data.categories.entries()) {
    const created = await tx.healthCategory.create({
      data: {
        healthModelId: model.id,
        code: category.code,
        name: category.name,
        weight: category.weight,
        displayOrder: index,
      },
      select: { id: true },
    });

    for (const weight of category.metrics) {
      const metricId = idsByCode.get(weight.code);

      if (!metricId) {
        throw ApiException.conflict(
          `The pack health model weighs "${weight.code}", which the pack does not install.`,
        );
      }

      await tx.healthMetricWeight.create({
        data: { healthCategoryId: created.id, metricId, weight: weight.weight },
      });
    }
  }

  return { created: true, categories: parsed.data.categories.length };
}

/** Insight and alert rules, each skipped if the tenant already has that code. */
async function installRules(
  tx: Prisma.TransactionClient,
  organizationId: string,
  stored: Array<{ code: string; name: string; definition: unknown }>,
  idsByCode: Map<string, string>,
): Promise<{
  insightsCreated: number;
  insightsKept: number;
  alertsCreated: number;
  alertsKept: number;
}> {
  const counts = { insightsCreated: 0, insightsKept: 0, alertsCreated: 0, alertsKept: 0 };
  const { insights, alerts, invalid } = parseStoredRules(stored);

  if (invalid.length > 0) {
    throw ApiException.conflict(
      `The pack contains rules that are no longer valid: ${invalid.join(', ')}.`,
    );
  }

  const [existingInsights, existingAlerts] = await Promise.all([
    tx.insightRule.findMany({ where: { organizationId }, select: { code: true } }),
    tx.alertRule.findMany({ where: { organizationId }, select: { code: true } }),
  ]);

  const insightCodes = new Set(existingInsights.map((rule) => rule.code));
  const alertCodes = new Set(existingAlerts.map((rule) => rule.code));

  for (const rule of insights) {
    if (insightCodes.has(rule.code)) {
      counts.insightsKept += 1;
      continue;
    }

    await tx.insightRule.create({
      data: {
        organizationId,
        code: rule.code,
        name: rule.name,
        description: rule.description ?? null,
        definition: {
          severity: rule.severity,
          category: rule.category ?? null,
          ...rule.definition,
        },
      },
    });

    counts.insightsCreated += 1;
  }

  for (const rule of alerts) {
    if (alertCodes.has(rule.code)) {
      counts.alertsKept += 1;
      continue;
    }

    await tx.alertRule.create({
      data: {
        organizationId,
        code: rule.code,
        name: rule.name,
        description: rule.description ?? null,
        metricId: idsByCode.get(rule.metric) ?? null,
        type: rule.type,
        severity: rule.severity,
        definition: rule.definition,
      },
    });

    counts.alertsCreated += 1;
  }

  return counts;
}

interface TemplateMetric {
  code: string;
  name: string;
  description: string | null;
  category: string | null;
  unit: Prisma.MetricCreateInput['unit'];
  aggregationType: Prisma.MetricCreateInput['aggregationType'];
  frequency: Prisma.MetricCreateInput['frequency'];
  direction: Prisma.MetricCreateInput['direction'];
  formula: { expression: string } | null;
}
