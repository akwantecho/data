import type {
  AggregationType,
  AlertSeverity,
  MetricDirection,
  MetricFrequency,
  MetricUnit,
} from './enums.js';

/**
 * An industry pack is a versioned bundle of default metrics, a health model and
 * deterministic rules for one industry (plan §17). It is data: installing one
 * writes ordinary tenant rows, and nothing about an industry is hard-coded into
 * the engines that read them.
 */
export interface IndustryPackSummary {
  id: string;
  code: string;
  name: string;
  description: string | null;
  version: string;
  industryId: string;
  industryName: string;
  metricCount: number;
  insightRuleCount: number;
  alertRuleCount: number;
  healthCategoryCount: number;
  /** Set when the calling organization has this pack installed. */
  installedVersion: string | null;
  installedAt: string | null;
}

export interface IndustryPackMetricSummary {
  code: string;
  name: string;
  description: string | null;
  category: string | null;
  unit: MetricUnit;
  aggregationType: AggregationType;
  frequency: MetricFrequency;
  direction: MetricDirection;
  formula: string | null;
}

export interface IndustryPackHealthCategorySummary {
  code: string;
  name: string;
  weight: string;
  metrics: Array<{ code: string; weight: string }>;
}

export interface IndustryPackRuleSummary {
  code: string;
  name: string;
  description: string | null;
  severity: AlertSeverity;
  /** Metric codes the rule reads — every rule states its own evidence. */
  metrics: string[];
}

export interface IndustryPackDetail extends IndustryPackSummary {
  metrics: IndustryPackMetricSummary[];
  healthModel: {
    name: string;
    categories: IndustryPackHealthCategorySummary[];
  } | null;
  insightRules: IndustryPackRuleSummary[];
  alertRules: IndustryPackRuleSummary[];
}

/** What an installation actually did, so the result can be reported and audited. */
export interface IndustryPackInstallResult {
  packCode: string;
  version: string;
  metricsCreated: number;
  /** Metrics already present under the same code, left exactly as the tenant had them. */
  metricsKept: number;
  healthModelCreated: boolean;
  healthCategoriesCreated: number;
  insightRulesCreated: number;
  insightRulesKept: number;
  alertRulesCreated: number;
  alertRulesKept: number;
}

export interface InstalledHealthModelSummary {
  id: string;
  name: string;
  categories: Array<{
    code: string;
    name: string;
    weight: string;
    metrics: Array<{ code: string; name: string; weight: string }>;
  }>;
}

/** Everything the organization settings card needs in one request. */
export interface IndustryPackOverview {
  industryId: string | null;
  industryName: string | null;
  available: IndustryPackSummary[];
  healthModel: InstalledHealthModelSummary | null;
  insightRuleCount: number;
  alertRuleCount: number;
  systemMetricCount: number;
}

/** Result of syncing the shipped catalogue into the database (platform admin). */
export interface IndustryPackSyncResult {
  packs: Array<{
    code: string;
    version: string;
    templateMetricsCreated: number;
    templateMetricsUpdated: number;
    insightRules: number;
    alertRules: number;
  }>;
}
