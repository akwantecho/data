import { Body, Controller, Get, Ip, Param, ParseUUIDPipe, Patch, Query } from '@nestjs/common';
import type { AlertDetail, AlertSummary, Paginated } from '@sip/shared-types';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { CurrentUser, OrganizationId, Roles } from '../auth/decorators';
import type { AuthenticatedUser } from '../auth/auth.types';
import {
  listAlertsSchema,
  updateAlertStatusSchema,
  type ListAlertsDto,
  type UpdateAlertStatusDto,
} from './alerts.dto';
import { AlertsService } from './alerts.service';

@Controller('alerts')
export class AlertsController {
  constructor(private readonly alerts: AlertsService) {}

  @Roles('ORGANIZATION_ADMIN', 'ANALYST', 'VIEWER')
  @Get()
  list(
    @OrganizationId() organizationId: string,
    @Query(new ZodValidationPipe(listAlertsSchema)) query: ListAlertsDto,
  ): Promise<Paginated<AlertSummary>> {
    return this.alerts.list(organizationId, query);
  }

  @Roles('ORGANIZATION_ADMIN', 'ANALYST', 'VIEWER')
  @Get(':id')
  detail(
    @OrganizationId() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AlertDetail> {
    return this.alerts.detail(organizationId, id);
  }

  /**
   * Acknowledging, resolving or dismissing (plan §27). A viewer reads alerts but
   * does not decide what happens to them.
   */
  @Roles('ORGANIZATION_ADMIN', 'ANALYST')
  @Patch(':id/status')
  setStatus(
    @OrganizationId() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(updateAlertStatusSchema)) dto: UpdateAlertStatusDto,
    @Ip() ip: string,
  ): Promise<AlertDetail> {
    return this.alerts.setStatus(organizationId, id, user.id, dto, ip);
  }
}
