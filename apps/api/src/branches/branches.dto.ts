import { z } from 'zod';

/** Codes are stable identifiers used by CSV imports, so they are constrained. */
export const codeSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2, 'Code must be at least 2 characters')
  .max(40)
  .regex(/^[a-z0-9][a-z0-9_-]*$/, 'Code may contain letters, numbers, hyphens and underscores');

const timezoneSchema = z.string().trim().min(1).max(64).refine(isValidTimezone, 'Unknown timezone');

const countrySchema = z
  .string()
  .trim()
  .toUpperCase()
  .length(2, 'Country must be a 2-letter ISO code');

export const createBranchSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(120),
  code: codeSchema,
  countryCode: countrySchema.nullish(),
  timezone: timezoneSchema.nullish(),
});

export type CreateBranchDto = z.infer<typeof createBranchSchema>;

export const updateBranchSchema = createBranchSchema
  .extend({ isActive: z.boolean() })
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'No changes were provided');

export type UpdateBranchDto = z.infer<typeof updateBranchSchema>;

export const listBranchesSchema = z.object({
  /** Inactive branches are hidden by default; settings screens ask for them. */
  includeInactive: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .default(false)
    .transform((value) => value === true || value === 'true'),
});

export type ListBranchesDto = z.infer<typeof listBranchesSchema>;

export function isValidTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}
