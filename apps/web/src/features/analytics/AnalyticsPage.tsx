import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import type { ComparisonBreakdown, MetricAnalytics } from '@sip/shared-types';
import { PageHeader } from '../../components/PageHeader';
import { EmptyState, ErrorState, LoadingState } from '../../components/states';
import { FilterBar, type AnalyticsFilterState } from '../../components/FilterBar';
import { SeriesChart } from '../../components/SeriesChart';
import { describeApiError } from '../../lib/errors';
import { changeTone, formatChange, formatMetricValue } from '../../lib/format';
import { useOrganization } from '../organization/organization-context';
import {
  analyticsKeys,
  fetchAnalyticsOptions,
  fetchComparison,
  fetchMetricAnalytics,
} from '../dashboard/dashboard-api';

const BREAKDOWNS: Array<{ value: ComparisonBreakdown; label: string }> = [
  { value: 'BRANCH', label: 'By branch' },
  { value: 'DEPARTMENT', label: 'By department' },
];

/**
 * The analytics page (plan §24): pick a metric, pick a range, compare periods and
 * slices, and see what the metric is made of.
 *
 * The selected metric lives in the URL, so a link to a number is a link someone
 * else opens on the same number.
 */
export function AnalyticsPage() {
  const { currencyCode } = useOrganization();
  const [searchParams, setSearchParams] = useSearchParams();
  const [filters, setFilters] = useState<AnalyticsFilterState>({
    from: '',
    to: '',
    branchId: '',
    departmentId: '',
  });
  const [breakdown, setBreakdown] = useState<ComparisonBreakdown>('BRANCH');

  const optionsQuery = useQuery({
    queryKey: analyticsKeys.options,
    queryFn: fetchAnalyticsOptions,
  });

  const metricId = searchParams.get('metric') ?? optionsQuery.data?.metrics[0]?.id ?? '';

  const query = {
    from: filters.from || undefined,
    to: filters.to || undefined,
    branchId: filters.branchId || undefined,
    departmentId: filters.departmentId || undefined,
  };

  const detailQuery = useQuery({
    queryKey: analyticsKeys.metric(metricId, query),
    queryFn: () => fetchMetricAnalytics(metricId, query),
    enabled: Boolean(metricId),
  });

  const comparisonQuery = useQuery({
    queryKey: analyticsKeys.comparison({ ...query, breakdown, metricId }),
    queryFn: () => fetchComparison({ ...query, breakdown, metricId }),
    enabled: Boolean(metricId),
  });

  const detail = detailQuery.data;
  const metric = detail?.metric;

  return (
    <div className="stack">
      <PageHeader
        title="Analytics"
        description="One metric at a time: how it moved, how it compares, and what it is made of."
      />

      <FilterBar
        options={optionsQuery.data}
        value={detail ? { ...filters, from: detail.window.from, to: detail.window.to } : filters}
        onChange={setFilters}
      >
        <label className="filter-bar__field">
          <span className="filter-bar__label">Metric</span>
          <select
            className="form-field__input"
            value={metricId}
            onChange={(event) => setSearchParams({ metric: event.target.value })}
          >
            {(optionsQuery.data?.metrics ?? []).map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        </label>
      </FilterBar>

      {detailQuery.isPending && metricId ? <LoadingState label="Loading analytics…" /> : null}
      {detailQuery.isError ? <ErrorState message={describeApiError(detailQuery.error)} /> : null}
      {!metricId && !optionsQuery.isPending ? (
        <EmptyState message="No metrics yet. Define one under Metrics to analyse it here." />
      ) : null}

      {detail && metric ? (
        <>
          <section className="card stack">
            <div className="section-header">
              <h2 className="card__title">{metric.name}</h2>
              <Link className="button button--ghost" to={`/metrics/${metric.metricId}`}>
                Metric definition
              </Link>
            </div>

            <dl className="metric-grid">
              <Figure
                label={`This range (${detail.window.from} → ${detail.window.to})`}
                value={formatMetricValue(metric.current, metric.unit, currencyCode)}
              />
              <Figure
                label={`Previous (${detail.window.previousFrom} → ${detail.window.previousTo})`}
                value={formatMetricValue(metric.previous, metric.unit, currencyCode)}
              />
              <Figure
                label="Change"
                value={formatChange(metric.changePct)}
                tone={changeTone(metric.changePct, metric.direction)}
              />
              <Figure
                label="Target"
                value={formatMetricValue(metric.target, metric.unit, currencyCode)}
              />
              <Figure
                label="Variance to target"
                value={formatChange(metric.varianceToTargetPct)}
                tone={changeTone(metric.varianceToTargetPct, metric.direction)}
              />
            </dl>

            <p className="form-hint">{describeAggregation(metric)}</p>

            <SeriesChart
              series={[
                { name: 'This range', points: metric.series },
                {
                  name: 'Previous range',
                  points: metric.previousSeries,
                  muted: true,
                  alignByIndex: true,
                },
              ]}
              unit={metric.unit}
              currencyCode={currencyCode}
              target={metric.target}
            />
          </section>

          <section className="card stack">
            <div className="section-header">
              <h2 className="card__title">Comparison</h2>
              <div className="filter-bar__group" role="group" aria-label="Comparison breakdown">
                {BREAKDOWNS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={`chip ${breakdown === option.value ? 'chip--active' : ''}`}
                    onClick={() => setBreakdown(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            {comparisonQuery.isError ? (
              <ErrorState message={describeApiError(comparisonQuery.error)} />
            ) : null}

            {comparisonQuery.data && comparisonQuery.data.rows.length === 0 ? (
              <EmptyState message="Nothing to compare: this organization has no active branches or departments." />
            ) : null}

            {comparisonQuery.data && comparisonQuery.data.rows.length > 0 ? (
              <>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th scope="col">{breakdown === 'BRANCH' ? 'Branch' : 'Department'}</th>
                      <th scope="col">This range</th>
                      <th scope="col">Previous</th>
                      <th scope="col">Change</th>
                      <th scope="col">Target</th>
                    </tr>
                  </thead>
                  <tbody>
                    {comparisonQuery.data.rows.map((row) => (
                      <tr key={row.key}>
                        <td>{row.label}</td>
                        <td>{formatMetricValue(row.current, metric.unit, currencyCode)}</td>
                        <td>{formatMetricValue(row.previous, metric.unit, currencyCode)}</td>
                        <td
                          className={`kpi-card__change--${changeTone(row.changePct, metric.direction)}`}
                        >
                          {formatChange(row.changePct)}
                        </td>
                        <td>{formatMetricValue(row.target, metric.unit, currencyCode)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <SeriesChart
                  series={comparisonQuery.data.rows.map((row) => ({
                    name: row.label,
                    points: row.series,
                  }))}
                  unit={metric.unit}
                  currencyCode={currencyCode}
                />
              </>
            ) : null}
          </section>

          {detail.inputs.length > 0 || detail.dependents.length > 0 || detail.related.length > 0 ? (
            <section className="card stack">
              <h2 className="card__title">Related metrics</h2>
              <RelatedTable
                caption="Inputs this metric is calculated from"
                metrics={detail.inputs}
                currencyCode={currencyCode}
              />
              <RelatedTable
                caption="Metrics calculated from this one"
                metrics={detail.dependents}
                currencyCode={currencyCode}
              />
              <RelatedTable
                caption={`Others in ${metric.category ?? 'the same category'}`}
                metrics={detail.related}
                currencyCode={currencyCode}
              />
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function RelatedTable({
  caption,
  metrics,
  currencyCode,
}: {
  caption: string;
  metrics: MetricAnalytics[];
  currencyCode: string;
}) {
  if (metrics.length === 0) {
    return null;
  }

  return (
    <div className="stack">
      <h3 className="metric-group__title">{caption}</h3>
      <table className="data-table">
        <thead>
          <tr>
            <th scope="col">Metric</th>
            <th scope="col">This range</th>
            <th scope="col">Change</th>
          </tr>
        </thead>
        <tbody>
          {metrics.map((metric) => (
            <tr key={metric.metricId}>
              <td>
                <Link to={`/analytics?metric=${metric.metricId}`}>{metric.name}</Link>
              </td>
              <td>{formatMetricValue(metric.current, metric.unit, currencyCode)}</td>
              <td className={`kpi-card__change--${changeTone(metric.changePct, metric.direction)}`}>
                {formatChange(metric.changePct)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Figure({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'positive' | 'negative' | 'neutral';
}) {
  return (
    <div className="metric-card">
      <dt className="metric-card__label">{label}</dt>
      <dd
        className={`metric-card__value ${
          tone && tone !== 'neutral' ? `metric-card__value--${tone}` : ''
        }`}
      >
        {value}
      </dd>
    </div>
  );
}

/** Says out loud how the range figure was produced, so nobody has to guess. */
function describeAggregation(metric: MetricAnalytics): string {
  const missing =
    metric.missingPeriods > 0
      ? ` ${metric.missingPeriods} period${metric.missingPeriods === 1 ? '' : 's'} in this range reported nothing.`
      : '';

  if (metric.aggregation === 'RECOMPUTED_FROM_INPUTS') {
    return `Calculated for this range from its inputs (${metric.formula}), not averaged from its monthly values.${missing}`;
  }

  const wording: Record<string, string> = {
    SUM: 'Summed across the range',
    AVERAGE: 'Averaged across the range',
    LAST: 'The latest period in the range',
    MIN: 'The lowest period in the range',
    MAX: 'The highest period in the range',
    NONE: 'Not aggregated',
  };

  return `${wording[metric.aggregation] ?? 'Aggregated'}.${missing}`;
}
