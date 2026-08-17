import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useQuery } from '@tanstack/react-query';
import {
  DECISION_PRIORITIES,
  DECISION_STATUSES,
  type CreateDecisionRequest,
} from '@sip/shared-types';
import { FormField } from '../../components/FormField';
import { Modal } from '../../components/Modal';
import { fetchAlerts, fetchInsights, healthKeys } from '../health/health-api';
import { fetchGoals, goalKeys } from '../goals/goals-api';
import { fetchMetrics, metricKeys } from '../metrics/metrics-api';

interface DecisionForm {
  title: string;
  problemStatement: string;
  context: string;
  status: CreateDecisionRequest['status'];
  priority: CreateDecisionRequest['priority'];
  decisionDate: string;
  expectedOutcome: string;
  reviewDate: string;
}

export interface EvidencePreset {
  metricIds?: string[];
  alertIds?: string[];
  insightIds?: string[];
  goalIds?: string[];
}

/**
 * Recording a decision (plan §30, §31).
 *
 * Evidence is not an optional extra on this form. A decision recorded without the
 * figures that prompted it cannot be reviewed later, because there is nothing to
 * review it against — so the submit button stays disabled until something is cited.
 */
export function DecisionDialog({
  preset,
  isSaving,
  error,
  onCancel,
  onSubmit,
}: {
  preset?: EvidencePreset;
  isSaving: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: (values: CreateDecisionRequest) => void;
}) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<DecisionForm>({
    defaultValues: {
      title: '',
      problemStatement: '',
      context: '',
      status: 'OPEN',
      priority: 'MEDIUM',
      decisionDate: '',
      expectedOutcome: '',
      reviewDate: '',
    },
  });

  const [metricIds, setMetricIds] = useState<string[]>(preset?.metricIds ?? []);
  const [alertIds, setAlertIds] = useState<string[]>(preset?.alertIds ?? []);
  const [insightIds, setInsightIds] = useState<string[]>(preset?.insightIds ?? []);
  const [goalIds, setGoalIds] = useState<string[]>(preset?.goalIds ?? []);

  const metricsQuery = useQuery({
    queryKey: metricKeys.list(true),
    queryFn: () => fetchMetrics(true),
  });
  const alertsQuery = useQuery({
    queryKey: healthKeys.alerts({ status: 'OPEN' }),
    queryFn: () => fetchAlerts({ status: 'OPEN' }),
  });
  const insightsQuery = useQuery({
    queryKey: healthKeys.insights({}),
    queryFn: () => fetchInsights({}),
  });
  const goalsQuery = useQuery({ queryKey: goalKeys.list({}), queryFn: () => fetchGoals({}) });

  const evidenceCount = metricIds.length + alertIds.length + insightIds.length + goalIds.length;

  return (
    <Modal title="Record a decision" onClose={onCancel}>
      <form
        className="stack"
        onSubmit={handleSubmit((values) =>
          onSubmit({
            title: values.title,
            problemStatement: values.problemStatement,
            context: values.context || null,
            status: values.status,
            priority: values.priority,
            decisionDate: values.decisionDate || null,
            expectedOutcome: values.expectedOutcome || null,
            reviewDate: values.reviewDate || null,
            metricIds,
            alertIds,
            insightIds,
            goalIds,
          }),
        )}
        noValidate
      >
        <FormField label="Decision" htmlFor="decision-title" error={errors.title?.message}>
          <input
            id="decision-title"
            className="form-field__input"
            {...register('title', {
              required: 'Say what was decided',
              minLength: { value: 3, message: 'Say what was decided' },
            })}
          />
        </FormField>

        <FormField
          label="Problem"
          htmlFor="decision-problem"
          hint="What made this necessary."
          error={errors.problemStatement?.message}
        >
          <textarea
            id="decision-problem"
            className="form-field__input"
            rows={3}
            {...register('problemStatement', {
              required: 'Describe the problem this decision addresses',
              minLength: { value: 10, message: 'Describe the problem this decision addresses' },
            })}
          />
        </FormField>

        <FormField label="Context" htmlFor="decision-context" hint="Optional background.">
          <textarea
            id="decision-context"
            className="form-field__input"
            rows={2}
            {...register('context')}
          />
        </FormField>

        <div className="form-grid">
          <FormField label="Status" htmlFor="decision-status">
            <select id="decision-status" className="form-field__input" {...register('status')}>
              {DECISION_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </FormField>

          <FormField label="Priority" htmlFor="decision-priority">
            <select id="decision-priority" className="form-field__input" {...register('priority')}>
              {DECISION_PRIORITIES.map((priority) => (
                <option key={priority} value={priority}>
                  {priority}
                </option>
              ))}
            </select>
          </FormField>
        </div>

        <FormField
          label="Expected outcome"
          htmlFor="decision-expected"
          hint="What this should achieve. The review is judged against exactly this."
        >
          <textarea
            id="decision-expected"
            className="form-field__input"
            rows={2}
            {...register('expectedOutcome')}
          />
        </FormField>

        <div className="form-grid">
          <FormField label="Decided on" htmlFor="decision-date">
            <input
              id="decision-date"
              type="date"
              className="form-field__input"
              {...register('decisionDate')}
            />
          </FormField>

          <FormField label="Review on" htmlFor="decision-review-date">
            <input
              id="decision-review-date"
              type="date"
              className="form-field__input"
              {...register('reviewDate')}
            />
          </FormField>
        </div>

        <fieldset className="stack">
          <legend className="metric-group__title">Evidence</legend>
          <p className="form-hint">
            Cite at least one figure. A decision without evidence cannot be reviewed later.
          </p>

          <EvidencePicker
            label="Alerts"
            options={(alertsQuery.data?.items ?? []).map((alert) => ({
              id: alert.id,
              label: `${alert.title} (${alert.severity})`,
            }))}
            selected={alertIds}
            onChange={setAlertIds}
          />
          <EvidencePicker
            label="Insights"
            options={(insightsQuery.data?.items ?? []).map((insight) => ({
              id: insight.id,
              label: insight.title,
            }))}
            selected={insightIds}
            onChange={setInsightIds}
          />
          <EvidencePicker
            label="Metrics"
            options={(metricsQuery.data ?? []).map((metric) => ({
              id: metric.id,
              label: metric.name,
            }))}
            selected={metricIds}
            onChange={setMetricIds}
          />
          <EvidencePicker
            label="Goals"
            options={(goalsQuery.data ?? []).map((goal) => ({ id: goal.id, label: goal.title }))}
            selected={goalIds}
            onChange={setGoalIds}
          />
        </fieldset>

        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}

        <div className="form-actions">
          <button
            type="submit"
            className="button button--primary"
            disabled={isSaving || evidenceCount === 0}
          >
            {isSaving ? 'Saving…' : 'Record decision'}
          </button>
          <button type="button" className="button button--ghost" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}

function EvidencePicker({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: Array<{ id: string; label: string }>;
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  if (options.length === 0) {
    return null;
  }

  return (
    <div className="form-field">
      <span className="form-field__label">{label}</span>
      <div className="filter-bar__group">
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            className={`chip ${selected.includes(option.id) ? 'chip--active' : ''}`}
            aria-pressed={selected.includes(option.id)}
            onClick={() =>
              onChange(
                selected.includes(option.id)
                  ? selected.filter((id) => id !== option.id)
                  : [...selected, option.id],
              )
            }
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
