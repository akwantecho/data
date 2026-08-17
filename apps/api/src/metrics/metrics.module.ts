import { Module } from '@nestjs/common';
import { CalculationService } from './calculation.service';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';

@Module({
  controllers: [MetricsController],
  providers: [MetricsService, CalculationService],
  exports: [MetricsService, CalculationService],
})
export class MetricsModule {}
