import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { ApiException } from '../../common/errors/api-exception';
import { ACCESS_COOKIE } from '../cookies';
import { IS_PUBLIC_KEY } from '../decorators';
import { TokenService } from '../token.service';
import type { AuthenticatedUser, RequestWithUser } from '../auth.types';

/**
 * Authenticates every request unless the route is marked `@Public()`.
 *
 * Registered globally, so a new controller is protected by default — forgetting a
 * guard cannot silently expose an endpoint.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request & RequestWithUser>();
    const token = extractToken(request);

    if (!token) {
      throw new ApiException('UNAUTHENTICATED', 'Authentication is required.');
    }

    const payload = await this.tokens.verifyAccessToken(token).catch(() => {
      throw new ApiException('UNAUTHENTICATED', 'Your session has expired.');
    });

    request.user = {
      id: payload.sub,
      email: payload.email,
      platformRole: payload.platformRole ?? null,
      organizationId: payload.org ?? null,
      organizationRole: payload.role ?? null,
    } satisfies AuthenticatedUser;

    return true;
  }
}

/**
 * The cookie is the supported transport (ADR-0006). A bearer header is also
 * accepted so non-browser clients and integration tests do not need a cookie jar.
 */
function extractToken(request: Request): string | undefined {
  const cookies = request.cookies as Record<string, string | undefined> | undefined;
  const fromCookie = cookies?.[ACCESS_COOKIE];

  if (fromCookie) {
    return fromCookie;
  }

  const header = request.headers.authorization;

  if (header?.startsWith('Bearer ')) {
    return header.slice('Bearer '.length).trim() || undefined;
  }

  return undefined;
}
