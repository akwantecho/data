import { HttpException, HttpStatus } from '@nestjs/common';
import type { ApiErrorCode, ApiErrorDetail, ApiErrorResponse } from '@sip/shared-types';

const STATUS_BY_CODE: Record<ApiErrorCode, HttpStatus> = {
  VALIDATION_ERROR: HttpStatus.BAD_REQUEST,
  UNAUTHENTICATED: HttpStatus.UNAUTHORIZED,
  FORBIDDEN: HttpStatus.FORBIDDEN,
  NOT_FOUND: HttpStatus.NOT_FOUND,
  CONFLICT: HttpStatus.CONFLICT,
  RATE_LIMITED: HttpStatus.TOO_MANY_REQUESTS,
  PAYLOAD_TOO_LARGE: HttpStatus.PAYLOAD_TOO_LARGE,
  UNSUPPORTED_MEDIA_TYPE: HttpStatus.UNSUPPORTED_MEDIA_TYPE,
  INTERNAL_ERROR: HttpStatus.INTERNAL_SERVER_ERROR,
  SERVICE_UNAVAILABLE: HttpStatus.SERVICE_UNAVAILABLE,
};

/**
 * Domain-level exception carrying the platform error contract (plan §47).
 * Services throw these instead of leaking framework or database errors.
 */
export class ApiException extends HttpException {
  readonly code: ApiErrorCode;
  readonly details: ApiErrorDetail[];

  constructor(code: ApiErrorCode, message: string, details: ApiErrorDetail[] = []) {
    const body: ApiErrorResponse = { code, message, details };
    super(body, STATUS_BY_CODE[code]);
    this.code = code;
    this.details = details;
  }

  static validation(message: string, details: ApiErrorDetail[] = []): ApiException {
    return new ApiException('VALIDATION_ERROR', message, details);
  }

  static notFound(entity: string): ApiException {
    return new ApiException('NOT_FOUND', `${entity} was not found.`);
  }

  static forbidden(message = 'You do not have access to this resource.'): ApiException {
    return new ApiException('FORBIDDEN', message);
  }

  static conflict(message: string): ApiException {
    return new ApiException('CONFLICT', message);
  }
}

export { STATUS_BY_CODE };
