import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthorizationGuard } from './authorization.guard';
import { IS_PUBLIC_KEY, PLATFORM_ADMIN_KEY, ROLES_KEY } from '../decorators';
import type { AuthenticatedUser } from '../auth.types';

function buildContext(user?: AuthenticatedUser) {
  const request: { user?: AuthenticatedUser } = { user };

  return {
    request,
    context: {
      getHandler: () => () => undefined,
      getClass: () => class {},
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext,
  };
}

function buildGuard(metadata: Record<string, unknown>, membership: unknown) {
  const reflector = {
    getAllAndOverride: (key: string) => metadata[key],
  } as unknown as Reflector;

  const prisma = {
    organizationUser: { findUnique: jest.fn().mockResolvedValue(membership) },
  };

  return { guard: new AuthorizationGuard(reflector, prisma as never), prisma };
}

const tenantUser: AuthenticatedUser = {
  id: 'user-1',
  email: 'analyst@alpha.local',
  platformRole: null,
  organizationId: 'org-1',
  organizationRole: 'ANALYST',
};

const platformUser: AuthenticatedUser = {
  id: 'user-2',
  email: 'platform@sip.local',
  platformRole: 'PLATFORM_ADMIN',
  organizationId: null,
  organizationRole: null,
};

const activeMembership = { role: 'ANALYST', organization: { status: 'ACTIVE' } };

describe('AuthorizationGuard', () => {
  it('allows public routes without a user', async () => {
    const { guard } = buildGuard({ [IS_PUBLIC_KEY]: true }, null);
    const { context } = buildContext(undefined);

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('rejects an unauthenticated request on a protected route', async () => {
    const { guard } = buildGuard({ [ROLES_KEY]: ['ANALYST'] }, activeMembership);
    const { context } = buildContext(undefined);

    await expect(guard.canActivate(context)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  describe('platform routes', () => {
    it('admits platform staff', async () => {
      const { guard } = buildGuard({ [PLATFORM_ADMIN_KEY]: true }, null);
      const { context } = buildContext(platformUser);

      await expect(guard.canActivate(context)).resolves.toBe(true);
    });

    it('refuses an ordinary tenant user', async () => {
      const { guard } = buildGuard({ [PLATFORM_ADMIN_KEY]: true }, activeMembership);
      const { context } = buildContext(tenantUser);

      await expect(guard.canActivate(context)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    it('does not touch membership for platform routes', async () => {
      const { guard, prisma } = buildGuard({ [PLATFORM_ADMIN_KEY]: true }, null);
      const { context } = buildContext(platformUser);

      await guard.canActivate(context);

      expect(prisma.organizationUser.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('tenant routes', () => {
    it('verifies membership against the database, not the token', async () => {
      const { guard, prisma } = buildGuard({ [ROLES_KEY]: ['ANALYST'] }, activeMembership);
      const { context } = buildContext(tenantUser);

      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(prisma.organizationUser.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { organizationId_userId: { organizationId: 'org-1', userId: 'user-1' } },
        }),
      );
    });

    it('refuses a user whose membership has been removed since the token was issued', async () => {
      const { guard } = buildGuard({ [ROLES_KEY]: ['ANALYST'] }, null);
      const { context } = buildContext(tenantUser);

      await expect(guard.canActivate(context)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    it('refuses access to a suspended organization', async () => {
      const { guard } = buildGuard(
        { [ROLES_KEY]: ['ANALYST'] },
        { role: 'ANALYST', organization: { status: 'SUSPENDED' } },
      );
      const { context } = buildContext(tenantUser);

      await expect(guard.canActivate(context)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    it('refuses a role that is not allowed on the route', async () => {
      const { guard } = buildGuard({ [ROLES_KEY]: ['ORGANIZATION_ADMIN'] }, activeMembership);
      const { context } = buildContext(tenantUser);

      await expect(guard.canActivate(context)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    it('refuses platform staff with no organization scope', async () => {
      const { guard } = buildGuard({ [ROLES_KEY]: ['ANALYST'] }, activeMembership);
      const { context } = buildContext(platformUser);

      await expect(guard.canActivate(context)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    it('replaces the token role with the stored role', async () => {
      const { guard } = buildGuard(
        { [ROLES_KEY]: ['ORGANIZATION_ADMIN', 'ANALYST'] },
        { role: 'ORGANIZATION_ADMIN', organization: { status: 'ACTIVE' } },
      );
      const { context, request } = buildContext({ ...tenantUser, organizationRole: 'ANALYST' });

      await guard.canActivate(context);

      expect(request.user?.organizationRole).toBe('ORGANIZATION_ADMIN');
    });
  });
});
