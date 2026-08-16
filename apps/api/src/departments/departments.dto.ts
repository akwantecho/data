import { z } from 'zod';
import { codeSchema } from '../branches/branches.dto';

export const createDepartmentSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(120),
  code: codeSchema,
  /** Null means the department belongs to the organization rather than one branch. */
  branchId: z.string().uuid('A valid branch id is required').nullish(),
});

export type CreateDepartmentDto = z.infer<typeof createDepartmentSchema>;

export const updateDepartmentSchema = createDepartmentSchema
  .extend({ isActive: z.boolean() })
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'No changes were provided');

export type UpdateDepartmentDto = z.infer<typeof updateDepartmentSchema>;

export const listDepartmentsSchema = z.object({
  branchId: z.string().uuid().optional(),
  includeInactive: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .default(false)
    .transform((value) => value === true || value === 'true'),
});

export type ListDepartmentsDto = z.infer<typeof listDepartmentsSchema>;
