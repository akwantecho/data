import { Injectable, Logger } from '@nestjs/common';
import type { IndustryPackInstallResult } from '@sip/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { installPack, packForIndustry } from './pack-install';

/**
 * Installing industry packs on behalf of a caller.
 *
 * The installation itself lives in `pack-install.ts` so the seed runs exactly the
 * same code; this adds the audit entry and the "which pack applies here" lookup.
 */
@Injectable()
export class PackInstallerService {
  private readonly logger = new Logger(PackInstallerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Installs the pack belonging to an industry, if one is published for it.
   *
   * Selecting an industry is what "creating an organization with an industry"
   * means for an existing tenant, so both paths end with the same rows.
   */
  async installForIndustry(
    organizationId: string,
    industryId: string,
    actorId: string,
    ipAddress?: string,
  ): Promise<IndustryPackInstallResult | null> {
    const packId = await packForIndustry(this.prisma, industryId);

    if (!packId) {
      this.logger.warn(`No industry pack is published for industry ${industryId}`);
      return null;
    }

    return this.install(organizationId, packId, actorId, ipAddress);
  }

  async install(
    organizationId: string,
    packId: string,
    actorId: string,
    ipAddress?: string,
  ): Promise<IndustryPackInstallResult> {
    const { result, packId: installedPackId } = await installPack(
      this.prisma,
      organizationId,
      packId,
    );

    await this.audit.record({
      actorId,
      organizationId,
      action: 'industry_pack.installed',
      entityType: 'industry_pack',
      entityId: installedPackId,
      after: { ...result },
      ipAddress,
    });

    return result;
  }
}
