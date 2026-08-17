import { DATA_SOURCE_STATUSES, DATA_SOURCE_TYPES } from '@sip/shared-types';
import { z } from 'zod';

export const createDataSourceSchema = z
  .object({
    name: z.string().trim().min(2, 'Name must be at least 2 characters').max(120),
    type: z.enum(DATA_SOURCE_TYPES),
  })
  .strict();

export type CreateDataSourceDto = z.infer<typeof createDataSourceSchema>;

export const updateDataSourceSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    status: z.enum(DATA_SOURCE_STATUSES),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'No changes were provided');

export type UpdateDataSourceDto = z.infer<typeof updateDataSourceSchema>;
