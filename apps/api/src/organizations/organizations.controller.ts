import { Body, Controller, Get, Ip, Patch, Put } from '@nestjs/common';
import type { OrganizationSummary } from '@sip/shared-types';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { CurrentUser, OrganizationId, Roles } from '../auth/decorators';
import type { AuthenticatedUser } from '../auth/auth.types';
import {
  setIndustrySchema,
  updateOrganizationSchema,
  type SetIndustryDto,
  type UpdateOrganizationDto,
} from './organizations.dto';
import { OrganizationsService } from './organizations.service';

@Controller('organizations')
export class OrganizationsController {
  constructor(private readonly organizations: OrganizationsService) {}

  /** Any member may read their own organization's profile. */
  @Roles('ORGANIZATION_ADMIN', 'ANALYST', 'VIEWER')
  @Get('current')
  findCurrent(@OrganizationId() organizationId: string): Promise<OrganizationSummary> {
    return this.organizations.findCurrent(organizationId);
  }

  /** Only an organization admin may change the profile. */
  @Roles('ORGANIZATION_ADMIN')
  @Patch('current')
  update(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(updateOrganizationSchema)) dto: UpdateOrganizationDto,
    @Ip() ip: string,
  ): Promise<OrganizationSummary> {
    return this.organizations.updateCurrent(organizationId, user.id, dto, ip);
  }

  /** Selecting the industry decides which industry pack the organization receives. */
  @Roles('ORGANIZATION_ADMIN')
  @Put('current/industry')
  setIndustry(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(setIndustrySchema)) dto: SetIndustryDto,
    @Ip() ip: string,
  ): Promise<OrganizationSummary> {
    return this.organizations.setIndustry(organizationId, user.id, dto.industryId, ip);
  }
}
