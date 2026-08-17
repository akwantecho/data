import { Module } from '@nestjs/common';
import { AlertsModule } from '../alerts/alerts.module';
import { GoalsModule } from '../goals/goals.module';
import { InsightsModule } from '../insights/insights.module';
import { OrganizationHealthModule } from '../organization-health/organization-health.module';
import { AnalysisController } from './analysis.controller';
import { AnalysisService } from './analysis.service';

@Module({
  imports: [OrganizationHealthModule, AlertsModule, InsightsModule, GoalsModule],
  controllers: [AnalysisController],
  providers: [AnalysisService],
  exports: [AnalysisService],
})
export class AnalysisModule {}
