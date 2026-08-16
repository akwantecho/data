import { z } from 'zod';

/**
 * Only fields a tenant admin may change. `industryId`, `status` and `slug` are
 * deliberately absent: changing the industry after data exists needs the guarded
 * flow from plan §37, and status is platform-controlled.
 */
export const updateOrganizationSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    countryCode: z.string().trim().toUpperCase().length(2, 'Country must be a 2-letter ISO code'),
    currencyCode: z.string().trim().toUpperCase().length(3, 'Currency must be a 3-letter ISO code'),
    timezone: z.string().trim().min(1).max(64).refine(isValidTimezone, 'Unknown timezone'),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'No changes were provided');

export type UpdateOrganizationDto = z.infer<typeof updateOrganizationSchema>;

function isValidTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export const setIndustrySchema = z.object({
  industryId: z.string().uuid('A valid industry id is required'),
});

export type SetIndustryDto = z.infer<typeof setIndustrySchema>;
