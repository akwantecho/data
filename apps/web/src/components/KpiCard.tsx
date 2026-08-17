import { Link } from 'react-router-dom';
import type { MetricAnalytics } from '@sip/shared-types';
import { changeTone, formatChange, formatMetricValue } from '../lib/format';

/**
 * One KPI (plan §22).
 *
 * Value, movement against the previous window, and standing against the target —
 * all calculated by the API. The card decides nothing except how to say it.
 */
export function KpiCard({
  metric,
  currencyCode,
}: {
  metric: MetricAnalytics;
  currencyCode: string;
}) {
  const tone = changeTone(metric.changePct, metric.direction);

  return (
    <article className="kpi-card">
      <Link className="kpi-card__title" to={`/analytics?metric=${metric.metricId}`}>
        {metric.name}
      </Link>

      {/* A headline figure is read at a glance, so large amounts are shown
          compactly; the exact figure stays available on hover and on the
          analytics page. */}
      <p
        className="kpi-card__value"
        title={formatMetricValue(metric.current, metric.unit, currencyCode)}
      >
        {formatMetricValue(metric.current, metric.unit, currencyCode, isLarge(metric.current))}
      </p>

      <p className={`kpi-card__change kpi-card__change--${tone}`}>
        {formatChange(metric.changePct)}
        <span className="kpi-card__caption"> vs previous period</span>
      </p>

      <dl className="kpi-card__meta">
        <div>
          <dt>Target</dt>
          <dd>
            {metric.target ? formatMetricValue(metric.target, metric.unit, currencyCode) : '—'}
            {metric.varianceToTargetPct ? (
              <span className="kpi-card__caption">
                {' '}
                ({formatChange(metric.varianceToTargetPct)})
              </span>
            ) : null}
          </dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>
            <span className={`badge ${statusClass(metric.thresholdStatus)}`}>
              {metric.thresholdStatus === 'UNKNOWN' ? 'No threshold' : metric.thresholdStatus}
            </span>
          </dd>
        </div>
      </dl>

      {metric.aggregation === 'RECOMPUTED_FROM_INPUTS' ? (
        <p className="kpi-card__caption">Recalculated for this range from {metric.formula}</p>
      ) : null}
      {metric.targetPeriods > 0 && metric.comparedToTarget !== metric.current ? (
        <p className="kpi-card__caption">
          Target covers {metric.targetPeriods} period{metric.targetPeriods === 1 ? '' : 's'} of this
          range
        </p>
      ) : null}
    </article>
  );
}

/** Compact notation earns its place once a figure stops fitting on one line. */
function isLarge(value: string | null): boolean {
  return value !== null && Math.abs(Number(value)) >= 100_000;
}

function statusClass(status: MetricAnalytics['thresholdStatus']): string {
  switch (status) {
    case 'OK':
      return 'badge--positive';
    case 'WARNING':
      return 'badge--warning';
    case 'CRITICAL':
      return 'badge--negative';
    default:
      return '';
  }
}
