import { z } from 'zod';
import { ALERT_SEVERITIES } from '@sip/shared-types';
import { RULE_MEASURES, RULE_OPERATORS } from '../industry-packs/catalogue/pack-definition';

/**
 * Evaluating insight rules (plan §28).
 *
 * MVP insights are deterministic. A rule is a set of conditions over figures the
 * metrics engine already computed; if every condition holds, the insight is
 * created with the evidence that made it true. No model is consulted — the AI
 * layer in Sprint 9 explains insights, it does not detect them (ADR-0005).
 */

/** The rule shape as stored on `insight_rules.definition` by the pack installer. */
export const storedInsightDefinitionSchema = z
  .object({
    severity: z.enum(ALERT_SEVERITIES).default('INFO'),
    category: z.string().nullish(),
    conditions: z
      .array(
        z
          .object({
            metric: z.string(),
            measure: z.enum(RULE_MEASURES),
            operator: z.enum(RULE_OPERATORS),
            value: z.number(),
          })
          .strict(),
      )
      .min(1),
    narrative: z.string().min(1),
    evidence: z.array(z.string()).min(1),
  })
  .strict();

export type StoredInsightDefinition = z.infer<typeof storedInsightDefinitionSchema>;

/** What the engine knows about one metric for the period being evaluated. */
export interface MetricFacts {
  code: string;
  name: string;
  value: number | null;
  changePct: number | null;
  varianceToTargetPct: number | null;
}

export interface ConditionResult {
  metric: string;
  measure: string;
  operator: string;
  threshold: number;
  actual: number | null;
  held: boolean;
}

export interface InsightEvaluation {
  fires: boolean;
  conditions: ConditionResult[];
  /** Why it could not be evaluated, when a metric or figure was missing. */
  unmet: string | null;
}

export function evaluateInsightRule(
  definition: StoredInsightDefinition,
  facts: Map<string, MetricFacts>,
): InsightEvaluation {
  const conditions: ConditionResult[] = [];
  let unmet: string | null = null;

  for (const condition of definition.conditions) {
    const metric = facts.get(condition.metric);
    const actual = metric ? measureOf(metric, condition.measure) : null;

    if (!metric) {
      unmet ??= `The organization has no metric "${condition.metric}"`;
    } else if (actual === null) {
      unmet ??= `"${metric.name}" has no ${condition.measure.toLowerCase().replace(/_/g, ' ')} for this period`;
    }

    conditions.push({
      metric: condition.metric,
      measure: condition.measure,
      operator: condition.operator,
      threshold: condition.value,
      actual,
      held: actual !== null && compare(actual, condition.operator, condition.value),
    });
  }

  // Every condition must hold, and a condition with nothing to read does not hold:
  // an insight asserted from a missing figure would be an assertion about nothing.
  return { fires: unmet === null && conditions.every((entry) => entry.held), conditions, unmet };
}

function measureOf(metric: MetricFacts, measure: string): number | null {
  switch (measure) {
    case 'VALUE':
      return metric.value;
    case 'CHANGE_PCT':
      return metric.changePct;
    case 'VARIANCE_TO_TARGET_PCT':
      return metric.varianceToTargetPct;
    default:
      return null;
  }
}

function compare(actual: number, operator: string, threshold: number): boolean {
  switch (operator) {
    case 'LT':
      return actual < threshold;
    case 'LTE':
      return actual <= threshold;
    case 'GT':
      return actual > threshold;
    case 'GTE':
      return actual >= threshold;
    default:
      return false;
  }
}

/**
 * The headline for an insight.
 *
 * The rule's name is the headline; the narrative it carries is the explanation.
 * Neither is generated — both were written when the rule was.
 */
export function insightTitle(ruleName: string): string {
  return ruleName;
}
