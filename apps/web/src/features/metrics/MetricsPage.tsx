import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import type { MetricSummary } from '@sip/shared-types';
import { useSession } from '../auth/session-context';
import { PageHeader } from '../../components/PageHeader';
import { EmptyState, ErrorState, LoadingState } from '../../components/states';
import { describeApiError } from '../../lib/errors';
import { formatMetricValue } from '../../lib/format';
import { useOrganization } from '../organization/organization-context';
import { MetricDialog } from './MetricDialog';
import { createMetric, fetchMetrics, metricKeys, recalculateMetrics } from './metrics-api';

/**
 * The metric catalogue: what this organization measures, how, and where each
 * number last stood. Definitions live in the database, never in this component
 * (plan §5.3).
 */
export function MetricsPage() {
  const { activeMembership } = useSession();
  const { currencyCode } = useOrganization();
  const role = activeMembership?.role;
  const canEdit = role === 'ORGANIZATION_ADMIN' || role === 'ANALYST';
  const queryClient = useQueryClient();

  const [isCreating, setIsCreating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const metricsQuery = useQuery({
    queryKey: metricKeys.list(true),
    queryFn: () => fetchMetrics(true),
  });

  const createMutation = useMutation({
    mutationFn: createMetric,
    onSuccess: async () => {
      setIsCreating(false);
      await queryClient.invalidateQueries({ queryKey: metricKeys.all });
    },
  });

  const recalculateMutation = useMutation({
    mutationFn: recalculateMetrics,
    onSuccess: async (result) => {
      setNotice(
        `Recalculated ${result.calculated} values.${
          result.skipped.length > 0
            ? ` ${result.skipped.length} could not be calculated — open the metric to see why.`
            : ''
        }`,
      );
      await queryClient.invalidateQueries({ queryKey: metricKeys.all });
    },
  });

  const grouped = groupByCategory(metricsQuery.data ?? []);

  return (
    <div className="stack">
      <PageHeader
        title="Metrics"
        description="Every KPI this organization tracks, with its unit, how it is produced and its latest value."
      />

      <section className="card stack">
        <div className="section-header">
          <h2 className="card__title">Metric catalogue</h2>
          {canEdit ? (
            <div className="form-actions">
              <button
                type="button"
                className="button button--ghost"
                disabled={recalculateMutation.isPending}
                onClick={() => recalculateMutation.mutate()}
              >
                {recalculateMutation.isPending ? 'Recalculating…' : 'Recalculate'}
              </button>
              <button
                type="button"
                className="button button--primary"
                onClick={() => setIsCreating(true)}
              >
                Add metric
              </button>
            </div>
          ) : null}
        </div>

        {metricsQuery.isPending ? <LoadingState label="Loading metrics…" /> : null}
        {metricsQuery.isError ? (
          <ErrorState message={describeApiError(metricsQuery.error)} />
        ) : null}
        {recalculateMutation.isError ? (
          <ErrorState message={describeApiError(recalculateMutation.error)} />
        ) : null}
        {notice ? (
          <p className="state" role="status">
            {notice}
          </p>
        ) : null}
        {metricsQuery.data?.length === 0 ? (
          <EmptyState message="No metrics yet. Add the ones this organization reports on." />
        ) : null}

        {grouped.map(([category, metrics]) => (
          <div key={category} className="stack">
            <h3 className="metric-group__title">{category}</h3>
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Metric</th>
                  <th scope="col">Produced by</th>
                  <th scope="col">Frequency</th>
                  <th scope="col">Latest value</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {metrics.map((metric) => (
                  <tr key={metric.id}>
                    <td>
                      <Link to={`/metrics/${metric.id}`}>{metric.name}</Link>
                      <span className="data-table__meta">{metric.code}</span>
                    </td>
                    <td>
                      {metric.isCalculated ? (
                        <>
                          Formula
                          <span className="data-table__meta">{metric.formula}</span>
                        </>
                      ) : (
                        'Imported or entered'
                      )}
                    </td>
                    <td>{titleCase(metric.frequency)}</td>
                    <td>
                      {metric.latestValue
                        ? formatMetricValue(metric.latestValue.value, metric.unit, currencyCode)
                        : '—'}
                      {metric.latestValue ? (
                        <span className="data-table__meta">{metric.latestValue.periodStart}</span>
                      ) : null}
                    </td>
                    <td>
                      <span
                        className={`badge ${metric.isActive ? 'badge--positive' : 'badge--negative'}`}
                      >
                        {metric.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </section>

      {isCreating ? (
        <MetricDialog
          metrics={metricsQuery.data ?? []}
          isSaving={createMutation.isPending}
          error={createMutation.isError ? describeApiError(createMutation.error) : null}
          onCancel={() => setIsCreating(false)}
          onSubmit={(values) => createMutation.mutate(values)}
        />
      ) : null}
    </div>
  );
}

/** Groups metrics by category so the catalogue reads like a structure, not a list. */
function groupByCategory(metrics: MetricSummary[]): Array<[string, MetricSummary[]]> {
  const groups = new Map<string, MetricSummary[]>();

  for (const metric of metrics) {
    const key = metric.category ?? 'Uncategorised';
    groups.set(key, [...(groups.get(key) ?? []), metric]);
  }

  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
}

function titleCase(value: string): string {
  return value.charAt(0) + value.slice(1).toLowerCase();
}
