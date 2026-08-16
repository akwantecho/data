import { Controller, Get } from '@nestjs/common';
import type { IndustrySummary } from '@sip/shared-types';
import { Roles } from '../auth/decorators';
import { IndustriesService } from './industries.service';

@Controller('industries')
export class IndustriesController {
  constructor(private readonly industries: IndustriesService) {}

  @Roles('ORGANIZATION_ADMIN', 'ANALYST', 'VIEWER')
  @Get()
  list(): Promise<IndustrySummary[]> {
    return this.industries.list();
  }
}
