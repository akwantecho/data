import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import type { InsightSummary, Paginated } from '@sip/shared-types';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { OrganizationId, Roles } from '../auth/decorators';
import { listInsightsSchema, type ListInsightsDto } from './insights.dto';
import { InsightsService } from './insights.service';

@Controller('insights')
export class InsightsController {
  constructor(private readonly insights: InsightsService) {}

  @Roles('ORGANIZATION_ADMIN', 'ANALYST', 'VIEWER')
  @Get()
  list(
    @OrganizationId() organizationId: string,
    @Query(new ZodValidationPipe(listInsightsSchema)) query: ListInsightsDto,
  ): Promise<Paginated<InsightSummary>> {
    return this.insights.list(organizationId, query);
  }

  @Roles('ORGANIZATION_ADMIN', 'ANALYST', 'VIEWER')
  @Get(':id')
  detail(
    @OrganizationId() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<InsightSummary> {
    return this.insights.detail(organizationId, id);
  }
}
