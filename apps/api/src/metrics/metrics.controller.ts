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
  Put,
  Query,
} from '@nestjs/common';
import type {
  MetricDetail,
  MetricSummary,
  MetricTargetSummary,
  MetricThresholdSummary,
  MetricValuePoint,
  RecalculationResult,
} from '@sip/shared-types';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { CurrentUser, OrganizationId, Roles } from '../auth/decorators';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CalculationService } from './calculation.service';
import {
  createMetricSchema,
  listMetricsSchema,
  manualValueSchema,
  setTargetSchema,
  setThresholdSchema,
  trendSchema,
  updateMetricSchema,
  type CreateMetricDto,
  type ListMetricsDto,
  type ManualValueDto,
  type SetTargetDto,
  type SetThresholdDto,
  type TrendDto,
  type UpdateMetricDto,
} from './metrics.dto';
import { MetricsService } from './metrics.service';

@Controller('metrics')
export class MetricsController {
  constructor(
    private readonly metrics: MetricsService,
    private readonly calculation: CalculationService,
  ) {}

  @Roles('ORGANIZATION_ADMIN', 'ANALYST', 'VIEWER')
  @Get()
  list(
    @OrganizationId() organizationId: string,
    @Query(new ZodValidationPipe(listMetricsSchema)) query: ListMetricsDto,
  ): Promise<MetricSummary[]> {
    return this.metrics.list(organizationId, query);
  }

  /**
   * Recalculates every formula metric. Declared before `:id` so the literal path
   * is matched first.
   */
  @Roles('ORGANIZATION_ADMIN', 'ANALYST')
  @Post('recalculate')
  @HttpCode(HttpStatus.OK)
  recalculate(@OrganizationId() organizationId: string): Promise<RecalculationResult> {
    return this.calculation.recalculate(organizationId);
  }

  @Roles('ORGANIZATION_ADMIN', 'ANALYST', 'VIEWER')
  @Get(':id')
  detail(
    @OrganizationId() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<MetricDetail> {
    return this.metrics.detail(organizationId, id);
  }

  @Roles('ORGANIZATION_ADMIN', 'ANALYST', 'VIEWER')
  @Get(':id/trend')
  trend(
    @OrganizationId() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodValidationPipe(trendSchema)) query: TrendDto,
  ): Promise<MetricValuePoint[]> {
    return this.metrics.trend(organizationId, id, query);
  }

  @Roles('ORGANIZATION_ADMIN', 'ANALYST')
  @Post()
  create(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createMetricSchema)) dto: CreateMetricDto,
    @Ip() ip: string,
  ): Promise<MetricSummary> {
    return this.metrics.create(organizationId, user.id, dto, ip);
  }

  @Roles('ORGANIZATION_ADMIN', 'ANALYST')
  @Patch(':id')
  update(
    @OrganizationId() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(updateMetricSchema)) dto: UpdateMetricDto,
    @Ip() ip: string,
  ): Promise<MetricSummary> {
    return this.metrics.update(organizationId, id, user.id, dto, ip);
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
    return this.metrics.remove(organizationId, id, user.id, ip);
  }

  /** Manual data entry (plan §2), validated exactly like an imported row. */
  @Roles('ORGANIZATION_ADMIN', 'ANALYST')
  @Post(':id/values')
  async recordValue(
    @OrganizationId() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(manualValueSchema)) dto: ManualValueDto,
    @Ip() ip: string,
  ): Promise<MetricValuePoint> {
    const point = await this.metrics.recordManualValue(organizationId, id, user.id, dto, ip);

    // Anything derived from this metric is now out of date.
    await this.calculation.recalculate(organizationId, [
      { periodType: point.periodType, periodStart: new Date(`${point.periodStart}T00:00:00.000Z`) },
    ]);

    return point;
  }

  @Roles('ORGANIZATION_ADMIN', 'ANALYST')
  @Put(':id/target')
  setTarget(
    @OrganizationId() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(setTargetSchema)) dto: SetTargetDto,
    @Ip() ip: string,
  ): Promise<MetricTargetSummary> {
    return this.metrics.setTarget(organizationId, id, user.id, dto, ip);
  }

  @Roles('ORGANIZATION_ADMIN', 'ANALYST')
  @Put(':id/threshold')
  setThreshold(
    @OrganizationId() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(setThresholdSchema)) dto: SetThresholdDto,
    @Ip() ip: string,
  ): Promise<MetricThresholdSummary> {
    return this.metrics.setThreshold(organizationId, id, user.id, dto, ip);
  }
}
