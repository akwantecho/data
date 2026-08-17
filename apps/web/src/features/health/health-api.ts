import type {
  AlertDetail,
  AlertSummary,
  AnalysisRun,
  HealthCurrent,
  HealthHistoryPoint,
  InsightSummary,
  Paginated,
  UpdateAlertStatusRequest,
} from '@sip/shared-types';
import { apiRequest } from '../../lib/api-client';

export const healthKeys = {
  current: (branchId: string) => ['health', 'current', branchId] as const,
  history: (branchId: string) => ['health', 'history', branchId] as const,
  alerts: (query: Record<string, string | undefined>) => ['alerts', query] as const,
  alert: (id: string) => ['alerts', id] as const,
  insights: (query: Record<string, string | undefined>) => ['insights', query] as const,
};

function toQueryString(query: Record<string, string | undefined>): string {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(query)) {
    if (value) {
      params.set(key, value);
    }
  }

  const serialised = params.toString();

  return serialised ? `?${serialised}` : '';
}

export function fetchHealthCurrent(branchId?: string): Promise<HealthCurrent> {
  return apiRequest<HealthCurrent>(`/health/current${toQueryString({ branchId })}`);
}

export function fetchHealthHistory(branchId?: string): Promise<HealthHistoryPoint[]> {
  return apiRequest<HealthHistoryPoint[]>(`/health/history${toQueryString({ branchId })}`);
}

export function fetchAlerts(
  query: Record<string, string | undefined>,
): Promise<Paginated<AlertSummary>> {
  return apiRequest<Paginated<AlertSummary>>(`/alerts${toQueryString(query)}`);
}

export function fetchAlert(id: string): Promise<AlertDetail> {
  return apiRequest<AlertDetail>(`/alerts/${id}`);
}

export function setAlertStatus(id: string, body: UpdateAlertStatusRequest): Promise<AlertDetail> {
  return apiRequest<AlertDetail>(`/alerts/${id}/status`, { method: 'PATCH', body });
}

export function fetchInsights(
  query: Record<string, string | undefined>,
): Promise<Paginated<InsightSummary>> {
  return apiRequest<Paginated<InsightSummary>>(`/insights${toQueryString(query)}`);
}

/** Runs health, alerts and insights for the latest period, in that order. */
export function runAnalysis(): Promise<AnalysisRun> {
  return apiRequest<AnalysisRun>('/analysis/run', { method: 'POST' });
}
