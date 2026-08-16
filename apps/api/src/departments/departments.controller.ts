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
import type { DepartmentSummary } from '@sip/shared-types';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { CurrentUser, OrganizationId, Roles } from '../auth/decorators';
import type { AuthenticatedUser } from '../auth/auth.types';
import {
  createDepartmentSchema,
  listDepartmentsSchema,
  updateDepartmentSchema,
  type CreateDepartmentDto,
  type ListDepartmentsDto,
  type UpdateDepartmentDto,
} from './departments.dto';
import { DepartmentsService } from './departments.service';

@Controller('departments')
export class DepartmentsController {
  constructor(private readonly departments: DepartmentsService) {}

  @Roles('ORGANIZATION_ADMIN', 'ANALYST', 'VIEWER')
  @Get()
  list(
    @OrganizationId() organizationId: string,
    @Query(new ZodValidationPipe(listDepartmentsSchema)) query: ListDepartmentsDto,
  ): Promise<DepartmentSummary[]> {
    return this.departments.list(organizationId, query);
  }

  @Roles('ORGANIZATION_ADMIN', 'ANALYST', 'VIEWER')
  @Get(':id')
  findOne(
    @OrganizationId() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<DepartmentSummary> {
    return this.departments.findOne(organizationId, id);
  }

  @Roles('ORGANIZATION_ADMIN')
  @Post()
  create(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createDepartmentSchema)) dto: CreateDepartmentDto,
    @Ip() ip: string,
  ): Promise<DepartmentSummary> {
    return this.departments.create(organizationId, user.id, dto, ip);
  }

  @Roles('ORGANIZATION_ADMIN')
  @Patch(':id')
  update(
    @OrganizationId() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(updateDepartmentSchema)) dto: UpdateDepartmentDto,
    @Ip() ip: string,
  ): Promise<DepartmentSummary> {
    return this.departments.update(organizationId, id, user.id, dto, ip);
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
    return this.departments.remove(organizationId, id, user.id, ip);
  }
}
