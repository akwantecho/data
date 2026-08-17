import type { AlertEvidence, AlertSeverity } from '@sip/shared-types';

/**
 * Deciding whether an alert rule fires (plan §27).
 *
 * Pure functions over figures the metrics engine already produced, so a rule can
 * never reach a different conclusion from the metric page it points at. Each
 * outcome carries the evidence that produced it: an alert nobody can check is an
 * alert nobody will act on.
 */

export type AlertRuleType =
  | 'METRIC_BELOW_THRESHOLD'
  | 'METRIC_ABOVE_THRESHOLD'
  | 'LARGE_PERIOD_CHANGE'
  | 'TARGET_MISSED'
  | 'DATA_SOURCE_STALE'
  | 'DATA_QUALITY_DEGRADED';

/** Everything a rule may look at, for one metric in one period. */
export interface RuleFacts {
  metricName: string;
  metricCode: string;
  unit: string;
  value: number | null;
  previousValue: number | null;
  changePct: number | null;
  target: number | null;
  warningValue: number | null;
  criticalValue: number | null;
  isRelativeToTarget: boolean;
  direction: 'HIGHER_IS_BETTER' | 'LOWER_IS_BETTER' | 'TARGET_RANGE' | 'INFORMATIONAL';
  /** Days since the newest committed import, for the staleness rule. */
  daysSinceImport: number | null;
  /** The organization's current data-quality score, for the quality rule. */
  dataQualityScore: number | null;
}

export interface RuleOutcome {
  fires: boolean;
  severity?: AlertSeverity;
  title?: string;
  description?: string;
  evidence?: AlertEvidence;
}

const NOT_FIRED: RuleOutcome = { fires: false };

export function evaluateAlertRule(
  type: AlertRuleType,
  definition: Record<string, unknown>,
  severity: AlertSeverity,
  facts: RuleFacts,
): RuleOutcome {
  switch (type) {
    case 'METRIC_ABOVE_THRESHOLD':
    case 'METRIC_BELOW_THRESHOLD':
      return thresholdRule(type, severity, facts);
    case 'LARGE_PERIOD_CHANGE':
      return changeRule(definition, severity, facts);
    case 'TARGET_MISSED':
      return targetRule(definition, severity, facts);
    case 'DATA_SOURCE_STALE':
      return staleRule(definition, severity, facts);
    case 'DATA_QUALITY_DEGRADED':
      return qualityRule(definition, severity, facts);
    default:
      return NOT_FIRED;
  }
}

/**
 * A threshold rule reads the metric's own warning and critical values, so a tenant
 * that retunes a threshold retunes the alert with it. Critical outranks the rule's
 * configured severity: a breach of the harder line is not a warning.
 */
function thresholdRule(
  type: 'METRIC_ABOVE_THRESHOLD' | 'METRIC_BELOW_THRESHOLD',
  severity: AlertSeverity,
  facts: RuleFacts,
): RuleOutcome {
  if (facts.value === null) {
    return NOT_FIRED;
  }

  const resolve = (limit: number | null) => {
    if (limit === null) {
      return null;
    }

    if (!facts.isRelativeToTarget) {
      return limit;
    }

    return facts.target === null ? null : (facts.target * limit) / 100;
  };

  const critical = resolve(facts.criticalValue);
  const warning = resolve(facts.warningValue);
  const breaches = (limit: number | null) =>
    limit !== null &&
    (type === 'METRIC_ABOVE_THRESHOLD' ? facts.value! > limit : facts.value! < limit);

  const breached = breaches(critical)
    ? { limit: critical as number, label: 'critical', severity: 'CRITICAL' as AlertSeverity }
    : breaches(warning)
      ? { limit: warning as number, label: 'warning', severity }
      : null;

  if (!breached) {
    return NOT_FIRED;
  }

  const direction = type === 'METRIC_ABOVE_THRESHOLD' ? 'above' : 'below';

  return {
    fires: true,
    severity: breached.severity,
    title: `${facts.metricName} is ${direction} its ${breached.label} threshold`,
    description:
      `${facts.metricName} reached ${format(facts.value)}, which is ${direction} the ` +
      `${breached.label} threshold of ${format(breached.limit)}.`,
    evidence: {
      statement: `${format(facts.value)} is ${direction} the ${breached.label} threshold of ${format(breached.limit)}.`,
      figures: [
        { label: facts.metricName, value: format(facts.value) },
        { label: `${capitalise(breached.label)} threshold`, value: format(breached.limit) },
        { label: 'Target', value: facts.target === null ? null : format(facts.target) },
      ],
    },
  };
}

/** A move of more than `changePct` against the previous period, in that direction. */
function changeRule(
  definition: Record<string, unknown>,
  severity: AlertSeverity,
  facts: RuleFacts,
): RuleOutcome {
  const limit = Number(definition.changePct);

  if (!Number.isFinite(limit) || facts.changePct === null) {
    return NOT_FIRED;
  }

  const fires = limit < 0 ? facts.changePct <= limit : facts.changePct >= limit;

  if (!fires) {
    return NOT_FIRED;
  }

  const moved = limit < 0 ? 'fell' : 'rose';

  return {
    fires: true,
    severity,
    title: `${facts.metricName} ${moved} sharply`,
    description:
      `${facts.metricName} ${moved} ${format(Math.abs(facts.changePct))}% against the previous ` +
      `period, past the ${format(Math.abs(limit))}% the rule allows.`,
    evidence: {
      statement: `${format(facts.previousValue)} → ${format(facts.value)} (${signed(facts.changePct)}%).`,
      figures: [
        { label: 'This period', value: format(facts.value) },
        { label: 'Previous period', value: format(facts.previousValue) },
        { label: 'Change', value: `${signed(facts.changePct)}%` },
        { label: 'Rule limit', value: `${signed(limit)}%` },
      ],
    },
  };
}

/** Missing the target by more than the tolerance the rule allows. */
function targetRule(
  definition: Record<string, unknown>,
  severity: AlertSeverity,
  facts: RuleFacts,
): RuleOutcome {
  const tolerance = Number(definition.tolerancePct ?? 0);

  if (facts.value === null || facts.target === null || facts.target === 0) {
    return NOT_FIRED;
  }

  const variance = ((facts.value - facts.target) / facts.target) * 100;
  const shortfall = facts.direction === 'LOWER_IS_BETTER' ? variance : -variance;

  if (!Number.isFinite(tolerance) || shortfall <= tolerance) {
    return NOT_FIRED;
  }

  return {
    fires: true,
    severity,
    title: `${facts.metricName} missed its target`,
    description:
      `${facts.metricName} came in at ${format(facts.value)} against a target of ` +
      `${format(facts.target)} — ${format(shortfall)}% short, past the ${format(tolerance)}% allowed.`,
    evidence: {
      statement: `${format(facts.value)} against a target of ${format(facts.target)} (${signed(-shortfall)}%).`,
      figures: [
        { label: facts.metricName, value: format(facts.value) },
        { label: 'Target', value: format(facts.target) },
        { label: 'Shortfall', value: `${format(shortfall)}%` },
        { label: 'Tolerance', value: `${format(tolerance)}%` },
      ],
    },
  };
}

/** Nothing imported for longer than the rule allows. */
function staleRule(
  definition: Record<string, unknown>,
  severity: AlertSeverity,
  facts: RuleFacts,
): RuleOutcome {
  const limit = Number(definition.staleDays);

  if (!Number.isFinite(limit) || facts.daysSinceImport === null || facts.daysSinceImport <= limit) {
    return NOT_FIRED;
  }

  return {
    fires: true,
    severity,
    title: 'Data has not been imported recently',
    description:
      `The most recent import was ${facts.daysSinceImport} days ago, past the ${limit} days ` +
      'this organization allows. Figures may be out of date.',
    evidence: {
      statement: `Last import ${facts.daysSinceImport} days ago; the rule allows ${limit}.`,
      figures: [
        { label: 'Days since last import', value: String(facts.daysSinceImport) },
        { label: 'Allowed', value: String(limit) },
      ],
    },
  };
}

/** The data-quality score dropping below what the rule accepts. */
function qualityRule(
  definition: Record<string, unknown>,
  severity: AlertSeverity,
  facts: RuleFacts,
): RuleOutcome {
  const floor = Number(definition.minimumScore);

  if (
    !Number.isFinite(floor) ||
    facts.dataQualityScore === null ||
    facts.dataQualityScore >= floor
  ) {
    return NOT_FIRED;
  }

  return {
    fires: true,
    severity,
    title: 'Data quality has degraded',
    description:
      `Data quality scored ${facts.dataQualityScore}/100, below the ${floor} this organization ` +
      'accepts. Check the rejected rows on the most recent imports.',
    evidence: {
      statement: `Quality ${facts.dataQualityScore}/100 against a floor of ${floor}.`,
      figures: [
        { label: 'Data quality', value: `${facts.dataQualityScore}/100` },
        { label: 'Minimum accepted', value: String(floor) },
      ],
    },
  };
}

function format(value: number | null): string {
  if (value === null) {
    return '—';
  }

  return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100);
}

function signed(value: number | null): string {
  if (value === null) {
    return '—';
  }

  return `${value > 0 ? '+' : ''}${format(value)}`;
}

function capitalise(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
