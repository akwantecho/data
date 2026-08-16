import type { OrganizationRole } from '@sip/shared-types';
import { AuthService } from './auth.service';
import { ApiException } from '../common/errors/api-exception';
import type { PasswordService } from './password.service';
import type { TokenService } from './token.service';
import { hashToken } from './token.service';

/** Minimal doubles — these tests are about the decision logic, not Prisma. */
function buildHarness(
  overrides: {
    user?: unknown;
    storedToken?: unknown;
    passwordMatches?: boolean;
  } = {},
) {
  const prisma = {
    user: {
      findUnique: jest.fn().mockResolvedValue(overrides.user ?? null),
      update: jest.fn().mockResolvedValue({}),
    },
  };

  const passwords = {
    verify: jest.fn().mockResolvedValue(overrides.passwordMatches ?? true),
  } as unknown as PasswordService;

  const tokens = {
    signAccessToken: jest.fn().mockResolvedValue('access-token'),
    issueRefreshToken: jest.fn().mockResolvedValue({
      token: 'refresh-token',
      expiresAt: new Date(Date.now() + 60_000),
      familyId: 'family-1',
    }),
    verifyRefreshToken: jest.fn(),
    findStoredToken: jest.fn().mockResolvedValue(overrides.storedToken ?? null),
    revokeToken: jest.fn().mockResolvedValue(undefined),
    revokeFamily: jest.fn().mockResolvedValue(undefined),
  } as unknown as TokenService;

  const service = new AuthService(prisma as never, passwords, tokens);

  return { service, prisma, passwords, tokens };
}

function membership(
  organizationId: string,
  role: OrganizationRole = 'ORGANIZATION_ADMIN',
  status = 'ACTIVE',
  isDefault = false,
) {
  return {
    role,
    isDefault,
    organization: {
      id: organizationId,
      name: `Org ${organizationId}`,
      slug: organizationId,
      status,
    },
  };
}

const activeUser = {
  id: 'user-1',
  email: 'admin@alpha.local',
  fullName: 'Alpha Admin',
  passwordHash: 'stored-hash',
  status: 'ACTIVE',
  platformRole: null,
  memberships: [membership('org-1')],
};

describe('AuthService.login', () => {
  it('issues a session scoped to the user’s organization', async () => {
    const { service, tokens } = buildHarness({ user: activeUser });

    const result = await service.login('admin@alpha.local', 'Password123!');

    expect(result.session.activeOrganizationId).toBe('org-1');
    expect(result.session.activeRole).toBe('ORGANIZATION_ADMIN');
    expect(result.accessToken).toBe('access-token');
    expect(result.refreshToken).toBe('refresh-token');
    expect(tokens.signAccessToken).toHaveBeenCalledWith(
      expect.objectContaining({ sub: 'user-1', org: 'org-1', role: 'ORGANIZATION_ADMIN' }),
    );
  });

  it('prefers the membership flagged as default', async () => {
    const { service } = buildHarness({
      user: {
        ...activeUser,
        memberships: [membership('org-1'), membership('org-2', 'ANALYST', 'ACTIVE', true)],
      },
    });

    const result = await service.login('admin@alpha.local', 'Password123!');

    expect(result.session.activeOrganizationId).toBe('org-2');
    expect(result.session.activeRole).toBe('ANALYST');
  });

  it('skips organizations that are not active', async () => {
    const { service } = buildHarness({
      user: {
        ...activeUser,
        memberships: [
          membership('org-suspended', 'ANALYST', 'SUSPENDED', true),
          membership('org-2'),
        ],
      },
    });

    const result = await service.login('admin@alpha.local', 'Password123!');

    expect(result.session.activeOrganizationId).toBe('org-2');
  });

  it('rejects an unknown email with the same message as a wrong password', async () => {
    const unknown = buildHarness({ user: null });
    const wrongPassword = buildHarness({ user: activeUser, passwordMatches: false });

    const first = await unknown.service.login('nobody@alpha.local', 'x').catch((e) => e);
    const second = await wrongPassword.service.login('admin@alpha.local', 'x').catch((e) => e);

    expect(first).toBeInstanceOf(ApiException);
    expect((first as ApiException).code).toBe('UNAUTHENTICATED');
    expect((first as ApiException).message).toBe((second as ApiException).message);
  });

  it('still hashes a password for an unknown email, to keep timing comparable', async () => {
    const { service, passwords } = buildHarness({ user: null });

    await service.login('nobody@alpha.local', 'x').catch(() => undefined);

    expect(passwords.verify).toHaveBeenCalled();
  });

  it('rejects a disabled user', async () => {
    const { service } = buildHarness({ user: { ...activeUser, status: 'DISABLED' } });

    await expect(service.login('admin@alpha.local', 'Password123!')).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
  });

  it('refuses a user with no usable organization and no platform role', async () => {
    const { service } = buildHarness({
      user: { ...activeUser, memberships: [membership('org-1', 'ANALYST', 'SUSPENDED')] },
    });

    await expect(service.login('admin@alpha.local', 'Password123!')).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('lets platform staff in without any membership', async () => {
    const { service } = buildHarness({
      user: { ...activeUser, platformRole: 'PLATFORM_ADMIN', memberships: [] },
    });

    const result = await service.login('platform@sip.local', 'Password123!');

    expect(result.session.activeOrganizationId).toBeNull();
    expect(result.session.user.platformRole).toBe('PLATFORM_ADMIN');
  });

  it('lowercases the email before lookup', async () => {
    const { service, prisma } = buildHarness({ user: activeUser });

    await service.login('Admin@Alpha.Local', 'Password123!');

    expect(prisma.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: 'admin@alpha.local' } }),
    );
  });
});

describe('AuthService.refresh', () => {
  const presented = 'refresh-token-value';

  function storedToken(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      id: 'token-1',
      userId: 'user-1',
      familyId: 'family-1',
      tokenHash: hashToken(presented),
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
      ...overrides,
    };
  }

  function harness(overrides: { storedToken?: unknown; user?: unknown } = {}) {
    const built = buildHarness({
      user: overrides.user ?? activeUser,
      storedToken: overrides.storedToken,
    });
    (built.tokens.verifyRefreshToken as jest.Mock).mockResolvedValue({
      sub: 'user-1',
      jti: 'token-1',
      fam: 'family-1',
    });
    return built;
  }

  it('rotates the token and re-issues the session in the same family', async () => {
    const { service, tokens } = harness({ storedToken: storedToken() });

    const result = await service.refresh(presented);

    expect(tokens.revokeToken).toHaveBeenCalledWith('token-1', 'ROTATED');
    expect(tokens.issueRefreshToken).toHaveBeenCalledWith('user-1', 'family-1');
    expect(result.session.activeOrganizationId).toBe('org-1');
  });

  it('revokes the whole family when an already-rotated token is replayed', async () => {
    const { service, tokens } = harness({ storedToken: storedToken({ revokedAt: new Date() }) });

    await expect(service.refresh(presented)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(tokens.revokeFamily).toHaveBeenCalledWith('family-1', 'REUSE_DETECTED');
  });

  it('rejects a token whose stored hash does not match the presented value', async () => {
    const { service } = harness({ storedToken: storedToken({ tokenHash: 'different-hash' }) });

    await expect(service.refresh(presented)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('rejects an expired stored token', async () => {
    const { service } = harness({
      storedToken: storedToken({ expiresAt: new Date(Date.now() - 1000) }),
    });

    await expect(service.refresh(presented)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('rejects a token that is not in the database at all', async () => {
    const { service } = harness({ storedToken: null });

    await expect(service.refresh(presented)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('revokes the family when the user has since been disabled', async () => {
    const { service, tokens } = harness({
      storedToken: storedToken(),
      user: { ...activeUser, status: 'DISABLED' },
    });

    await expect(service.refresh(presented)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(tokens.revokeFamily).toHaveBeenCalledWith('family-1', 'MEMBERSHIP_CHANGED');
  });
});

describe('AuthService.switchOrganization', () => {
  const caller = {
    id: 'user-1',
    email: 'admin@alpha.local',
    platformRole: null,
    organizationId: 'org-1',
    organizationRole: 'ORGANIZATION_ADMIN' as const,
  };

  it('re-scopes the access token to another membership', async () => {
    const { service, tokens } = buildHarness({
      user: { ...activeUser, memberships: [membership('org-1'), membership('org-2', 'VIEWER')] },
    });

    const result = await service.switchOrganization(caller, 'org-2');

    expect(result.session.activeOrganizationId).toBe('org-2');
    expect(result.session.activeRole).toBe('VIEWER');
    expect(tokens.signAccessToken).toHaveBeenCalledWith(
      expect.objectContaining({ org: 'org-2', role: 'VIEWER' }),
    );
  });

  it('refuses an organization the user does not belong to', async () => {
    const { service } = buildHarness({ user: activeUser });

    await expect(service.switchOrganization(caller, 'org-someone-else')).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('refuses a suspended organization', async () => {
    const { service } = buildHarness({
      user: { ...activeUser, memberships: [membership('org-2', 'ANALYST', 'SUSPENDED')] },
    });

    await expect(service.switchOrganization(caller, 'org-2')).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });
});
