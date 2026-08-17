import { Controller, Get } from '@nestjs/common';
import type { DataQualityReport } from '@sip/shared-types';
import { OrganizationId, Roles } from '../auth/decorators';
import { DataQualityService } from './data-quality.service';

@Controller('data-quality')
export class DataQualityController {
  constructor(private readonly dataQuality: DataQualityService) {}

  @Roles('ORGANIZATION_ADMIN', 'ANALYST', 'VIEWER')
  @Get()
  report(@OrganizationId() organizationId: string): Promise<DataQualityReport> {
    return this.dataQuality.report(organizationId);
  }
}
