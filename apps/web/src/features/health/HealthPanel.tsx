import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { HealthCategoryScore } from '@sip/shared-types';
import { EmptyState, ErrorState, LoadingState } from '../../components/states';
import { describeApiError } from '../../lib/errors';
import { fetchHealthCurrent, healthKeys } from './health-api';

/**
 * Organizational health on the dashboard (plan §21, §26).
 *
 * The score is shown with the categories that produced it, and each category
 * opens on the metrics that produced *it* — the number is only useful if you can
 * follow it down to something you can change.
 */
export function HealthPanel({ branchId = '' }: { branchId?: string }) {
  const [expanded, setExpanded] = useState<string | null>(null);

  const healthQuery = useQuery({
    queryKey: healthKeys.current(branchId),
    queryFn: () => fetchHealthCurrent(branchId || undefined),
  });

  const health = healthQuery.data;

  return (
    <section className="card stack">
      <div className="section-header">
        <h2 className="card__title">Organizational health</h2>
        {health?.current ? (
          <span className={`badge ${bandClass(health.current.band)}`}>{health.current.band}</span>
        ) : null}
      </div>

      {healthQuery.isPending ? <LoadingState label="Loading health…" /> : null}
      {healthQuery.isError ? <ErrorState message={describeApiError(healthQuery.error)} /> : null}

      {health && !health.modelId ? (
        <EmptyState message="No health model is installed. Install the industry pack in settings." />
      ) : null}

      {health?.modelId && !health.current ? (
        <EmptyState message="No score yet. Import data or run the analysis to score the latest period." />
      ) : null}

      {health?.current ? (
        <>
          <div className="health-score">
            <span className="health-score__value">{health.current.overallScore}</span>
            <span className="health-score__caption">
              out of 100 · {health.current.periodStart}
              {health.changePoints !== null ? (
                <span
                  className={`kpi-card__change--${health.changePoints >= 0 ? 'positive' : 'negative'}`}
                >
                  {' '}
                  {health.changePoints >= 0 ? '+' : ''}
                  {health.changePoints} vs previous period
                </span>
              ) : null}
            </span>
          </div>

          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Category</th>
                <th scope="col">Weight</th>
                <th scope="col">Score</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {health.current.categories.map((category) => (
                <tr key={category.code}>
                  <td>{category.name}</td>
                  <td>{Number(category.effectiveWeight) || Number(category.weight)}%</td>
                  <td>
                    {category.score === null ? (
                      <span className="data-table__meta">Not scored</span>
                    ) : (
                      <span className={`badge ${bandClass(category.band)}`}>{category.score}</span>
                    )}
                  </td>
                  <td className="data-table__actions">
                    <button
                      type="button"
                      className="button button--ghost"
                      onClick={() => setExpanded(expanded === category.code ? null : category.code)}
                    >
                      {expanded === category.code ? 'Hide' : 'Why'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {expanded ? (
            <CategoryDetail
              category={
                health.current.categories.find(
                  (category) => category.code === expanded,
                ) as HealthCategoryScore
              }
            />
          ) : null}

          {health.current.unscoredMetrics > 0 ? (
            <p className="form-hint">
              {health.current.unscoredMetrics} weighted metric
              {health.current.unscoredMetrics === 1 ? '' : 's'} could not be scored for this period
              — the remaining weights were redistributed, so the score still means what it says.
            </p>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

function CategoryDetail({ category }: { category: HealthCategoryScore }) {
  return (
    <div className="stack">
      <h3 className="metric-group__title">{category.name}</h3>
      <table className="data-table">
        <thead>
          <tr>
            <th scope="col">Metric</th>
            <th scope="col">Value</th>
            <th scope="col">Target</th>
            <th scope="col">Score</th>
            <th scope="col">Contribution</th>
            <th scope="col">Scored against</th>
          </tr>
        </thead>
        <tbody>
          {category.metrics.map((metric) => (
            <tr key={metric.code}>
              <td>{metric.name}</td>
              <td>{trim(metric.value)}</td>
              <td>{trim(metric.target)}</td>
              <td>{metric.score === null ? '—' : metric.score}</td>
              <td>{metric.contribution === null ? '—' : metric.contribution}</td>
              <td>{describeBasis(metric.basis)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function bandClass(band: string | null): string {
  switch (band) {
    case 'HEALTHY':
      return 'badge--positive';
    case 'ATTENTION':
      return 'badge--warning';
    case 'RISK':
    case 'CRITICAL':
      return 'badge--negative';
    default:
      return '';
  }
}

function describeBasis(basis: string): string {
  switch (basis) {
    case 'TARGET':
      return 'Its target';
    case 'THRESHOLDS':
      return 'Its thresholds';
    case 'TARGET_AND_THRESHOLDS':
      return 'Target and thresholds';
    case 'TARGET_RANGE':
      return 'Its acceptable range';
    case 'NO_VALUE':
      return 'No value this period';
    case 'NO_BENCHMARK':
      return 'No target or threshold set';
    case 'INFORMATIONAL':
      return 'Informational, never scored';
    default:
      return basis;
  }
}

function trim(value: string | null): string {
  if (value === null) {
    return '—';
  }

  const numeric = Number(value);

  return Number.isFinite(numeric)
    ? new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(numeric)
    : value;
}
