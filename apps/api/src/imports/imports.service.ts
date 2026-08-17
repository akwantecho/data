import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { ImportStatus } from '@prisma/client';
import type {
  ImportCommitResult,
  ImportPreview,
  ImportRowDetail,
  ImportSummary,
  ImportValidationReport,
  Paginated,
} from '@sip/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { ApiException } from '../common/errors/api-exception';
import { AuditService } from '../audit/audit.service';
import { AnalysisService } from '../analysis/analysis.service';
import { CalculationService } from '../metrics/calculation.service';
import { parseCsv, suggestMapping } from './csv-parser';
import { validateRows, type ImportMapping, type MetricDefinition } from './validation';
import type { ImportMappingDto } from './imports.dto';

/** How many issues a validation report returns before truncating. */
const MAX_REPORTED_ISSUES = 200;

/** Identities deleted/inserted per statement when committing. */
const COMMIT_CHUNK_SIZE = 200;

const IMPORT_SELECT = {
  id: true,
  fileName: true,
  fileSizeBytes: true,
  status: true,
  dataSourceId: true,
  mapping: true,
  rowsReceived: true,
  rowsValid: true,
  rowsWarning: true,
  rowsRejected: true,
  committedAt: true,
  createdAt: true,
  updatedAt: true,
  dataSource: { select: { name: true } },
} as const;

/**
 * The CSV import pipeline (plan §14):
 *
 *   upload → preview → map → validate → commit
 *
 * Each step is persisted, so an import is an auditable operation rather than a
 * transient upload: the raw row survives alongside the parsed one, every rejection
 * is explained, and a commit is idempotent because metric values are keyed by
 * (metric, period, branch, department).
 */
@Injectable()
export class ImportsService {
  private readonly logger = new Logger(ImportsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly calculation: CalculationService,
    private readonly analysis: AnalysisService,
  ) {}

  async upload(
    organizationId: string,
    actorId: string,
    file: { originalname: string; size: number; buffer: Buffer },
    dataSourceId: string | undefined,
    ipAddress?: string,
  ): Promise<ImportPreview> {
    const checksum = createHash('sha256').update(file.buffer).digest('hex');

    await this.assertNotAlreadyImported(organizationId, checksum);
    await this.assertDataSourceBelongsToOrganization(organizationId, dataSourceId);

    const parsed = parseCsv(file.buffer);

    const created = await this.prisma.$transaction(async (tx) => {
      const dataImport = await tx.dataImport.create({
        data: {
          organizationId,
          dataSourceId: dataSourceId ?? null,
          fileName: file.originalname,
          fileSizeBytes: file.size,
          checksum,
          status: 'UPLOADED',
          rowsReceived: parsed.rows.length,
        },
        select: IMPORT_SELECT,
      });

      // The raw row is stored exactly as received; parsing decisions come later and
      // must always be re-checkable against what the file actually said.
      await tx.dataImportRow.createMany({
        data: parsed.rows.map((row, index) => ({
          dataImportId: dataImport.id,
          rowNumber: index + 1,
          rawData: row as Prisma.InputJsonValue,
          status: 'VALID' as const,
        })),
      });

      return dataImport;
    });

    await this.audit.record({
      actorId,
      organizationId,
      action: 'import.uploaded',
      entityType: 'data_import',
      entityId: created.id,
      after: { fileName: file.originalname, rows: parsed.rows.length },
      ipAddress,
    });

    const metrics = await this.loadMetrics(organizationId);

    return {
      import: toSummary(created),
      columns: parsed.columns,
      suggestedMapping: suggestMapping(
        parsed.columns,
      ) as unknown as ImportPreview['suggestedMapping'],
      sampleRows: parsed.rows.slice(0, 20).map((data, index) => ({ rowNumber: index + 1, data })),
      availableMetricCodes: [...metrics.values()].map((metric) => metric.code).sort(),
    };
  }

  /** Records which uploaded column fills each importer field. */
  async setMapping(
    organizationId: string,
    importId: string,
    actorId: string,
    mapping: ImportMappingDto,
    ipAddress?: string,
  ): Promise<ImportSummary> {
    const dataImport = await this.findEditable(organizationId, importId);
    const columns = await this.fileColumns(dataImport.id);

    const missing = Object.entries(mapping)
      .filter(([, column]) => typeof column === 'string' && column.length > 0)
      .filter(([, column]) => !columns.includes(column as string))
      .map(([field, column]) => ({
        field,
        message: `The file has no column "${column as string}"`,
      }));

    if (missing.length > 0) {
      throw ApiException.validation('The request could not be processed.', missing);
    }

    const updated = await this.prisma.dataImport.update({
      where: { id: dataImport.id },
      data: { mapping: mapping as Prisma.InputJsonValue, status: 'MAPPED' },
      select: IMPORT_SELECT,
    });

    await this.audit.record({
      actorId,
      organizationId,
      action: 'import.mapped',
      entityType: 'data_import',
      entityId: importId,
      after: mapping as Prisma.InputJsonValue,
      ipAddress,
    });

    return toSummary(updated);
  }

  /**
   * Validates every row against the organization's metrics, branches, departments
   * and currency, and stores the outcome. Re-running replaces the previous result,
   * so a mapping can be corrected and re-checked.
   */
  async validate(organizationId: string, importId: string): Promise<ImportValidationReport> {
    const dataImport = await this.findEditable(organizationId, importId);

    if (!dataImport.mapping) {
      throw ApiException.conflict('Map the columns before validating.');
    }

    const [organization, metrics, branches, departments, rows] = await Promise.all([
      this.prisma.organization.findUniqueOrThrow({
        where: { id: organizationId },
        select: { currencyCode: true },
      }),
      this.loadMetrics(organizationId),
      this.loadCodes('branch', organizationId),
      this.loadCodes('department', organizationId),
      this.prisma.dataImportRow.findMany({
        where: { dataImportId: dataImport.id },
        orderBy: { rowNumber: 'asc' },
        select: { id: true, rowNumber: true, rawData: true },
      }),
    ]);

    const summary = validateRows(
      rows.map((row) => row.rawData as Record<string, string>),
      {
        mapping: dataImport.mapping as unknown as ImportMapping,
        metrics,
        branches,
        departments,
        currencyCode: organization.currencyCode,
      },
    );

    const rowIdByNumber = new Map(rows.map((row) => [row.rowNumber, row.id]));

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.dataValidationError.deleteMany({ where: { dataImportId: dataImport.id } });

      for (const row of summary.rows) {
        await tx.dataImportRow.update({
          where: { id: rowIdByNumber.get(row.rowNumber) },
          data: {
            status: row.status,
            parsedData: row.parsed
              ? ({
                  metricCode: row.parsed.metricCode,
                  periodType: row.parsed.periodType,
                  periodStart: row.parsed.periodStart.toISOString().slice(0, 10),
                  value: row.parsed.value,
                  branchId: row.parsed.branchId,
                  departmentId: row.parsed.departmentId,
                } as Prisma.InputJsonValue)
              : Prisma.DbNull,
          },
        });
      }

      const issues = summary.rows.flatMap((row) =>
        row.issues.map((issue) => ({
          dataImportId: dataImport.id,
          rowId: rowIdByNumber.get(row.rowNumber) ?? null,
          rowNumber: row.rowNumber,
          column: issue.column ?? null,
          code: issue.code,
          message: issue.message,
          severity: issue.severity,
        })),
      );

      if (issues.length > 0) {
        await tx.dataValidationError.createMany({ data: issues });
      }

      return tx.dataImport.update({
        where: { id: dataImport.id },
        data: {
          status: 'VALIDATED',
          rowsReceived: summary.rowsReceived,
          rowsValid: summary.rowsValid,
          rowsWarning: summary.rowsWarning,
          rowsRejected: summary.rowsRejected,
        },
        select: IMPORT_SELECT,
      });
    });

    const stored = await this.prisma.dataValidationError.findMany({
      where: { dataImportId: dataImport.id },
      orderBy: [{ severity: 'asc' }, { rowNumber: 'asc' }],
      take: MAX_REPORTED_ISSUES + 1,
    });

    return {
      import: toSummary(updated),
      issues: stored.slice(0, MAX_REPORTED_ISSUES).map((issue) => ({
        rowNumber: issue.rowNumber,
        column: issue.column,
        code: issue.code,
        message: issue.message,
        severity: issue.severity,
      })),
      issuesTruncated: stored.length > MAX_REPORTED_ISSUES,
    };
  }

  /**
   * Writes the accepted rows into `metric_values`.
   *
   * Values are replaced per identity rather than appended, so re-importing a
   * corrected file for the same period overwrites instead of double-counting.
   */
  async commit(
    organizationId: string,
    importId: string,
    actorId: string,
    ipAddress?: string,
  ): Promise<ImportCommitResult> {
    const dataImport = await this.findOne(organizationId, importId);

    if (dataImport.status === 'COMMITTED') {
      throw ApiException.conflict('This import has already been committed.');
    }

    if (dataImport.status !== 'VALIDATED') {
      throw ApiException.conflict('Validate the import before committing it.');
    }

    const rows = await this.prisma.dataImportRow.findMany({
      where: { dataImportId: dataImport.id, status: { in: ['VALID', 'WARNING'] } },
      orderBy: { rowNumber: 'asc' },
      select: { parsedData: true },
    });

    const values = rows
      .map((row) => row.parsedData as StoredRow | null)
      .filter((row): row is StoredRow => row !== null);

    if (values.length === 0) {
      throw ApiException.conflict('This import has no rows that can be committed.');
    }

    const metrics = await this.loadMetrics(organizationId);

    const prepared = values.map((row) => {
      const metric = metrics.get(row.metricCode.toLowerCase());

      if (!metric) {
        // The metric was deleted between validation and commit.
        throw ApiException.conflict(
          `The metric "${row.metricCode}" no longer exists. Re-validate the import.`,
        );
      }

      return {
        organizationId,
        metricId: metric.id,
        branchId: row.branchId,
        departmentId: row.departmentId,
        periodType: row.periodType,
        periodStart: new Date(`${row.periodStart}T00:00:00.000Z`),
        periodEnd: new Date(`${row.periodStart}T00:00:00.000Z`),
        value: row.value,
      };
    });

    const written = await this.prisma.$transaction(
      async (tx) => {
        let count = 0;

        for (let index = 0; index < prepared.length; index += COMMIT_CHUNK_SIZE) {
          const chunk = prepared.slice(index, index + COMMIT_CHUNK_SIZE);

          // NULL branch/department cannot be matched by a unique constraint in
          // PostgreSQL, so the replace is expressed explicitly.
          await tx.metricValue.deleteMany({
            where: {
              organizationId,
              OR: chunk.map((row) => ({
                metricId: row.metricId,
                branchId: row.branchId,
                departmentId: row.departmentId,
                periodType: row.periodType,
                periodStart: row.periodStart,
              })),
            },
          });

          const result = await tx.metricValue.createMany({
            data: chunk.map((row) => ({
              ...row,
              periodEnd: periodEndFor(row.periodType, row.periodStart),
              sourceType: 'CSV',
              sourceRef: dataImport.id,
              isCalculated: false,
            })),
          });

          count += result.count;
        }

        await tx.dataImport.update({
          where: { id: dataImport.id },
          data: { status: 'COMMITTED', committedAt: new Date() },
        });

        if (dataImport.dataSourceId) {
          await tx.dataSource.update({
            where: { id: dataImport.dataSourceId },
            data: { lastSyncAt: new Date() },
          });
        }

        return count;
      },
      { timeout: 60_000 },
    );

    // Formula metrics derived from what just landed are now out of date; only the
    // periods this file touched need recalculating (plan §14).
    const touchedPeriods = uniquePeriods(prepared);
    const recalculation = await this.calculation.recalculate(organizationId, touchedPeriods);

    if (recalculation.skipped.length > 0) {
      this.logger.warn(
        `Import ${importId}: ${recalculation.skipped.length} calculated values could not be produced`,
      );
    }

    // The month is now complete, so the engines that read it run: health score,
    // then alerts, then insights (plan §49). A failure here must not undo a
    // committed import — the values are the record, the analysis is derived — so it
    // is logged and the commit still succeeds.
    const analysed = await this.analysis
      .run(organizationId, touchedPeriods, actorId)
      .catch((error: unknown) => {
        this.logger.error(
          `Import ${importId} committed, but the analysis failed: ${String(error)}`,
        );

        return { periods: [], goals: { evaluated: 0, changed: 0, achieved: 0 } };
      });

    const committed = await this.prisma.dataImport.findUniqueOrThrow({
      where: { id: dataImport.id },
      select: IMPORT_SELECT,
    });

    await this.audit.record({
      actorId,
      organizationId,
      action: 'import.committed',
      entityType: 'data_import',
      entityId: importId,
      after: {
        fileName: committed.fileName,
        valuesWritten: written,
        rowsRejected: committed.rowsRejected,
        valuesCalculated: recalculation.calculated,
        alertsRaised: analysed.periods.reduce((total, run) => total + run.alerts.created, 0),
        insightsCreated: analysed.periods.reduce((total, run) => total + run.insights.created, 0),
        goalsUpdated: analysed.goals.changed,
      },
      ipAddress,
    });

    this.logger.log(
      `Import ${importId} committed ${written} metric values and calculated ${recalculation.calculated}`,
    );

    return { import: toSummary(committed), valuesWritten: written };
  }

  /** Abandons an import before it is committed; the record and its rows are kept. */
  async cancel(
    organizationId: string,
    importId: string,
    actorId: string,
    ipAddress?: string,
  ): Promise<ImportSummary> {
    const dataImport = await this.findOne(organizationId, importId);

    if (dataImport.status === 'COMMITTED') {
      throw ApiException.conflict('A committed import cannot be cancelled.');
    }

    if (dataImport.status === 'CANCELLED') {
      return toSummary(dataImport);
    }

    const updated = await this.prisma.dataImport.update({
      where: { id: dataImport.id },
      data: { status: 'CANCELLED' },
      select: IMPORT_SELECT,
    });

    await this.audit.record({
      actorId,
      organizationId,
      action: 'import.cancelled',
      entityType: 'data_import',
      entityId: importId,
      ipAddress,
    });

    return toSummary(updated);
  }

  async list(
    organizationId: string,
    page: number,
    pageSize: number,
  ): Promise<Paginated<ImportSummary>> {
    const [items, total] = await Promise.all([
      this.prisma.dataImport.findMany({
        where: { organizationId },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: IMPORT_SELECT,
      }),
      this.prisma.dataImport.count({ where: { organizationId } }),
    ]);

    return { items: items.map(toSummary), page, pageSize, total };
  }

  async findSummary(organizationId: string, importId: string): Promise<ImportValidationReport> {
    const dataImport = await this.findOne(organizationId, importId);

    const issues = await this.prisma.dataValidationError.findMany({
      where: { dataImportId: dataImport.id },
      orderBy: [{ severity: 'asc' }, { rowNumber: 'asc' }],
      take: MAX_REPORTED_ISSUES + 1,
    });

    return {
      import: toSummary(dataImport),
      issues: issues.slice(0, MAX_REPORTED_ISSUES).map((issue) => ({
        rowNumber: issue.rowNumber,
        column: issue.column,
        code: issue.code,
        message: issue.message,
        severity: issue.severity,
      })),
      issuesTruncated: issues.length > MAX_REPORTED_ISSUES,
    };
  }

  /** Rows as received, with their outcome — the audit view of an import. */
  async listRows(
    organizationId: string,
    importId: string,
    filters: { status?: 'VALID' | 'WARNING' | 'REJECTED'; page: number; pageSize: number },
  ): Promise<Paginated<ImportRowDetail>> {
    const dataImport = await this.findOne(organizationId, importId);

    const where = {
      dataImportId: dataImport.id,
      ...(filters.status ? { status: filters.status } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.dataImportRow.findMany({
        where,
        orderBy: { rowNumber: 'asc' },
        skip: (filters.page - 1) * filters.pageSize,
        take: filters.pageSize,
        select: {
          rowNumber: true,
          status: true,
          rawData: true,
          errors: {
            select: { rowNumber: true, column: true, code: true, message: true, severity: true },
          },
        },
      }),
      this.prisma.dataImportRow.count({ where }),
    ]);

    return {
      items: rows.map((row) => ({
        rowNumber: row.rowNumber,
        status: row.status,
        data: row.rawData as Record<string, string>,
        issues: row.errors.map((error) => ({
          rowNumber: error.rowNumber,
          column: error.column,
          code: error.code,
          message: error.message,
          severity: error.severity,
        })),
      })),
      page: filters.page,
      pageSize: filters.pageSize,
      total,
    };
  }

  private async findOne(organizationId: string, importId: string) {
    const dataImport = await this.prisma.dataImport.findFirst({
      where: { id: importId, organizationId },
      select: IMPORT_SELECT,
    });

    if (!dataImport) {
      throw ApiException.notFound('Import');
    }

    return dataImport;
  }

  /** An import that can still be mapped or validated. */
  private async findEditable(organizationId: string, importId: string) {
    const dataImport = await this.findOne(organizationId, importId);

    if (dataImport.status === 'COMMITTED') {
      throw ApiException.conflict('This import has already been committed.');
    }

    if (dataImport.status === 'CANCELLED') {
      throw ApiException.conflict('This import was cancelled.');
    }

    return dataImport;
  }

  /**
   * Blocks re-importing a file that was already committed (plan §42: "duplicate
   * commit is prevented"). An abandoned upload of the same file is replaced, so a
   * user who cancelled can simply try again.
   */
  private async assertNotAlreadyImported(organizationId: string, checksum: string): Promise<void> {
    const existing = await this.prisma.dataImport.findUnique({
      where: { organizationId_checksum: { organizationId, checksum } },
      select: { id: true, status: true, fileName: true },
    });

    if (!existing) {
      return;
    }

    if (existing.status === 'COMMITTED') {
      throw ApiException.conflict(
        `This exact file was already imported as "${existing.fileName}". Change the data or delete the previous import first.`,
      );
    }

    await this.prisma.dataImport.delete({ where: { id: existing.id } });
  }

  private async assertDataSourceBelongsToOrganization(
    organizationId: string,
    dataSourceId: string | undefined,
  ): Promise<void> {
    if (!dataSourceId) {
      return;
    }

    const source = await this.prisma.dataSource.findFirst({
      where: { id: dataSourceId, organizationId },
      select: { id: true },
    });

    if (!source) {
      throw ApiException.validation('The request could not be processed.', [
        { field: 'dataSourceId', message: 'Unknown data source for this organization' },
      ]);
    }
  }

  private async fileColumns(importId: string): Promise<string[]> {
    const first = await this.prisma.dataImportRow.findFirst({
      where: { dataImportId: importId },
      orderBy: { rowNumber: 'asc' },
      select: { rawData: true },
    });

    return Object.keys((first?.rawData ?? {}) as Record<string, string>);
  }

  private async loadMetrics(organizationId: string): Promise<Map<string, MetricDefinition>> {
    const metrics = await this.prisma.metric.findMany({
      where: { organizationId, isActive: true },
      select: {
        id: true,
        code: true,
        name: true,
        unit: true,
        frequency: true,
        aggregationType: true,
      },
    });

    return new Map(
      metrics.map((metric) => [
        metric.code.toLowerCase(),
        {
          id: metric.id,
          code: metric.code,
          name: metric.name,
          unit: metric.unit,
          frequency: metric.frequency,
          isCalculated: metric.aggregationType === 'FORMULA',
        },
      ]),
    );
  }

  private async loadCodes(
    entity: 'branch' | 'department',
    organizationId: string,
  ): Promise<Map<string, string>> {
    const rows =
      entity === 'branch'
        ? await this.prisma.branch.findMany({
            where: { organizationId, isActive: true },
            select: { id: true, code: true },
          })
        : await this.prisma.department.findMany({
            where: { organizationId, isActive: true },
            select: { id: true, code: true },
          });

    return new Map(rows.map((row) => [row.code.toLowerCase(), row.id]));
  }
}

/** The distinct periods an import wrote to, for a targeted recalculation. */
function uniquePeriods(
  rows: Array<{ periodType: StoredRow['periodType']; periodStart: Date }>,
): Array<{ periodType: StoredRow['periodType']; periodStart: Date }> {
  const seen = new Map<string, { periodType: StoredRow['periodType']; periodStart: Date }>();

  for (const row of rows) {
    seen.set(`${row.periodType}|${row.periodStart.toISOString()}`, {
      periodType: row.periodType,
      periodStart: row.periodStart,
    });
  }

  return [...seen.values()];
}

interface StoredRow {
  metricCode: string;
  periodType: 'DAY' | 'WEEK' | 'MONTH' | 'QUARTER' | 'YEAR';
  periodStart: string;
  value: string;
  branchId: string | null;
  departmentId: string | null;
}

type ImportRow = {
  id: string;
  fileName: string;
  fileSizeBytes: number;
  status: ImportStatus;
  dataSourceId: string | null;
  mapping: Prisma.JsonValue;
  rowsReceived: number;
  rowsValid: number;
  rowsWarning: number;
  rowsRejected: number;
  committedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  dataSource: { name: string } | null;
};

function toSummary(row: ImportRow): ImportSummary {
  return {
    id: row.id,
    fileName: row.fileName,
    fileSizeBytes: row.fileSizeBytes,
    status: row.status,
    dataSourceId: row.dataSourceId,
    dataSourceName: row.dataSource?.name ?? null,
    mapping: (row.mapping as ImportSummary['mapping']) ?? null,
    rowsReceived: row.rowsReceived,
    rowsValid: row.rowsValid,
    rowsWarning: row.rowsWarning,
    rowsRejected: row.rowsRejected,
    committedAt: row.committedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Recomputes the period end from its start, so storage stays self-consistent. */
function periodEndFor(type: StoredRow['periodType'], start: Date): Date {
  const year = start.getUTCFullYear();
  const month = start.getUTCMonth();

  switch (type) {
    case 'DAY':
      return start;
    case 'WEEK':
      return new Date(start.getTime() + 6 * 86_400_000);
    case 'MONTH':
      return new Date(Date.UTC(year, month + 1, 0));
    case 'QUARTER':
      return new Date(Date.UTC(year, month + 3, 0));
    case 'YEAR':
      return new Date(Date.UTC(year, 11, 31));
  }
}
