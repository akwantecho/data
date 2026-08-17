import type { PrismaClient } from '@prisma/client';
import type { IndustryPackSyncResult } from '@sip/shared-types';
import { collectDependencies, parseFormula } from '../metrics/formula/formula';
import { PACK_CATALOGUE, validatedCatalogue, type PackDefinition } from './catalogue';
import { storedAlertRule, storedInsightRule } from './stored-rule';

/**
 * Writes the shipped catalogue into the database.
 *
 * Packs are stored as rows — an `industry_packs` row, template `metrics`
 * (`organization_id` null, `industry_id` set), a health model definition and rule
 * definitions — because the installer reads from the database, never from the
 * catalogue module. That is what keeps "a pack is data" true rather than
 * aspirational: a pack inserted by an administrator installs through exactly the
 * same path as a shipped one.
 *
 * A plain function rather than a Nest provider, so the seed script — which runs
 * outside the DI container with its own client — uses this same code.
 *
 * Idempotent: syncing an unchanged catalogue changes nothing.
 */
export async function syncPackCatalogue(
  prisma: PrismaClient,
  packs: PackDefinition[] = PACK_CATALOGUE,
): Promise<IndustryPackSyncResult> {
  const definitions = validatedCatalogue(packs);
  const result: IndustryPackSyncResult = { packs: [] };

  for (const definition of definitions) {
    const industry = await prisma.industry.findUnique({
      where: { code: definition.industryCode },
      select: { id: true },
    });

    if (!industry) {
      throw new Error(
        `Industry pack "${definition.code}" needs industry "${definition.industryCode}", which does not exist.`,
      );
    }

    const pack = await prisma.industryPack.upsert({
      where: { code: definition.code },
      update: {
        industryId: industry.id,
        name: definition.name,
        version: definition.version,
        description: definition.description,
        isActive: true,
      },
      create: {
        industryId: industry.id,
        code: definition.code,
        name: definition.name,
        version: definition.version,
        description: definition.description,
      },
      select: { id: true },
    });

    let created = 0;
    let updated = 0;

    // Template metrics are ordinary metric rows scoped to an industry rather than
    // an organization. Installing clones them, so a tenant's edits never reach the
    // template every other tenant installs from.
    for (const [index, metric] of definition.metrics.entries()) {
      const existing = await prisma.metric.findUnique({
        where: { industryId_code: { industryId: industry.id, code: metric.code } },
        select: { id: true },
      });

      const data = {
        industryId: industry.id,
        code: metric.code,
        name: metric.name,
        description: metric.description ?? null,
        category: metric.category,
        unit: metric.unit,
        aggregationType: metric.aggregationType,
        frequency: metric.frequency,
        direction: metric.direction,
        isSystem: true,
      };

      const template = existing
        ? await prisma.metric.update({ where: { id: existing.id }, data, select: { id: true } })
        : await prisma.metric.create({ data, select: { id: true } });

      if (existing) {
        updated += 1;
      } else {
        created += 1;
      }

      if (metric.formula) {
        // Parsed here as well as in the catalogue test, so a formula that reaches
        // the database is always one the engine can actually evaluate.
        const inputs = collectDependencies(parseFormula(metric.formula));

        await prisma.metricFormula.upsert({
          where: { metricId: template.id },
          create: { metricId: template.id, expression: metric.formula, inputs },
          update: { expression: metric.formula, inputs },
        });
      } else {
        await prisma.metricFormula.deleteMany({ where: { metricId: template.id } });
      }

      await prisma.industryPackMetric.upsert({
        where: { industryPackId_metricId: { industryPackId: pack.id, metricId: template.id } },
        create: { industryPackId: pack.id, metricId: template.id, displayOrder: index },
        update: { displayOrder: index },
      });
    }

    // The health model and the rules are stored as definitions; they become tenant
    // rows at install time, not before.
    const existingModel = await prisma.industryPackHealthModel.findFirst({
      where: { industryPackId: pack.id },
      select: { id: true },
    });

    if (existingModel) {
      await prisma.industryPackHealthModel.update({
        where: { id: existingModel.id },
        data: { name: definition.healthModel.name, definition: definition.healthModel },
      });
    } else {
      await prisma.industryPackHealthModel.create({
        data: {
          industryPackId: pack.id,
          name: definition.healthModel.name,
          definition: definition.healthModel,
        },
      });
    }

    const storedRules = [
      ...definition.insightRules.map((rule) => ({
        code: rule.code,
        name: rule.name,
        definition: storedInsightRule(rule),
      })),
      // Alert rules share the pack's rule table under a reserved code prefix. Both
      // are "rules this pack installs", and the prefix keeps an insight and an
      // alert that describe the same condition from colliding on one code.
      ...definition.alertRules.map((rule) => ({
        code: alertRuleCode(rule.code),
        name: rule.name,
        definition: storedAlertRule(rule),
      })),
    ];

    for (const rule of storedRules) {
      await prisma.industryPackInsightRule.upsert({
        where: { industryPackId_code: { industryPackId: pack.id, code: rule.code } },
        create: {
          industryPackId: pack.id,
          code: rule.code,
          name: rule.name,
          definition: rule.definition,
        },
        update: { name: rule.name, definition: rule.definition },
      });
    }

    // Anything the catalogue no longer defines goes, so a pack shrinking is as
    // reproducible as a pack growing.
    await prisma.industryPackInsightRule.deleteMany({
      where: {
        industryPackId: pack.id,
        code: { notIn: storedRules.map((rule) => rule.code) },
      },
    });

    result.packs.push({
      code: definition.code,
      version: definition.version,
      templateMetricsCreated: created,
      templateMetricsUpdated: updated,
      insightRules: definition.insightRules.length,
      alertRules: definition.alertRules.length,
    });
  }

  return result;
}

/** Prefix separating stored alert-rule definitions from insight-rule definitions. */
export const ALERT_RULE_PREFIX = 'alert:';

export function alertRuleCode(code: string): string {
  return `${ALERT_RULE_PREFIX}${code}`;
}
