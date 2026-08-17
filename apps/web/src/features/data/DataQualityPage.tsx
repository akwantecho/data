import { useQuery } from '@tanstack/react-query';
import type { DataQualityLevel } from '@sip/shared-types';
import { EmptyState, ErrorState, LoadingState } from '../../components/states';
import { describeApiError } from '../../lib/errors';
import { dataKeys, fetchDataQuality } from './data-api';
import { DataLayout } from './DataLayout';

/**
 * Data quality is shown before any KPI is built on it: a number is only as
 * trustworthy as the data underneath, and the platform says so out loud (plan §16).
 */
export function DataQualityPage() {
  const qualityQuery = useQuery({ queryKey: dataKeys.quality, queryFn: fetchDataQuality });
  const report = qualityQuery.data;

  return (
    <DataLayout
      title="Data Quality"
      description="How complete, valid and fresh the imported data is — and therefore how much weight the numbers can carry."
    >
      {qualityQuery.isPending ? <LoadingState label="Assessing data quality…" /> : null}
      {qualityQuery.isError ? <ErrorState message={describeApiError(qualityQuery.error)} /> : null}

      {report ? (
        <>
          <section className="metric-grid">
            <ScoreCard
              label="Overall data quality"
              value={`${report.overallScore}/100`}
              tone={levelFromScore(report.overallScore)}
            />
            <ScoreCard label="Completeness" value={`${report.completenessPct}%`} />
            <ScoreCard label="Validity" value={`${report.validityPct}%`} />
            <ScoreCard label="Freshness" value={report.freshness} tone={report.freshness} />
            <ScoreCard label="Confidence" value={report.confidence} tone={report.confidence} />
            <ScoreCard label="Rejected rows on record" value={String(report.errorCount)} />
          </section>

          <section className="card stack">
            <h2 className="card__title">By source</h2>
            <p className="state">
              {report.lastUpdatedAt
                ? `Last import ${new Date(report.lastUpdatedAt).toLocaleString()}${
                    report.daysSinceLastImport !== null
                      ? ` — ${report.daysSinceLastImport} days ago`
                      : ''
                  }.`
                : 'No data has been imported yet, so nothing can be assessed.'}
            </p>

            {report.sources.length === 0 ? (
              <EmptyState message="No data sources configured." />
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">Source</th>
                    <th scope="col">Rows received</th>
                    <th scope="col">Rejected</th>
                    <th scope="col">Validity</th>
                    <th scope="col">Freshness</th>
                    <th scope="col">Last import</th>
                  </tr>
                </thead>
                <tbody>
                  {report.sources.map((source) => (
                    <tr key={source.dataSourceId ?? source.dataSourceName}>
                      <td>{source.dataSourceName}</td>
                      <td>{source.rowsReceived}</td>
                      <td>{source.rowsRejected}</td>
                      <td>{source.validityPct}%</td>
                      <td>
                        <span className={`badge ${toneClass(source.freshness)}`}>
                          {source.freshness}
                        </span>
                      </td>
                      <td>
                        {source.lastImportAt
                          ? new Date(source.lastImportAt).toLocaleDateString()
                          : 'Never'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      ) : null}
    </DataLayout>
  );
}

function ScoreCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: DataQualityLevel;
}) {
  return (
    <article className="card metric-card">
      <span className="metric-card__label">{label}</span>
      <span className={`metric-card__value ${tone ? toneTextClass(tone) : ''}`}>{value}</span>
    </article>
  );
}

function levelFromScore(score: number): DataQualityLevel {
  if (score >= 85) {
    return 'GOOD';
  }

  return score >= 60 ? 'FAIR' : score > 0 ? 'POOR' : 'UNKNOWN';
}

function toneClass(level: DataQualityLevel): string {
  return level === 'GOOD' ? 'badge--positive' : level === 'UNKNOWN' ? '' : 'badge--negative';
}

function toneTextClass(level: DataQualityLevel): string {
  return level === 'GOOD'
    ? 'metric-card__value--positive'
    : level === 'POOR'
      ? 'metric-card__value--negative'
      : '';
}
