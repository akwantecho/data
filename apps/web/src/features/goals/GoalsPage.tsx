import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import type { GoalStatus } from '@sip/shared-types';
import { useSession } from '../auth/session-context';
import { PageHeader } from '../../components/PageHeader';
import { EmptyState, ErrorState, LoadingState } from '../../components/states';
import { describeApiError } from '../../lib/errors';
import { formatMetricValue } from '../../lib/format';
import { useOrganization } from '../organization/organization-context';
import { fetchMetrics, metricKeys } from '../metrics/metrics-api';
import { GoalProgressBar } from './GoalProgressBar';
import { describeRemaining, statusLabel, toneFor } from './goal-display';
import { GoalDialog } from './GoalDialog';
import { createGoal, fetchGoals, goalKeys, recalculateGoals } from './goals-api';

const FILTERS: Array<{ label: string; status?: GoalStatus }> = [
  { label: 'All' },
  { label: 'Active', status: 'ACTIVE' },
  { label: 'On track', status: 'ON_TRACK' },
  { label: 'At risk', status: 'AT_RISK' },
  { label: 'Off track', status: 'OFF_TRACK' },
  { label: 'Achieved', status: 'ACHIEVED' },
];

/**
 * Goals (plan §29).
 *
 * A metric-linked goal is never typed up by hand: its current value comes from the
 * metrics engine over the goal's own window, and its status follows from progress
 * against the calendar. This page shows both, so a goal that is ahead of the clock
 * and one that is behind it never look the same.
 */
export function GoalsPage() {
  const { activeMembership } = useSession();
  const { currencyCode } = useOrganization();
  const canEdit =
    activeMembership?.role === 'ORGANIZATION_ADMIN' || activeMembership?.role === 'ANALYST';
  const queryClient = useQueryClient();

  const [status, setStatus] = useState<GoalStatus | undefined>(undefined);
  const [isCreating, setIsCreating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const query = { status };
  const goalsQuery = useQuery({ queryKey: goalKeys.list(query), queryFn: () => fetchGoals(query) });

  const metricsQuery = useQuery({
    queryKey: metricKeys.list(true),
    queryFn: () => fetchMetrics(true),
    enabled: isCreating,
  });

  const createMutation = useMutation({
    mutationFn: createGoal,
    onSuccess: async () => {
      setIsCreating(false);
      await queryClient.invalidateQueries({ queryKey: ['goals'] });
    },
  });

  const recalculateMutation = useMutation({
    mutationFn: recalculateGoals,
    onSuccess: async (result) => {
      setNotice(
        result.changed === 0
          ? `Checked ${result.evaluated} goals; nothing has moved since the last run.`
          : `Updated ${result.changed} of ${result.evaluated} goals.`,
      );
      await queryClient.invalidateQueries({ queryKey: ['goals'] });
    },
  });

  const goals = goalsQuery.data ?? [];

  return (
    <div className="stack">
      <PageHeader
        title="Goals"
        description="Where the organization said it was going, and where its own metrics say it has got to."
      />

      <div className="filter-bar">
        <div className="filter-bar__group" role="group" aria-label="Goal status">
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
              Set a goal
            </button>
          </div>
        ) : null}
      </div>

      {notice ? (
        <p className="state" role="status">
          {notice}
        </p>
      ) : null}

      {goalsQuery.isPending ? <LoadingState label="Loading goals…" /> : null}
      {goalsQuery.isError ? <ErrorState message={describeApiError(goalsQuery.error)} /> : null}
      {goalsQuery.data && goals.length === 0 ? (
        <section className="card">
          <EmptyState message="No goals yet. A goal linked to a metric keeps its own progress current." />
        </section>
      ) : null}

      {goals.map((goal) => (
        <article className="card stack" key={goal.id}>
          <div className="section-header">
            <h2 className="card__title">
              <Link to={`/goals/${goal.id}`}>{goal.title}</Link>
            </h2>
            <span className={`badge badge--${toneFor(goal.status)}`}>
              {statusLabel(goal.status)}
            </span>
          </div>

          <GoalProgressBar
            progressPct={goal.progressPct}
            expectedProgressPct={goal.expectedProgressPct}
            status={goal.status}
          />

          <p className="form-hint">
            {goal.primaryMetric
              ? `${goal.primaryMetric.name}: ` +
                `${formatMetricValue(goal.currentValue, goal.primaryMetric.unit, currencyCode)}` +
                ` of ${formatMetricValue(goal.targetValue, goal.primaryMetric.unit, currencyCode)}`
              : `Target ${goal.targetValue} — no metric linked, so progress is entered by hand`}
            {' · '}
            due {goal.dueDate}
            {' · '}
            {describeRemaining(goal.daysRemaining)}
            {goal.ownerName ? ` · ${goal.ownerName}` : ''}
          </p>
        </article>
      ))}

      {isCreating ? (
        <GoalDialog
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
