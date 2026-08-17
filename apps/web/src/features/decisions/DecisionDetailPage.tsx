import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import {
  DECISION_REVIEW_RESULTS,
  DECISION_STATUSES,
  type DecisionStatus,
  type ReviewDecisionRequest,
} from '@sip/shared-types';
import { useSession } from '../auth/session-context';
import { PageHeader } from '../../components/PageHeader';
import { FormField } from '../../components/FormField';
import { EmptyState, ErrorState, LoadingState } from '../../components/states';
import { describeApiError } from '../../lib/errors';
import { statusLabel } from '../goals/goal-display';
import {
  addDecisionAction,
  decisionKeys,
  fetchDecision,
  reviewDecision,
  setDecisionActionState,
  updateDecision,
} from './decisions-api';

/**
 * One decision, its evidence and its review (plan §31, §32).
 *
 * The evidence panel is the reason the record exists: it says what the decision was
 * taken on, and every item links back to the figure itself so the reasoning can be
 * checked rather than taken on trust.
 */
export function DecisionDetailPage() {
  const { id = '' } = useParams();
  const { activeMembership } = useSession();
  const canAct =
    activeMembership?.role === 'ORGANIZATION_ADMIN' || activeMembership?.role === 'ANALYST';
  const queryClient = useQueryClient();

  const [actionTitle, setActionTitle] = useState('');

  const decisionQuery = useQuery({
    queryKey: decisionKeys.detail(id),
    queryFn: () => fetchDecision(id),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['decisions'] });

  const statusMutation = useMutation({
    mutationFn: (status: DecisionStatus) => updateDecision(id, { status }),
    onSuccess: invalidate,
  });

  const actionMutation = useMutation({
    mutationFn: () => addDecisionAction(id, { title: actionTitle.trim() }),
    onSuccess: async () => {
      setActionTitle('');
      await invalidate();
    },
  });

  const actionStateMutation = useMutation({
    mutationFn: ({ actionId, isCompleted }: { actionId: string; isCompleted: boolean }) =>
      setDecisionActionState(id, actionId, isCompleted),
    onSuccess: invalidate,
  });

  const reviewMutation = useMutation({
    mutationFn: (body: ReviewDecisionRequest) => reviewDecision(id, body),
    onSuccess: invalidate,
  });

  const decision = decisionQuery.data;

  if (decisionQuery.isPending) {
    return <LoadingState label="Loading decision…" />;
  }

  if (decisionQuery.isError || !decision) {
    return <ErrorState message={describeApiError(decisionQuery.error)} />;
  }

  return (
    <div className="stack">
      <PageHeader title={decision.title} description={decision.problemStatement} />

      <section className="card stack">
        <div className="section-header">
          <h2 className="card__title">Where it stands</h2>
          <span className="badge">{decision.status}</span>
        </div>

        <dl className="metric-grid">
          <Stat label="Priority" value={decision.priority} />
          <Stat label="Owner" value={decision.ownerName ?? 'Unassigned'} />
          <Stat label="Decided" value={decision.decisionDate ?? 'Not yet'} />
          <Stat label="Review due" value={decision.reviewDate ?? 'Not scheduled'} />
          <Stat
            label="Actions"
            value={
              decision.totalActions === 0
                ? 'None'
                : `${decision.openActions} of ${decision.totalActions} open`
            }
          />
          <Stat label="Last review" value={decision.lastReviewResult ?? 'Not reviewed'} />
        </dl>

        {decision.context ? <p>{decision.context}</p> : null}
        {decision.expectedOutcome ? (
          <p className="form-hint">Expected outcome: {decision.expectedOutcome}</p>
        ) : null}

        {canAct ? (
          <div className="form-actions">
            {DECISION_STATUSES.filter((status) => status !== decision.status).map((status) => (
              <button
                key={status}
                type="button"
                className="button button--ghost"
                disabled={statusMutation.isPending}
                onClick={() => statusMutation.mutate(status)}
              >
                Mark {status.toLowerCase().replace(/_/g, ' ')}
              </button>
            ))}
          </div>
        ) : null}
      </section>

      <section className="card stack">
        <h2 className="card__title">Evidence</h2>
        <p className="form-hint">
          The figures this decision was taken on. Each links back to the record it came from.
        </p>

        {decision.evidence.metrics.length === 0 &&
        decision.evidence.alerts.length === 0 &&
        decision.evidence.insights.length === 0 &&
        decision.evidence.goals.length === 0 ? (
          <EmptyState message="No evidence is linked to this decision." />
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Kind</th>
                <th scope="col">What</th>
                <th scope="col">Detail</th>
              </tr>
            </thead>
            <tbody>
              {decision.evidence.alerts.map((alert) => (
                <tr key={alert.alertId}>
                  <td>Alert</td>
                  <td>
                    <Link to="/alerts">{alert.title}</Link>
                  </td>
                  <td>
                    {alert.severity} · {alert.periodStart ?? 'no period'}
                  </td>
                </tr>
              ))}
              {decision.evidence.insights.map((insight) => (
                <tr key={insight.insightId}>
                  <td>Insight</td>
                  <td>
                    <Link to="/insights">{insight.title}</Link>
                  </td>
                  <td>{insight.periodStart ?? 'no period'}</td>
                </tr>
              ))}
              {decision.evidence.metrics.map((metric) => (
                <tr key={metric.metricId}>
                  <td>Metric</td>
                  <td>
                    <Link to={`/metrics/${metric.metricId}`}>{metric.name}</Link>
                  </td>
                  <td>{metric.unit}</td>
                </tr>
              ))}
              {decision.evidence.goals.map((goal) => (
                <tr key={goal.goalId}>
                  <td>Goal</td>
                  <td>
                    <Link to={`/goals/${goal.goalId}`}>{goal.title}</Link>
                  </td>
                  <td>
                    {statusLabel(goal.status)}
                    {goal.progressPct === null ? '' : ` · ${goal.progressPct}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card stack">
        <h2 className="card__title">Actions</h2>

        {decision.actions.length === 0 ? (
          <EmptyState message="No actions have been recorded against this decision." />
        ) : (
          <ul className="stack">
            {decision.actions.map((action) => (
              <li key={action.id}>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={action.isCompleted}
                    disabled={!canAct || actionStateMutation.isPending}
                    onChange={(event) =>
                      actionStateMutation.mutate({
                        actionId: action.id,
                        isCompleted: event.target.checked,
                      })
                    }
                  />
                  <span>{action.title}</span>
                </label>
                <span className="data-table__meta">
                  {action.ownerName ?? 'Unassigned'}
                  {action.dueDate ? ` · due ${action.dueDate}` : ''}
                  {action.completedAt
                    ? ` · done ${new Date(action.completedAt).toLocaleDateString()}`
                    : ''}
                </span>
              </li>
            ))}
          </ul>
        )}

        {canAct ? (
          <form
            className="stack"
            onSubmit={(event) => {
              event.preventDefault();

              if (actionTitle.trim().length >= 3) {
                actionMutation.mutate();
              }
            }}
          >
            <label className="filter-bar__field" htmlFor="decision-action">
              <span className="filter-bar__label">Add an action</span>
              <input
                id="decision-action"
                className="form-field__input"
                value={actionTitle}
                onChange={(event) => setActionTitle(event.target.value)}
                placeholder="What someone will actually do"
              />
            </label>
            <div className="form-actions">
              <button
                type="submit"
                className="button button--ghost"
                disabled={actionMutation.isPending || actionTitle.trim().length < 3}
              >
                Add action
              </button>
            </div>
          </form>
        ) : null}
      </section>

      <section className="card stack">
        <h2 className="card__title">Reviews</h2>
        <p className="form-hint">
          Each review is kept as it was written and judged against the outcome expected at the time,
          so editing the decision afterwards cannot rewrite its history.
        </p>

        {decision.reviews.length === 0 ? (
          <EmptyState message="This decision has not been reviewed yet." />
        ) : (
          <ul className="stack">
            {decision.reviews.map((review) => (
              <li key={review.id} className="stack">
                <div className="section-header">
                  <strong>{review.result ?? 'No verdict'}</strong>
                  <span className="data-table__meta">
                    {new Date(review.reviewedAt).toLocaleDateString()}
                    {review.reviewerName ? ` · ${review.reviewerName}` : ''}
                  </span>
                </div>
                <p>{review.actualOutcome ?? '—'}</p>
                {review.expectedOutcome ? (
                  <p className="form-hint">Expected at the time: {review.expectedOutcome}</p>
                ) : null}
                {review.notes ? <p className="form-hint">{review.notes}</p> : null}
              </li>
            ))}
          </ul>
        )}

        {canAct && decision.status !== 'DRAFT' ? (
          <ReviewForm
            isSaving={reviewMutation.isPending}
            error={reviewMutation.isError ? describeApiError(reviewMutation.error) : null}
            onSubmit={(values) => reviewMutation.mutate(values)}
          />
        ) : null}
        {canAct && decision.status === 'DRAFT' ? (
          <p className="state">A decision that has not been taken yet cannot be reviewed.</p>
        ) : null}
      </section>
    </div>
  );
}

/** The review form (plan §32): what happened, how it went, and anything else worth keeping. */
function ReviewForm({
  isSaving,
  error,
  onSubmit,
}: {
  isSaving: boolean;
  error: string | null;
  onSubmit: (values: ReviewDecisionRequest) => void;
}) {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<{ actualOutcome: string; result: ReviewDecisionRequest['result']; notes: string }>({
    defaultValues: { actualOutcome: '', result: 'NEUTRAL', notes: '' },
  });

  return (
    <form
      className="stack"
      onSubmit={handleSubmit((values) => {
        onSubmit({
          actualOutcome: values.actualOutcome,
          result: values.result,
          notes: values.notes || null,
        });
        reset();
      })}
      noValidate
    >
      <h3 className="metric-group__title">Record a review</h3>

      <FormField
        label="What actually happened"
        htmlFor="review-outcome"
        error={errors.actualOutcome?.message}
      >
        <textarea
          id="review-outcome"
          className="form-field__input"
          rows={3}
          {...register('actualOutcome', {
            required: 'Say what actually happened',
            minLength: { value: 3, message: 'Say what actually happened' },
          })}
        />
      </FormField>

      <FormField label="Result" htmlFor="review-result">
        <select id="review-result" className="form-field__input" {...register('result')}>
          {DECISION_REVIEW_RESULTS.map((result) => (
            <option key={result} value={result}>
              {result}
            </option>
          ))}
        </select>
      </FormField>

      <FormField label="Notes" htmlFor="review-notes" hint="Optional.">
        <input id="review-notes" className="form-field__input" {...register('notes')} />
      </FormField>

      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="form-actions">
        <button type="submit" className="button button--primary" disabled={isSaving}>
          {isSaving ? 'Saving…' : 'Record review'}
        </button>
      </div>
    </form>
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
