import { Body, Controller, Get, Ip, Param, ParseUUIDPipe, Patch, Query } from '@nestjs/common';
import type { Paginated, PlatformOrganizationSummary } from '@sip/shared-types';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { CurrentUser, PlatformAdminOnly } from '../auth/decorators';
import type { AuthenticatedUser } from '../auth/auth.types';
import {
  paginationSchema,
  updateOrganizationStatusSchema,
  type PaginationDto,
  type UpdateOrganizationStatusDto,
} from './platform.dto';
import { PlatformService } from './platform.service';

@PlatformAdminOnly()
@Controller('platform')
export class PlatformController {
  constructor(private readonly platform: PlatformService) {}

  @Get('organizations')
  listOrganizations(
    @Query(new ZodValidationPipe(paginationSchema)) query: PaginationDto,
  ): Promise<Paginated<PlatformOrganizationSummary>> {
    return this.platform.listOrganizations(query.page, query.pageSize);
  }

  @Patch('organizations/:id/status')
  setOrganizationStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateOrganizationStatusSchema)) dto: UpdateOrganizationStatusDto,
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ip: string,
  ): Promise<PlatformOrganizationSummary> {
    return this.platform.setOrganizationStatus(id, dto.status, user.id, ip);
  }
}
