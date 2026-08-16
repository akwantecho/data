import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { OrganizationRole } from '@sip/shared-types';
import { ApiException } from '../common/errors/api-exception';
import type { AuthenticatedUser, RequestWithUser } from './auth.types';

export const IS_PUBLIC_KEY = 'auth:public';
export const ROLES_KEY = 'auth:roles';
export const PLATFORM_ADMIN_KEY = 'auth:platformAdmin';

/** Opts a route out of authentication. Authentication is the default. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** Restricts a route to the listed organization roles. Implies tenant scope. */
export const Roles = (...roles: OrganizationRole[]) => SetMetadata(ROLES_KEY, roles);

/** Restricts a route to platform staff. */
export const PlatformAdminOnly = () => SetMetadata(PLATFORM_ADMIN_KEY, true);

/** Injects the authenticated user attached by the guards. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser => {
    const request = context.switchToHttp().getRequest<RequestWithUser>();

    if (!request.user) {
      throw new ApiException('UNAUTHENTICATED', 'Authentication is required.');
    }

    return request.user;
  },
);

/**
 * Injects the organization id the request is scoped to.
 *
 * This is the only sanctioned source of `organizationId` in a tenant service — it
 * comes from the verified access token, never from the request body (ADR-0002).
 */
export const OrganizationId = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string => {
    const request = context.switchToHttp().getRequest<RequestWithUser>();

    if (!request.user?.organizationId) {
      throw ApiException.forbidden('This request is not scoped to an organization.');
    }

    return request.user.organizationId;
  },
);
