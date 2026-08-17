import { Injectable } from '@nestjs/common';
import type { DataQualityLevel, DataQualityReport, DataQualitySource } from '@sip/shared-types';
import { PrismaService } from '../prisma/prisma.service';

/** Freshness thresholds in days (plan §16). Configurable per organization later. */
const FRESH_DAYS = 35;
const STALE_DAYS = 95;

/**
 * Rule-based data quality (plan §16).
 *
 * Every figure is derived from what actually happened to the data — imports, their
 * rejections and their age — never from a model. The score is deliberately simple
 * and explainable: a user who disagrees with it can see exactly which number moved
 * it.
 */
@Injectable()
export class DataQualityService {
  constructor(private readonly prisma: PrismaService) {}

  async report(organizationId: string): Promise<DataQualityReport> {
    const [imports, sources, errorCount] = await Promise.all([
      this.prisma.dataImport.findMany({
        where: { organizationId, status: 'COMMITTED' },
        orderBy: { committedAt: 'desc' },
        select: {
          dataSourceId: true,
          committedAt: true,
          rowsReceived: true,
          rowsValid: true,
          rowsWarning: true,
          rowsRejected: true,
          dataSource: { select: { name: true } },
        },
      }),
      this.prisma.dataSource.findMany({
        where: { organizationId },
        select: { id: true, name: true, lastSyncAt: true },
      }),
      this.prisma.dataValidationError.count({
        where: { dataImport: { organizationId }, severity: 'ERROR' },
      }),
    ]);

    if (imports.length === 0) {
      return {
        overallScore: 0,
        completenessPct: 0,
        validityPct: 0,
        freshness: 'UNKNOWN',
        daysSinceLastImport: null,
        errorCount,
        lastUpdatedAt: null,
        confidence: 'UNKNOWN',
        sources: sources.map((source) => ({
          dataSourceId: source.id,
          dataSourceName: source.name,
          lastImportAt: source.lastSyncAt?.toISOString() ?? null,
          rowsReceived: 0,
          rowsRejected: 0,
          validityPct: 0,
          freshness: 'UNKNOWN' as const,
        })),
      };
    }

    const totals = imports.reduce(
      (accumulator, entry) => ({
        received: accumulator.received + entry.rowsReceived,
        accepted: accumulator.accepted + entry.rowsValid + entry.rowsWarning,
        clean: accumulator.clean + entry.rowsValid,
      }),
      { received: 0, accepted: 0, clean: 0 },
    );

    const lastImportAt = imports[0].committedAt;
    const daysSinceLastImport = lastImportAt ? daysSince(lastImportAt) : null;

    // Completeness: how much of what arrived could actually be used.
    const completenessPct = percentage(totals.accepted, totals.received);
    // Validity: how much arrived without any complaint at all.
    const validityPct = percentage(totals.clean, totals.received);
    const freshness = freshnessOf(daysSinceLastImport);

    const overallScore = round(
      completenessPct * 0.4 + validityPct * 0.4 + freshnessScore(freshness) * 0.2,
    );

    return {
      overallScore,
      completenessPct,
      validityPct,
      freshness,
      daysSinceLastImport,
      errorCount,
      lastUpdatedAt: lastImportAt?.toISOString() ?? null,
      confidence: confidenceOf(overallScore, totals.received),
      sources: this.summariseSources(imports, sources),
    };
  }

  private summariseSources(
    imports: Array<{
      dataSourceId: string | null;
      committedAt: Date | null;
      rowsReceived: number;
      rowsValid: number;
      rowsWarning: number;
      rowsRejected: number;
      dataSource: { name: string } | null;
    }>,
    sources: Array<{ id: string; name: string; lastSyncAt: Date | null }>,
  ): DataQualitySource[] {
    const grouped = new Map<string, DataQualitySource & { clean: number }>();

    for (const source of sources) {
      grouped.set(source.id, {
        dataSourceId: source.id,
        dataSourceName: source.name,
        lastImportAt: null,
        rowsReceived: 0,
        rowsRejected: 0,
        validityPct: 0,
        freshness: 'UNKNOWN',
        clean: 0,
      });
    }

    for (const entry of imports) {
      const key = entry.dataSourceId ?? 'unassigned';

      const current =
        grouped.get(key) ??
        ({
          dataSourceId: entry.dataSourceId,
          dataSourceName: entry.dataSource?.name ?? 'Direct uploads',
          lastImportAt: null,
          rowsReceived: 0,
          rowsRejected: 0,
          validityPct: 0,
          freshness: 'UNKNOWN',
          clean: 0,
        } as DataQualitySource & { clean: number });

      current.rowsReceived += entry.rowsReceived;
      current.rowsRejected += entry.rowsRejected;
      current.clean += entry.rowsValid;

      const committedAt = entry.committedAt?.toISOString() ?? null;
      if (committedAt && (!current.lastImportAt || committedAt > current.lastImportAt)) {
        current.lastImportAt = committedAt;
      }

      grouped.set(key, current);
    }

    return [...grouped.values()].map(({ clean, ...source }) => ({
      ...source,
      validityPct: percentage(clean, source.rowsReceived),
      freshness: freshnessOf(source.lastImportAt ? daysSince(new Date(source.lastImportAt)) : null),
    }));
  }
}

function daysSince(date: Date): number {
  return Math.max(0, Math.floor((Date.now() - date.getTime()) / 86_400_000));
}

function percentage(part: number, total: number): number {
  if (total === 0) {
    return 0;
  }

  return round((part / total) * 100);
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function freshnessOf(days: number | null): DataQualityLevel {
  if (days === null) {
    return 'UNKNOWN';
  }

  if (days <= FRESH_DAYS) {
    return 'GOOD';
  }

  return days <= STALE_DAYS ? 'FAIR' : 'POOR';
}

function freshnessScore(level: DataQualityLevel): number {
  switch (level) {
    case 'GOOD':
      return 100;
    case 'FAIR':
      return 60;
    case 'POOR':
      return 20;
    default:
      return 0;
  }
}

/**
 * Confidence answers "how much should management lean on these numbers?", so it
 * accounts for volume as well as quality: a perfect score over ten rows is not
 * evidence of much.
 */
function confidenceOf(score: number, rowsReceived: number): DataQualityLevel {
  if (rowsReceived < 20) {
    return 'POOR';
  }

  if (score >= 85) {
    return 'GOOD';
  }

  return score >= 60 ? 'FAIR' : 'POOR';
}
