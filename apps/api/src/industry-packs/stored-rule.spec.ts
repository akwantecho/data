import { healthcarePack } from './catalogue/healthcare';
import { parseStoredRules, storedAlertRule, storedInsightRule } from './stored-rule';

/**
 * Rules survive a round trip through a JSON column. A rule that cannot be read
 * back is a rule the engines in Sprints 7 and 8 cannot run.
 */
describe('stored pack rules', () => {
  const rows = [
    ...healthcarePack.insightRules.map((rule) => ({
      code: rule.code,
      definition: JSON.parse(JSON.stringify(storedInsightRule(rule))) as unknown,
    })),
    ...healthcarePack.alertRules.map((rule) => ({
      code: `alert:${rule.code}`,
      definition: JSON.parse(JSON.stringify(storedAlertRule(rule))) as unknown,
    })),
  ];

  it('reads both kinds back, keeping them apart', () => {
    const parsed = parseStoredRules(rows);

    expect(parsed.insights.map((rule) => rule.code)).toEqual(
      healthcarePack.insightRules.map((rule) => rule.code),
    );
    expect(parsed.alerts.map((rule) => rule.code)).toEqual(
      healthcarePack.alertRules.map((rule) => rule.code),
    );
    expect(parsed.invalid).toEqual([]);
  });

  it('keeps the conditions and evidence a rule was written with', () => {
    const parsed = parseStoredRules(rows);
    const rule = parsed.insights.find((entry) => entry.code === 'volume_up_monetization_down');

    expect(rule?.definition.conditions).toEqual([
      { metric: 'appointments', measure: 'CHANGE_PCT', operator: 'GT', value: 0 },
      { metric: 'revenue_per_patient', measure: 'CHANGE_PCT', operator: 'LT', value: 0 },
    ]);
    expect(rule?.definition.evidence).toContain('revenue');
  });

  it('reports a row it cannot read rather than dropping it silently', () => {
    const parsed = parseStoredRules([
      ...rows,
      { code: 'mystery', definition: { kind: 'INSIGHT', rule: { code: 'broken' } } },
      { code: 'not_even_a_rule', definition: 'a string' },
    ]);

    expect(parsed.invalid).toEqual(['mystery', 'not_even_a_rule']);
    expect(parsed.insights).toHaveLength(healthcarePack.insightRules.length);
  });

  it('rejects an alert rule whose kind claims it is an insight', () => {
    const [alert] = healthcarePack.alertRules;

    const parsed = parseStoredRules([
      { code: alert.code, definition: { kind: 'INSIGHT', rule: alert } },
    ]);

    expect(parsed.invalid).toEqual([alert.code]);
  });
});
