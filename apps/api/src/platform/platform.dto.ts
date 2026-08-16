import { ORGANIZATION_STATUSES } from '@sip/shared-types';
import { z } from 'zod';

export const paginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(25),
});

export type PaginationDto = z.infer<typeof paginationSchema>;

export const updateOrganizationStatusSchema = z.object({
  status: z.enum(ORGANIZATION_STATUSES),
});

export type UpdateOrganizationStatusDto = z.infer<typeof updateOrganizationStatusSchema>;
