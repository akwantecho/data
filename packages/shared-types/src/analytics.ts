import type { AggregationType, MetricDirection, MetricUnit, PeriodType } from './enums.js';
import type { ThresholdStatus } from './metrics.js';

/**
 * Filters every dashboard and analytics query accepts (plan §21).
 *
 * The window is a date range over period starts. `branchId` and `departmentId`
 * narrow the slice; without them the figures are organization-wide.
 */
export interface AnalyticsFilters {
  from: string;
  to: string;
  branchId: string | null;
  departmentId: string | null;
}

/** What a filter selection resolved to, echoed back so the UI can label it. */
export interface ResolvedWindow extends AnalyticsFilters {
  /** The equally long window immediately before this one. */
  previousFrom: string;
  previousTo: string;
  branchName: string | null;
  departmentName: string | null;
}

/** One aggregated point in a series. */
export interface SeriesPoint {
  periodStart: string;
  periodType: PeriodType;
  value: string;
}

/**
 * A metric summarised over the window: the aggregate, the same aggregate over the
 * preceding window, and everything derived from the two. Every number here is
 * computed on the server (plan §5).
 */
export interface MetricAnalytics {
  metricId: string;
  code: string;
  name: string;
  category: string | null;
  unit: MetricUnit;
  direction: MetricDirection;
  aggregationType: AggregationType;
  formula: string | null;
  /** How the window figure was produced — see docs/analytics.md. */
  aggregation: AggregationMethod;
  current: string | null;
  previous: string | null;
  changePct: string | null;
  target: string | null;
  /** How many periods in the window actually carry a target. */
  targetPeriods: number;
  /**
   * The metric aggregated over exactly those periods — the figure the target is
   * comparable to. Equal to `current` when targets cover the whole window.
   */
  comparedToTarget: string | null;
  varianceToTargetPct: string | null;
  thresholdStatus: ThresholdStatus;
  series: SeriesPoint[];
  previousSeries: SeriesPoint[];
  /** Periods inside the window that reported no value at all. */
  missingPeriods: number;
}

export const AGGREGATION_METHODS = [
  'SUM',
  'AVERAGE',
  'LAST',
  'MIN',
  'MAX',
  'RECOMPUTED_FROM_INPUTS',
  'NONE',
] as const;
export type AggregationMethod = (typeof AGGREGATION_METHODS)[number];

/** Counts of where the organization's metrics stand against their thresholds. */
export interface PerformanceSummary {
  ok: number;
  warning: number;
  critical: number;
  unknown: number;
  onTarget: number;
  belowTarget: number;
  withoutTarget: number;
}

export interface DashboardOverview {
  window: ResolvedWindow;
  /** KPI cards, chosen from the organization's own health model (ADR-0010). */
  kpis: MetricAnalytics[];
  /** The metric the headline trend chart shows, and its series. */
  headline: MetricAnalytics | null;
  performance: PerformanceSummary;
  health: DashboardHealth | null;
  dataQuality: { score: number; level: string; lastImportAt: string | null } | null;
  attention: DashboardAttention;
  metricCount: number;
}

/**
 * The installed health model. Scores are calculated in Sprint 7; until then the
 * model is shown with `overallScore: null` rather than a fabricated number.
 */
export interface DashboardHealth {
  modelName: string;
  overallScore: number | null;
  band: string | null;
  categories: Array<{ code: string; name: string; weight: string; score: number | null }>;
}

/** Open items competing for management attention (plan §21). */
export interface DashboardAttention {
  alerts: Array<{
    id: string;
    title: string;
    severity: string;
    status: string;
    createdAt: string;
  }>;
  insights: Array<{ id: string; title: string; severity: string; createdAt: string }>;
  goals: Array<{ id: string; title: string; status: string; progressPct: string | null }>;
  decisions: Array<{ id: string; title: string; status: string; createdAt: string }>;
}

/** Analytics for one metric (plan §24). */
export interface MetricAnalyticsDetail {
  window: ResolvedWindow;
  metric: MetricAnalytics;
  /** Metrics this one is derived from, and metrics derived from it. */
  inputs: MetricAnalytics[];
  dependents: MetricAnalytics[];
  /** Other metrics in the same category, for context. */
  related: MetricAnalytics[];
}

export const COMPARISON_BREAKDOWNS = ['BRANCH', 'DEPARTMENT', 'METRIC'] as const;
export type ComparisonBreakdown = (typeof COMPARISON_BREAKDOWNS)[number];

/** One row of a comparison: a branch, a department or a metric. */
export interface ComparisonRow {
  key: string;
  label: string;
  current: string | null;
  previous: string | null;
  changePct: string | null;
  target: string | null;
  varianceToTargetPct: string | null;
  series: SeriesPoint[];
}

export interface ComparisonResult {
  window: ResolvedWindow;
  breakdown: ComparisonBreakdown;
  /** Set when the comparison is of one metric across slices. */
  metric: { id: string; code: string; name: string; unit: MetricUnit } | null;
  rows: ComparisonRow[];
}

/** The filter bar's options, so the client never invents ids. */
export interface AnalyticsOptions {
  metrics: Array<{ id: string; code: string; name: string; category: string | null }>;
  branches: Array<{ id: string; name: string }>;
  departments: Array<{ id: string; name: string; branchId: string | null }>;
  /** Earliest and latest period with any stored value, for sensible defaults. */
  earliestPeriod: string | null;
  latestPeriod: string | null;
}
