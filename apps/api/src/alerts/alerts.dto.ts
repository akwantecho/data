import { ALERT_SEVERITIES, ALERT_STATUSES } from '@sip/shared-types';
import { z } from 'zod';

export const listAlertsSchema = z.object({
  status: z.enum(ALERT_STATUSES).optional(),
  severity: z.enum(ALERT_SEVERITIES).optional(),
  metricId: z.string().uuid('A valid metric is required').optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export type ListAlertsDto = z.infer<typeof listAlertsSchema>;

export const updateAlertStatusSchema = z
  .object({
    status: z.enum(ALERT_STATUSES),
    /** Why — recorded on the transition, so a dismissal can be asked about later. */
    note: z.string().trim().max(500).nullish(),
  })
  .strict();

export type UpdateAlertStatusDto = z.infer<typeof updateAlertStatusSchema>;

/** Running the engines for one period, on demand. */
export const evaluatePeriodSchema = z
  .object({
    period: z.string().trim().min(4).optional(),
  })
  .strict();

export type EvaluatePeriodDto = z.infer<typeof evaluatePeriodSchema>;
