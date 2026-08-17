/**
 * Universal domain vocabulary.
 *
 * These values are the contract between the database (Prisma enums), the API and
 * the web client. They intentionally describe *generic* concepts only — anything
 * industry specific (patients, rooms, units) lives inside an industry pack, never
 * here. See docs/architecture.md §"Universal Core".
 */

export const PLATFORM_ROLES = ['PLATFORM_ADMIN'] as const;
export type PlatformRole = (typeof PLATFORM_ROLES)[number];

export const ORGANIZATION_ROLES = ['ORGANIZATION_ADMIN', 'ANALYST', 'VIEWER'] as const;
export type OrganizationRole = (typeof ORGANIZATION_ROLES)[number];

export const ORGANIZATION_STATUSES = ['ACTIVE', 'SUSPENDED', 'ARCHIVED'] as const;
export type OrganizationStatus = (typeof ORGANIZATION_STATUSES)[number];

export const USER_STATUSES = ['ACTIVE', 'INVITED', 'DISABLED'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const METRIC_UNITS = [
  'CURRENCY',
  'PERCENTAGE',
  'COUNT',
  'DECIMAL',
  'RATIO',
  'DAYS',
  'HOURS',
  'MINUTES',
  'SCORE',
] as const;
export type MetricUnit = (typeof METRIC_UNITS)[number];

/** Period a stored value belongs to; mirrors the metric frequencies. */
export const PERIOD_TYPES = ['DAY', 'WEEK', 'MONTH', 'QUARTER', 'YEAR'] as const;
export type PeriodType = (typeof PERIOD_TYPES)[number];

export const METRIC_FREQUENCIES = ['DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY'] as const;
export type MetricFrequency = (typeof METRIC_FREQUENCIES)[number];

export const METRIC_DIRECTIONS = [
  'HIGHER_IS_BETTER',
  'LOWER_IS_BETTER',
  'TARGET_RANGE',
  'INFORMATIONAL',
] as const;
export type MetricDirection = (typeof METRIC_DIRECTIONS)[number];

export const AGGREGATION_TYPES = ['SUM', 'AVERAGE', 'LAST', 'MIN', 'MAX', 'FORMULA'] as const;
export type AggregationType = (typeof AGGREGATION_TYPES)[number];

export const DATA_SOURCE_TYPES = ['MANUAL', 'CSV'] as const;
export type DataSourceType = (typeof DATA_SOURCE_TYPES)[number];

export const DATA_SOURCE_STATUSES = ['ACTIVE', 'INACTIVE', 'ERROR'] as const;
export type DataSourceStatus = (typeof DATA_SOURCE_STATUSES)[number];

export const IMPORT_STATUSES = [
  'UPLOADED',
  'MAPPED',
  'VALIDATED',
  'COMMITTED',
  'FAILED',
  'CANCELLED',
] as const;
export type ImportStatus = (typeof IMPORT_STATUSES)[number];

export const VALIDATION_SEVERITIES = ['WARNING', 'ERROR'] as const;
export type ValidationSeverity = (typeof VALIDATION_SEVERITIES)[number];

export const ALERT_SEVERITIES = ['INFO', 'WARNING', 'HIGH', 'CRITICAL'] as const;
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number];

export const ALERT_STATUSES = ['OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'DISMISSED'] as const;
export type AlertStatus = (typeof ALERT_STATUSES)[number];

export const GOAL_STATUSES = [
  'DRAFT',
  'ACTIVE',
  'ON_TRACK',
  'AT_RISK',
  'OFF_TRACK',
  'ACHIEVED',
  'CANCELLED',
] as const;
export type GoalStatus = (typeof GOAL_STATUSES)[number];

export const DECISION_STATUSES = [
  'DRAFT',
  'OPEN',
  'APPROVED',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
] as const;
export type DecisionStatus = (typeof DECISION_STATUSES)[number];

export const DECISION_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export type DecisionPriority = (typeof DECISION_PRIORITIES)[number];

export const DECISION_REVIEW_RESULTS = ['POSITIVE', 'NEUTRAL', 'NEGATIVE', 'INCONCLUSIVE'] as const;
export type DecisionReviewResult = (typeof DECISION_REVIEW_RESULTS)[number];

export const HEALTH_BANDS = ['HEALTHY', 'ATTENTION', 'RISK', 'CRITICAL'] as const;
export type HealthBand = (typeof HEALTH_BANDS)[number];

/**
 * Default health interpretation bands. Configurable per organization — these are
 * only the platform defaults (plan §26).
 */
export const DEFAULT_HEALTH_BANDS: ReadonlyArray<{ band: HealthBand; min: number; max: number }> = [
  { band: 'HEALTHY', min: 80, max: 100 },
  { band: 'ATTENTION', min: 60, max: 79.999999 },
  { band: 'RISK', min: 40, max: 59.999999 },
  { band: 'CRITICAL', min: 0, max: 39.999999 },
];
