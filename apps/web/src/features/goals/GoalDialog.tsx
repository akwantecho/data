import { useForm } from 'react-hook-form';
import { GOAL_STATUSES, type CreateGoalRequest, type MetricSummary } from '@sip/shared-types';
import { FormField } from '../../components/FormField';
import { Modal } from '../../components/Modal';

interface GoalForm {
  title: string;
  description: string;
  metricId: string;
  baselineValue: string;
  targetValue: string;
  startDate: string;
  dueDate: string;
  status: CreateGoalRequest['status'];
}

/**
 * Setting a goal.
 *
 * Linking a metric is what makes the goal maintain itself: progress is then read
 * from the metric over the goal's own window, and nobody is asked to keep a
 * percentage up to date by hand.
 */
export function GoalDialog({
  metrics,
  isSaving,
  error,
  onCancel,
  onSubmit,
}: {
  metrics: MetricSummary[];
  isSaving: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: (values: CreateGoalRequest) => void;
}) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<GoalForm>({
    defaultValues: {
      title: '',
      description: '',
      metricId: '',
      baselineValue: '',
      targetValue: '',
      startDate: '',
      dueDate: '',
      status: 'ACTIVE',
    },
  });

  return (
    <Modal title="Set a goal" onClose={onCancel}>
      <form
        className="stack"
        onSubmit={handleSubmit((values) =>
          onSubmit({
            title: values.title,
            description: values.description || null,
            metricId: values.metricId || null,
            baselineValue: values.baselineValue || null,
            targetValue: values.targetValue,
            startDate: values.startDate,
            dueDate: values.dueDate,
            status: values.status,
          }),
        )}
        noValidate
      >
        <FormField label="Goal" htmlFor="goal-title" error={errors.title?.message}>
          <input
            id="goal-title"
            className="form-field__input"
            {...register('title', {
              required: 'Give the goal a title',
              minLength: { value: 3, message: 'Give the goal a title' },
            })}
          />
        </FormField>

        <FormField label="Description" htmlFor="goal-description" hint="Optional context.">
          <input id="goal-description" className="form-field__input" {...register('description')} />
        </FormField>

        <FormField
          label="Metric"
          htmlFor="goal-metric"
          hint="Linking a metric lets the system keep progress current on its own."
        >
          <select id="goal-metric" className="form-field__input" {...register('metricId')}>
            <option value="">No metric — track by hand</option>
            {metrics.map((metric) => (
              <option key={metric.id} value={metric.id}>
                {metric.name}
              </option>
            ))}
          </select>
        </FormField>

        <div className="form-grid">
          <FormField
            label="Baseline"
            htmlFor="goal-baseline"
            hint="Where it stands today. Progress is measured from here."
            error={errors.baselineValue?.message}
          >
            <input
              id="goal-baseline"
              className="form-field__input"
              inputMode="decimal"
              {...register('baselineValue', {
                pattern: { value: /^-?\d+(\.\d+)?$/, message: 'Enter a number' },
              })}
            />
          </FormField>

          <FormField label="Target" htmlFor="goal-target" error={errors.targetValue?.message}>
            <input
              id="goal-target"
              className="form-field__input"
              inputMode="decimal"
              {...register('targetValue', {
                required: 'A goal needs a target',
                pattern: { value: /^-?\d+(\.\d+)?$/, message: 'Enter a number' },
              })}
            />
          </FormField>
        </div>

        <div className="form-grid">
          <FormField label="Starts" htmlFor="goal-start" error={errors.startDate?.message}>
            <input
              id="goal-start"
              type="date"
              className="form-field__input"
              {...register('startDate', { required: 'A goal needs a start date' })}
            />
          </FormField>

          <FormField label="Due" htmlFor="goal-due" error={errors.dueDate?.message}>
            <input
              id="goal-due"
              type="date"
              className="form-field__input"
              {...register('dueDate', { required: 'A goal needs a due date' })}
            />
          </FormField>
        </div>

        <FormField
          label="Status"
          htmlFor="goal-status"
          hint="On track, at risk and off track are derived from progress — they are not set by hand."
        >
          <select id="goal-status" className="form-field__input" {...register('status')}>
            {GOAL_STATUSES.filter(
              (status) => status === 'DRAFT' || status === 'ACTIVE' || status === 'CANCELLED',
            ).map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </FormField>

        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}

        <div className="form-actions">
          <button type="submit" className="button button--primary" disabled={isSaving}>
            {isSaving ? 'Saving…' : 'Save goal'}
          </button>
          <button type="button" className="button button--ghost" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}
