import type {
  IndustryPackDetail,
  IndustryPackInstallResult,
  IndustryPackOverview,
  IndustryPackSummary,
  IndustryPackSyncResult,
} from '@sip/shared-types';
import { apiRequest } from '../../lib/api-client';

export const packKeys = {
  overview: ['industry-packs', 'overview'] as const,
  detail: (id: string) => ['industry-packs', id] as const,
  platformList: ['platform', 'industry-packs'] as const,
  platformDetail: (id: string) => ['platform', 'industry-packs', id] as const,
};

export function fetchPackOverview(): Promise<IndustryPackOverview> {
  return apiRequest<IndustryPackOverview>('/industry-packs');
}

export function fetchPack(id: string): Promise<IndustryPackDetail> {
  return apiRequest<IndustryPackDetail>(`/industry-packs/${id}`);
}

export function installPack(id: string): Promise<IndustryPackInstallResult> {
  return apiRequest<IndustryPackInstallResult>(`/industry-packs/${id}/install`, { method: 'POST' });
}

export function fetchPlatformPacks(): Promise<IndustryPackSummary[]> {
  return apiRequest<IndustryPackSummary[]>('/platform/industry-packs');
}

export function fetchPlatformPack(id: string): Promise<IndustryPackDetail> {
  return apiRequest<IndustryPackDetail>(`/platform/industry-packs/${id}`);
}

export function syncPacks(): Promise<IndustryPackSyncResult> {
  return apiRequest<IndustryPackSyncResult>('/platform/industry-packs/sync', { method: 'POST' });
}
