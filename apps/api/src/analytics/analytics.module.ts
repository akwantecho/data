import { Module } from '@nestjs/common';
import { DataQualityModule } from '../data-quality/data-quality.module';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { DashboardService } from './dashboard.service';

@Module({
  imports: [DataQualityModule],
  controllers: [AnalyticsController],
  providers: [AnalyticsService, DashboardService],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
