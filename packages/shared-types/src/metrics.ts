import type {
  AggregationType,
  MetricDirection,
  MetricFrequency,
  MetricUnit,
  PeriodType,
} from './enums.js';

export interface MetricSummary {
  id: string;
  code: string;
  name: string;
  description: string | null;
  category: string | null;
  unit: MetricUnit;
  aggregationType: AggregationType;
  frequency: MetricFrequency;
  direction: MetricDirection;
  /** True when the metric is derived from a formula rather than imported. */
  isCalculated: boolean;
  formula: string | null;
  /** System metrics come from an industry pack and cannot be deleted. */
  isSystem: boolean;
  isActive: boolean;
  valueCount: number;
  latestValue: MetricValuePoint | null;
}

export interface MetricValuePoint {
  periodType: PeriodType;
  periodStart: string;
  periodEnd: string;
  value: string;
  branchId: string | null;
  branchName: string | null;
  departmentId: string | null;
  departmentName: string | null;
  isCalculated: boolean;
  sourceType: string;
  updatedAt: string;
}

export interface MetricTargetSummary {
  id: string;
  periodType: PeriodType;
  periodStart: string;
  periodEnd: string;
  targetValue: string;
  minValue: string | null;
  maxValue: string | null;
  branchId: string | null;
}

export interface MetricThresholdSummary {
  warningValue: string | null;
  criticalValue: string | null;
  isRelativeToTarget: boolean;
}

/** Everything the metric detail page needs (plan §25). */
export interface MetricDetail {
  metric: MetricSummary;
  /** Metric codes this formula reads. */
  dependencies: string[];
  /** Formula metrics that read this one. */
  dependents: string[];
  currentValue: MetricValuePoint | null;
  previousValue: MetricValuePoint | null;
  changePct: string | null;
  target: MetricTargetSummary | null;
  /** Signed difference to target as a percentage, when both are known. */
  varianceToTargetPct: string | null;
  threshold: MetricThresholdSummary | null;
  thresholdStatus: ThresholdStatus;
  trend: MetricValuePoint[];
  lastUpdatedAt: string | null;
}

export const THRESHOLD_STATUSES = ['OK', 'WARNING', 'CRITICAL', 'UNKNOWN'] as const;
export type ThresholdStatus = (typeof THRESHOLD_STATUSES)[number];

export interface CreateMetricRequest {
  code: string;
  name: string;
  description?: string | null;
  category?: string | null;
  unit: MetricUnit;
  aggregationType: AggregationType;
  frequency: MetricFrequency;
  direction: MetricDirection;
  /** Required when aggregationType is FORMULA. */
  formula?: string | null;
}

export type UpdateMetricRequest = Partial<CreateMetricRequest> & { isActive?: boolean };

export interface ManualValueRequest {
  metricId: string;
  /** Period label, e.g. 2026-01, 2026-Q1, 2026-W05, 2026 or 2026-01-31. */
  period: string;
  value: string;
  branchId?: string | null;
  departmentId?: string | null;
}

export interface SetTargetRequest {
  period: string;
  targetValue: string;
  minValue?: string | null;
  maxValue?: string | null;
  branchId?: string | null;
}

export interface SetThresholdRequest {
  warningValue?: string | null;
  criticalValue?: string | null;
  isRelativeToTarget?: boolean;
}

/** Outcome of recalculating formula metrics (plan §42 Sprint 4). */
export interface RecalculationResult {
  calculated: number;
  skipped: RecalculationSkip[];
}

export interface RecalculationSkip {
  metricCode: string;
  period: string;
  reason: 'MISSING_INPUT' | 'DIVISION_BY_ZERO';
  detail: string;
}
