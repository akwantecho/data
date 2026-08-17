import { PACK_CATALOGUE, validatedCatalogue } from './index';
import { packDefinitionSchema } from './pack-definition';
import { healthcarePack } from './healthcare';

/**
 * A pack is data, and wrong data is only discovered inside a customer's
 * organization unless something checks it here. These tests are that check.
 */
describe('industry pack catalogue', () => {
  it('ships the three MVP packs, one per industry', () => {
    const packs = validatedCatalogue();

    expect(packs.map((pack) => pack.industryCode).sort()).toEqual([
      'healthcare',
      'hospitality',
      'real_estate',
    ]);
  });

  it.each(PACK_CATALOGUE.map((pack) => [pack.code, pack] as const))(
    '%s is valid',
    (_code, pack) => {
      expect(packDefinitionSchema.safeParse(pack).success).toBe(true);
    },
  );

  it.each(PACK_CATALOGUE.map((pack) => [pack.code, pack] as const))(
    '%s installs every metric the plan lists for it',
    (_code, pack) => {
      // Guards against a metric quietly disappearing from a pack in a later edit.
      const expected: Record<string, number> = {
        healthcare_core: 11,
        hospitality_core: 12,
        real_estate_core: 12,
      };

      expect(pack.metrics).toHaveLength(expected[pack.code]);
    },
  );

  it.each(PACK_CATALOGUE.map((pack) => [pack.code, pack] as const))(
    '%s weights every health category to 100 and every category to 100 overall',
    (_code, pack) => {
      const total = pack.healthModel.categories.reduce((sum, category) => sum + category.weight, 0);

      expect(total).toBe(100);

      for (const category of pack.healthModel.categories) {
        const metrics = category.metrics.reduce((sum, metric) => sum + metric.weight, 0);
        expect([category.code, metrics]).toEqual([category.code, 100]);
      }
    },
  );

  it.each(PACK_CATALOGUE.map((pack) => [pack.code, pack] as const))(
    '%s only references metrics it installs itself',
    (_code, pack) => {
      const codes = new Set(pack.metrics.map((metric) => metric.code));

      for (const metric of pack.metrics) {
        for (const token of (metric.formula ?? '').match(/[a-z][a-z0-9_]*/g) ?? []) {
          expect([metric.code, token, codes.has(token)]).toEqual([metric.code, token, true]);
        }
      }

      for (const rule of pack.insightRules) {
        for (const code of [
          ...rule.definition.conditions.map((condition) => condition.metric),
          ...rule.definition.evidence,
        ]) {
          expect([rule.code, code, codes.has(code)]).toEqual([rule.code, code, true]);
        }
      }

      for (const rule of pack.alertRules) {
        expect([rule.code, rule.metric, codes.has(rule.metric)]).toEqual([
          rule.code,
          rule.metric,
          true,
        ]);
      }
    },
  );

  it.each(PACK_CATALOGUE.map((pack) => [pack.code, pack] as const))(
    '%s gives every insight rule evidence to quote',
    (_code, pack) => {
      for (const rule of pack.insightRules) {
        expect(rule.definition.evidence.length).toBeGreaterThan(0);
        expect(rule.definition.narrative.length).toBeGreaterThan(20);
      }
    },
  );

  it('rejects a pack whose categories do not sum to 100', () => {
    const broken = {
      ...healthcarePack,
      healthModel: {
        ...healthcarePack.healthModel,
        categories: healthcarePack.healthModel.categories.slice(0, 2),
      },
    };

    const result = packDefinitionSchema.safeParse(broken);

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.message).join()).toContain(
      'Health categories must sum to 100',
    );
  });

  it('rejects a formula that reaches outside the pack', () => {
    const broken = {
      ...healthcarePack,
      metrics: healthcarePack.metrics.map((metric) =>
        metric.code === 'revenue_per_patient'
          ? { ...metric, formula: 'revenue / occupied_rooms' }
          : metric,
      ),
    };

    const result = packDefinitionSchema.safeParse(broken);

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.message).join()).toContain(
      'unknown metric occupied_rooms',
    );
  });

  it('rejects an alert rule whose parameters do not match its type', () => {
    const broken = {
      ...healthcarePack,
      alertRules: [
        {
          code: 'wrong_parameters',
          name: 'Wrong parameters',
          metric: 'revenue',
          type: 'LARGE_PERIOD_CHANGE' as const,
          severity: 'WARNING' as const,
          definition: { usesConfiguredThreshold: true },
        },
      ],
    };

    const result = packDefinitionSchema.safeParse(broken);

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.message).join()).toContain(
      'LARGE_PERIOD_CHANGE parameters are invalid',
    );
  });

  it('names the offending pack when validation fails', () => {
    expect(() => validatedCatalogue([{ ...healthcarePack, metrics: [] } as never])).toThrow(
      /Industry pack "healthcare_core" is invalid/,
    );
  });
});
