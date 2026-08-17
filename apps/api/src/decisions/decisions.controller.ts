import {
  Body,
  Controller,
  Delete,
  Get,
  Ip,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import type {
  DecisionCentre,
  DecisionDetail,
  DecisionSummary,
  Paginated,
} from '@sip/shared-types';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { CurrentUser, OrganizationId, Roles } from '../auth/decorators';
import type { AuthenticatedUser } from '../auth/auth.types';
import {
  createDecisionActionSchema,
  createDecisionSchema,
  listDecisionsSchema,
  reviewDecisionSchema,
  updateDecisionActionSchema,
  updateDecisionSchema,
  type CreateDecisionActionDto,
  type CreateDecisionDto,
  type ListDecisionsDto,
  type ReviewDecisionDto,
  type UpdateDecisionActionDto,
  type UpdateDecisionDto,
} from './decisions.dto';
import { DecisionsService } from './decisions.service';

@Controller('decisions')
export class DecisionsController {
  constructor(private readonly decisions: DecisionsService) {}

  @Roles('ORGANIZATION_ADMIN', 'ANALYST', 'VIEWER')
  @Get()
  list(
    @OrganizationId() organizationId: string,
    @Query(new ZodValidationPipe(listDecisionsSchema)) query: ListDecisionsDto,
  ): Promise<Paginated<DecisionSummary>> {
    return this.decisions.list(organizationId, query);
  }

  /** The decision centre (plan §30). Declared before `:id` so it is not read as one. */
  @Roles('ORGANIZATION_ADMIN', 'ANALYST', 'VIEWER')
  @Get('centre')
  centre(@OrganizationId() organizationId: string): Promise<DecisionCentre> {
    return this.decisions.centre(organizationId);
  }

  @Roles('ORGANIZATION_ADMIN', 'ANALYST', 'VIEWER')
  @Get(':id')
  detail(
    @OrganizationId() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<DecisionDetail> {
    return this.decisions.detail(organizationId, id);
  }

  @Roles('ORGANIZATION_ADMIN', 'ANALYST')
  @Post()
  create(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createDecisionSchema)) dto: CreateDecisionDto,
    @Ip() ip: string,
  ): Promise<DecisionDetail> {
    return this.decisions.create(organizationId, user.id, dto, ip);
  }

  @Roles('ORGANIZATION_ADMIN', 'ANALYST')
  @Patch(':id')
  update(
    @OrganizationId() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(updateDecisionSchema)) dto: UpdateDecisionDto,
    @Ip() ip: string,
  ): Promise<DecisionDetail> {
    return this.decisions.update(organizationId, id, user.id, dto, ip);
  }

  @Roles('ORGANIZATION_ADMIN', 'ANALYST')
  @Post(':id/actions')
  addAction(
    @OrganizationId() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createDecisionActionSchema)) dto: CreateDecisionActionDto,
  ): Promise<DecisionDetail> {
    return this.decisions.addAction(organizationId, id, user.id, dto);
  }

  @Roles('ORGANIZATION_ADMIN', 'ANALYST')
  @Patch(':id/actions/:actionId')
  setActionState(
    @OrganizationId() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('actionId', ParseUUIDPipe) actionId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(updateDecisionActionSchema)) dto: UpdateDecisionActionDto,
  ): Promise<DecisionDetail> {
    return this.decisions.setActionState(organizationId, id, actionId, user.id, dto);
  }

  @Roles('ORGANIZATION_ADMIN', 'ANALYST')
  @Delete(':id/actions/:actionId')
  removeAction(
    @OrganizationId() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('actionId', ParseUUIDPipe) actionId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<DecisionDetail> {
    return this.decisions.removeAction(organizationId, id, actionId, user.id);
  }

  /** Recording how it turned out (plan §32). */
  @Roles('ORGANIZATION_ADMIN', 'ANALYST')
  @Post(':id/review')
  review(
    @OrganizationId() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(reviewDecisionSchema)) dto: ReviewDecisionDto,
    @Ip() ip: string,
  ): Promise<DecisionDetail> {
    return this.decisions.review(organizationId, id, user.id, dto, ip);
  }
}
