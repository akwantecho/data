import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import type { DecisionSummary } from '@sip/shared-types';
import { useSession } from '../auth/session-context';
import { PageHeader } from '../../components/PageHeader';
import { EmptyState, ErrorState, LoadingState } from '../../components/states';
import { describeApiError } from '../../lib/errors';
import { GoalProgressBar } from '../goals/GoalProgressBar';
import { statusLabel, toneFor } from '../goals/goal-display';
import { DecisionDialog, type EvidencePreset } from './DecisionDialog';
import { createDecision, decisionKeys, fetchDecisionCentre } from './decisions-api';

/**
 * The decision centre (plan §30).
 *
 * Everything competing for management attention in one screen, in the order the
 * plan sets: what is critical, what is a warning, what is an opportunity, what has
 * been decided and what has been reviewed. Nothing here is calculated by this
 * page — the engines already produced it, and each item carries straight into a
 * decision with itself as the evidence.
 */
export function DecisionCentrePage() {
  const { activeMembership } = useSession();
  const canDecide =
    activeMembership?.role === 'ORGANIZATION_ADMIN' || activeMembership?.role === 'ANALYST';
  const queryClient = useQueryClient();

  const [preset, setPreset] = useState<EvidencePreset | null>(null);

  const centreQuery = useQuery({
    queryKey: decisionKeys.centre,
    queryFn: fetchDecisionCentre,
  });

  const createMutation = useMutation({
    mutationFn: createDecision,
    onSuccess: async () => {
      setPreset(null);
      await queryClient.invalidateQueries({ queryKey: ['decisions'] });
    },
  });

  const centre = centreQuery.data;

  return (
    <div className="stack">
      <PageHeader
        title="Decision Center"
        description="What the numbers are asking management to look at, and what management decided to do about it."
      />

      {canDecide ? (
        <div className="form-actions">
          <button type="button" className="button button--primary" onClick={() => setPreset({})}>
            Record a decision
          </button>
        </div>
      ) : null}

      {centreQuery.isPending ? <LoadingState label="Loading the decision centre…" /> : null}
      {centreQuery.isError ? <ErrorState message={describeApiError(centreQuery.error)} /> : null}

      {centre ? (
        <>
          <div className="panel-grid">
            <AttentionPanel
              title="Critical issues"
              emptyMessage="Nothing critical is open."
              items={centre.criticalIssues.map((issue) => ({
                id: issue.id,
                title: issue.title,
                meta: `${issue.metricName ?? 'No metric'} · ${issue.periodStart ?? 'no period'}`,
                preset: { alertIds: [issue.id] },
              }))}
              canDecide={canDecide}
              onDecide={setPreset}
              tone="negative"
            />
            <AttentionPanel
              title="Warnings"
              emptyMessage="No warnings are open."
              items={centre.warnings.map((issue) => ({
                id: issue.id,
                title: issue.title,
                meta: `${issue.metricName ?? 'No metric'} · ${issue.periodStart ?? 'no period'}`,
                preset: { alertIds: [issue.id] },
              }))}
              canDecide={canDecide}
              onDecide={setPreset}
              tone="warning"
            />
            <AttentionPanel
              title="Opportunities"
              emptyMessage="No opportunities have been raised for this period."
              items={centre.opportunities.map((insight) => ({
                id: insight.id,
                title: insight.title,
                meta: insight.narrative,
                preset: { insightIds: [insight.id] },
              }))}
              canDecide={canDecide}
              onDecide={setPreset}
            />
          </div>

          <section className="card stack">
            <div className="section-header">
              <h2 className="card__title">Goals at risk</h2>
              <Link className="button button--ghost" to="/goals">
                All goals
              </Link>
            </div>
            {centre.goalsAtRisk.length === 0 ? (
              <EmptyState message="No goal has fallen behind its schedule." />
            ) : (
              <ul className="stack">
                {centre.goalsAtRisk.map((goal) => (
                  <li key={goal.id} className="stack">
                    <div className="section-header">
                      <Link to={`/goals/${goal.id}`}>{goal.title}</Link>
                      <span className={`badge badge--${toneFor(goal.status)}`}>
                        {statusLabel(goal.status)}
                      </span>
                    </div>
                    <GoalProgressBar
                      progressPct={goal.progressPct}
                      expectedProgressPct={goal.expectedProgressPct}
                      status={goal.status}
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>

          <div className="panel-grid">
            <DecisionListPanel
              title="Open decisions"
              emptyMessage="Nothing is currently being decided."
              decisions={centre.openDecisions}
            />
            <DecisionListPanel
              title="Recently reviewed"
              emptyMessage="No decision has been reviewed yet."
              decisions={centre.recentlyReviewed}
            />
          </div>
        </>
      ) : null}

      {preset ? (
        <DecisionDialog
          preset={preset}
          isSaving={createMutation.isPending}
          error={createMutation.isError ? describeApiError(createMutation.error) : null}
          onCancel={() => setPreset(null)}
          onSubmit={(values) => createMutation.mutate(values)}
        />
      ) : null}
    </div>
  );
}

function AttentionPanel({
  title,
  items,
  emptyMessage,
  canDecide,
  onDecide,
  tone,
}: {
  title: string;
  items: Array<{ id: string; title: string; meta: string; preset: EvidencePreset }>;
  emptyMessage: string;
  canDecide: boolean;
  onDecide: (preset: EvidencePreset) => void;
  tone?: 'negative' | 'warning';
}) {
  return (
    <section className="card stack">
      <div className="section-header">
        <h2 className="card__title">{title}</h2>
        {tone ? <span className={`badge badge--${tone}`}>{items.length}</span> : null}
      </div>

      {items.length === 0 ? (
        <EmptyState message={emptyMessage} />
      ) : (
        <ul className="stack">
          {items.map((item) => (
            <li key={item.id} className="stack">
              <strong>{item.title}</strong>
              <span className="data-table__meta">{item.meta}</span>
              {canDecide ? (
                <button
                  type="button"
                  className="button button--ghost"
                  onClick={() => onDecide(item.preset)}
                >
                  Decide on this
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function DecisionListPanel({
  title,
  decisions,
  emptyMessage,
}: {
  title: string;
  decisions: DecisionSummary[];
  emptyMessage: string;
}) {
  return (
    <section className="card stack">
      <h2 className="card__title">{title}</h2>
      {decisions.length === 0 ? (
        <EmptyState message={emptyMessage} />
      ) : (
        <ul className="stack">
          {decisions.map((decision) => (
            <li key={decision.id}>
              <Link to={`/decisions/${decision.id}`}>{decision.title}</Link>
              <span className="data-table__meta">
                {decision.status} · {decision.priority} · {decision.evidenceCount} pieces of
                evidence
                {decision.totalActions > 0
                  ? ` · ${decision.openActions} of ${decision.totalActions} actions open`
                  : ''}
                {decision.lastReviewResult ? ` · reviewed ${decision.lastReviewResult}` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
