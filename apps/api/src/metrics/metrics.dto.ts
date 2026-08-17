import {
  AGGREGATION_TYPES,
  METRIC_DIRECTIONS,
  METRIC_FREQUENCIES,
  METRIC_UNITS,
} from '@sip/shared-types';
import { z } from 'zod';
import { codeSchema } from '../branches/branches.dto';

/** A decimal carried as a string, so precision survives the trip to the database. */
const decimalString = z
  .string()
  .trim()
  .regex(/^-?\d+(\.\d+)?$/, 'Enter a number, for example 1250.75');

export const createMetricSchema = z
  .object({
    code: codeSchema,
    name: z.string().trim().min(2, 'Name must be at least 2 characters').max(120),
    description: z.string().trim().max(500).nullish(),
    category: z.string().trim().max(80).nullish(),
    unit: z.enum(METRIC_UNITS),
    aggregationType: z.enum(AGGREGATION_TYPES),
    frequency: z.enum(METRIC_FREQUENCIES),
    direction: z.enum(METRIC_DIRECTIONS),
    formula: z.string().trim().max(500).nullish(),
  })
  .strict();

export type CreateMetricDto = z.infer<typeof createMetricSchema>;

export const updateMetricSchema = createMetricSchema
  .extend({ isActive: z.boolean() })
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'No changes were provided');

export type UpdateMetricDto = z.infer<typeof updateMetricSchema>;

export const listMetricsSchema = z.object({
  category: z.string().trim().min(1).optional(),
  search: z.string().trim().min(1).max(80).optional(),
  includeInactive: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .default(false)
    .transform((value) => value === true || value === 'true'),
});

export type ListMetricsDto = z.infer<typeof listMetricsSchema>;

export const manualValueSchema = z
  .object({
    period: z.string().trim().min(4, 'A period is required'),
    value: decimalString,
    branchId: z.string().uuid().nullish(),
    departmentId: z.string().uuid().nullish(),
  })
  .strict();

export type ManualValueDto = z.infer<typeof manualValueSchema>;

export const setTargetSchema = z
  .object({
    period: z.string().trim().min(4, 'A period is required'),
    targetValue: decimalString,
    minValue: decimalString.nullish(),
    maxValue: decimalString.nullish(),
    branchId: z.string().uuid().nullish(),
  })
  .strict();

export type SetTargetDto = z.infer<typeof setTargetSchema>;

export const setThresholdSchema = z
  .object({
    warningValue: decimalString.nullish(),
    criticalValue: decimalString.nullish(),
    isRelativeToTarget: z.boolean().default(false),
  })
  .strict();

export type SetThresholdDto = z.infer<typeof setThresholdSchema>;

export const trendSchema = z.object({
  branchId: z.string().uuid().optional(),
  limit: z.coerce.number().int().positive().max(60).default(24),
});

export type TrendDto = z.infer<typeof trendSchema>;
