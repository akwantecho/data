import { Controller, Get, Ip, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import type {
  IndustryPackDetail,
  IndustryPackSummary,
  IndustryPackSyncResult,
} from '@sip/shared-types';
import { CurrentUser, PlatformAdminOnly } from '../auth/decorators';
import type { AuthenticatedUser } from '../auth/auth.types';
import { IndustryPacksService } from './industry-packs.service';

/**
 * Platform administration of industry packs (plan §36).
 *
 * These routes cross industries deliberately — that is what platform staff are
 * for — and are unreachable from any tenant session.
 */
@PlatformAdminOnly()
@Controller('platform/industry-packs')
export class PlatformPacksController {
  constructor(private readonly packs: IndustryPacksService) {}

  @Get()
  list(): Promise<IndustryPackSummary[]> {
    return this.packs.listAll();
  }

  /**
   * Re-reads the shipped catalogue into the database. Installed organizations are
   * untouched: syncing changes what a *future* install produces, and an existing
   * tenant picks it up only by installing again.
   */
  @Post('sync')
  sync(@CurrentUser() user: AuthenticatedUser, @Ip() ip: string): Promise<IndustryPackSyncResult> {
    return this.packs.sync(user.id, ip);
  }

  @Get(':id')
  detail(@Param('id', ParseUUIDPipe) id: string): Promise<IndustryPackDetail> {
    return this.packs.getForPlatform(id);
  }
}
