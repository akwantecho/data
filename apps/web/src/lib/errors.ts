import { ApiError } from './api-client';

/**
 * Turns an error into copy a user can act on.
 *
 * The API already returns safe, human-readable messages for the codes a user can
 * cause (validation, conflict, forbidden), so those are shown as-is; anything else
 * gets a generic line, because internal failures must not leak detail.
 */
export function describeApiError(
  error: unknown,
  fallback = 'Something went wrong. Please try again.',
): string {
  if (!(error instanceof ApiError)) {
    return fallback;
  }

  switch (error.code) {
    case 'VALIDATION_ERROR': {
      const detail = error.body.details[0];
      return detail ? `${detail.field ? `${detail.field}: ` : ''}${detail.message}` : error.message;
    }
    case 'CONFLICT':
    case 'FORBIDDEN':
    case 'NOT_FOUND':
      return error.message;
    case 'RATE_LIMITED':
      return 'Too many requests. Please wait a moment and try again.';
    default:
      return fallback;
  }
}
