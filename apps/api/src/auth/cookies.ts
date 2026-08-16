import type { CookieOptions, Response } from 'express';
import type { Env } from '../config/env';

export const ACCESS_COOKIE = 'sip_access';
export const REFRESH_COOKIE = 'sip_refresh';

/** Refresh cookies are only sent to the endpoints that rotate or clear them. */
export const REFRESH_COOKIE_PATH = '/api/auth';

interface CookieConfig {
  secure: boolean;
  domain?: string;
  refreshPath: string;
}

export function cookieConfig(config: {
  get: <K extends keyof Env>(key: K, options: { infer: true }) => Env[K];
}): CookieConfig {
  return {
    secure: config.get('COOKIE_SECURE', { infer: true }),
    domain: config.get('COOKIE_DOMAIN', { infer: true }),
    refreshPath: `/${config.get('API_PREFIX', { infer: true })}/auth`,
  };
}

function baseOptions(config: CookieConfig): CookieOptions {
  return {
    httpOnly: true,
    // Lax blocks the cross-site POST that a CSRF attack needs, while keeping
    // ordinary top-level navigation to the app working (ADR-0006).
    sameSite: 'lax',
    secure: config.secure,
    domain: config.domain,
    path: '/',
  };
}

export function setAccessCookie(
  response: Response,
  token: string,
  ttlSeconds: number,
  config: CookieConfig,
): void {
  response.cookie(ACCESS_COOKIE, token, { ...baseOptions(config), maxAge: ttlSeconds * 1000 });
}

export function setRefreshCookie(
  response: Response,
  token: string,
  ttlSeconds: number,
  config: CookieConfig,
): void {
  response.cookie(REFRESH_COOKIE, token, {
    ...baseOptions(config),
    path: config.refreshPath,
    maxAge: ttlSeconds * 1000,
  });
}

export function clearAuthCookies(response: Response, config: CookieConfig): void {
  response.clearCookie(ACCESS_COOKIE, baseOptions(config));
  response.clearCookie(REFRESH_COOKIE, { ...baseOptions(config), path: config.refreshPath });
}
