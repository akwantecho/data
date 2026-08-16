import { Injectable, PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';
import { ApiException } from '../errors/api-exception';

/**
 * DTO validation via Zod (ADR-0003). Schemas are plain values, so the same schema
 * can be shared with the web client instead of being duplicated as decorators.
 *
 * Usage: `@Body(new ZodValidationPipe(createBranchSchema)) dto: CreateBranchDto`
 */
@Injectable()
export class ZodValidationPipe<TOutput> implements PipeTransform<unknown, TOutput> {
  constructor(private readonly schema: ZodType<TOutput>) {}

  transform(value: unknown): TOutput {
    const result = this.schema.safeParse(value);

    if (!result.success) {
      throw ApiException.validation(
        'The request could not be processed.',
        result.error.issues.map((issue) => ({
          field: issue.path.join('.') || undefined,
          message: issue.message,
        })),
      );
    }

    return result.data;
  }
}
