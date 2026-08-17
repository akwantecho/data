import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import type {
  AnalyticsOptions,
  ComparisonResult,
  DashboardOverview,
  MetricAnalyticsDetail,
} from '@sip/shared-types';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { OrganizationId, Roles } from '../auth/decorators';
import {
  analyticsFiltersSchema,
  comparisonSchema,
  type AnalyticsFiltersDto,
  type ComparisonDto,
} from './analytics.dto';
import { AnalyticsService } from './analytics.service';
import { DashboardService } from './dashboard.service';

/**
 * Reading is open to every member: a viewer's whole job is to look at these
 * numbers. Nothing here writes, so there is no role split beyond membership.
 */
@Controller()
export class AnalyticsController {
  constructor(
    private readonly analytics: AnalyticsService,
    private readonly dashboard: DashboardService,
  ) {}

  @Roles('ORGANIZATION_ADMIN', 'ANALYST', 'VIEWER')
  @Get('dashboard/overview')
  overview(
    @OrganizationId() organizationId: string,
    @Query(new ZodValidationPipe(analyticsFiltersSchema)) filters: AnalyticsFiltersDto,
  ): Promise<DashboardOverview> {
    return this.dashboard.overview(organizationId, filters);
  }

  /** The filter bar's options, so the client never invents an id. */
  @Roles('ORGANIZATION_ADMIN', 'ANALYST', 'VIEWER')
  @Get('analytics/options')
  options(@OrganizationId() organizationId: string): Promise<AnalyticsOptions> {
    return this.analytics.options(organizationId);
  }

  /**
   * Declared before `analytics/metric/:metricId` would be reached, and on a
   * distinct path, so neither route can swallow the other.
   */
  @Roles('ORGANIZATION_ADMIN', 'ANALYST', 'VIEWER')
  @Get('analytics/comparison')
  comparison(
    @OrganizationId() organizationId: string,
    @Query(new ZodValidationPipe(comparisonSchema)) dto: ComparisonDto,
  ): Promise<ComparisonResult> {
    return this.analytics.comparison(organizationId, dto);
  }

  @Roles('ORGANIZATION_ADMIN', 'ANALYST', 'VIEWER')
  @Get('analytics/metric/:metricId')
  metric(
    @OrganizationId() organizationId: string,
    @Param('metricId', ParseUUIDPipe) metricId: string,
    @Query(new ZodValidationPipe(analyticsFiltersSchema)) filters: AnalyticsFiltersDto,
  ): Promise<MetricAnalyticsDetail> {
    return this.analytics.metricDetail(organizationId, metricId, filters);
  }
}
