import { evaluateAlertRule, type RuleFacts } from './alert-rules';

function facts(overrides: Partial<RuleFacts> = {}): RuleFacts {
  return {
    metricName: 'No-Show Rate',
    metricCode: 'no_show_rate',
    unit: 'PERCENTAGE',
    value: null,
    previousValue: null,
    changePct: null,
    target: null,
    warningValue: null,
    criticalValue: null,
    isRelativeToTarget: false,
    direction: 'LOWER_IS_BETTER',
    daysSinceImport: null,
    dataQualityScore: null,
    ...overrides,
  };
}

describe('threshold rules', () => {
  const above = (overrides: Partial<RuleFacts>) =>
    evaluateAlertRule(
      'METRIC_ABOVE_THRESHOLD',
      { usesConfiguredThreshold: true },
      'WARNING',
      facts(overrides),
    );

  it('fires when the value passes the warning line', () => {
    const outcome = above({ value: 8, warningValue: 7, criticalValue: 10 });

    expect(outcome.fires).toBe(true);
    expect(outcome.severity).toBe('WARNING');
    expect(outcome.title).toContain('above its warning threshold');
  });

  it('raises the severity to critical when the harder line is passed', () => {
    // A breach of the critical line is not a warning, whatever the rule says.
    const outcome = above({ value: 12, warningValue: 7, criticalValue: 10 });

    expect(outcome.severity).toBe('CRITICAL');
    expect(outcome.title).toContain('critical');
  });

  it('stays quiet inside the thresholds', () => {
    expect(above({ value: 5, warningValue: 7, criticalValue: 10 }).fires).toBe(false);
  });

  it('reads a relative threshold as a percentage of the target', () => {
    // 108% of a target of 7 is 7.56.
    const quiet = above({ value: 7.4, target: 7, warningValue: 108, isRelativeToTarget: true });
    const loud = above({ value: 7.9, target: 7, warningValue: 108, isRelativeToTarget: true });

    expect(quiet.fires).toBe(false);
    expect(loud.fires).toBe(true);
  });

  it('cannot fire on a relative threshold with no target behind it', () => {
    expect(above({ value: 99, warningValue: 108, isRelativeToTarget: true }).fires).toBe(false);
  });

  it('fires below the line for a below-threshold rule', () => {
    const outcome = evaluateAlertRule(
      'METRIC_BELOW_THRESHOLD',
      { usesConfiguredThreshold: true },
      'WARNING',
      facts({
        metricName: 'Occupancy Rate',
        value: 60,
        warningValue: 70,
        direction: 'HIGHER_IS_BETTER',
      }),
    );

    expect(outcome.fires).toBe(true);
    expect(outcome.evidence?.figures).toContainEqual({ label: 'Occupancy Rate', value: '60' });
  });

  it('says nothing about a period with no value', () => {
    expect(above({ warningValue: 7 }).fires).toBe(false);
  });
});

describe('large period change', () => {
  const rule = (changePct: number, overrides: Partial<RuleFacts>) =>
    evaluateAlertRule('LARGE_PERIOD_CHANGE', { changePct }, 'HIGH', facts(overrides));

  it('fires on a fall past a negative limit', () => {
    const outcome = rule(-15, {
      metricName: 'RevPAR',
      value: 80,
      previousValue: 100,
      changePct: -20,
    });

    expect(outcome.fires).toBe(true);
    expect(outcome.title).toContain('fell sharply');
    expect(outcome.evidence?.statement).toBe('100 → 80 (-20%).');
  });

  it('does not fire on a fall inside the limit', () => {
    expect(rule(-15, { value: 90, previousValue: 100, changePct: -10 }).fires).toBe(false);
  });

  it('fires on a rise past a positive limit', () => {
    const outcome = rule(20, { value: 130, previousValue: 100, changePct: 30 });

    expect(outcome.fires).toBe(true);
    expect(outcome.title).toContain('rose sharply');
  });

  it('cannot fire without a previous period to compare with', () => {
    expect(rule(-15, { value: 80 }).fires).toBe(false);
  });
});

describe('target missed', () => {
  const rule = (tolerancePct: number, overrides: Partial<RuleFacts>) =>
    evaluateAlertRule('TARGET_MISSED', { tolerancePct }, 'HIGH', facts(overrides));

  it('fires when the shortfall passes the tolerance', () => {
    const outcome = rule(5, {
      metricName: 'Revenue',
      direction: 'HIGHER_IS_BETTER',
      value: 900,
      target: 1000,
    });

    expect(outcome.fires).toBe(true);
    expect(outcome.evidence?.figures).toContainEqual({ label: 'Shortfall', value: '10%' });
  });

  it('tolerates a small miss', () => {
    expect(rule(5, { direction: 'HIGHER_IS_BETTER', value: 970, target: 1000 }).fires).toBe(false);
  });

  it('never fires when the target was beaten', () => {
    expect(rule(5, { direction: 'HIGHER_IS_BETTER', value: 1100, target: 1000 }).fires).toBe(false);
  });

  it('reads the miss from the other side for a lower-is-better metric', () => {
    // 12 against a target of 10 is a 20% overshoot, which is the miss here.
    const outcome = rule(5, { direction: 'LOWER_IS_BETTER', value: 12, target: 10 });
    const under = rule(5, { direction: 'LOWER_IS_BETTER', value: 8, target: 10 });

    expect(outcome.fires).toBe(true);
    expect(under.fires).toBe(false);
  });

  it('cannot divide by a target of zero', () => {
    expect(rule(5, { value: 10, target: 0 }).fires).toBe(false);
  });
});

describe('data rules', () => {
  it('fires when nothing has been imported for longer than allowed', () => {
    const outcome = evaluateAlertRule(
      'DATA_SOURCE_STALE',
      { staleDays: 30 },
      'WARNING',
      facts({ daysSinceImport: 45 }),
    );

    expect(outcome.fires).toBe(true);
    expect(outcome.description).toContain('45 days ago');
  });

  it('stays quiet while imports are recent', () => {
    expect(
      evaluateAlertRule(
        'DATA_SOURCE_STALE',
        { staleDays: 30 },
        'WARNING',
        facts({ daysSinceImport: 5 }),
      ).fires,
    ).toBe(false);
  });

  it('fires when data quality drops below the floor', () => {
    const outcome = evaluateAlertRule(
      'DATA_QUALITY_DEGRADED',
      { minimumScore: 70 },
      'WARNING',
      facts({ dataQualityScore: 55 }),
    );

    expect(outcome.fires).toBe(true);
    expect(outcome.evidence?.figures).toContainEqual({ label: 'Data quality', value: '55/100' });
  });

  it('cannot judge quality that has never been measured', () => {
    expect(
      evaluateAlertRule('DATA_QUALITY_DEGRADED', { minimumScore: 70 }, 'WARNING', facts()).fires,
    ).toBe(false);
  });
});

describe('every rule that fires', () => {
  it('carries a statement and figures, because an alert has to be checkable', () => {
    const outcomes = [
      evaluateAlertRule(
        'METRIC_ABOVE_THRESHOLD',
        { usesConfiguredThreshold: true },
        'WARNING',
        facts({ value: 12, warningValue: 7, criticalValue: 10 }),
      ),
      evaluateAlertRule(
        'LARGE_PERIOD_CHANGE',
        { changePct: -15 },
        'HIGH',
        facts({ value: 80, previousValue: 100, changePct: -20 }),
      ),
      evaluateAlertRule(
        'TARGET_MISSED',
        { tolerancePct: 5 },
        'HIGH',
        facts({ direction: 'HIGHER_IS_BETTER', value: 900, target: 1000 }),
      ),
    ];

    for (const outcome of outcomes) {
      expect(outcome.fires).toBe(true);
      expect(outcome.evidence?.statement.length).toBeGreaterThan(5);
      expect(outcome.evidence?.figures.length).toBeGreaterThan(1);
      expect(outcome.title?.length).toBeGreaterThan(5);
      expect(outcome.description?.length).toBeGreaterThan(10);
    }
  });

  it('never fires on a rule type it does not know', () => {
    expect(evaluateAlertRule('MYSTERY' as never, {}, 'INFO', facts({ value: 1 })).fires).toBe(
      false,
    );
  });
});
