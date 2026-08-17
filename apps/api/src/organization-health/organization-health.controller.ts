import { Controller, Get, Post, Query } from '@nestjs/common';
import type {
  HealthCurrent,
  HealthHistoryPoint,
  HealthRecalculationResult,
} from '@sip/shared-types';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { OrganizationId, Roles } from '../auth/decorators';
import { healthQuerySchema, type HealthQueryDto } from './organization-health.dto';
import { OrganizationHealthService } from './organization-health.service';

/**
 * Organizational health (plan §26).
 *
 * Shares the `/health` prefix with the service liveness probe, which answers
 * `GET /health` and nothing else: this controller only claims sub-paths, and every
 * one of them is tenant-scoped and authenticated.
 */
@Controller('health')
export class OrganizationHealthController {
  constructor(private readonly health: OrganizationHealthService) {}

  @Roles('ORGANIZATION_ADMIN', 'ANALYST', 'VIEWER')
  @Get('current')
  current(
    @OrganizationId() organizationId: string,
    @Query(new ZodValidationPipe(healthQuerySchema)) query: HealthQueryDto,
  ): Promise<HealthCurrent> {
    return this.health.current(organizationId, query.branchId ?? null);
  }

  @Roles('ORGANIZATION_ADMIN', 'ANALYST', 'VIEWER')
  @Get('history')
  history(
    @OrganizationId() organizationId: string,
    @Query(new ZodValidationPipe(healthQuerySchema)) query: HealthQueryDto,
  ): Promise<HealthHistoryPoint[]> {
    return this.health.history(organizationId, query.branchId ?? null, query.limit);
  }

  /** Rescores every period the organization has data for. */
  @Roles('ORGANIZATION_ADMIN', 'ANALYST')
  @Post('recalculate')
  recalculate(@OrganizationId() organizationId: string): Promise<HealthRecalculationResult> {
    return this.health.recalculate(organizationId);
  }
}
