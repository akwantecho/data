import { Injectable } from '@nestjs/common';
import type {
  IndustryPackDetail,
  IndustryPackOverview,
  IndustryPackRuleSummary,
  IndustryPackSummary,
  IndustryPackSyncResult,
  InstalledHealthModelSummary,
} from '@sip/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { ApiException } from '../common/errors/api-exception';
import { AuditService } from '../audit/audit.service';
import { packHealthModelSchema } from './catalogue/pack-definition';
import { syncPackCatalogue } from './pack-sync';
import { parseStoredRules } from './stored-rule';

const PACK_SELECT = {
  id: true,
  code: true,
  name: true,
  description: true,
  version: true,
  industryId: true,
  industry: { select: { name: true } },
  healthModels: { select: { definition: true }, take: 1 },
  insightRules: { select: { code: true, name: true, definition: true } },
  _count: { select: { packMetrics: true } },
} as const;

/**
 * Reading industry packs.
 *
 * Two audiences: platform staff, who see every pack, and tenants, who see only
 * the pack for their own industry (plan §17 — "no organization receives another
 * industry's private configuration"). The tenant-facing methods take an
 * organization id and filter on its industry; there is no code path that returns
 * a pack from another industry to a tenant.
 */
@Injectable()
export class IndustryPacksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Platform view: every published pack. */
  async listAll(): Promise<IndustryPackSummary[]> {
    const packs = await this.prisma.industryPack.findMany({
      orderBy: [{ industry: { name: 'asc' } }, { name: 'asc' }],
      select: PACK_SELECT,
    });

    return packs.map((pack) => toSummary(pack, null));
  }

  async getForPlatform(packId: string): Promise<IndustryPackDetail> {
    const pack = await this.prisma.industryPack.findUnique({
      where: { id: packId },
      select: { ...PACK_SELECT, ...PACK_METRICS_SELECT },
    });

    if (!pack) {
      throw ApiException.notFound('Industry pack');
    }

    return toDetail(pack, null);
  }

  /** Tenant view: packs published for this organization's industry, and only those. */
  async getForPlatformOrTenant(
    packId: string,
    organizationId: string,
  ): Promise<IndustryPackDetail> {
    const organization = await this.organizationIndustry(organizationId);

    const pack = await this.prisma.industryPack.findFirst({
      where: { id: packId, isActive: true, industryId: organization.industryId ?? '' },
      select: { ...PACK_SELECT, ...PACK_METRICS_SELECT },
    });

    if (!pack) {
      throw ApiException.notFound('Industry pack');
    }

    const installation = await this.prisma.organizationIndustryPack.findUnique({
      where: { organizationId_industryPackId: { organizationId, industryPackId: pack.id } },
      select: { version: true, installedAt: true },
    });

    return toDetail(pack, installation);
  }

  /**
   * Everything the organization settings card needs: which pack applies, whether
   * it is installed, and what the installation produced.
   */
  async overview(organizationId: string): Promise<IndustryPackOverview> {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { industryId: true, industry: { select: { name: true } } },
    });

    if (!organization) {
      throw ApiException.notFound('Organization');
    }

    if (!organization.industryId) {
      return {
        industryId: null,
        industryName: null,
        available: [],
        healthModel: null,
        insightRuleCount: 0,
        alertRuleCount: 0,
        systemMetricCount: 0,
      };
    }

    const [packs, installations, healthModel, insightRuleCount, alertRuleCount, systemMetricCount] =
      await Promise.all([
        this.prisma.industryPack.findMany({
          where: { industryId: organization.industryId, isActive: true },
          orderBy: { name: 'asc' },
          select: PACK_SELECT,
        }),
        this.prisma.organizationIndustryPack.findMany({
          where: { organizationId },
          select: { industryPackId: true, version: true, installedAt: true },
        }),
        this.installedHealthModel(organizationId),
        this.prisma.insightRule.count({ where: { organizationId } }),
        this.prisma.alertRule.count({ where: { organizationId } }),
        this.prisma.metric.count({ where: { organizationId, isSystem: true } }),
      ]);

    const byPack = new Map(installations.map((row) => [row.industryPackId, row]));

    return {
      industryId: organization.industryId,
      industryName: organization.industry?.name ?? null,
      available: packs.map((pack) => toSummary(pack, byPack.get(pack.id) ?? null)),
      healthModel,
      insightRuleCount,
      alertRuleCount,
      systemMetricCount,
    };
  }

  /** The organization's own health model, as installed and possibly since edited. */
  async installedHealthModel(organizationId: string): Promise<InstalledHealthModelSummary | null> {
    const model = await this.prisma.healthModel.findFirst({
      where: { organizationId, isActive: true },
      select: {
        id: true,
        name: true,
        categories: {
          orderBy: { displayOrder: 'asc' },
          select: {
            code: true,
            name: true,
            weight: true,
            weights: {
              select: {
                weight: true,
                metric: { select: { code: true, name: true } },
              },
            },
          },
        },
      },
    });

    if (!model) {
      return null;
    }

    return {
      id: model.id,
      name: model.name,
      categories: model.categories.map((category) => ({
        code: category.code,
        name: category.name,
        weight: category.weight.toString(),
        metrics: category.weights.map((weight) => ({
          code: weight.metric.code,
          name: weight.metric.name,
          weight: weight.weight.toString(),
        })),
      })),
    };
  }

  /** Platform admin: re-read the shipped catalogue into the database. */
  async sync(actorId: string, ipAddress?: string): Promise<IndustryPackSyncResult> {
    const result = await syncPackCatalogue(this.prisma);

    await this.audit.record({
      actorId,
      organizationId: null,
      action: 'platform.industry_packs.synced',
      entityType: 'industry_pack',
      entityId: null,
      after: { packs: result.packs },
      ipAddress,
    });

    return result;
  }

  private async organizationIndustry(
    organizationId: string,
  ): Promise<{ industryId: string | null }> {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { industryId: true },
    });

    if (!organization) {
      throw ApiException.notFound('Organization');
    }

    return organization;
  }
}

const PACK_METRICS_SELECT = {
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
} as const;

interface PackRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  version: string;
  industryId: string;
  industry: { name: string };
  healthModels: Array<{ definition: unknown }>;
  insightRules: Array<{ code: string; name: string; definition: unknown }>;
  _count: { packMetrics: number };
}

type Installation = { version: string; installedAt: Date } | null;

function toSummary(pack: PackRow, installation: Installation): IndustryPackSummary {
  const rules = splitRules(pack.insightRules);

  return {
    id: pack.id,
    code: pack.code,
    name: pack.name,
    description: pack.description,
    version: pack.version,
    industryId: pack.industryId,
    industryName: pack.industry.name,
    metricCount: pack._count.packMetrics,
    insightRuleCount: rules.insights.length,
    alertRuleCount: rules.alerts.length,
    healthCategoryCount: healthCategories(pack.healthModels[0]?.definition).length,
    installedVersion: installation?.version ?? null,
    installedAt: installation?.installedAt.toISOString() ?? null,
  };
}

function toDetail(
  pack: PackRow & {
    packMetrics: Array<{
      metric: {
        code: string;
        name: string;
        description: string | null;
        category: string | null;
        unit: IndustryPackDetail['metrics'][number]['unit'];
        aggregationType: IndustryPackDetail['metrics'][number]['aggregationType'];
        frequency: IndustryPackDetail['metrics'][number]['frequency'];
        direction: IndustryPackDetail['metrics'][number]['direction'];
        formula: { expression: string } | null;
      };
    }>;
  },
  installation: Installation,
): IndustryPackDetail {
  const rules = splitRules(pack.insightRules);
  const categories = healthCategories(pack.healthModels[0]?.definition);
  const healthModelName = healthModelLabel(pack.healthModels[0]?.definition);

  return {
    ...toSummary(pack, installation),
    metrics: pack.packMetrics.map(({ metric }) => ({
      code: metric.code,
      name: metric.name,
      description: metric.description,
      category: metric.category,
      unit: metric.unit,
      aggregationType: metric.aggregationType,
      frequency: metric.frequency,
      direction: metric.direction,
      formula: metric.formula?.expression ?? null,
    })),
    healthModel: categories.length
      ? {
          name: healthModelName,
          categories: categories.map((category) => ({
            code: category.code,
            name: category.name,
            weight: category.weight.toString(),
            metrics: category.metrics.map((metric) => ({
              code: metric.code,
              weight: metric.weight.toString(),
            })),
          })),
        }
      : null,
    insightRules: rules.insights,
    alertRules: rules.alerts,
  };
}

/** Pack rules share one table; each row records which kind it holds. */
function splitRules(rows: Array<{ code: string; name: string; definition: unknown }>): {
  insights: IndustryPackRuleSummary[];
  alerts: IndustryPackRuleSummary[];
} {
  const parsed = parseStoredRules(rows);

  return {
    insights: parsed.insights.map((rule) => ({
      code: rule.code,
      name: rule.name,
      description: rule.description ?? null,
      severity: rule.severity,
      metrics: [
        ...new Set([
          ...rule.definition.conditions.map((condition) => condition.metric),
          ...rule.definition.evidence,
        ]),
      ],
    })),
    alerts: parsed.alerts.map((rule) => ({
      code: rule.code,
      name: rule.name,
      description: rule.description ?? null,
      severity: rule.severity,
      metrics: [rule.metric],
    })),
  };
}

function healthCategories(definition: unknown): Array<{
  code: string;
  name: string;
  weight: number;
  metrics: Array<{ code: string; weight: number }>;
}> {
  const parsed = packHealthModelSchema.safeParse(definition);

  return parsed.success ? parsed.data.categories : [];
}

function healthModelLabel(definition: unknown): string {
  const parsed = packHealthModelSchema.safeParse(definition);

  return parsed.success ? parsed.data.name : 'Health model';
}
