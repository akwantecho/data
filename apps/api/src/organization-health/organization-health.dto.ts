import { z } from 'zod';

export const healthQuerySchema = z.object({
  branchId: z.string().uuid('A valid branch is required').optional(),
  limit: z.coerce.number().int().min(1).max(60).default(24),
});

export type HealthQueryDto = z.infer<typeof healthQuerySchema>;
