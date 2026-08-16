import type { ApiErrorResponse } from '@sip/shared-types';

/** Base URL of the API. In development Vite proxies `/api` to the backend. */
export const API_BASE_URL: string = import.meta.env.VITE_API_BASE_URL ?? '/api';

/** Error thrown for any non-2xx API response, carrying the platform error envelope. */
export class ApiError extends Error {
  readonly status: number;
  readonly body: ApiErrorResponse;

  constructor(status: number, body: ApiErrorResponse) {
    super(body.message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }

  get code(): ApiErrorResponse['code'] {
    return this.body.code;
  }
}

const FALLBACK_ERROR: ApiErrorResponse = {
  code: 'INTERNAL_ERROR',
  message: 'The request could not be processed.',
  details: [],
};

export interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  /** Internal: set while retrying after a token refresh, to stop a refresh loop. */
  skipRefresh?: boolean;
}

/** Endpoints that must never trigger the refresh-and-retry path themselves. */
const AUTH_ENDPOINTS = ['/auth/login', '/auth/refresh', '/auth/logout'];

/**
 * Tokens are httpOnly cookies, so the client cannot see when the access token
 * expires. Instead, a 401 triggers one refresh attempt and one retry.
 *
 * Concurrent requests share a single refresh call — otherwise a page issuing five
 * queries would rotate the refresh token five times and trip reuse detection.
 */
let refreshInFlight: Promise<boolean> | null = null;

/**
 * Thin fetch wrapper. Business calculations always happen server-side, so the
 * client only transports and renders — it never derives KPI values itself.
 */
export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = await sendRequest(path, options);

  if (response.status === 401 && !options.skipRefresh && !AUTH_ENDPOINTS.includes(path)) {
    const refreshed = await refreshSession();

    if (refreshed) {
      return readResponse<T>(await sendRequest(path, { ...options, skipRefresh: true }));
    }
  }

  return readResponse<T>(response);
}

/** Attempts a single shared token refresh. Resolves to whether the session survives. */
export function refreshSession(): Promise<boolean> {
  refreshInFlight ??= sendRequest('/auth/refresh', { method: 'POST' })
    .then((response) => response.ok)
    .catch(() => false)
    .finally(() => {
      refreshInFlight = null;
    });

  return refreshInFlight;
}

async function sendRequest(path: string, options: RequestOptions): Promise<Response> {
  const { body, headers, skipRefresh: _skipRefresh, ...rest } = options;

  return fetch(`${API_BASE_URL}${path}`, {
    ...rest,
    headers: {
      Accept: 'application/json',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    // Session cookies are httpOnly, so they must ride along on every request.
    credentials: 'include',
  });
}

async function readResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw new ApiError(response.status, await readErrorBody(response));
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

async function readErrorBody(response: Response): Promise<ApiErrorResponse> {
  try {
    const parsed = (await response.json()) as Partial<ApiErrorResponse>;

    if (parsed && typeof parsed.code === 'string' && typeof parsed.message === 'string') {
      return { code: parsed.code, message: parsed.message, details: parsed.details ?? [] };
    }
  } catch {
    // Non-JSON error responses (proxy/gateway failures) fall through to the default.
  }

  return FALLBACK_ERROR;
}
