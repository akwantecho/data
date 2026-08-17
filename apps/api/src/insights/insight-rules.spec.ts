import {
  evaluateInsightRule,
  storedInsightDefinitionSchema,
  type MetricFacts,
} from './insight-rules';

function facts(entries: Array<[string, Partial<MetricFacts>]>): Map<string, MetricFacts> {
  return new Map(
    entries.map(([code, overrides]) => [
      code,
      {
        code,
        name: code,
        value: null,
        changePct: null,
        varianceToTargetPct: null,
        ...overrides,
      },
    ]),
  );
}

const volumeUpMonetizationDown = storedInsightDefinitionSchema.parse({
  severity: 'WARNING',
  category: 'Financial',
  conditions: [
    { metric: 'appointments', measure: 'CHANGE_PCT', operator: 'GT', value: 0 },
    { metric: 'revenue_per_patient', measure: 'CHANGE_PCT', operator: 'LT', value: 0 },
  ],
  narrative: 'Patient volume is increasing but monetization per patient is declining.',
  evidence: ['appointments', 'revenue_per_patient', 'revenue'],
});

describe('evaluateInsightRule', () => {
  it('fires when every condition holds', () => {
    const result = evaluateInsightRule(
      volumeUpMonetizationDown,
      facts([
        ['appointments', { changePct: 9.5 }],
        ['revenue_per_patient', { changePct: -11 }],
      ]),
    );

    expect(result.fires).toBe(true);
    expect(result.conditions.every((condition) => condition.held)).toBe(true);
  });

  it('does not fire when one condition fails', () => {
    const result = evaluateInsightRule(
      volumeUpMonetizationDown,
      facts([
        ['appointments', { changePct: 9.5 }],
        ['revenue_per_patient', { changePct: 4 }],
      ]),
    );

    expect(result.fires).toBe(false);
    expect(result.conditions.map((condition) => condition.held)).toEqual([true, false]);
  });

  it('reports the figure each condition read, whether it held or not', () => {
    const result = evaluateInsightRule(
      volumeUpMonetizationDown,
      facts([
        ['appointments', { changePct: 9.5 }],
        ['revenue_per_patient', { changePct: -11 }],
      ]),
    );

    expect(result.conditions[0]).toMatchObject({
      metric: 'appointments',
      measure: 'CHANGE_PCT',
      threshold: 0,
      actual: 9.5,
    });
  });

  it('cannot fire when a metric the rule needs does not exist here', () => {
    const result = evaluateInsightRule(
      volumeUpMonetizationDown,
      facts([['appointments', { changePct: 9.5 }]]),
    );

    expect(result.fires).toBe(false);
    expect(result.unmet).toContain('revenue_per_patient');
  });

  it('cannot fire when a metric has no figure for the period', () => {
    // A first month has no change to read, and an insight asserted from a missing
    // figure would be an assertion about nothing.
    const result = evaluateInsightRule(
      volumeUpMonetizationDown,
      facts([
        ['appointments', { changePct: null }],
        ['revenue_per_patient', { changePct: -11 }],
      ]),
    );

    expect(result.fires).toBe(false);
    expect(result.unmet).toContain('change pct');
  });

  it.each([
    ['LT', 5, 4, true],
    ['LT', 5, 5, false],
    ['LTE', 5, 5, true],
    ['GT', 5, 6, true],
    ['GT', 5, 5, false],
    ['GTE', 5, 5, true],
  ] as const)('%s %s against %s', (operator, threshold, actual, expected) => {
    const rule = storedInsightDefinitionSchema.parse({
      conditions: [{ metric: 'revenue', measure: 'VALUE', operator, value: threshold }],
      narrative: 'A rule with one condition.',
      evidence: ['revenue'],
    });

    expect(evaluateInsightRule(rule, facts([['revenue', { value: actual }]])).fires).toBe(expected);
  });

  it.each(['VALUE', 'CHANGE_PCT', 'VARIANCE_TO_TARGET_PCT'] as const)('reads %s', (measure) => {
    const rule = storedInsightDefinitionSchema.parse({
      conditions: [{ metric: 'revenue', measure, operator: 'LT', value: 0 }],
      narrative: 'A rule with one condition.',
      evidence: ['revenue'],
    });

    const readings = { value: -1, changePct: -1, varianceToTargetPct: -1 };

    expect(evaluateInsightRule(rule, facts([['revenue', readings]])).fires).toBe(true);
  });
});

describe('storedInsightDefinitionSchema', () => {
  it('refuses a rule with no evidence, because an insight must quote something', () => {
    const result = storedInsightDefinitionSchema.safeParse({
      conditions: [{ metric: 'revenue', measure: 'VALUE', operator: 'LT', value: 0 }],
      narrative: 'Revenue fell.',
      evidence: [],
    });

    expect(result.success).toBe(false);
  });

  it('refuses a rule with no conditions', () => {
    const result = storedInsightDefinitionSchema.safeParse({
      conditions: [],
      narrative: 'Something happened.',
      evidence: ['revenue'],
    });

    expect(result.success).toBe(false);
  });

  it('refuses a measure the engine cannot compute', () => {
    const result = storedInsightDefinitionSchema.safeParse({
      conditions: [{ metric: 'revenue', measure: 'VIBES', operator: 'LT', value: 0 }],
      narrative: 'Revenue felt wrong.',
      evidence: ['revenue'],
    });

    expect(result.success).toBe(false);
  });

  it('defaults an unstated severity to informational', () => {
    const parsed = storedInsightDefinitionSchema.parse({
      conditions: [{ metric: 'revenue', measure: 'VALUE', operator: 'LT', value: 0 }],
      narrative: 'Revenue fell.',
      evidence: ['revenue'],
    });

    expect(parsed.severity).toBe('INFO');
  });
});
