import type {
  DataSourceStatus,
  DataSourceType,
  ImportStatus,
  ValidationSeverity,
} from './enums.js';

export interface DataSourceSummary {
  id: string;
  name: string;
  type: DataSourceType;
  status: DataSourceStatus;
  lastSyncAt: string | null;
  importCount: number;
  createdAt: string;
}

export interface CreateDataSourceRequest {
  name: string;
  type: DataSourceType;
}

export interface UpdateDataSourceRequest {
  name?: string;
  status?: DataSourceStatus;
}

/**
 * Which uploaded column fills each field the importer needs.
 * `metricCode`, `period` and `value` are required; the rest are optional.
 */
export interface ImportMappingRequest {
  metricCode: string;
  period: string;
  value: string;
  branchCode?: string | null;
  departmentCode?: string | null;
  currency?: string | null;
}

export interface ImportSummary {
  id: string;
  fileName: string;
  fileSizeBytes: number;
  status: ImportStatus;
  dataSourceId: string | null;
  dataSourceName: string | null;
  mapping: ImportMappingRequest | null;
  rowsReceived: number;
  rowsValid: number;
  rowsWarning: number;
  rowsRejected: number;
  committedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ImportPreviewRow {
  rowNumber: number;
  data: Record<string, string>;
}

/** Response of the upload step: what was parsed, plus a suggested mapping. */
export interface ImportPreview {
  import: ImportSummary;
  columns: string[];
  suggestedMapping: ImportMappingRequest;
  sampleRows: ImportPreviewRow[];
  /** Metric codes the organization accepts, so the UI can explain mismatches. */
  availableMetricCodes: string[];
}

export interface ImportIssue {
  rowNumber: number | null;
  column: string | null;
  code: string;
  message: string;
  severity: ValidationSeverity;
}

/** Response of the validate step. */
export interface ImportValidationReport {
  import: ImportSummary;
  issues: ImportIssue[];
  /** True when the report lists only part of the issues. */
  issuesTruncated: boolean;
}

export interface ImportRowDetail {
  rowNumber: number;
  status: 'VALID' | 'WARNING' | 'REJECTED';
  data: Record<string, string>;
  issues: ImportIssue[];
}

export interface ImportCommitResult {
  import: ImportSummary;
  /** Metric values written or updated by the commit. */
  valuesWritten: number;
}

export const DATA_QUALITY_LEVELS = ['GOOD', 'FAIR', 'POOR', 'UNKNOWN'] as const;
export type DataQualityLevel = (typeof DATA_QUALITY_LEVELS)[number];

export interface DataQualityReport {
  /** 0–100, rule-based (plan §16). */
  overallScore: number;
  completenessPct: number;
  validityPct: number;
  freshness: DataQualityLevel;
  daysSinceLastImport: number | null;
  errorCount: number;
  lastUpdatedAt: string | null;
  confidence: DataQualityLevel;
  sources: DataQualitySource[];
}

export interface DataQualitySource {
  dataSourceId: string | null;
  dataSourceName: string;
  lastImportAt: string | null;
  rowsReceived: number;
  rowsRejected: number;
  validityPct: number;
  freshness: DataQualityLevel;
}
