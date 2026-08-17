import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useSession } from '../auth/session-context';
import { PageHeader } from '../../components/PageHeader';
import { EmptyState, ErrorState, LoadingState } from '../../components/states';
import { describeApiError } from '../../lib/errors';
import { formatMetricValue } from '../../lib/format';
import { useOrganization } from '../organization/organization-context';
import { GoalProgressBar } from './GoalProgressBar';
import { describeRemaining, statusLabel, toneFor } from './goal-display';
import { addGoalNote, deleteGoal, fetchGoal, goalKeys, updateGoal } from './goals-api';

/**
 * One goal, and everything that happened to it (plan §29).
 *
 * The history is the point: every recalculation that changed the figure appended a
 * row, so the record shows how the goal actually went rather than only where it
 * ended up.
 */
export function GoalDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { activeMembership } = useSession();
  const { currencyCode } = useOrganization();
  const canEdit =
    activeMembership?.role === 'ORGANIZATION_ADMIN' || activeMembership?.role === 'ANALYST';
  const queryClient = useQueryClient();

  const [note, setNote] = useState('');

  const goalQuery = useQuery({ queryKey: goalKeys.detail(id), queryFn: () => fetchGoal(id) });

  const noteMutation = useMutation({
    mutationFn: () => addGoalNote(id, note.trim()),
    onSuccess: async () => {
      setNote('');
      await queryClient.invalidateQueries({ queryKey: ['goals'] });
    },
  });

  const cancelMutation = useMutation({
    mutationFn: () => updateGoal(id, { status: 'CANCELLED' }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['goals'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteGoal(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['goals'] });
      navigate('/goals');
    },
  });

  const goal = goalQuery.data;

  /** A goal's figures carry the linked metric's unit; without one they are bare numbers. */
  const show = (value: string | null): string =>
    goal?.primaryMetric
      ? formatMetricValue(value, goal.primaryMetric.unit, currencyCode)
      : (value ?? '—');

  if (goalQuery.isPending) {
    return <LoadingState label="Loading goal…" />;
  }

  if (goalQuery.isError || !goal) {
    return <ErrorState message={describeApiError(goalQuery.error)} />;
  }

  return (
    <div className="stack">
      <PageHeader
        title={goal.title}
        description={goal.description ?? 'No description was recorded for this goal.'}
      />

      <section className="card stack">
        <div className="section-header">
          <h2 className="card__title">Progress</h2>
          <span className={`badge badge--${toneFor(goal.status)}`}>{statusLabel(goal.status)}</span>
        </div>

        <GoalProgressBar
          progressPct={goal.progressPct}
          expectedProgressPct={goal.expectedProgressPct}
          status={goal.status}
        />

        <dl className="metric-grid">
          <Stat label="Baseline" value={show(goal.baselineValue)} />
          <Stat label="Current" value={show(goal.currentValue)} />
          <Stat label="Target" value={show(goal.targetValue)} />
          <Stat label="Window" value={`${goal.startDate} → ${goal.dueDate}`} />
          <Stat label="Time" value={describeRemaining(goal.daysRemaining)} />
          <Stat label="Owner" value={goal.ownerName ?? 'Unassigned'} />
        </dl>

        <p className="form-hint">
          {goal.primaryMetric ? (
            <>
              Progress is read from{' '}
              <Link to={`/metrics/${goal.primaryMetric.metricId}`}>{goal.primaryMetric.name}</Link>{' '}
              over this goal&rsquo;s own window, and refreshed after every import. Nobody types the
              current value.
            </>
          ) : (
            'No metric is linked, so the current value is whatever was last recorded by hand.'
          )}
        </p>
      </section>

      {goal.decisions.length > 0 ? (
        <section className="card stack">
          <h2 className="card__title">Decisions citing this goal</h2>
          <ul className="stack">
            {goal.decisions.map((decision) => (
              <li key={decision.id}>
                <Link to={`/decisions/${decision.id}`}>{decision.title}</Link>
                <span className="data-table__meta">{decision.status}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="card stack">
        <h2 className="card__title">History</h2>

        {goal.updates.length === 0 ? (
          <EmptyState message="Nothing has been recorded against this goal yet." />
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">Value</th>
                <th scope="col">Progress</th>
                <th scope="col">Status</th>
                <th scope="col">Note</th>
              </tr>
            </thead>
            <tbody>
              {goal.updates.map((update) => (
                <tr key={update.id}>
                  <td>
                    {new Date(update.createdAt).toLocaleString()}
                    {update.actorName ? (
                      <span className="data-table__meta">{update.actorName}</span>
                    ) : (
                      <span className="data-table__meta">Automatic</span>
                    )}
                  </td>
                  <td>{show(update.currentValue)}</td>
                  <td>{update.progressPct === null ? '—' : `${update.progressPct}%`}</td>
                  <td>{update.status ? statusLabel(update.status) : '—'}</td>
                  <td>{update.note ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {canEdit ? (
          <form
            className="stack"
            onSubmit={(event) => {
              event.preventDefault();

              if (note.trim().length > 0) {
                noteMutation.mutate();
              }
            }}
          >
            <label className="filter-bar__field" htmlFor="goal-note">
              <span className="filter-bar__label">Add a note</span>
              <input
                id="goal-note"
                className="form-field__input"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Context the figures cannot carry"
              />
            </label>
            <div className="form-actions">
              <button
                type="submit"
                className="button button--ghost"
                disabled={noteMutation.isPending || note.trim().length === 0}
              >
                {noteMutation.isPending ? 'Saving…' : 'Add note'}
              </button>
            </div>
            {noteMutation.isError ? (
              <p className="form-error" role="alert">
                {describeApiError(noteMutation.error)}
              </p>
            ) : null}
          </form>
        ) : null}
      </section>

      {canEdit ? (
        <section className="card stack">
          <h2 className="card__title">Close this goal</h2>
          <p className="form-hint">
            Cancelling keeps the goal and its history. Deleting is refused while a decision cites it
            as evidence — that decision would otherwise lose its reasoning.
          </p>
          <div className="form-actions">
            <button
              type="button"
              className="button button--ghost"
              disabled={cancelMutation.isPending || goal.status === 'CANCELLED'}
              onClick={() => cancelMutation.mutate()}
            >
              {goal.status === 'CANCELLED' ? 'Cancelled' : 'Cancel goal'}
            </button>
            <button
              type="button"
              className="button button--danger"
              disabled={deleteMutation.isPending}
              onClick={() => deleteMutation.mutate()}
            >
              Delete goal
            </button>
          </div>
          {deleteMutation.isError ? (
            <p className="form-error" role="alert">
              {describeApiError(deleteMutation.error)}
            </p>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric-card">
      <dt className="metric-card__label">{label}</dt>
      <dd className="metric-card__value">{value}</dd>
    </div>
  );
}
