import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { BranchSummary } from '@sip/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { ApiException } from '../common/errors/api-exception';
import { AuditService } from '../audit/audit.service';
import type { CreateBranchDto, UpdateBranchDto } from './branches.dto';

const BRANCH_SELECT = {
  id: true,
  name: true,
  code: true,
  countryCode: true,
  timezone: true,
  isActive: true,
  createdAt: true,
  _count: { select: { departments: true } },
} as const;

/**
 * Branches are tenant-owned: every query carries `organizationId`, so a branch id
 * from another organization simply does not resolve (ADR-0002).
 */
@Injectable()
export class BranchesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(organizationId: string, includeInactive: boolean): Promise<BranchSummary[]> {
    const branches = await this.prisma.branch.findMany({
      where: { organizationId, ...(includeInactive ? {} : { isActive: true }) },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      select: BRANCH_SELECT,
    });

    return branches.map(toSummary);
  }

  async findOne(organizationId: string, id: string): Promise<BranchSummary> {
    const branch = await this.prisma.branch.findFirst({
      where: { id, organizationId },
      select: BRANCH_SELECT,
    });

    if (!branch) {
      throw ApiException.notFound('Branch');
    }

    return toSummary(branch);
  }

  async create(
    organizationId: string,
    actorId: string,
    dto: CreateBranchDto,
    ipAddress?: string,
  ): Promise<BranchSummary> {
    const branch = await this.prisma.branch
      .create({
        data: {
          organizationId,
          name: dto.name,
          code: dto.code,
          countryCode: dto.countryCode ?? null,
          timezone: dto.timezone ?? null,
        },
        select: BRANCH_SELECT,
      })
      .catch((error: unknown) => {
        throw translateUniqueViolation(error, dto.code);
      });

    await this.audit.record({
      actorId,
      organizationId,
      action: 'branch.created',
      entityType: 'branch',
      entityId: branch.id,
      after: { name: branch.name, code: branch.code },
      ipAddress,
    });

    return toSummary(branch);
  }

  async update(
    organizationId: string,
    id: string,
    actorId: string,
    dto: UpdateBranchDto,
    ipAddress?: string,
  ): Promise<BranchSummary> {
    const before = await this.prisma.branch.findFirst({
      where: { id, organizationId },
      select: BRANCH_SELECT,
    });

    if (!before) {
      throw ApiException.notFound('Branch');
    }

    // Scoped by organization as well as id: an id alone must never be enough.
    const updated = await this.prisma.branch
      .update({ where: { id: before.id }, data: dto, select: BRANCH_SELECT })
      .catch((error: unknown) => {
        throw translateUniqueViolation(error, dto.code ?? before.code);
      });

    await this.audit.record({
      actorId,
      organizationId,
      action: 'branch.updated',
      entityType: 'branch',
      entityId: id,
      before: snapshot(before),
      after: snapshot(updated),
      ipAddress,
    });

    return toSummary(updated);
  }

  /**
   * Deletes a branch that carries no history.
   *
   * Once metric values or departments reference it, deleting would silently
   * destroy reported numbers, so the caller is told to deactivate instead. This is
   * the "do not silently discard data" rule applied to structure.
   */
  async remove(
    organizationId: string,
    id: string,
    actorId: string,
    ipAddress?: string,
  ): Promise<void> {
    const branch = await this.prisma.branch.findFirst({
      where: { id, organizationId },
      select: {
        id: true,
        name: true,
        code: true,
        _count: { select: { departments: true, metricValues: true } },
      },
    });

    if (!branch) {
      throw ApiException.notFound('Branch');
    }

    if (branch._count.departments > 0) {
      throw ApiException.conflict(
        'This branch still has departments. Move or remove them first, or deactivate the branch instead.',
      );
    }

    if (branch._count.metricValues > 0) {
      throw ApiException.conflict(
        'This branch has reported data and cannot be deleted. Deactivate it instead.',
      );
    }

    await this.prisma.branch.delete({ where: { id: branch.id } });

    await this.audit.record({
      actorId,
      organizationId,
      action: 'branch.deleted',
      entityType: 'branch',
      entityId: id,
      before: { name: branch.name, code: branch.code },
      ipAddress,
    });
  }
}

type BranchRow = {
  id: string;
  name: string;
  code: string;
  countryCode: string | null;
  timezone: string | null;
  isActive: boolean;
  createdAt: Date;
  _count: { departments: number };
};

function toSummary(row: BranchRow): BranchSummary {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    countryCode: row.countryCode,
    timezone: row.timezone,
    isActive: row.isActive,
    departmentCount: row._count.departments,
    createdAt: row.createdAt.toISOString(),
  };
}

function snapshot(row: BranchRow) {
  return {
    name: row.name,
    code: row.code,
    countryCode: row.countryCode,
    timezone: row.timezone,
    isActive: row.isActive,
  };
}

/** Turns the composite (organizationId, code) violation into a usable message. */
export function translateUniqueViolation(error: unknown, code: string): unknown {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    return ApiException.conflict(`The code "${code}" is already used in this organization.`);
  }

  return error;
}
