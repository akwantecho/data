import { z } from 'zod';
import { packAlertRuleSchema, packInsightRuleSchema } from './catalogue/pack-definition';

/**
 * How a pack's rules are stored.
 *
 * `industry_pack_insight_rules` is the pack's one rule table (plan §8.5), and it
 * carries both kinds. Rather than guessing from the shape of the JSON, each row
 * records which kind it is and keeps the rule itself untouched underneath — so
 * reading a rule back is a parse, not an inference.
 */
export const storedRuleSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('INSIGHT'), rule: packInsightRuleSchema }),
  z.object({ kind: z.literal('ALERT'), rule: packAlertRuleSchema }),
]);

export type StoredRule = z.infer<typeof storedRuleSchema>;

export function storedInsightRule(rule: z.infer<typeof packInsightRuleSchema>): StoredRule {
  return { kind: 'INSIGHT', rule };
}

export function storedAlertRule(rule: z.infer<typeof packAlertRuleSchema>): StoredRule {
  return { kind: 'ALERT', rule };
}

/** Splits stored rows into the two kinds, ignoring anything that no longer parses. */
export function parseStoredRules(rows: Array<{ code: string; definition: unknown }>): {
  insights: Array<z.infer<typeof packInsightRuleSchema>>;
  alerts: Array<z.infer<typeof packAlertRuleSchema>>;
  invalid: string[];
} {
  const insights: Array<z.infer<typeof packInsightRuleSchema>> = [];
  const alerts: Array<z.infer<typeof packAlertRuleSchema>> = [];
  const invalid: string[] = [];

  for (const row of rows) {
    const parsed = storedRuleSchema.safeParse(row.definition);

    if (!parsed.success) {
      invalid.push(row.code);
      continue;
    }

    if (parsed.data.kind === 'INSIGHT') {
      insights.push(parsed.data.rule);
    } else {
      alerts.push(parsed.data.rule);
    }
  }

  return { insights, alerts, invalid };
}
