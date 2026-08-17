import { Injectable } from '@nestjs/common';
import type { DataSourceSummary } from '@sip/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { ApiException } from '../common/errors/api-exception';
import { AuditService } from '../audit/audit.service';
import type { CreateDataSourceDto, UpdateDataSourceDto } from './data-sources.dto';

const SOURCE_SELECT = {
  id: true,
  name: true,
  type: true,
  status: true,
  lastSyncAt: true,
  createdAt: true,
  _count: { select: { imports: true } },
} as const;

/**
 * Where an organization's data comes from. The MVP supports MANUAL and CSV;
 * the type is part of the model so API, database and ERP connectors can be added
 * without reshaping anything (plan §13).
 */
@Injectable()
export class DataSourcesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(organizationId: string): Promise<DataSourceSummary[]> {
    const sources = await this.prisma.dataSource.findMany({
      where: { organizationId },
      orderBy: [{ status: 'asc' }, { name: 'asc' }],
      select: SOURCE_SELECT,
    });

    return sources.map(toSummary);
  }

  async create(
    organizationId: string,
    actorId: string,
    dto: CreateDataSourceDto,
    ipAddress?: string,
  ): Promise<DataSourceSummary> {
    const source = await this.prisma.dataSource.create({
      data: { organizationId, name: dto.name, type: dto.type },
      select: SOURCE_SELECT,
    });

    await this.audit.record({
      actorId,
      organizationId,
      action: 'data_source.created',
      entityType: 'data_source',
      entityId: source.id,
      after: { name: source.name, type: source.type },
      ipAddress,
    });

    return toSummary(source);
  }

  async update(
    organizationId: string,
    id: string,
    actorId: string,
    dto: UpdateDataSourceDto,
    ipAddress?: string,
  ): Promise<DataSourceSummary> {
    const before = await this.prisma.dataSource.findFirst({
      where: { id, organizationId },
      select: SOURCE_SELECT,
    });

    if (!before) {
      throw ApiException.notFound('Data source');
    }

    const updated = await this.prisma.dataSource.update({
      where: { id: before.id },
      data: dto,
      select: SOURCE_SELECT,
    });

    await this.audit.record({
      actorId,
      organizationId,
      action: 'data_source.updated',
      entityType: 'data_source',
      entityId: id,
      before: { name: before.name, status: before.status },
      after: { name: updated.name, status: updated.status },
      ipAddress,
    });

    return toSummary(updated);
  }

  /** A source with import history is deactivated instead, so the trail survives. */
  async remove(
    organizationId: string,
    id: string,
    actorId: string,
    ipAddress?: string,
  ): Promise<void> {
    const source = await this.prisma.dataSource.findFirst({
      where: { id, organizationId },
      select: { id: true, name: true, _count: { select: { imports: true } } },
    });

    if (!source) {
      throw ApiException.notFound('Data source');
    }

    if (source._count.imports > 0) {
      throw ApiException.conflict(
        'This source has import history and cannot be deleted. Set it to inactive instead.',
      );
    }

    await this.prisma.dataSource.delete({ where: { id: source.id } });

    await this.audit.record({
      actorId,
      organizationId,
      action: 'data_source.deleted',
      entityType: 'data_source',
      entityId: id,
      before: { name: source.name },
      ipAddress,
    });
  }
}

type SourceRow = {
  id: string;
  name: string;
  type: DataSourceSummary['type'];
  status: DataSourceSummary['status'];
  lastSyncAt: Date | null;
  createdAt: Date;
  _count: { imports: number };
};

function toSummary(row: SourceRow): DataSourceSummary {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    status: row.status,
    lastSyncAt: row.lastSyncAt?.toISOString() ?? null,
    importCount: row._count.imports,
    createdAt: row.createdAt.toISOString(),
  };
}
