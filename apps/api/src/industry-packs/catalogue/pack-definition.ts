import {
  AGGREGATION_TYPES,
  ALERT_SEVERITIES,
  METRIC_DIRECTIONS,
  METRIC_FREQUENCIES,
  METRIC_UNITS,
} from '@sip/shared-types';
import { z } from 'zod';

/**
 * The shape of an industry pack.
 *
 * A pack is data (plan §17): this file describes what that data must look like,
 * and nothing here knows what an industry *is*. Adding Retail or Logistics later
 * means adding a definition that satisfies this schema — no engine changes, no
 * conditionals keyed on an industry code anywhere in the codebase.
 *
 * The schema is deliberately strict and is checked in a unit test for every
 * shipped pack, because a pack that is wrong is only discovered at install time
 * otherwise — inside a customer's organization.
 */

const codeSchema = z
  .string()
  .trim()
  .min(2)
  .max(60)
  .regex(/^[a-z][a-z0-9_]*$/, 'Codes are lower_snake_case');

/** 0–100 with three decimals, matching the Decimal(6,3) weight columns. */
const weightSchema = z.number().gt(0).max(100);

export const packMetricSchema = z
  .object({
    code: codeSchema,
    name: z.string().trim().min(2).max(120),
    description: z.string().trim().max(500).optional(),
    category: z.string().trim().min(2).max(80),
    unit: z.enum(METRIC_UNITS),
    aggregationType: z.enum(AGGREGATION_TYPES),
    frequency: z.enum(METRIC_FREQUENCIES),
    direction: z.enum(METRIC_DIRECTIONS),
    /** Present only for FORMULA metrics; validated against the pack's own codes. */
    formula: z.string().trim().max(500).optional(),
  })
  .strict()
  .refine((metric) => (metric.aggregationType === 'FORMULA') === Boolean(metric.formula), {
    message: 'A FORMULA metric needs a formula, and only a FORMULA metric may have one',
  });

export type PackMetricDefinition = z.infer<typeof packMetricSchema>;

export const packHealthCategorySchema = z
  .object({
    code: codeSchema,
    name: z.string().trim().min(2).max(80),
    weight: weightSchema,
    metrics: z
      .array(z.object({ code: codeSchema, weight: weightSchema }).strict())
      .min(1, 'A health category must weigh at least one metric'),
  })
  .strict();

export const packHealthModelSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    categories: z.array(packHealthCategorySchema).min(1),
  })
  .strict();

/**
 * What a rule may look at. Every measure is something the metrics engine already
 * computes, so a rule never needs its own arithmetic — and never needs a model.
 */
export const RULE_MEASURES = ['CHANGE_PCT', 'VALUE', 'VARIANCE_TO_TARGET_PCT'] as const;
export const RULE_OPERATORS = ['LT', 'LTE', 'GT', 'GTE'] as const;

export const ruleConditionSchema = z
  .object({
    metric: codeSchema,
    measure: z.enum(RULE_MEASURES),
    operator: z.enum(RULE_OPERATORS),
    value: z.number(),
  })
  .strict();

export const packInsightRuleSchema = z
  .object({
    code: codeSchema,
    name: z.string().trim().min(2).max(120),
    description: z.string().trim().max(500).optional(),
    severity: z.enum(ALERT_SEVERITIES),
    category: z.string().trim().max(80).optional(),
    definition: z
      .object({
        /** All conditions must hold — deterministic, in the order written. */
        conditions: z.array(ruleConditionSchema).min(1),
        narrative: z.string().trim().min(10).max(500),
        /** Metric codes quoted as evidence. An insight without evidence is a bug. */
        evidence: z.array(codeSchema).min(1),
      })
      .strict(),
  })
  .strict();

export type PackInsightRuleDefinition = z.infer<typeof packInsightRuleSchema>;

/**
 * Alert rule parameters, keyed by rule type so each type validates its own
 * arguments rather than accepting a free-form blob. `usesConfiguredThreshold`
 * means the rule reads the metric's own warning/critical values, so a tenant that
 * retunes a threshold retunes the alert with it.
 */
const alertRuleParameters = {
  METRIC_ABOVE_THRESHOLD: z.object({ usesConfiguredThreshold: z.literal(true) }).strict(),
  METRIC_BELOW_THRESHOLD: z.object({ usesConfiguredThreshold: z.literal(true) }).strict(),
  LARGE_PERIOD_CHANGE: z.object({ changePct: z.number() }).strict(),
  TARGET_MISSED: z.object({ tolerancePct: z.number().min(0).max(100) }).strict(),
} as const;

export const ALERT_RULE_TYPES = Object.keys(alertRuleParameters) as Array<
  keyof typeof alertRuleParameters
>;

export const packAlertRuleSchema = z
  .object({
    code: codeSchema,
    name: z.string().trim().min(2).max(120),
    description: z.string().trim().max(500).optional(),
    metric: codeSchema,
    type: z.enum(ALERT_RULE_TYPES),
    severity: z.enum(ALERT_SEVERITIES),
    // Parameters are scalars by design: a rule that needed nested structure would
    // be a rule the deterministic engine cannot explain in one sentence.
    definition: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
  })
  .strict()
  .superRefine((rule, ctx) => {
    const parsed = alertRuleParameters[rule.type].safeParse(rule.definition);

    if (!parsed.success) {
      ctx.addIssue({
        code: 'custom',
        path: ['definition'],
        message: `${rule.type} parameters are invalid: ${parsed.error.issues
          .map((issue) => issue.message)
          .join('; ')}`,
      });
    }
  });

export const packDefinitionSchema = z
  .object({
    code: codeSchema,
    name: z.string().trim().min(2).max(120),
    /** Must match an `industries.code`; the pack is bound to exactly one industry. */
    industryCode: codeSchema,
    version: z.string().regex(/^\d+\.\d+\.\d+$/, 'Semantic version, e.g. 1.0.0'),
    description: z.string().trim().max(500),
    metrics: z.array(packMetricSchema).min(1),
    healthModel: packHealthModelSchema,
    insightRules: z.array(packInsightRuleSchema),
    alertRules: z.array(packAlertRuleSchema),
  })
  .strict()
  .superRefine((pack, ctx) => {
    const codes = new Set<string>();

    for (const metric of pack.metrics) {
      if (codes.has(metric.code)) {
        ctx.addIssue({ code: 'custom', message: `Duplicate metric code: ${metric.code}` });
      }
      codes.add(metric.code);
    }

    const requireKnown = (code: string, where: string) => {
      if (!codes.has(code)) {
        ctx.addIssue({ code: 'custom', message: `${where} refers to unknown metric ${code}` });
      }
    };

    // A formula may only reference metrics the same pack installs: a pack that
    // depended on a tenant's own metrics would install differently everywhere.
    for (const metric of pack.metrics) {
      for (const referenced of referencedCodes(metric.formula)) {
        requireKnown(referenced, `Formula for ${metric.code}`);
      }
    }

    const categoryWeights = sum(pack.healthModel.categories.map((category) => category.weight));

    if (categoryWeights !== 100) {
      ctx.addIssue({
        code: 'custom',
        message: `Health categories must sum to 100, got ${categoryWeights}`,
      });
    }

    for (const category of pack.healthModel.categories) {
      const metricWeights = sum(category.metrics.map((metric) => metric.weight));

      if (metricWeights !== 100) {
        ctx.addIssue({
          code: 'custom',
          message: `Metrics in ${category.code} must sum to 100, got ${metricWeights}`,
        });
      }

      for (const metric of category.metrics) {
        requireKnown(metric.code, `Health category ${category.code}`);
      }
    }

    for (const rule of pack.insightRules) {
      for (const condition of rule.definition.conditions) {
        requireKnown(condition.metric, `Insight rule ${rule.code}`);
      }
      for (const code of rule.definition.evidence) {
        requireKnown(code, `Evidence for ${rule.code}`);
      }
    }

    for (const rule of pack.alertRules) {
      requireKnown(rule.metric, `Alert rule ${rule.code}`);
    }
  });

export type PackDefinition = z.infer<typeof packDefinitionSchema>;

/** Metric codes a formula mentions. Kept simple: the parser validates the rest. */
function referencedCodes(formula: string | undefined): string[] {
  if (!formula) {
    return [];
  }

  return [...formula.matchAll(/[a-z][a-z0-9_]*/g)].map((match) => match[0]);
}

function sum(values: number[]): number {
  return Number(values.reduce((total, value) => total + value, 0).toFixed(3));
}
