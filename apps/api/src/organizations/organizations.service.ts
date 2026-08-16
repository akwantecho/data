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
