import { Injectable } from '@nestjs/common';
import type { DepartmentSummary } from '@sip/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { ApiException } from '../common/errors/api-exception';
import { AuditService } from '../audit/audit.service';
import { translateUniqueViolation } from '../branches/branches.service';
import type { CreateDepartmentDto, UpdateDepartmentDto } from './departments.dto';

const DEPARTMENT_SELECT = {
  id: true,
  name: true,
  code: true,
  branchId: true,
  isActive: true,
  createdAt: true,
  branch: { select: { name: true } },
} as const;

@Injectable()
export class DepartmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(
    organizationId: string,
    filters: { branchId?: string; includeInactive: boolean },
  ): Promise<DepartmentSummary[]> {
    const departments = await this.prisma.department.findMany({
      where: {
        organizationId,
        ...(filters.branchId ? { branchId: filters.branchId } : {}),
        ...(filters.includeInactive ? {} : { isActive: true }),
      },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      select: DEPARTMENT_SELECT,
    });

    return departments.map(toSummary);
  }

  async findOne(organizationId: string, id: string): Promise<DepartmentSummary> {
    const department = await this.prisma.department.findFirst({
      where: { id, organizationId },
      select: DEPARTMENT_SELECT,
    });

    if (!department) {
      throw ApiException.notFound('Department');
    }

    return toSummary(department);
  }

  async create(
    organizationId: string,
    actorId: string,
    dto: CreateDepartmentDto,
    ipAddress?: string,
  ): Promise<DepartmentSummary> {
    await this.assertBranchBelongsToOrganization(organizationId, dto.branchId);

    const department = await this.prisma.department
      .create({
        data: {
          organizationId,
          name: dto.name,
          code: dto.code,
          branchId: dto.branchId ?? null,
        },
        select: DEPARTMENT_SELECT,
      })
      .catch((error: unknown) => {
        throw translateUniqueViolation(error, dto.code);
      });

    await this.audit.record({
      actorId,
      organizationId,
      action: 'department.created',
      entityType: 'department',
      entityId: department.id,
      after: { name: department.name, code: department.code, branchId: department.branchId },
      ipAddress,
    });

    return toSummary(department);
  }

  async update(
    organizationId: string,
    id: string,
    actorId: string,
    dto: UpdateDepartmentDto,
    ipAddress?: string,
  ): Promise<DepartmentSummary> {
    const before = await this.prisma.department.findFirst({
      where: { id, organizationId },
      select: DEPARTMENT_SELECT,
    });

    if (!before) {
      throw ApiException.notFound('Department');
    }

    if (dto.branchId !== undefined) {
      await this.assertBranchBelongsToOrganization(organizationId, dto.branchId);
    }

    const updated = await this.prisma.department
      .update({ where: { id: before.id }, data: dto, select: DEPARTMENT_SELECT })
      .catch((error: unknown) => {
        throw translateUniqueViolation(error, dto.code ?? before.code);
      });

    await this.audit.record({
      actorId,
      organizationId,
      action: 'department.updated',
      entityType: 'department',
      entityId: id,
      before: snapshot(before),
      after: snapshot(updated),
      ipAddress,
    });

    return toSummary(updated);
  }

  /** Same rule as branches: structure carrying reported data is deactivated, not deleted. */
  async remove(
    organizationId: string,
    id: string,
    actorId: string,
    ipAddress?: string,
  ): Promise<void> {
    const department = await this.prisma.department.findFirst({
      where: { id, organizationId },
      select: {
        id: true,
        name: true,
        code: true,
        _count: { select: { metricValues: true } },
      },
    });

    if (!department) {
      throw ApiException.notFound('Department');
    }

    if (department._count.metricValues > 0) {
      throw ApiException.conflict(
        'This department has reported data and cannot be deleted. Deactivate it instead.',
      );
    }

    await this.prisma.department.delete({ where: { id: department.id } });

    await this.audit.record({
      actorId,
      organizationId,
      action: 'department.deleted',
      entityType: 'department',
      entityId: id,
      before: { name: department.name, code: department.code },
      ipAddress,
    });
  }

  /**
   * A branch id from another organization must be rejected, not silently accepted —
   * otherwise a tenant could attach its structure to someone else's branch.
   */
  private async assertBranchBelongsToOrganization(
    organizationId: string,
    branchId: string | null | undefined,
  ): Promise<void> {
    if (!branchId) {
      return;
    }

    const branch = await this.prisma.branch.findFirst({
      where: { id: branchId, organizationId },
      select: { id: true },
    });

    if (!branch) {
      throw ApiException.validation('The request could not be processed.', [
        { field: 'branchId', message: 'Unknown branch for this organization' },
      ]);
    }
  }
}

type DepartmentRow = {
  id: string;
  name: string;
  code: string;
  branchId: string | null;
  isActive: boolean;
  createdAt: Date;
  branch: { name: string } | null;
};

function toSummary(row: DepartmentRow): DepartmentSummary {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    branchId: row.branchId,
    branchName: row.branch?.name ?? null,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
  };
}

function snapshot(row: DepartmentRow) {
  return { name: row.name, code: row.code, branchId: row.branchId, isActive: row.isActive };
}
