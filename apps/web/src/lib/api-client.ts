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
}

/**
 * Thin fetch wrapper. Business calculations always happen server-side, so the
 * client only transports and renders — it never derives KPI values itself.
 */
export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, headers, ...rest } = options;

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...rest,
    headers: {
      Accept: 'application/json',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'include',
  });

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
