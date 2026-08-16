import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditRecord {
  actorId: string | null;
  organizationId: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: Prisma.InputJsonValue | null;
  after?: Prisma.InputJsonValue | null;
  ipAddress?: string | null;
}

/**
 * Append-only trail of who changed what (plan §46).
 *
 * Writing an audit row must never break the operation it describes, so failures
 * are logged rather than thrown. The trail is a record, not a transaction guard.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditRecord): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          actorId: entry.actorId,
          organizationId: entry.organizationId,
          action: entry.action,
          entityType: entry.entityType,
          entityId: entry.entityId ?? null,
          before: entry.before ?? undefined,
          after: entry.after ?? undefined,
          ipAddress: entry.ipAddress ?? null,
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to write audit log for ${entry.action} on ${entry.entityType}: ${
          (error as Error).message
        }`,
      );
    }
  }
}
