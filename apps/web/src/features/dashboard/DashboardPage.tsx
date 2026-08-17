import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import type { DashboardOverview } from '@sip/shared-types';
import { PageHeader } from '../../components/PageHeader';
import { EmptyState, ErrorState, LoadingState } from '../../components/states';
import { FilterBar, type AnalyticsFilterState } from '../../components/FilterBar';
import { KpiCard } from '../../components/KpiCard';
import { SeriesChart } from '../../components/SeriesChart';
import { describeApiError } from '../../lib/errors';
import { useOrganization } from '../organization/organization-context';
import { analyticsKeys, fetchAnalyticsOptions, fetchOverview } from './dashboard-api';

const EMPTY_FILTERS: AnalyticsFilterState = { from: '', to: '', branchId: '', departmentId: '' };

/**
 * The executive dashboard (plan §21).
 *
 * One request answers the whole screen, so every panel describes the same window
 * and the same slice. Nothing here calculates: the API returns figures already
 * aggregated over the filter, and this page formats them.
 */
export function DashboardPage() {
  const { currencyCode } = useOrganization();
  const [filters, setFilters] = useState<AnalyticsFilterState>(EMPTY_FILTERS);

  const optionsQuery = useQuery({
    queryKey: analyticsKeys.options,
    queryFn: fetchAnalyticsOptions,
  });

  const query = {
    from: filters.from || undefined,
    to: filters.to || undefined,
    branchId: filters.branchId || undefined,
    departmentId: filters.departmentId || undefined,
  };

  const overviewQuery = useQuery({
    queryKey: analyticsKeys.overview(query),
    queryFn: () => fetchOverview(query),
  });

  const overview = overviewQuery.data;

  return (
    <div className="stack">
      <PageHeader
        title="Overview"
        description="What this organization measured over the selected range, against the range before it."
      />

      <FilterBar
        options={optionsQuery.data}
        value={filters.from && filters.to ? filters : windowAsFilters(overview, filters)}
        onChange={setFilters}
      />

      {overviewQuery.isPending ? <LoadingState label="Loading dashboard…" /> : null}
      {overviewQuery.isError ? (
        <ErrorState message={describeApiError(overviewQuery.error)} />
      ) : null}

      {overview ? (
        <>
          <p className="state" role="status">
            {describeWindow(overview)}
          </p>

          {overview.kpis.length === 0 ? (
            <EmptyState message="No metrics have values in this range yet. Import data or widen the range." />
          ) : (
            <section className="kpi-grid">
              {overview.kpis.map((kpi) => (
                <KpiCard key={kpi.metricId} metric={kpi} currencyCode={currencyCode} />
              ))}
            </section>
          )}

          {overview.headline ? (
            <section className="card stack">
              <div className="section-header">
                <h2 className="card__title">{overview.headline.name} over time</h2>
                <Link
                  className="button button--ghost"
                  to={`/analytics?metric=${overview.headline.metricId}`}
                >
                  Open in analytics
                </Link>
              </div>
              <SeriesChart
                series={[
                  { name: 'This range', points: overview.headline.series },
                  {
                    name: 'Previous range',
                    points: overview.headline.previousSeries,
                    muted: true,
                    alignByIndex: true,
                  },
                ]}
                unit={overview.headline.unit}
                currencyCode={currencyCode}
                target={overview.headline.target}
              />
            </section>
          ) : null}

          <div className="panel-grid">
            <section className="card stack">
              <h2 className="card__title">Performance</h2>
              <p className="form-hint">
                Every active metric in this range, against its own thresholds and targets.
              </p>
              <dl className="metric-grid">
                <Stat label="Meeting target" value={overview.performance.onTarget} />
                <Stat
                  label="Behind target"
                  value={overview.performance.belowTarget}
                  tone="negative"
                />
                <Stat label="No target set" value={overview.performance.withoutTarget} />
                <Stat label="Threshold OK" value={overview.performance.ok} tone="positive" />
                <Stat label="Warning" value={overview.performance.warning} tone="negative" />
                <Stat label="Critical" value={overview.performance.critical} tone="negative" />
              </dl>
            </section>

            <section className="card stack">
              <h2 className="card__title">Organizational health</h2>
              {overview.health ? (
                <>
                  <p className="form-hint">{overview.health.modelName}</p>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th scope="col">Category</th>
                        <th scope="col">Weight</th>
                        <th scope="col">Score</th>
                      </tr>
                    </thead>
                    <tbody>
                      {overview.health.categories.map((category) => (
                        <tr key={category.code}>
                          <td>{category.name}</td>
                          <td>{Number(category.weight)}%</td>
                          <td>{category.score === null ? 'Not scored yet' : category.score}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="form-hint">
                    The model is installed and weighted; scores are calculated in a later sprint.
                  </p>
                </>
              ) : (
                <EmptyState message="No health model is installed. Install the industry pack in settings." />
              )}
            </section>
          </div>

          <div className="panel-grid">
            <AttentionPanel
              title="Alerts"
              emptyMessage="No open alerts. The alerts engine arrives in a later sprint."
              items={overview.attention.alerts.map((alert) => ({
                id: alert.id,
                title: alert.title,
                meta: `${alert.severity} · ${alert.status}`,
              }))}
            />
            <AttentionPanel
              title="Insights"
              emptyMessage="No insights yet. Deterministic insight rules are installed and run in a later sprint."
              items={overview.attention.insights.map((insight) => ({
                id: insight.id,
                title: insight.title,
                meta: insight.severity,
              }))}
            />
            <AttentionPanel
              title="Decisions needing attention"
              emptyMessage="No open decisions."
              items={overview.attention.decisions.map((decision) => ({
                id: decision.id,
                title: decision.title,
                meta: decision.status,
              }))}
            />
          </div>

          <section className="card stack">
            <h2 className="card__title">Data behind these numbers</h2>
            <dl className="metric-grid">
              <Stat label="Metrics tracked" value={overview.metricCount} />
              <Stat
                label="Data quality"
                value={
                  overview.dataQuality ? `${overview.dataQuality.score}/100` : 'No imports yet'
                }
              />
              <Stat
                label="Last import"
                value={
                  overview.dataQuality?.lastImportAt
                    ? new Date(overview.dataQuality.lastImportAt).toLocaleDateString()
                    : '—'
                }
              />
            </dl>
            <p className="form-hint">
              Figures are aggregated server-side from stored values. A calculated metric is
              recomputed from its inputs for the range rather than averaged —{' '}
              <Link to="/data/quality">data quality</Link> explains what has been imported.
            </p>
          </section>
        </>
      ) : null}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone?: 'positive' | 'negative';
}) {
  return (
    <div className="metric-card">
      <dt className="metric-card__label">{label}</dt>
      <dd className={`metric-card__value ${tone ? `metric-card__value--${tone}` : ''}`}>{value}</dd>
    </div>
  );
}

function AttentionPanel({
  title,
  items,
  emptyMessage,
}: {
  title: string;
  items: Array<{ id: string; title: string; meta: string }>;
  emptyMessage: string;
}) {
  return (
    <section className="card stack">
      <h2 className="card__title">{title}</h2>
      {items.length === 0 ? (
        <EmptyState message={emptyMessage} />
      ) : (
        <ul className="stack">
          {items.map((item) => (
            <li key={item.id}>
              <strong>{item.title}</strong>
              <span className="data-table__meta">{item.meta}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** The server resolved the range; the filter bar shows what it chose. */
function windowAsFilters(
  overview: DashboardOverview | undefined,
  filters: AnalyticsFilterState,
): AnalyticsFilterState {
  if (!overview) {
    return filters;
  }

  return { ...filters, from: overview.window.from, to: overview.window.to };
}

function describeWindow(overview: DashboardOverview): string {
  const { window } = overview;
  const slice = window.departmentName ?? window.branchName ?? 'the whole organization';

  return (
    `${window.from} to ${window.to}, compared with ${window.previousFrom} to ${window.previousTo}` +
    `, for ${slice}.`
  );
}
