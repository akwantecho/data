import { Module } from '@nestjs/common';
import { AnalyticsModule } from '../analytics/analytics.module';
import { OrganizationHealthController } from './organization-health.controller';
import { OrganizationHealthService } from './organization-health.service';

@Module({
  imports: [AnalyticsModule],
  controllers: [OrganizationHealthController],
  providers: [OrganizationHealthService],
  exports: [OrganizationHealthService],
})
export class OrganizationHealthModule {}
