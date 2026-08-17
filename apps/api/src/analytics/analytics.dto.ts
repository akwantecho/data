import { COMPARISON_BREAKDOWNS } from '@sip/shared-types';
import { z } from 'zod';

/** An ISO date, the same shape `period_start` is stored in. */
const isoDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date, for example 2026-01-01');

const filterFields = {
  from: isoDate.optional(),
  to: isoDate.optional(),
  branchId: z.string().uuid('A valid branch is required').optional(),
  departmentId: z.string().uuid('A valid department is required').optional(),
};

const orderedRange = (value: { from?: string; to?: string }) =>
  !value.from || !value.to || value.from <= value.to;

const RANGE_MESSAGE = {
  path: ['from'],
  message: 'The start of the range must not be after its end',
};

export const analyticsFiltersSchema = z
  .object(filterFields)
  .strict()
  .refine(orderedRange, RANGE_MESSAGE);

export type AnalyticsFiltersDto = z.infer<typeof analyticsFiltersSchema>;

export const comparisonSchema = z
  .object({
    ...filterFields,
    breakdown: z.enum(COMPARISON_BREAKDOWNS).default('BRANCH'),
    metricId: z.string().uuid('A valid metric is required').optional(),
    /** Comma-separated ids, used when comparing metrics against each other. */
    metricIds: z
      .string()
      .optional()
      .transform((value) =>
        value
          ? value
              .split(',')
              .map((id) => id.trim())
              .filter(Boolean)
          : [],
      )
      .pipe(z.array(z.string().uuid('A valid metric is required')).max(6)),
  })
  .strict()
  .refine(orderedRange, RANGE_MESSAGE);

export type ComparisonDto = z.infer<typeof comparisonSchema>;
