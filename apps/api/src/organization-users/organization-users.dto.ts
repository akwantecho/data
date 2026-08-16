import { ORGANIZATION_ROLES } from '@sip/shared-types';
import { z } from 'zod';

/**
 * Minimum strength for an initial password set by an administrator.
 * Length is the property that matters most, so it leads.
 */
export const passwordSchema = z
  .string()
  .min(12, 'Password must be at least 12 characters')
  .max(256)
  .refine((value) => /[a-z]/.test(value) && /[A-Z]/.test(value) && /[0-9]/.test(value), {
    message: 'Password must include lower case, upper case and a number',
  });

export const addMemberSchema = z
  .object({
    email: z.string().trim().toLowerCase().email('A valid email address is required'),
    role: z.enum(ORGANIZATION_ROLES),
    fullName: z.string().trim().min(2).max(120).optional(),
    temporaryPassword: passwordSchema.optional(),
  })
  .strict();

export type AddMemberDto = z.infer<typeof addMemberSchema>;

export const updateMemberSchema = z.object({
  role: z.enum(ORGANIZATION_ROLES),
});

export type UpdateMemberDto = z.infer<typeof updateMemberSchema>;
