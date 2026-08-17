import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useSession } from '../auth/session-context';
import { EmptyState, ErrorState, LoadingState } from '../../components/states';
import { describeApiError } from '../../lib/errors';
import { metricKeys } from '../metrics/metrics-api';
import { fetchPackOverview, installPack, packKeys } from './packs-api';

/**
 * The organization's industry pack, on the settings page next to the industry it
 * follows from.
 *
 * Installing is safe to repeat: the API adds what is missing and leaves every
 * existing metric, weight and rule exactly as the organization has it, which is
 * what the result message reports back.
 */
export function IndustryPackCard() {
  const { activeMembership } = useSession();
  const canInstall = activeMembership?.role === 'ORGANIZATION_ADMIN';
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<string | null>(null);

  const overviewQuery = useQuery({ queryKey: packKeys.overview, queryFn: fetchPackOverview });

  const installMutation = useMutation({
    mutationFn: installPack,
    onSuccess: async (result) => {
      setNotice(
        `Installed ${result.packCode} ${result.version}: ${result.metricsCreated} metrics added, ` +
          `${result.metricsKept} already present and left unchanged, ` +
          `${result.insightRulesCreated} insight rules and ${result.alertRulesCreated} alert rules added.`,
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: packKeys.overview }),
        queryClient.invalidateQueries({ queryKey: metricKeys.all }),
      ]);
    },
  });

  return (
    <section className="card stack">
      <h2 className="card__title">Industry pack</h2>

      {overviewQuery.isPending ? <LoadingState label="Loading industry pack…" /> : null}
      {overviewQuery.isError ? (
        <ErrorState message={describeApiError(overviewQuery.error)} />
      ) : null}

      {overviewQuery.data && !overviewQuery.data.industryId ? (
        <EmptyState message="Select an industry to see the pack that applies to this organization." />
      ) : null}

      {overviewQuery.data && overviewQuery.data.industryId ? (
        <>
          {overviewQuery.data.available.length === 0 ? (
            <EmptyState
              message={`No pack is published for ${overviewQuery.data.industryName ?? 'this industry'} yet.`}
            />
          ) : null}

          {overviewQuery.data.available.map((pack) => (
            <div key={pack.id} className="stack">
              <div className="section-header">
                <div>
                  <strong>{pack.name}</strong>
                  <span className="data-table__meta">
                    {pack.installedVersion
                      ? `Installed, version ${pack.installedVersion}`
                      : 'Not installed'}
                  </span>
                </div>
                {canInstall ? (
                  <button
                    type="button"
                    className="button button--primary"
                    disabled={installMutation.isPending}
                    onClick={() => installMutation.mutate(pack.id)}
                  >
                    {installMutation.isPending
                      ? 'Installing…'
                      : pack.installedVersion
                        ? 'Reinstall missing items'
                        : 'Install pack'}
                  </button>
                ) : null}
              </div>
              <p className="form-hint">{pack.description}</p>
              <p className="state">
                {pack.metricCount} metrics, {pack.healthCategoryCount} health categories,{' '}
                {pack.insightRuleCount} insight rules and {pack.alertRuleCount} alert rules.
              </p>
            </div>
          ))}

          <dl className="metric-grid">
            <div className="metric-card">
              <dt className="metric-card__label">Pack metrics in this organization</dt>
              <dd className="metric-card__value">{overviewQuery.data.systemMetricCount}</dd>
            </div>
            <div className="metric-card">
              <dt className="metric-card__label">Insight rules</dt>
              <dd className="metric-card__value">{overviewQuery.data.insightRuleCount}</dd>
            </div>
            <div className="metric-card">
              <dt className="metric-card__label">Alert rules</dt>
              <dd className="metric-card__value">{overviewQuery.data.alertRuleCount}</dd>
            </div>
          </dl>

          {overviewQuery.data.healthModel ? (
            <div className="stack">
              <h3 className="metric-group__title">{overviewQuery.data.healthModel.name}</h3>
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">Category</th>
                    <th scope="col">Weight</th>
                    <th scope="col">Metrics</th>
                  </tr>
                </thead>
                <tbody>
                  {overviewQuery.data.healthModel.categories.map((category) => (
                    <tr key={category.code}>
                      <td>{category.name}</td>
                      <td>{Number(category.weight)}%</td>
                      <td>
                        {category.metrics
                          .map((metric) => `${metric.name} ${Number(metric.weight)}%`)
                          .join(', ')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="form-hint">
                Scores are calculated from this model in a later sprint. Pack metrics behave like
                any other: rename, retarget or deactivate them under{' '}
                <Link to="/metrics">Metrics</Link>.
              </p>
            </div>
          ) : null}
        </>
      ) : null}

      {installMutation.isError ? (
        <p className="form-error" role="alert">
          {describeApiError(installMutation.error)}
        </p>
      ) : null}
      {notice ? (
        <p className="state" role="status">
          {notice}
        </p>
      ) : null}
    </section>
  );
}
