import type {
  CreateMetricRequest,
  ManualValueRequest,
  MetricDetail,
  MetricSummary,
  MetricTargetSummary,
  MetricThresholdSummary,
  MetricValuePoint,
  RecalculationResult,
  SetTargetRequest,
  SetThresholdRequest,
  UpdateMetricRequest,
} from '@sip/shared-types';
import { apiRequest } from '../../lib/api-client';

export const metricKeys = {
  all: ['metrics'] as const,
  list: (includeInactive: boolean) => ['metrics', { includeInactive }] as const,
  detail: (id: string) => ['metrics', id] as const,
};

export function fetchMetrics(includeInactive: boolean): Promise<MetricSummary[]> {
  return apiRequest<MetricSummary[]>(`/metrics?includeInactive=${includeInactive}`);
}

export function fetchMetric(id: string): Promise<MetricDetail> {
  return apiRequest<MetricDetail>(`/metrics/${id}`);
}

export function createMetric(body: CreateMetricRequest): Promise<MetricSummary> {
  return apiRequest<MetricSummary>('/metrics', { method: 'POST', body });
}

export function updateMetric(id: string, body: UpdateMetricRequest): Promise<MetricSummary> {
  return apiRequest<MetricSummary>(`/metrics/${id}`, { method: 'PATCH', body });
}

export function deleteMetric(id: string): Promise<void> {
  return apiRequest<void>(`/metrics/${id}`, { method: 'DELETE' });
}

export function recordValue(
  id: string,
  body: Omit<ManualValueRequest, 'metricId'>,
): Promise<MetricValuePoint> {
  return apiRequest<MetricValuePoint>(`/metrics/${id}/values`, { method: 'POST', body });
}

export function setTarget(id: string, body: SetTargetRequest): Promise<MetricTargetSummary> {
  return apiRequest<MetricTargetSummary>(`/metrics/${id}/target`, { method: 'PUT', body });
}

export function setThreshold(
  id: string,
  body: SetThresholdRequest,
): Promise<MetricThresholdSummary> {
  return apiRequest<MetricThresholdSummary>(`/metrics/${id}/threshold`, { method: 'PUT', body });
}

export function recalculateMetrics(): Promise<RecalculationResult> {
  return apiRequest<RecalculationResult>('/metrics/recalculate', { method: 'POST' });
}
