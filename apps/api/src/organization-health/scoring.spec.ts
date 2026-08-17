import { bandFor, combineWeighted, parseBands, scoreMetric, type ScoreInput } from './scoring';

function input(overrides: Partial<ScoreInput> = {}): ScoreInput {
  return {
    value: null,
    target: null,
    minValue: null,
    maxValue: null,
    warningValue: null,
    criticalValue: null,
    isRelativeToTarget: false,
    direction: 'HIGHER_IS_BETTER',
    ...overrides,
  };
}

describe('scoreMetric', () => {
  describe('against a target', () => {
    it('scores full marks for hitting it', () => {
      expect(scoreMetric(input({ value: 500, target: 500 }))).toEqual({
        score: 100,
        basis: 'TARGET',
      });
    });

    it('does not score more than full marks for beating it', () => {
      // Health is "are we where we said we would be", not a leaderboard.
      expect(scoreMetric(input({ value: 900, target: 500 })).score).toBe(100);
    });

    it('scores half marks for half the target', () => {
      expect(scoreMetric(input({ value: 250, target: 500 })).score).toBe(50);
    });

    it('scores nothing for nothing reported', () => {
      expect(scoreMetric(input({ value: 0, target: 500 })).score).toBe(0);
    });

    it('reads a lower-is-better target from the other side', () => {
      const onTarget = scoreMetric(input({ value: 8, target: 8, direction: 'LOWER_IS_BETTER' }));
      const double = scoreMetric(input({ value: 16, target: 8, direction: 'LOWER_IS_BETTER' }));
      const better = scoreMetric(input({ value: 4, target: 8, direction: 'LOWER_IS_BETTER' }));

      expect(onTarget.score).toBe(100);
      // Twice the target is as bad as it gets on a scale built from the target alone.
      expect(double.score).toBe(0);
      expect(better.score).toBe(100);
    });
  });

  describe('against thresholds', () => {
    const thresholds = { warningValue: 400, criticalValue: 200 };

    it('scores the warning line at 60 and the critical line at 25', () => {
      expect(scoreMetric(input({ value: 400, ...thresholds })).score).toBe(60);
      expect(scoreMetric(input({ value: 200, ...thresholds })).score).toBe(25);
    });

    it('interpolates between the two', () => {
      expect(scoreMetric(input({ value: 300, ...thresholds })).score).toBe(42.5);
    });

    it('falls to zero below the critical line', () => {
      expect(scoreMetric(input({ value: 0, ...thresholds })).score).toBe(0);
      expect(scoreMetric(input({ value: -50, ...thresholds })).score).toBe(0);
    });

    it('says it scored from thresholds alone', () => {
      expect(scoreMetric(input({ value: 300, ...thresholds })).basis).toBe('THRESHOLDS');
    });
  });

  describe('against both', () => {
    const both = { target: 500, warningValue: 400, criticalValue: 200 };

    it('anchors target, warning and critical in order', () => {
      expect(scoreMetric(input({ value: 500, ...both })).score).toBe(100);
      expect(scoreMetric(input({ value: 400, ...both })).score).toBe(60);
      expect(scoreMetric(input({ value: 200, ...both })).score).toBe(25);
    });

    it('interpolates between the warning line and the target', () => {
      expect(scoreMetric(input({ value: 450, ...both })).score).toBe(80);
    });

    it('reports the basis as both', () => {
      expect(scoreMetric(input({ value: 450, ...both })).basis).toBe('TARGET_AND_THRESHOLDS');
    });

    it('reads a relative threshold as a percentage of the target', () => {
      // 92% and 85% of 500 are 460 and 425.
      const relative = input({
        value: 460,
        target: 500,
        warningValue: 92,
        criticalValue: 85,
        isRelativeToTarget: true,
      });

      expect(scoreMetric(relative).score).toBe(60);
    });

    it('ignores a relative threshold when there is no target to relate it to', () => {
      const orphan = input({ value: 460, warningValue: 92, isRelativeToTarget: true });

      expect(scoreMetric(orphan)).toEqual({ score: null, basis: 'NO_BENCHMARK' });
    });

    it('drops a threshold that sits on the good side of the target', () => {
      // A warning line above the target would otherwise invert the scale.
      const contradictory = input({ value: 500, target: 500, warningValue: 600 });

      expect(contradictory).toBeDefined();
      expect(scoreMetric(contradictory).score).toBe(100);
    });
  });

  describe('lower is better', () => {
    const noShow = {
      direction: 'LOWER_IS_BETTER' as const,
      target: 5,
      warningValue: 7,
      criticalValue: 10,
    };

    it('scores a value under the target at full marks', () => {
      expect(scoreMetric(input({ value: 3, ...noShow })).score).toBe(100);
    });

    it('scores the warning and critical lines the same way as any other metric', () => {
      expect(scoreMetric(input({ value: 7, ...noShow })).score).toBe(60);
      expect(scoreMetric(input({ value: 10, ...noShow })).score).toBe(25);
    });

    it('falls away above the critical line', () => {
      expect(scoreMetric(input({ value: 13, ...noShow })).score).toBe(0);
    });
  });

  describe('range and informational metrics', () => {
    it('scores full marks inside the range', () => {
      const within = input({
        value: 50,
        direction: 'TARGET_RANGE',
        minValue: 40,
        maxValue: 60,
      });

      expect(scoreMetric(within)).toEqual({ score: 100, basis: 'TARGET_RANGE' });
    });

    it('penalises above and below the range equally', () => {
      const build = (value: number) =>
        scoreMetric(input({ value, direction: 'TARGET_RANGE', minValue: 40, maxValue: 60 }));

      expect(build(30).score).toBe(build(70).score);
      expect(build(30).score).toBe(50);
    });

    it('never scores an informational metric', () => {
      expect(scoreMetric(input({ value: 42, target: 40, direction: 'INFORMATIONAL' }))).toEqual({
        score: null,
        basis: 'INFORMATIONAL',
      });
    });

    it('reports a missing value rather than scoring it zero', () => {
      // Nothing reported is not the same as a bad month.
      expect(scoreMetric(input({ target: 500 }))).toEqual({ score: null, basis: 'NO_VALUE' });
    });

    it('reports a metric with nothing to be measured against', () => {
      expect(scoreMetric(input({ value: 500 }))).toEqual({ score: null, basis: 'NO_BENCHMARK' });
    });
  });
});

describe('combineWeighted', () => {
  it('weights the parts as configured', () => {
    const result = combineWeighted([
      { score: 100, weight: 50 },
      { score: 50, weight: 50 },
    ]);

    expect(result.score).toBe(75);
    expect(result.effectiveWeights).toEqual([50, 50]);
  });

  it('redistributes the weight of a part that could not be scored', () => {
    // The unscored metric never reaches here; its weight simply is not in the list.
    const result = combineWeighted([
      { score: 80, weight: 40 },
      { score: 60, weight: 20 },
    ]);

    // 40 and 20 become two thirds and one third.
    expect(result.effectiveWeights).toEqual([66.67, 33.33]);
    expect(result.score).toBeCloseTo(73.33, 1);
  });

  it('has no score when nothing could be scored', () => {
    expect(combineWeighted([])).toEqual({ score: null, effectiveWeights: [] });
  });
});

describe('bands', () => {
  const bands = parseBands(null);

  it.each([
    [95, 'HEALTHY'],
    [80, 'HEALTHY'],
    [70, 'ATTENTION'],
    [45, 'RISK'],
    [10, 'CRITICAL'],
    [0, 'CRITICAL'],
  ])('labels %s as %s', (score, expected) => {
    expect(bandFor(score, bands)).toBe(expected);
  });

  it('has no label for no score', () => {
    expect(bandFor(null, bands)).toBeNull();
  });

  it('uses the organization’s own bands when it has configured them', () => {
    const strict = parseBands([
      { band: 'HEALTHY', min: 90, max: 100 },
      { band: 'ATTENTION', min: 70, max: 89.999 },
      { band: 'RISK', min: 50, max: 69.999 },
      { band: 'CRITICAL', min: 0, max: 49.999 },
    ]);

    expect(bandFor(85, strict)).toBe('ATTENTION');
    expect(bandFor(85, bands)).toBe('HEALTHY');
  });

  it('falls back to the defaults when the stored bands are unusable', () => {
    expect(parseBands('nonsense')).toHaveLength(4);
    expect(parseBands([{ band: 'HEALTHY' }])).toHaveLength(4);
  });
});
