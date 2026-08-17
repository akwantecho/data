import { useForm, useWatch } from 'react-hook-form';
import {
  AGGREGATION_TYPES,
  METRIC_DIRECTIONS,
  METRIC_FREQUENCIES,
  METRIC_UNITS,
  type CreateMetricRequest,
  type MetricSummary,
} from '@sip/shared-types';
import { FormField } from '../../components/FormField';
import { Modal } from '../../components/Modal';

interface MetricForm {
  code: string;
  name: string;
  category: string;
  unit: CreateMetricRequest['unit'];
  aggregationType: CreateMetricRequest['aggregationType'];
  frequency: CreateMetricRequest['frequency'];
  direction: CreateMetricRequest['direction'];
  formula: string;
}

/**
 * Defines or edits a metric.
 *
 * The formula field is only meaningful for a FORMULA metric, so it appears when
 * that aggregation is chosen; the server validates the expression regardless.
 */
export function MetricDialog({
  metric,
  metrics,
  isSaving,
  error,
  onCancel,
  onSubmit,
}: {
  metric?: MetricSummary;
  metrics: MetricSummary[];
  isSaving: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: (values: CreateMetricRequest) => void;
}) {
  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<MetricForm>({
    defaultValues: {
      code: metric?.code ?? '',
      name: metric?.name ?? '',
      category: metric?.category ?? '',
      unit: metric?.unit ?? 'CURRENCY',
      aggregationType: metric?.aggregationType ?? 'SUM',
      frequency: metric?.frequency ?? 'MONTHLY',
      direction: metric?.direction ?? 'HIGHER_IS_BETTER',
      formula: metric?.formula ?? '',
    },
  });

  // useWatch rather than watch(): the returned function cannot be memoized, so the
  // React Compiler would skip optimising the whole dialog.
  const isFormula = useWatch({ control, name: 'aggregationType' }) === 'FORMULA';

  const available = metrics
    .filter((candidate) => candidate.id !== metric?.id && !candidate.isCalculated)
    .map((candidate) => candidate.code);

  return (
    <Modal title={metric ? 'Edit metric' : 'Add metric'} onClose={onCancel}>
      <form
        className="stack"
        onSubmit={handleSubmit((values) =>
          onSubmit({
            code: values.code,
            name: values.name,
            category: values.category || null,
            unit: values.unit,
            aggregationType: values.aggregationType,
            frequency: values.frequency,
            direction: values.direction,
            formula: values.aggregationType === 'FORMULA' ? values.formula : null,
          }),
        )}
        noValidate
      >
        <FormField label="Name" htmlFor="metric-name" error={errors.name?.message}>
          <input
            id="metric-name"
            className="form-field__input"
            {...register('name', {
              required: 'Name is required',
              minLength: { value: 2, message: 'Name must be at least 2 characters' },
            })}
          />
        </FormField>

        <FormField
          label="Code"
          htmlFor="metric-code"
          hint="Used by CSV imports and formulas. Letters, numbers and underscores."
          error={errors.code?.message}
        >
          <input
            id="metric-code"
            className="form-field__input"
            disabled={Boolean(metric)}
            {...register('code', {
              required: 'Code is required',
              pattern: {
                value: /^[A-Za-z0-9][A-Za-z0-9_-]*$/,
                message: 'Use letters, numbers, hyphens and underscores',
              },
            })}
          />
        </FormField>

        <FormField label="Category" htmlFor="metric-category" hint="Optional, e.g. Financial.">
          <input id="metric-category" className="form-field__input" {...register('category')} />
        </FormField>

        <FormField label="Unit" htmlFor="metric-unit">
          <select id="metric-unit" className="form-field__input" {...register('unit')}>
            {METRIC_UNITS.map((unit) => (
              <option key={unit} value={unit}>
                {unit}
              </option>
            ))}
          </select>
        </FormField>

        <FormField
          label="Produced by"
          htmlFor="metric-aggregation"
          hint="FORMULA derives the value from other metrics; the rest are reported."
        >
          <select
            id="metric-aggregation"
            className="form-field__input"
            {...register('aggregationType')}
          >
            {AGGREGATION_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </FormField>

        {isFormula ? (
          <FormField
            label="Formula"
            htmlFor="metric-formula"
            hint={
              available.length > 0
                ? `Arithmetic over metric codes, e.g. ${available.slice(0, 2).join(' / ')} * 100`
                : 'Arithmetic over metric codes, e.g. net_profit / revenue * 100'
            }
            error={errors.formula?.message}
          >
            <input
              id="metric-formula"
              className="form-field__input"
              {...register('formula', {
                validate: (value) =>
                  !isFormula || value.trim().length > 0 || 'A formula metric needs an expression',
              })}
            />
          </FormField>
        ) : null}

        <FormField label="Frequency" htmlFor="metric-frequency">
          <select id="metric-frequency" className="form-field__input" {...register('frequency')}>
            {METRIC_FREQUENCIES.map((frequency) => (
              <option key={frequency} value={frequency}>
                {frequency}
              </option>
            ))}
          </select>
        </FormField>

        <FormField
          label="Direction"
          htmlFor="metric-direction"
          hint="Whether a higher or lower number is better; drives thresholds and alerts."
        >
          <select id="metric-direction" className="form-field__input" {...register('direction')}>
            {METRIC_DIRECTIONS.map((direction) => (
              <option key={direction} value={direction}>
                {direction}
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
            {isSaving ? 'Saving…' : 'Save metric'}
          </button>
          <button type="button" className="button button--ghost" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}
