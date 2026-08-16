import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('A valid email address is required'),
  password: z.string().min(1, 'Password is required').max(256),
});

export type LoginDto = z.infer<typeof loginSchema>;

export const switchOrganizationSchema = z.object({
  organizationId: z.string().uuid('A valid organization id is required'),
});

export type SwitchOrganizationDto = z.infer<typeof switchOrganizationSchema>;
