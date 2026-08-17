import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { Link, useParams } from 'react-router-dom';
import type { MetricDetail, ThresholdStatus } from '@sip/shared-types';
import { useSession } from '../auth/session-context';
import { PageHeader } from '../../components/PageHeader';
import { FormField } from '../../components/FormField';
import { Modal } from '../../components/Modal';
import { TrendChart } from '../../components/TrendChart';
import { ErrorState, LoadingState } from '../../components/states';
import { describeApiError } from '../../lib/errors';
import { changeTone, formatChange, formatMetricValue } from '../../lib/format';
import { useOrganization } from '../organization/organization-context';
import { fetchMetric, metricKeys, recordValue, setTarget, setThreshold } from './metrics-api';

/** Everything about one metric: its value, target, threshold, formula and history. */
export function MetricDetailPage() {
  const { id = '' } = useParams();
  const { activeMembership } = useSession();
  const { currencyCode } = useOrganization();
  const role = activeMembership?.role;
  const canEdit = role === 'ORGANIZATION_ADMIN' || role === 'ANALYST';
  const queryClient = useQueryClient();

  const [dialog, setDialog] = useState<'value' | 'target' | 'threshold' | null>(null);

  const detailQuery = useQuery({
    queryKey: metricKeys.detail(id),
    queryFn: () => fetchMetric(id),
    enabled: id.length > 0,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: metricKeys.all });

  const valueMutation = useMutation({
    mutationFn: (input: { period: string; value: string }) => recordValue(id, input),
    onSuccess: async () => {
      setDialog(null);
      await refresh();
    },
  });

  const targetMutation = useMutation({
    mutationFn: (input: { period: string; targetValue: string }) => setTarget(id, input),
    onSuccess: async () => {
      setDialog(null);
      await refresh();
    },
  });

  const thresholdMutation = useMutation({
    mutationFn: (input: { warningValue: string | null; criticalValue: string | null }) =>
      setThreshold(id, input),
    onSuccess: async () => {
      setDialog(null);
      await refresh();
    },
  });

  const detail = detailQuery.data;

  return (
    <div className="stack">
      {detailQuery.isPending ? <LoadingState label="Loading metric…" /> : null}
      {detailQuery.isError ? <ErrorState message={describeApiError(detailQuery.error)} /> : null}

      {detail ? (
        <>
          <PageHeader
            title={detail.metric.name}
            description={
              detail.metric.description ??
              `Reported ${detail.metric.frequency.toLowerCase()} · ${detail.metric.code}`
            }
          />

          <section className="metric-grid">
            <ValueCard
              label="Current"
              value={formatMetricValue(
                detail.currentValue?.value,
                detail.metric.unit,
                currencyCode,
              )}
              meta={detail.currentValue?.periodStart ?? 'No value yet'}
            />
            <ValueCard
              label="Previous period"
              value={formatMetricValue(
                detail.previousValue?.value,
                detail.metric.unit,
                currencyCode,
              )}
              meta={detail.previousValue?.periodStart ?? '—'}
            />
            <ValueCard
              label="Change"
              value={formatChange(detail.changePct)}
              tone={changeTone(detail.changePct, detail.metric.direction)}
              meta="Period over period"
            />
            <ValueCard
              label="Target"
              value={formatMetricValue(
                detail.target?.targetValue,
                detail.metric.unit,
                currencyCode,
              )}
              meta={
                detail.varianceToTargetPct
                  ? `${formatChange(detail.varianceToTargetPct)} to target`
                  : 'No target set'
              }
            />
          </section>

          <section className="card stack">
            <div className="section-header">
              <h2 className="card__title">Trend</h2>
              <StatusBadge status={detail.thresholdStatus} />
            </div>
            <TrendChart
              points={detail.trend}
              unit={detail.metric.unit}
              currencyCode={currencyCode}
              target={detail.target?.targetValue ?? null}
            />
          </section>

          <section className="card stack">
            <div className="section-header">
              <h2 className="card__title">Definition</h2>
              {canEdit ? (
                <div className="form-actions">
                  {detail.metric.isCalculated ? null : (
                    <button
                      type="button"
                      className="button button--ghost"
                      onClick={() => setDialog('value')}
                    >
                      Enter value
                    </button>
                  )}
                  <button
                    type="button"
                    className="button button--ghost"
                    onClick={() => setDialog('target')}
                  >
                    Set target
                  </button>
                  <button
                    type="button"
                    className="button button--ghost"
                    onClick={() => setDialog('threshold')}
                  >
                    Set thresholds
                  </button>
                </div>
              ) : null}
            </div>

            <dl className="status-list">
              <Row label="Unit" value={detail.metric.unit} />
              <Row label="Frequency" value={detail.metric.frequency} />
              <Row label="Direction" value={detail.metric.direction.replaceAll('_', ' ')} />
              <Row
                label="Source"
                value={
                  detail.metric.isCalculated
                    ? `Calculated: ${detail.metric.formula}`
                    : (detail.currentValue?.sourceType ?? 'Imported or entered')
                }
              />
              <Row
                label="Depends on"
                value={detail.dependencies.length > 0 ? detail.dependencies.join(', ') : '—'}
              />
              <Row
                label="Used by"
                value={detail.dependents.length > 0 ? detail.dependents.join(', ') : '—'}
              />
              <Row
                label="Warning threshold"
                value={formatMetricValue(
                  detail.threshold?.warningValue,
                  detail.metric.unit,
                  currencyCode,
                )}
              />
              <Row
                label="Critical threshold"
                value={formatMetricValue(
                  detail.threshold?.criticalValue,
                  detail.metric.unit,
                  currencyCode,
                )}
              />
              <Row
                label="Last updated"
                value={
                  detail.lastUpdatedAt ? new Date(detail.lastUpdatedAt).toLocaleString() : 'Never'
                }
              />
            </dl>

            <p className="state">
              <Link to="/metrics">Back to metrics</Link>
            </p>
          </section>
        </>
      ) : null}

      {dialog === 'value' ? (
        <ValueDialog
          isSaving={valueMutation.isPending}
          error={valueMutation.isError ? describeApiError(valueMutation.error) : null}
          onCancel={() => setDialog(null)}
          onSubmit={(values) => valueMutation.mutate(values)}
        />
      ) : null}

      {dialog === 'target' ? (
        <TargetDialog
          isSaving={targetMutation.isPending}
          error={targetMutation.isError ? describeApiError(targetMutation.error) : null}
          onCancel={() => setDialog(null)}
          onSubmit={(values) => targetMutation.mutate(values)}
        />
      ) : null}

      {dialog === 'threshold' ? (
        <ThresholdDialog
          detail={detail}
          isSaving={thresholdMutation.isPending}
          error={thresholdMutation.isError ? describeApiError(thresholdMutation.error) : null}
          onCancel={() => setDialog(null)}
          onSubmit={(values) => thresholdMutation.mutate(values)}
        />
      ) : null}
    </div>
  );
}

function ValueCard({
  label,
  value,
  meta,
  tone,
}: {
  label: string;
  value: string;
  meta: string;
  tone?: 'positive' | 'negative' | 'neutral';
}) {
  return (
    <article className="card metric-card">
      <span className="metric-card__label">{label}</span>
      <span
        className={`metric-card__value ${
          tone === 'positive'
            ? 'metric-card__value--positive'
            : tone === 'negative'
              ? 'metric-card__value--negative'
              : ''
        }`}
      >
        {value}
      </span>
      <span className="metric-card__label">{meta}</span>
    </article>
  );
}

function StatusBadge({ status }: { status: ThresholdStatus }) {
  if (status === 'UNKNOWN') {
    return <span className="badge">No threshold</span>;
  }

  return (
    <span className={`badge ${status === 'OK' ? 'badge--positive' : 'badge--negative'}`}>
      {status}
    </span>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="status-list__row">
      <dt className="status-list__label">{label}</dt>
      <dd className="status-list__value" style={{ margin: 0 }}>
        {value}
      </dd>
    </div>
  );
}

function ValueDialog({
  isSaving,
  error,
  onCancel,
  onSubmit,
}: {
  isSaving: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: (values: { period: string; value: string }) => void;
}) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<{ period: string; value: string }>({ defaultValues: { period: '', value: '' } });

  return (
    <Modal title="Enter a value" onClose={onCancel}>
      <form className="stack" onSubmit={handleSubmit(onSubmit)} noValidate>
        <p className="state">
          Entered by hand, validated exactly like an imported row, and replaceable by a later import
          for the same period.
        </p>

        <FormField
          label="Period"
          htmlFor="value-period"
          hint="2026-01, 2026-Q1, 2026-W05, 2026 or 2026-01-31"
          error={errors.period?.message}
        >
          <input
            id="value-period"
            className="form-field__input"
            {...register('period', { required: 'A period is required' })}
          />
        </FormField>

        <FormField label="Value" htmlFor="value-amount" error={errors.value?.message}>
          <input
            id="value-amount"
            className="form-field__input"
            {...register('value', {
              required: 'A value is required',
              pattern: { value: /^-?\d+(\.\d+)?$/, message: 'Enter a number, e.g. 1250.75' },
            })}
          />
        </FormField>

        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}

        <div className="form-actions">
          <button type="submit" className="button button--primary" disabled={isSaving}>
            {isSaving ? 'Saving…' : 'Save value'}
          </button>
          <button type="button" className="button button--ghost" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}

function TargetDialog({
  isSaving,
  error,
  onCancel,
  onSubmit,
}: {
  isSaving: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: (values: { period: string; targetValue: string }) => void;
}) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<{ period: string; targetValue: string }>({
    defaultValues: { period: '', targetValue: '' },
  });

  return (
    <Modal title="Set a target" onClose={onCancel}>
      <form className="stack" onSubmit={handleSubmit(onSubmit)} noValidate>
        <FormField
          label="Period"
          htmlFor="target-period"
          hint="The period the target applies to."
          error={errors.period?.message}
        >
          <input
            id="target-period"
            className="form-field__input"
            {...register('period', { required: 'A period is required' })}
          />
        </FormField>

        <FormField label="Target" htmlFor="target-value" error={errors.targetValue?.message}>
          <input
            id="target-value"
            className="form-field__input"
            {...register('targetValue', {
              required: 'A target is required',
              pattern: { value: /^-?\d+(\.\d+)?$/, message: 'Enter a number, e.g. 130000' },
            })}
          />
        </FormField>

        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}

        <div className="form-actions">
          <button type="submit" className="button button--primary" disabled={isSaving}>
            {isSaving ? 'Saving…' : 'Save target'}
          </button>
          <button type="button" className="button button--ghost" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ThresholdDialog({
  detail,
  isSaving,
  error,
  onCancel,
  onSubmit,
}: {
  detail: MetricDetail | undefined;
  isSaving: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: (values: { warningValue: string | null; criticalValue: string | null }) => void;
}) {
  const { register, handleSubmit } = useForm<{ warningValue: string; criticalValue: string }>({
    defaultValues: {
      warningValue: detail?.threshold?.warningValue ?? '',
      criticalValue: detail?.threshold?.criticalValue ?? '',
    },
  });

  const lowerIsBetter = detail?.metric.direction === 'LOWER_IS_BETTER';

  return (
    <Modal title="Set thresholds" onClose={onCancel}>
      <form
        className="stack"
        onSubmit={handleSubmit((values) =>
          onSubmit({
            warningValue: values.warningValue || null,
            criticalValue: values.criticalValue || null,
          }),
        )}
        noValidate
      >
        <p className="state">
          {lowerIsBetter
            ? 'This metric is better when lower, so a value above a threshold is a breach.'
            : 'This metric is better when higher, so a value below a threshold is a breach.'}
        </p>

        <FormField label="Warning at" htmlFor="threshold-warning" hint="Leave empty for none.">
          <input
            id="threshold-warning"
            className="form-field__input"
            {...register('warningValue')}
          />
        </FormField>

        <FormField label="Critical at" htmlFor="threshold-critical" hint="Leave empty for none.">
          <input
            id="threshold-critical"
            className="form-field__input"
            {...register('criticalValue')}
          />
        </FormField>

        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}

        <div className="form-actions">
          <button type="submit" className="button button--primary" disabled={isSaving}>
            {isSaving ? 'Saving…' : 'Save thresholds'}
          </button>
          <button type="button" className="button button--ghost" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}
