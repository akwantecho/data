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
  Query,
} from '@nestjs/common';
import type { BranchSummary } from '@sip/shared-types';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { CurrentUser, OrganizationId, Roles } from '../auth/decorators';
import type { AuthenticatedUser } from '../auth/auth.types';
import {
  createBranchSchema,
  listBranchesSchema,
  updateBranchSchema,
  type CreateBranchDto,
  type ListBranchesDto,
  type UpdateBranchDto,
} from './branches.dto';
import { BranchesService } from './branches.service';

@Controller('branches')
export class BranchesController {
  constructor(private readonly branches: BranchesService) {}

  @Roles('ORGANIZATION_ADMIN', 'ANALYST', 'VIEWER')
  @Get()
  list(
    @OrganizationId() organizationId: string,
    @Query(new ZodValidationPipe(listBranchesSchema)) query: ListBranchesDto,
  ): Promise<BranchSummary[]> {
    return this.branches.list(organizationId, query.includeInactive);
  }

  @Roles('ORGANIZATION_ADMIN', 'ANALYST', 'VIEWER')
  @Get(':id')
  findOne(
    @OrganizationId() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<BranchSummary> {
    return this.branches.findOne(organizationId, id);
  }

  @Roles('ORGANIZATION_ADMIN')
  @Post()
  create(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createBranchSchema)) dto: CreateBranchDto,
    @Ip() ip: string,
  ): Promise<BranchSummary> {
    return this.branches.create(organizationId, user.id, dto, ip);
  }

  @Roles('ORGANIZATION_ADMIN')
  @Patch(':id')
  update(
    @OrganizationId() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(updateBranchSchema)) dto: UpdateBranchDto,
    @Ip() ip: string,
  ): Promise<BranchSummary> {
    return this.branches.update(organizationId, id, user.id, dto, ip);
  }

  @Roles('ORGANIZATION_ADMIN')
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @OrganizationId() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ip: string,
  ): Promise<void> {
    return this.branches.remove(organizationId, id, user.id, ip);
  }
}
