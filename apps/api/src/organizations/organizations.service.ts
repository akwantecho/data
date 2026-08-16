import { Injectable } from '@nestjs/common';
import type { OrganizationSummary } from '@sip/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { ApiException } from '../common/errors/api-exception';
import { AuditService } from '../audit/audit.service';
import type { UpdateOrganizationDto } from './organizations.dto';

const ORGANIZATION_SELECT = {
  id: true,
  name: true,
  slug: true,
  industryId: true,
  countryCode: true,
  currencyCode: true,
  timezone: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  industry: { select: { name: true } },
} as const;

/**
 * Every method takes `organizationId` explicitly and filters on it. There is no
 * code path here that can read or write an organization the caller is not scoped
 * to (ADR-0002).
 */
@Injectable()
export class OrganizationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async findCurrent(organizationId: string): Promise<OrganizationSummary> {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: ORGANIZATION_SELECT,
    });

    if (!organization) {
      throw ApiException.notFound('Organization');
    }

    return toSummary(organization);
  }

  async updateCurrent(
    organizationId: string,
    actorId: string,
    dto: UpdateOrganizationDto,
    ipAddress?: string,
  ): Promise<OrganizationSummary> {
    const before = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: ORGANIZATION_SELECT,
    });

    if (!before) {
      throw ApiException.notFound('Organization');
    }

    const updated = await this.prisma.organization.update({
      where: { id: organizationId },
      data: dto,
      select: ORGANIZATION_SELECT,
    });

    await this.audit.record({
      actorId,
      organizationId,
      action: 'organization.updated',
      entityType: 'organization',
      entityId: organizationId,
      before: auditSnapshot(before),
      after: auditSnapshot(updated),
      ipAddress,
    });

    return toSummary(updated);
  }

  /**
   * Sets the industry, which decides which industry pack an organization gets.
   *
   * Plan §37: changing it once data exists is disabled for the MVP. Metrics,
   * targets and health models are all industry-derived, so a late switch would
   * leave reported history describing a model that no longer applies.
   */
  async setIndustry(
    organizationId: string,
    actorId: string,
    industryId: string,
    ipAddress?: string,
  ): Promise<OrganizationSummary> {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: ORGANIZATION_SELECT,
    });

    if (!organization) {
      throw ApiException.notFound('Organization');
    }

    const industry = await this.prisma.industry.findFirst({
      where: { id: industryId, isActive: true },
      select: { id: true },
    });

    if (!industry) {
      throw ApiException.validation('The request could not be processed.', [
        { field: 'industryId', message: 'Unknown industry' },
      ]);
    }

    if (organization.industryId === industryId) {
      return toSummary(organization);
    }

    if (organization.industryId && (await this.hasReportedData(organizationId))) {
      throw ApiException.conflict(
        'The industry cannot be changed after data has been imported. Contact platform support.',
      );
    }

    const updated = await this.prisma.organization.update({
      where: { id: organizationId },
      data: { industryId },
      select: ORGANIZATION_SELECT,
    });

    await this.audit.record({
      actorId,
      organizationId,
      action: 'organization.industry_changed',
      entityType: 'organization',
      entityId: organizationId,
      before: { industryId: organization.industryId },
      after: { industryId: updated.industryId },
      ipAddress,
    });

    return toSummary(updated);
  }

  /** Any stored measurement or import makes the industry choice load-bearing. */
  private async hasReportedData(organizationId: string): Promise<boolean> {
    const [values, imports] = await Promise.all([
      this.prisma.metricValue.count({ where: { organizationId }, take: 1 }),
      this.prisma.dataImport.count({ where: { organizationId }, take: 1 }),
    ]);

    return values > 0 || imports > 0;
  }
}

type OrganizationRow = {
  id: string;
  name: string;
  slug: string;
  industryId: string | null;
  countryCode: string;
  currencyCode: string;
  timezone: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  industry: { name: string } | null;
};

function toSummary(row: OrganizationRow): OrganizationSummary {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    industryId: row.industryId,
    industryName: row.industry?.name ?? null,
    countryCode: row.countryCode,
    currencyCode: row.currencyCode,
    timezone: row.timezone,
    status: row.status as OrganizationSummary['status'],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** The mutable fields only — an audit entry should show the change, not the row. */
function auditSnapshot(row: OrganizationRow) {
  return {
    name: row.name,
    countryCode: row.countryCode,
    currencyCode: row.currencyCode,
    timezone: row.timezone,
  };
}
