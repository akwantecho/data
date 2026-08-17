import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { IndustryPackSummary } from '@sip/shared-types';
import { PageHeader } from '../../components/PageHeader';
import { EmptyState, ErrorState, LoadingState } from '../../components/states';
import { describeApiError } from '../../lib/errors';
import { fetchPlatformPack, fetchPlatformPacks, packKeys, syncPacks } from './packs-api';

/**
 * Industry packs as platform staff see them (plan §36): every published pack,
 * what it installs, and the button that re-reads the shipped catalogue into the
 * database.
 */
export function PlatformPacksPage() {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const packsQuery = useQuery({ queryKey: packKeys.platformList, queryFn: fetchPlatformPacks });

  const detailQuery = useQuery({
    queryKey: packKeys.platformDetail(selectedId ?? ''),
    queryFn: () => fetchPlatformPack(selectedId as string),
    enabled: Boolean(selectedId),
  });

  const syncMutation = useMutation({
    mutationFn: syncPacks,
    onSuccess: async (result) => {
      const summary = result.packs
        .map(
          (pack) =>
            `${pack.code} ${pack.version} (+${pack.templateMetricsCreated} new, ` +
            `${pack.templateMetricsUpdated} updated)`,
        )
        .join('; ');

      setNotice(`Catalogue synced: ${summary}. Organizations pick this up when they install.`);
      await queryClient.invalidateQueries({ queryKey: packKeys.platformList });
    },
  });

  return (
    <div className="stack">
      <PageHeader
        title="Industry packs"
        description="Default metrics, health models and rules per industry. A pack is data: installing one writes ordinary tenant rows."
      />

      <section className="card stack">
        <div className="section-header">
          <h2 className="card__title">Published packs</h2>
          <button
            type="button"
            className="button button--ghost"
            disabled={syncMutation.isPending}
            onClick={() => syncMutation.mutate()}
          >
            {syncMutation.isPending ? 'Syncing…' : 'Sync catalogue'}
          </button>
        </div>

        {packsQuery.isPending ? <LoadingState label="Loading industry packs…" /> : null}
        {packsQuery.isError ? <ErrorState message={describeApiError(packsQuery.error)} /> : null}
        {syncMutation.isError ? (
          <ErrorState message={describeApiError(syncMutation.error)} />
        ) : null}
        {notice ? (
          <p className="state" role="status">
            {notice}
          </p>
        ) : null}
        {packsQuery.data?.length === 0 ? (
          <EmptyState message="No industry packs are published. Sync the catalogue to publish them." />
        ) : null}

        {packsQuery.data && packsQuery.data.length > 0 ? (
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Pack</th>
                <th scope="col">Industry</th>
                <th scope="col">Version</th>
                <th scope="col">Metrics</th>
                <th scope="col">Health categories</th>
                <th scope="col">Rules</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {packsQuery.data.map((pack) => (
                <tr key={pack.id}>
                  <td>
                    {pack.name}
                    <span className="data-table__meta">{pack.code}</span>
                  </td>
                  <td>{pack.industryName}</td>
                  <td>{pack.version}</td>
                  <td>{pack.metricCount}</td>
                  <td>{pack.healthCategoryCount}</td>
                  <td>{describeRules(pack)}</td>
                  <td className="data-table__actions">
                    <button
                      type="button"
                      className="button button--ghost"
                      onClick={() => setSelectedId(pack.id === selectedId ? null : pack.id)}
                    >
                      {pack.id === selectedId ? 'Hide' : 'Inspect'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </section>

      {selectedId ? (
        <section className="card stack">
          {detailQuery.isPending ? <LoadingState label="Loading pack…" /> : null}
          {detailQuery.isError ? (
            <ErrorState message={describeApiError(detailQuery.error)} />
          ) : null}

          {detailQuery.data ? (
            <>
              <h2 className="card__title">{detailQuery.data.name}</h2>
              <p className="form-hint">{detailQuery.data.description}</p>

              <h3 className="metric-group__title">Metrics</h3>
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">Metric</th>
                    <th scope="col">Category</th>
                    <th scope="col">Unit</th>
                    <th scope="col">Produced by</th>
                  </tr>
                </thead>
                <tbody>
                  {detailQuery.data.metrics.map((metric) => (
                    <tr key={metric.code}>
                      <td>
                        {metric.name}
                        <span className="data-table__meta">{metric.code}</span>
                      </td>
                      <td>{metric.category ?? '—'}</td>
                      <td>{metric.unit}</td>
                      <td>{metric.formula ? `Formula: ${metric.formula}` : 'Reported'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {detailQuery.data.healthModel ? (
                <>
                  <h3 className="metric-group__title">{detailQuery.data.healthModel.name}</h3>
                  <ul className="stack">
                    {detailQuery.data.healthModel.categories.map((category) => (
                      <li key={category.code}>
                        <strong>
                          {category.name} — {category.weight}%
                        </strong>
                        <span className="data-table__meta">
                          {category.metrics
                            .map((metric) => `${metric.code} ${metric.weight}%`)
                            .join(', ')}
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}

              <h3 className="metric-group__title">Rules</h3>
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">Rule</th>
                    <th scope="col">Kind</th>
                    <th scope="col">Severity</th>
                    <th scope="col">Reads</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ...detailQuery.data.insightRules.map((rule) => ({ rule, kind: 'Insight' })),
                    ...detailQuery.data.alertRules.map((rule) => ({ rule, kind: 'Alert' })),
                  ].map(({ rule, kind }) => (
                    <tr key={`${kind}-${rule.code}`}>
                      <td>
                        {rule.name}
                        <span className="data-table__meta">{rule.code}</span>
                      </td>
                      <td>{kind}</td>
                      <td>{rule.severity}</td>
                      <td>{rule.metrics.join(', ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

function describeRules(pack: IndustryPackSummary): string {
  return `${pack.insightRuleCount} insight, ${pack.alertRuleCount} alert`;
}
