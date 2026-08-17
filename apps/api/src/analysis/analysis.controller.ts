import { Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import type { AnalysisRunResult } from '@sip/shared-types';
import { CurrentUser, OrganizationId, Roles } from '../auth/decorators';
import type { AuthenticatedUser } from '../auth/auth.types';
import { AnalysisService } from './analysis.service';

@Controller('analysis')
export class AnalysisController {
  constructor(private readonly analysis: AnalysisService) {}

  /**
   * Health, alerts and insights for the latest period with data, in that order —
   * the same sequence an import commit runs (plan §49).
   */
  @Roles('ORGANIZATION_ADMIN', 'ANALYST')
  @Post('run')
  @HttpCode(HttpStatus.OK)
  run(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<AnalysisRunResult[]> {
    return this.analysis.run(organizationId, undefined, user.id);
  }
}
