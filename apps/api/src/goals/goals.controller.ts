import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Ip,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import type { GoalDetail, GoalProgressResult, GoalSummary } from '@sip/shared-types';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { CurrentUser, OrganizationId, Roles } from '../auth/decorators';
import type { AuthenticatedUser } from '../auth/auth.types';
import {
  createGoalSchema,
  goalNoteSchema,
  listGoalsSchema,
  updateGoalSchema,
  type CreateGoalDto,
  type GoalNoteDto,
  type ListGoalsDto,
  type UpdateGoalDto,
} from './goals.dto';
import { GoalsService } from './goals.service';

@Controller('goals')
export class GoalsController {
  constructor(private readonly goals: GoalsService) {}

  @Roles('ORGANIZATION_ADMIN', 'ANALYST', 'VIEWER')
  @Get()
  list(
    @OrganizationId() organizationId: string,
    @Query(new ZodValidationPipe(listGoalsSchema)) query: ListGoalsDto,
  ): Promise<GoalSummary[]> {
    return this.goals.list(organizationId, query);
  }

  @Roles('ORGANIZATION_ADMIN', 'ANALYST', 'VIEWER')
  @Get(':id')
  detail(
    @OrganizationId() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<GoalDetail> {
    return this.goals.detail(organizationId, id);
  }

  @Roles('ORGANIZATION_ADMIN', 'ANALYST')
  @Post()
  create(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createGoalSchema)) dto: CreateGoalDto,
    @Ip() ip: string,
  ): Promise<GoalDetail> {
    return this.goals.create(organizationId, user.id, dto, ip);
  }

  @Roles('ORGANIZATION_ADMIN', 'ANALYST')
  @Patch(':id')
  update(
    @OrganizationId() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(updateGoalSchema)) dto: UpdateGoalDto,
    @Ip() ip: string,
  ): Promise<GoalDetail> {
    return this.goals.update(organizationId, id, user.id, dto, ip);
  }

  @Roles('ORGANIZATION_ADMIN', 'ANALYST')
  @Delete(':id')
  @HttpCode(204)
  async remove(
    @OrganizationId() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ip: string,
  ): Promise<void> {
    await this.goals.remove(organizationId, id, user.id, ip);
  }

  /** A note recorded by hand, kept in the same history as the automatic entries. */
  @Roles('ORGANIZATION_ADMIN', 'ANALYST')
  @Post(':id/notes')
  addNote(
    @OrganizationId() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(goalNoteSchema)) dto: GoalNoteDto,
  ): Promise<GoalDetail> {
    return this.goals.addNote(organizationId, id, user.id, dto.note);
  }

  /**
   * Recalculating on demand. Progress is refreshed automatically after every
   * import; this is here for when someone wants it now.
   */
  @Roles('ORGANIZATION_ADMIN', 'ANALYST')
  @Post('recalculate')
  @HttpCode(200)
  recalculate(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<GoalProgressResult> {
    return this.goals.recalculate(organizationId, user.id);
  }
}
