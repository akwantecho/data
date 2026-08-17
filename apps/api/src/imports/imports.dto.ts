import { z } from 'zod';

export const importMappingSchema = z
  .object({
    metricCode: z.string().trim().min(1, 'A metric column is required'),
    period: z.string().trim().min(1, 'A period column is required'),
    value: z.string().trim().min(1, 'A value column is required'),
    branchCode: z.string().trim().min(1).nullish(),
    departmentCode: z.string().trim().min(1).nullish(),
    currency: z.string().trim().min(1).nullish(),
  })
  .strict();

export type ImportMappingDto = z.infer<typeof importMappingSchema>;

export const uploadImportSchema = z.object({
  dataSourceId: z.string().uuid('A valid data source id is required').optional(),
});

export type UploadImportDto = z.infer<typeof uploadImportSchema>;

export const listImportsSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
});

export type ListImportsDto = z.infer<typeof listImportsSchema>;

export const listRowsSchema = z.object({
  status: z.enum(['VALID', 'WARNING', 'REJECTED']).optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(200).default(50),
});

export type ListRowsDto = z.infer<typeof listRowsSchema>;
