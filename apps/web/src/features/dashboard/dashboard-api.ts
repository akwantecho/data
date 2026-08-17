import type {
  AnalyticsOptions,
  ComparisonBreakdown,
  ComparisonResult,
  DashboardOverview,
  MetricAnalyticsDetail,
} from '@sip/shared-types';
import { apiRequest } from '../../lib/api-client';

export interface AnalyticsQuery {
  [key: string]: string | undefined;
  from?: string;
  to?: string;
  branchId?: string;
  departmentId?: string;
}

export const analyticsKeys = {
  options: ['analytics', 'options'] as const,
  overview: (query: AnalyticsQuery) => ['dashboard', 'overview', query] as const,
  metric: (metricId: string, query: AnalyticsQuery) =>
    ['analytics', 'metric', metricId, query] as const,
  comparison: (query: Record<string, string | undefined>) =>
    ['analytics', 'comparison', query] as const,
};

/** Empty values are dropped so the API applies its own defaults. */
export function toQueryString(query: Record<string, string | undefined>): string {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(query)) {
    if (value) {
      params.set(key, value);
    }
  }

  const serialised = params.toString();

  return serialised ? `?${serialised}` : '';
}

export function fetchAnalyticsOptions(): Promise<AnalyticsOptions> {
  return apiRequest<AnalyticsOptions>('/analytics/options');
}

export function fetchOverview(query: AnalyticsQuery): Promise<DashboardOverview> {
  return apiRequest<DashboardOverview>(`/dashboard/overview${toQueryString(query)}`);
}

export function fetchMetricAnalytics(
  metricId: string,
  query: AnalyticsQuery,
): Promise<MetricAnalyticsDetail> {
  return apiRequest<MetricAnalyticsDetail>(`/analytics/metric/${metricId}${toQueryString(query)}`);
}

export function fetchComparison(
  query: AnalyticsQuery & { breakdown: ComparisonBreakdown; metricId?: string },
): Promise<ComparisonResult> {
  return apiRequest<ComparisonResult>(`/analytics/comparison${toQueryString(query)}`);
}
