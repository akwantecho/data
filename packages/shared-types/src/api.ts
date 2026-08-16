/**
 * Transport-level contracts shared by the API and the web client.
 */

/** Standardised error envelope (plan §47). Never carries stack traces or DB internals. */
export interface ApiErrorResponse {
  code: ApiErrorCode;
  message: string;
  details: ApiErrorDetail[];
}

export interface ApiErrorDetail {
  field?: string;
  message: string;
}

export const API_ERROR_CODES = [
  'VALIDATION_ERROR',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'RATE_LIMITED',
  'PAYLOAD_TOO_LARGE',
  'UNSUPPORTED_MEDIA_TYPE',
  'INTERNAL_ERROR',
  'SERVICE_UNAVAILABLE',
] as const;
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

/** Envelope for paginated list endpoints (plan §45: pagination on large lists). */
export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

/** Response of `GET /health` — used by Docker healthchecks and CI smoke tests. */
export interface HealthCheckResponse {
  status: 'ok' | 'degraded';
  service: string;
  version: string;
  uptimeSeconds: number;
  checks: {
    database: 'up' | 'down';
  };
  timestamp: string;
}
