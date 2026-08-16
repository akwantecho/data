import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { OrganizationRole } from '@sip/shared-types';
import type { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { ApiException } from '../../common/errors/api-exception';
import { IS_PUBLIC_KEY, PLATFORM_ADMIN_KEY, ROLES_KEY } from '../decorators';
import type { RequestWithUser } from '../auth.types';

/**
 * Enforces the two access rules the platform has (plan §6):
 *
 *   `@PlatformAdminOnly()` — platform staff only, and never tenant-scoped.
 *   `@Roles(...)`          — a live membership of the token's organization, with
 *                            one of the listed roles.
 *
 * Membership is re-read from the database on every tenant request rather than
 * trusted from the token. An access token lives 15 minutes; a user removed from
 * an organization must lose access immediately, not when their token expires.
 *
 * Runs after JwtAuthGuard, which has already populated `request.user`.
 */
@Injectable()
export class AuthorizationGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];

    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request & RequestWithUser>();
    const user = request.user;

    if (!user) {
      throw new ApiException('UNAUTHENTICATED', 'Authentication is required.');
    }

    if (this.reflector.getAllAndOverride<boolean>(PLATFORM_ADMIN_KEY, targets)) {
      if (user.platformRole !== 'PLATFORM_ADMIN') {
        throw ApiException.forbidden();
      }
      return true;
    }

    const roles = this.reflector.getAllAndOverride<OrganizationRole[]>(ROLES_KEY, targets);

    if (!roles) {
      return true;
    }

    if (!user.organizationId) {
      throw ApiException.forbidden('This request is not scoped to an organization.');
    }

    const membership = await this.prisma.organizationUser.findUnique({
      where: {
        organizationId_userId: { organizationId: user.organizationId, userId: user.id },
      },
      select: { role: true, organization: { select: { status: true } } },
    });

    if (!membership || membership.organization.status !== 'ACTIVE') {
      throw ApiException.forbidden();
    }

    if (!roles.includes(membership.role)) {
      throw ApiException.forbidden('Your role does not allow this action.');
    }

    // Trust the stored role over the token's copy for the rest of the request.
    request.user = { ...user, organizationRole: membership.role };

    return true;
  }
}
