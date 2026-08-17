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
import type { DataSourceSummary } from '@sip/shared-types';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { CurrentUser, OrganizationId, Roles } from '../auth/decorators';
import type { AuthenticatedUser } from '../auth/auth.types';
import {
  createDataSourceSchema,
  updateDataSourceSchema,
  type CreateDataSourceDto,
  type UpdateDataSourceDto,
} from './data-sources.dto';
import { DataSourcesService } from './data-sources.service';

@Controller('data-sources')
export class DataSourcesController {
  constructor(private readonly dataSources: DataSourcesService) {}

  @Roles('ORGANIZATION_ADMIN', 'ANALYST', 'VIEWER')
  @Get()
  list(@OrganizationId() organizationId: string): Promise<DataSourceSummary[]> {
    return this.dataSources.list(organizationId);
  }

  /** Analysts import data, so they may also manage the sources they import from. */
  @Roles('ORGANIZATION_ADMIN', 'ANALYST')
  @Post()
  create(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createDataSourceSchema)) dto: CreateDataSourceDto,
    @Ip() ip: string,
  ): Promise<DataSourceSummary> {
    return this.dataSources.create(organizationId, user.id, dto, ip);
  }

  @Roles('ORGANIZATION_ADMIN', 'ANALYST')
  @Patch(':id')
  update(
    @OrganizationId() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(updateDataSourceSchema)) dto: UpdateDataSourceDto,
    @Ip() ip: string,
  ): Promise<DataSourceSummary> {
    return this.dataSources.update(organizationId, id, user.id, dto, ip);
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
    return this.dataSources.remove(organizationId, id, user.id, ip);
  }
}
