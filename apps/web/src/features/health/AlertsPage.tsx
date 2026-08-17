import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import type { AlertStatus, AlertSummary } from '@sip/shared-types';
import { ALERT_STATUSES } from '@sip/shared-types';
import { useSession } from '../auth/session-context';
import { PageHeader } from '../../components/PageHeader';
import { Drawer } from '../../components/Drawer';
import { EmptyState, ErrorState, LoadingState } from '../../components/states';
import { describeApiError } from '../../lib/errors';
import { fetchAlert, fetchAlerts, healthKeys, setAlertStatus } from './health-api';

const FILTERS: Array<{ label: string; status?: AlertStatus }> = [
  { label: 'Open', status: 'OPEN' },
  { label: 'Acknowledged', status: 'ACKNOWLEDGED' },
  { label: 'Resolved', status: 'RESOLVED' },
  { label: 'Dismissed', status: 'DISMISSED' },
  { label: 'All' },
];

/**
 * Alerts (plan §27).
 *
 * Every alert says what fired, on which metric and in which period, and opens on
 * the figures that produced it — an alert nobody can check is an alert nobody
 * will act on.
 */
export function AlertsPage() {
  const { activeMembership } = useSession();
  const canAct =
    activeMembership?.role === 'ORGANIZATION_ADMIN' || activeMembership?.role === 'ANALYST';
  const queryClient = useQueryClient();

  const [status, setStatus] = useState<AlertStatus | undefined>('OPEN');
  const [openId, setOpenId] = useState<string | null>(null);
  const [note, setNote] = useState('');

  const query = { status };
  const alertsQuery = useQuery({
    queryKey: healthKeys.alerts(query),
    queryFn: () => fetchAlerts(query),
  });

  const detailQuery = useQuery({
    queryKey: healthKeys.alert(openId ?? ''),
    queryFn: () => fetchAlert(openId as string),
    enabled: Boolean(openId),
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, next }: { id: string; next: AlertStatus }) =>
      setAlertStatus(id, { status: next, note: note.trim() || null }),
    onSuccess: async () => {
      setNote('');
      await queryClient.invalidateQueries({ queryKey: ['alerts'] });
    },
  });

  const alerts = alertsQuery.data?.items ?? [];

  return (
    <div className="stack">
      <PageHeader
        title="Alerts"
        description="Conditions the organization asked to be told about, each with the figures that triggered it."
      />

      <div className="filter-bar">
        <div className="filter-bar__group" role="group" aria-label="Alert status">
          {FILTERS.map((filter) => (
            <button
              key={filter.label}
              type="button"
              className={`chip ${status === filter.status ? 'chip--active' : ''}`}
              onClick={() => setStatus(filter.status)}
            >
              {filter.label}
            </button>
          ))}
        </div>
      </div>

      <section className="card stack">
        {alertsQuery.isPending ? <LoadingState label="Loading alerts…" /> : null}
        {alertsQuery.isError ? <ErrorState message={describeApiError(alertsQuery.error)} /> : null}
        {alertsQuery.data && alerts.length === 0 ? (
          <EmptyState
            message={
              status === 'OPEN'
                ? 'No open alerts. Rules are evaluated after every import.'
                : 'No alerts with this status.'
            }
          />
        ) : null}

        {alerts.length > 0 ? (
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Alert</th>
                <th scope="col">Metric</th>
                <th scope="col">Period</th>
                <th scope="col">Severity</th>
                <th scope="col">Status</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {alerts.map((alert) => (
                <tr key={alert.id}>
                  <td>
                    {alert.title}
                    <span className="data-table__meta">{alert.evidence.statement}</span>
                  </td>
                  <td>
                    {alert.metricId ? (
                      <Link to={`/analytics?metric=${alert.metricId}`}>{alert.metricName}</Link>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>{alert.periodStart ?? '—'}</td>
                  <td>
                    <span className={`badge ${severityClass(alert.severity)}`}>
                      {alert.severity}
                    </span>
                  </td>
                  <td>{alert.status}</td>
                  <td className="data-table__actions">
                    <button
                      type="button"
                      className="button button--ghost"
                      onClick={() => setOpenId(alert.id)}
                    >
                      Evidence
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </section>

      {openId && detailQuery.data ? (
        <Drawer title={detailQuery.data.title} onClose={() => setOpenId(null)}>
          <div className="stack">
            <p>{detailQuery.data.description}</p>

            <h3 className="metric-group__title">Evidence</h3>
            <p className="state">{detailQuery.data.evidence.statement}</p>
            <table className="data-table">
              <tbody>
                {detailQuery.data.evidence.figures.map((figure) => (
                  <tr key={figure.label}>
                    <td>{figure.label}</td>
                    <td>{figure.value ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <h3 className="metric-group__title">History</h3>
            <ul className="stack">
              {detailQuery.data.events.map((event) => (
                <li key={event.id}>
                  <strong>
                    {event.fromStatus ? `${event.fromStatus} → ` : ''}
                    {event.toStatus}
                  </strong>
                  <span className="data-table__meta">
                    {new Date(event.createdAt).toLocaleString()}
                    {event.actorName ? ` · ${event.actorName}` : ''}
                    {event.note ? ` · ${event.note}` : ''}
                  </span>
                </li>
              ))}
            </ul>

            {canAct &&
            detailQuery.data.status !== 'RESOLVED' &&
            detailQuery.data.status !== 'DISMISSED' ? (
              <div className="stack">
                <label className="filter-bar__field">
                  <span className="filter-bar__label">Note (optional)</span>
                  <input
                    className="form-field__input"
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    placeholder="Why you are closing this"
                  />
                </label>
                <div className="form-actions">
                  {ALERT_STATUSES.filter((candidate) => candidate !== detailQuery.data.status).map(
                    (candidate) =>
                      candidate === 'OPEN' ? null : (
                        <button
                          key={candidate}
                          type="button"
                          className="button button--ghost"
                          disabled={statusMutation.isPending}
                          onClick={() =>
                            statusMutation.mutate({ id: detailQuery.data.id, next: candidate })
                          }
                        >
                          {label(candidate)}
                        </button>
                      ),
                  )}
                </div>
                {statusMutation.isError ? (
                  <p className="form-error" role="alert">
                    {describeApiError(statusMutation.error)}
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        </Drawer>
      ) : null}
    </div>
  );
}

function severityClass(severity: AlertSummary['severity']): string {
  switch (severity) {
    case 'CRITICAL':
    case 'HIGH':
      return 'badge--negative';
    case 'WARNING':
      return 'badge--warning';
    default:
      return '';
  }
}

function label(status: AlertStatus): string {
  switch (status) {
    case 'ACKNOWLEDGED':
      return 'Acknowledge';
    case 'RESOLVED':
      return 'Resolve';
    case 'DISMISSED':
      return 'Dismiss';
    default:
      return status;
  }
}
