import { Injectable } from '@nestjs/common';
import type { OrganizationStatus, Paginated, PlatformOrganizationSummary } from '@sip/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { ApiException } from '../common/errors/api-exception';
import { AuditService } from '../audit/audit.service';

/**
 * Platform administration (plan §36).
 *
 * These queries intentionally cross tenants — that is the whole point of the
 * platform role — which is why every route here is `@PlatformAdminOnly()` and no
 * tenant session can ever reach them.
 */
@Injectable()
export class PlatformService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async listOrganizations(
    page: number,
    pageSize: number,
  ): Promise<Paginated<PlatformOrganizationSummary>> {
    const [rows, total] = await Promise.all([
      this.prisma.organization.findMany({
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          name: true,
          slug: true,
          countryCode: true,
          currencyCode: true,
          status: true,
          createdAt: true,
          industry: { select: { name: true } },
          _count: { select: { members: true } },
        },
      }),
      this.prisma.organization.count(),
    ]);

    return {
      items: rows.map((row) => ({
        id: row.id,
        name: row.name,
        slug: row.slug,
        industryName: row.industry?.name ?? null,
        countryCode: row.countryCode,
        currencyCode: row.currencyCode,
        status: row.status,
        memberCount: row._count.members,
        createdAt: row.createdAt.toISOString(),
      })),
      page,
      pageSize,
      total,
    };
  }

  /** Activating or suspending a tenant. Suspension takes effect on the next request. */
  async setOrganizationStatus(
    organizationId: string,
    status: OrganizationStatus,
    actorId: string,
    ipAddress?: string,
  ): Promise<PlatformOrganizationSummary> {
    const before = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { status: true },
    });

    if (!before) {
      throw ApiException.notFound('Organization');
    }

    const updated = await this.prisma.organization.update({
      where: { id: organizationId },
      data: { status },
      select: {
        id: true,
        name: true,
        slug: true,
        countryCode: true,
        currencyCode: true,
        status: true,
        createdAt: true,
        industry: { select: { name: true } },
        _count: { select: { members: true } },
      },
    });

    await this.audit.record({
      actorId,
      organizationId,
      action: 'platform.organization.status_changed',
      entityType: 'organization',
      entityId: organizationId,
      before: { status: before.status },
      after: { status: updated.status },
      ipAddress,
    });

    return {
      id: updated.id,
      name: updated.name,
      slug: updated.slug,
      industryName: updated.industry?.name ?? null,
      countryCode: updated.countryCode,
      currencyCode: updated.currencyCode,
      status: updated.status,
      memberCount: updated._count.members,
      createdAt: updated.createdAt.toISOString(),
    };
  }
}
