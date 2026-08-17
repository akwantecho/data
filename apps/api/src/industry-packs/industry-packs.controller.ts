import { Controller, Get, Ip, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import type {
  IndustryPackDetail,
  IndustryPackInstallResult,
  IndustryPackOverview,
} from '@sip/shared-types';
import { CurrentUser, OrganizationId, Roles } from '../auth/decorators';
import type { AuthenticatedUser } from '../auth/auth.types';
import { IndustryPacksService } from './industry-packs.service';
import { PackInstallerService } from './pack-installer.service';

/**
 * Tenant-facing industry packs.
 *
 * Every route resolves the pack through the caller's own organization, so a pack
 * belonging to another industry is a 404 here — not a permission error, because a
 * tenant has no business knowing it exists (plan §17).
 */
@Controller('industry-packs')
export class IndustryPacksController {
  constructor(
    private readonly packs: IndustryPacksService,
    private readonly installer: PackInstallerService,
  ) {}

  @Roles('ORGANIZATION_ADMIN', 'ANALYST', 'VIEWER')
  @Get()
  overview(@OrganizationId() organizationId: string): Promise<IndustryPackOverview> {
    return this.packs.overview(organizationId);
  }

  @Roles('ORGANIZATION_ADMIN', 'ANALYST', 'VIEWER')
  @Get(':id')
  detail(
    @OrganizationId() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<IndustryPackDetail> {
    return this.packs.getForPlatformOrTenant(id, organizationId);
  }

  /**
   * Installing is idempotent and never overwrites: re-running it adds whatever the
   * organization is missing and leaves everything it already has alone.
   */
  @Roles('ORGANIZATION_ADMIN')
  @Post(':id/install')
  install(
    @OrganizationId() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ip: string,
  ): Promise<IndustryPackInstallResult> {
    return this.installer.install(organizationId, id, user.id, ip);
  }
}
