import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Ip,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import type { OrganizationMemberSummary } from '@sip/shared-types';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { CurrentUser, OrganizationId, Roles } from '../auth/decorators';
import type { AuthenticatedUser } from '../auth/auth.types';
import {
  addMemberSchema,
  updateMemberSchema,
  type AddMemberDto,
  type UpdateMemberDto,
} from './organization-users.dto';
import { OrganizationUsersService } from './organization-users.service';

@Controller('organization-users')
export class OrganizationUsersController {
  constructor(private readonly members: OrganizationUsersService) {}

  /** Any member may see who else is in the organization. */
  @Roles('ORGANIZATION_ADMIN', 'ANALYST', 'VIEWER')
  @Get()
  list(@OrganizationId() organizationId: string): Promise<OrganizationMemberSummary[]> {
    return this.members.list(organizationId);
  }

  @Roles('ORGANIZATION_ADMIN')
  @Post()
  add(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(addMemberSchema)) dto: AddMemberDto,
    @Ip() ip: string,
  ): Promise<OrganizationMemberSummary> {
    return this.members.add(organizationId, user.id, dto, ip);
  }

  @Roles('ORGANIZATION_ADMIN')
  @Patch(':userId')
  updateRole(
    @OrganizationId() organizationId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(updateMemberSchema)) dto: UpdateMemberDto,
    @Ip() ip: string,
  ): Promise<OrganizationMemberSummary> {
    return this.members.updateRole(organizationId, userId, user.id, dto, ip);
  }

  @Roles('ORGANIZATION_ADMIN')
  @Delete(':userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @OrganizationId() organizationId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ip: string,
  ): Promise<void> {
    return this.members.remove(organizationId, userId, user.id, ip);
  }
}
