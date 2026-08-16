import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import type { SessionResponse } from '@sip/shared-types';
import type { Request, Response } from 'express';
import type { Env } from '../config/env';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { AuthService } from './auth.service';
import {
  loginSchema,
  switchOrganizationSchema,
  type LoginDto,
  type SwitchOrganizationDto,
} from './auth.dto';
import type { AuthenticatedUser } from './auth.types';
import {
  clearAuthCookies,
  cookieConfig,
  REFRESH_COOKIE,
  setAccessCookie,
  setRefreshCookie,
} from './cookies';
import { CurrentUser, Public } from './decorators';
import { TokenService } from './token.service';

/**
 * Brute-force ceilings for the credential endpoints, far below the global limit.
 * Refresh is looser: a legitimate client rotates on a schedule and on 401 retries.
 */
const LOGIN_ATTEMPTS_PER_MINUTE = 10;
const REFRESH_ATTEMPTS_PER_MINUTE = 30;

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly tokens: TokenService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /**
   * Exchanges credentials for session cookies.
   *
   * Tightly throttled: this is the endpoint an attacker brute-forces.
   */
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: LOGIN_ATTEMPTS_PER_MINUTE } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body(new ZodValidationPipe(loginSchema)) dto: LoginDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SessionResponse> {
    const issued = await this.auth.login(dto.email, dto.password);
    this.writeSessionCookies(response, issued.accessToken, issued.refreshToken);
    return issued.session;
  }

  /** Rotates the refresh token and re-issues the access token. */
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: REFRESH_ATTEMPTS_PER_MINUTE } })
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SessionResponse> {
    const token = readRefreshCookie(request);

    try {
      const issued = await this.auth.refresh(token ?? '');
      this.writeSessionCookies(response, issued.accessToken, issued.refreshToken);
      return issued.session;
    } catch (error) {
      // A rejected refresh means the session is over — do not leave stale cookies
      // in the browser to be retried forever.
      clearAuthCookies(response, cookieConfig(this.config));
      throw error;
    }
  }

  /** Revokes the whole token family and clears the cookies. Always succeeds. */
  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.auth.logout(readRefreshCookie(request));
    clearAuthCookies(response, cookieConfig(this.config));
  }

  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser): Promise<SessionResponse> {
    return this.auth.currentSession(user);
  }

  /** Re-scopes the access token to another organization the user belongs to. */
  @Post('switch-organization')
  @HttpCode(HttpStatus.OK)
  async switchOrganization(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(switchOrganizationSchema)) dto: SwitchOrganizationDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SessionResponse> {
    const { session, accessToken } = await this.auth.switchOrganization(user, dto.organizationId);

    setAccessCookie(response, accessToken, this.tokens.accessTtlSeconds, cookieConfig(this.config));

    return session;
  }

  private writeSessionCookies(response: Response, accessToken: string, refreshToken: string): void {
    const cookies = cookieConfig(this.config);
    setAccessCookie(response, accessToken, this.tokens.accessTtlSeconds, cookies);
    setRefreshCookie(response, refreshToken, this.tokens.refreshTtlSeconds, cookies);
  }
}

function readRefreshCookie(request: Request): string | undefined {
  const cookies = request.cookies as Record<string, string | undefined> | undefined;
  return cookies?.[REFRESH_COOKIE];
}
