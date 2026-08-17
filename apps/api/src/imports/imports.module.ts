import { Module } from '@nestjs/common';
import { AnalysisModule } from '../analysis/analysis.module';
import { MetricsModule } from '../metrics/metrics.module';
import { ImportsController } from './imports.controller';
import { ImportsService } from './imports.service';

@Module({
  imports: [MetricsModule, AnalysisModule],
  controllers: [ImportsController],
  providers: [ImportsService],
  exports: [ImportsService],
})
export class ImportsModule {}
