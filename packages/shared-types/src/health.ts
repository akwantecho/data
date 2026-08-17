import type { AlertSeverity, AlertStatus, HealthBand, PeriodType } from './enums.js';

/**
 * How one metric scored inside a category (plan §26).
 *
 * A health score that cannot say which metric pulled it down is a number nobody
 * can act on, so every contribution is kept — including the ones that could not be
 * scored, and why.
 */
export interface HealthMetricScore {
  metricId: string;
  code: string;
  name: string;
  /** Weight as configured, 0–100 within the category. */
  weight: string;
  /** Weight after redistributing the unscorable metrics' share. */
  effectiveWeight: string;
  value: string | null;
  target: string | null;
  score: number | null;
  /** How the score was reached, or why there is none. */
  basis: HealthScoreBasis;
  contribution: number | null;
}

export const HEALTH_SCORE_BASES = [
  'TARGET',
  'THRESHOLDS',
  'TARGET_AND_THRESHOLDS',
  'TARGET_RANGE',
  'NO_VALUE',
  'NO_BENCHMARK',
  'INFORMATIONAL',
] as const;
export type HealthScoreBasis = (typeof HEALTH_SCORE_BASES)[number];

export interface HealthCategoryScore {
  code: string;
  name: string;
  weight: string;
  effectiveWeight: string;
  score: number | null;
  band: HealthBand | null;
  metrics: HealthMetricScore[];
}

export interface HealthScoreSummary {
  periodType: PeriodType;
  periodStart: string;
  periodEnd: string;
  branchId: string | null;
  branchName: string | null;
  overallScore: number | null;
  band: HealthBand | null;
  categories: HealthCategoryScore[];
  /** Metrics the model weighs that could not be scored for this period. */
  unscoredMetrics: number;
  calculatedAt: string;
}

export interface HealthCurrent {
  modelId: string | null;
  modelName: string | null;
  bands: Array<{ band: HealthBand; min: number; max: number }>;
  current: HealthScoreSummary | null;
  previous: HealthScoreSummary | null;
  /** Difference against the previous period, in points. */
  changePoints: number | null;
}

export interface HealthHistoryPoint {
  periodType: PeriodType;
  periodStart: string;
  overallScore: number;
  band: HealthBand;
}

export interface HealthRecalculationResult {
  periodsScored: number;
  skipped: Array<{ period: string; reason: string }>;
}

/** An alert, with the numbers that produced it (plan §27). */
export interface AlertSummary {
  id: string;
  ruleCode: string | null;
  ruleName: string | null;
  ruleType: string | null;
  metricId: string | null;
  metricCode: string | null;
  metricName: string | null;
  severity: AlertSeverity;
  status: AlertStatus;
  title: string;
  description: string;
  periodType: PeriodType | null;
  periodStart: string | null;
  evidence: AlertEvidence;
  createdAt: string;
  updatedAt: string;
}

export interface AlertEvidence {
  /** Plain-language statement of what was compared with what. */
  statement: string;
  figures: Array<{ label: string; value: string | null }>;
}

export interface AlertDetail extends AlertSummary {
  events: Array<{
    id: string;
    fromStatus: AlertStatus | null;
    toStatus: AlertStatus;
    note: string | null;
    actorName: string | null;
    createdAt: string;
  }>;
}

export interface UpdateAlertStatusRequest {
  status: AlertStatus;
  note?: string | null;
}

export interface AlertEvaluationResult {
  created: number;
  resolved: number;
  unchanged: number;
  rulesEvaluated: number;
}

/** An insight, which is worthless without the figures behind it (plan §28). */
export interface InsightSummary {
  id: string;
  ruleCode: string | null;
  ruleName: string | null;
  title: string;
  narrative: string;
  category: string | null;
  severity: AlertSeverity;
  periodType: PeriodType | null;
  periodStart: string | null;
  evidence: InsightEvidenceItem[];
  createdAt: string;
}

export interface InsightEvidenceItem {
  metricId: string | null;
  label: string;
  value: string | null;
  changePct: string | null;
  detail: Record<string, unknown> | null;
}

export interface InsightGenerationResult {
  created: number;
  unchanged: number;
  rulesEvaluated: number;
}

/** Running all three engines for a period, as an import commit does. */
export interface AnalysisRunResult {
  period: string;
  health: HealthRecalculationResult;
  alerts: AlertEvaluationResult;
  insights: InsightGenerationResult;
}
