import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';
import type { HealthCheckResponse } from '@sip/shared-types';
import { Public } from '../auth/decorators';
import { HealthService } from './health.service';

// Monitoring and container healthchecks cannot authenticate; the response carries
// no tenant data, only service liveness.
@Public()
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  /**
   * Liveness + database readiness. Used by Docker healthchecks, CI smoke tests and
   * uptime monitoring. Always 200 so a degraded database is reported in the body
   * rather than masked as a transport failure.
   */
  @Get()
  @HttpCode(HttpStatus.OK)
  check(): Promise<HealthCheckResponse> {
    return this.healthService.check();
  }
}
