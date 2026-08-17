import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import type { InsightSummary } from '@sip/shared-types';
import { PageHeader } from '../../components/PageHeader';
import { EmptyState, ErrorState, LoadingState } from '../../components/states';
import { describeApiError } from '../../lib/errors';
import { formatChange } from '../../lib/format';
import { fetchInsights, healthKeys } from './health-api';

/**
 * Insights (plan §28).
 *
 * Each one is produced by a deterministic rule and shown with the figures that
 * made it true. Nothing here is written by a model: the AI layer explains
 * insights, it does not detect them (ADR-0005).
 */
export function InsightsPage() {
  const query = {};
  const insightsQuery = useQuery({
    queryKey: healthKeys.insights(query),
    queryFn: () => fetchInsights(query),
  });

  const insights = insightsQuery.data?.items ?? [];

  return (
    <div className="stack">
      <PageHeader
        title="Insights"
        description="What the rules noticed in the numbers, and the figures behind each observation."
      />

      {insightsQuery.isPending ? <LoadingState label="Loading insights…" /> : null}
      {insightsQuery.isError ? (
        <ErrorState message={describeApiError(insightsQuery.error)} />
      ) : null}
      {insightsQuery.data && insights.length === 0 ? (
        <section className="card">
          <EmptyState message="No insights yet. Rules are evaluated after every import." />
        </section>
      ) : null}

      {insights.map((insight) => (
        <InsightCard key={insight.id} insight={insight} />
      ))}
    </div>
  );
}

function InsightCard({ insight }: { insight: InsightSummary }) {
  return (
    <article className="card stack">
      <div className="section-header">
        <h2 className="card__title">{insight.title}</h2>
        <span className={`badge ${insight.severity === 'INFO' ? '' : 'badge--warning'}`}>
          {insight.severity}
        </span>
      </div>

      <p>{insight.narrative}</p>

      <p className="form-hint">
        {insight.category ? `${insight.category} · ` : ''}
        {insight.periodStart ?? 'No period'} · rule {insight.ruleCode ?? 'unknown'}
      </p>

      <h3 className="metric-group__title">Evidence</h3>
      <table className="data-table">
        <thead>
          <tr>
            <th scope="col">Metric</th>
            <th scope="col">Value</th>
            <th scope="col">Change</th>
            <th scope="col">What the rule read</th>
          </tr>
        </thead>
        <tbody>
          {insight.evidence.map((item) => (
            <tr key={item.label}>
              <td>
                {item.metricId ? (
                  <Link to={`/analytics?metric=${item.metricId}`}>{item.label}</Link>
                ) : (
                  item.label
                )}
              </td>
              <td>{item.value ?? '—'}</td>
              <td>{formatChange(item.changePct)}</td>
              <td>{describeCondition(item.detail)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </article>
  );
}

/** The condition this figure satisfied, spelled out rather than left implied. */
function describeCondition(detail: Record<string, unknown> | null): string {
  if (!detail || typeof detail.measure !== 'string') {
    return 'Quoted as context';
  }

  const measure = String(detail.measure).toLowerCase().replace(/_/g, ' ');
  const operator =
    { LT: 'below', LTE: 'at or below', GT: 'above', GTE: 'at or above' }[String(detail.operator)] ??
    String(detail.operator);

  return `${measure} ${operator} ${String(detail.threshold)}`;
}
