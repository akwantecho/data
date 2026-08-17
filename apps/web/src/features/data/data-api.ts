import type {
  CreateDataSourceRequest,
  DataQualityReport,
  DataSourceSummary,
  ImportCommitResult,
  ImportMappingRequest,
  ImportPreview,
  ImportRowDetail,
  ImportSummary,
  ImportValidationReport,
  Paginated,
  UpdateDataSourceRequest,
} from '@sip/shared-types';
import { API_BASE_URL, ApiError, apiRequest } from '../../lib/api-client';

export const dataKeys = {
  sources: ['data-sources'] as const,
  imports: (page: number) => ['imports', { page }] as const,
  import: (id: string) => ['imports', id] as const,
  importRows: (id: string, status: string) => ['imports', id, 'rows', status] as const,
  quality: ['data-quality'] as const,
};

export function fetchDataSources(): Promise<DataSourceSummary[]> {
  return apiRequest<DataSourceSummary[]>('/data-sources');
}

export function createDataSource(body: CreateDataSourceRequest): Promise<DataSourceSummary> {
  return apiRequest<DataSourceSummary>('/data-sources', { method: 'POST', body });
}

export function updateDataSource(
  id: string,
  body: UpdateDataSourceRequest,
): Promise<DataSourceSummary> {
  return apiRequest<DataSourceSummary>(`/data-sources/${id}`, { method: 'PATCH', body });
}

export function deleteDataSource(id: string): Promise<void> {
  return apiRequest<void>(`/data-sources/${id}`, { method: 'DELETE' });
}

/**
 * Uploads the file itself.
 *
 * `fetch` must not be given a Content-Type here: the browser has to set the
 * multipart boundary, so this is the one request that bypasses `apiRequest`.
 */
export async function uploadImport(file: File, dataSourceId?: string): Promise<ImportPreview> {
  const form = new FormData();
  form.append('file', file);

  if (dataSourceId) {
    form.append('dataSourceId', dataSourceId);
  }

  const response = await fetch(`${API_BASE_URL}/imports/upload`, {
    method: 'POST',
    body: form,
    credentials: 'include',
  });

  if (!response.ok) {
    const body = await response
      .json()
      .catch(() => ({ code: 'INTERNAL_ERROR', message: 'The upload failed.', details: [] }));

    throw new ApiError(response.status, body);
  }

  return (await response.json()) as ImportPreview;
}

export function mapImport(id: string, mapping: ImportMappingRequest): Promise<ImportSummary> {
  return apiRequest<ImportSummary>(`/imports/${id}/map`, { method: 'POST', body: mapping });
}

export function validateImport(id: string): Promise<ImportValidationReport> {
  return apiRequest<ImportValidationReport>(`/imports/${id}/validate`, { method: 'POST' });
}

export function commitImport(id: string): Promise<ImportCommitResult> {
  return apiRequest<ImportCommitResult>(`/imports/${id}/commit`, { method: 'POST' });
}

export function cancelImport(id: string): Promise<ImportSummary> {
  return apiRequest<ImportSummary>(`/imports/${id}/cancel`, { method: 'POST' });
}

export function fetchImports(page: number): Promise<Paginated<ImportSummary>> {
  return apiRequest<Paginated<ImportSummary>>(`/imports?page=${page}&pageSize=20`);
}

export function fetchImport(id: string): Promise<ImportValidationReport> {
  return apiRequest<ImportValidationReport>(`/imports/${id}`);
}

export function fetchImportRows(id: string, status?: string): Promise<Paginated<ImportRowDetail>> {
  const query = status ? `?status=${status}&pageSize=50` : '?pageSize=50';
  return apiRequest<Paginated<ImportRowDetail>>(`/imports/${id}/rows${query}`);
}

export function fetchDataQuality(): Promise<DataQualityReport> {
  return apiRequest<DataQualityReport>('/data-quality');
}
