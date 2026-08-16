import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from './jwt-auth.guard';
import { ACCESS_COOKIE } from '../cookies';
import { IS_PUBLIC_KEY } from '../decorators';
import type { TokenService } from '../token.service';
import type { AccessTokenPayload } from '../auth.types';

const payload: AccessTokenPayload = {
  sub: 'user-1',
  email: 'analyst@alpha.local',
  org: 'org-1',
  role: 'ANALYST',
  platformRole: null,
};

function buildContext(request: Record<string, unknown>) {
  return {
    request,
    context: {
      getHandler: () => () => undefined,
      getClass: () => class {},
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext,
  };
}

function buildGuard(isPublic: boolean, verify: jest.Mock) {
  const reflector = {
    getAllAndOverride: (key: string) => (key === IS_PUBLIC_KEY ? isPublic : undefined),
  } as unknown as Reflector;

  return new JwtAuthGuard(reflector, { verifyAccessToken: verify } as unknown as TokenService);
}

describe('JwtAuthGuard', () => {
  it('skips authentication for public routes', async () => {
    const verify = jest.fn();
    const { context } = buildContext({ headers: {} });

    await expect(buildGuard(true, verify).canActivate(context)).resolves.toBe(true);
    expect(verify).not.toHaveBeenCalled();
  });

  it('rejects a request with no token', async () => {
    const { context } = buildContext({ headers: {} });

    await expect(buildGuard(false, jest.fn()).canActivate(context)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
  });

  it('reads the access token from the cookie', async () => {
    const verify = jest.fn().mockResolvedValue(payload);
    const { context, request } = buildContext({
      headers: {},
      cookies: { [ACCESS_COOKIE]: 'cookie-token' },
    });

    await expect(buildGuard(false, verify).canActivate(context)).resolves.toBe(true);
    expect(verify).toHaveBeenCalledWith('cookie-token');
    expect(request.user).toEqual({
      id: 'user-1',
      email: 'analyst@alpha.local',
      platformRole: null,
      organizationId: 'org-1',
      organizationRole: 'ANALYST',
    });
  });

  it('accepts a bearer header for non-browser clients', async () => {
    const verify = jest.fn().mockResolvedValue(payload);
    const { context } = buildContext({ headers: { authorization: 'Bearer header-token' } });

    await expect(buildGuard(false, verify).canActivate(context)).resolves.toBe(true);
    expect(verify).toHaveBeenCalledWith('header-token');
  });

  it('prefers the cookie over the header', async () => {
    const verify = jest.fn().mockResolvedValue(payload);
    const { context } = buildContext({
      headers: { authorization: 'Bearer header-token' },
      cookies: { [ACCESS_COOKIE]: 'cookie-token' },
    });

    await buildGuard(false, verify).canActivate(context);

    expect(verify).toHaveBeenCalledWith('cookie-token');
  });

  it('rejects an invalid or expired token', async () => {
    const verify = jest.fn().mockRejectedValue(new Error('jwt expired'));
    const { context } = buildContext({ headers: {}, cookies: { [ACCESS_COOKIE]: 'stale' } });

    await expect(buildGuard(false, verify).canActivate(context)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
  });
});
