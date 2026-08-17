import { ALERT_SEVERITIES } from '@sip/shared-types';
import { z } from 'zod';

export const listInsightsSchema = z.object({
  severity: z.enum(ALERT_SEVERITIES).optional(),
  category: z.string().trim().min(1).max(80).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export type ListInsightsDto = z.infer<typeof listInsightsSchema>;
