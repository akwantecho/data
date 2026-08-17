import { Prisma } from '@prisma/client';
import { evaluateThreshold, percentageChange, varianceToTarget } from './metrics.service';

const decimal = (value: string) => new Prisma.Decimal(value);

describe('percentageChange', () => {
  it('reports growth and decline', () => {
    expect(percentageChange(decimal('128400'), decimal('116900'))).toBe('9.84');
    expect(percentageChange(decimal('90'), decimal('100'))).toBe('-10');
  });

  it('is undefined without both values', () => {
    expect(percentageChange(null, decimal('100'))).toBeNull();
    expect(percentageChange(decimal('100'), null)).toBeNull();
  });

  it('is undefined when the previous value is zero, rather than infinite', () => {
    expect(percentageChange(decimal('100'), decimal('0'))).toBeNull();
  });
});

describe('varianceToTarget', () => {
  it('reports the signed distance from the target', () => {
    expect(varianceToTarget(decimal('128400'), decimal('130000'))).toBe('-1.23');
    expect(varianceToTarget(decimal('140000'), decimal('130000'))).toBe('7.69');
  });

  it('is undefined against a zero target', () => {
    expect(varianceToTarget(decimal('100'), decimal('0'))).toBeNull();
  });
});

describe('evaluateThreshold', () => {
  const absolute = {
    warningValue: decimal('100'),
    criticalValue: decimal('80'),
    isRelativeToTarget: false,
  };

  it('is unknown without a value or a threshold', () => {
    expect(evaluateThreshold(null, absolute, null, 'HIGHER_IS_BETTER')).toBe('UNKNOWN');
    expect(evaluateThreshold(decimal('50'), null, null, 'HIGHER_IS_BETTER')).toBe('UNKNOWN');
  });

  it('is unknown for an informational metric, which has no good direction', () => {
    expect(evaluateThreshold(decimal('10'), absolute, null, 'INFORMATIONAL')).toBe('UNKNOWN');
  });

  describe('higher is better', () => {
    it('breaches when the value falls below the limit', () => {
      expect(evaluateThreshold(decimal('120'), absolute, null, 'HIGHER_IS_BETTER')).toBe('OK');
      expect(evaluateThreshold(decimal('90'), absolute, null, 'HIGHER_IS_BETTER')).toBe('WARNING');
      expect(evaluateThreshold(decimal('70'), absolute, null, 'HIGHER_IS_BETTER')).toBe('CRITICAL');
    });

    it('treats the limit itself as still acceptable', () => {
      expect(evaluateThreshold(decimal('100'), absolute, null, 'HIGHER_IS_BETTER')).toBe('OK');
    });
  });

  describe('lower is better', () => {
    const lower = {
      warningValue: decimal('5'),
      criticalValue: decimal('10'),
      isRelativeToTarget: false,
    };

    it('breaches when the value rises above the limit', () => {
      expect(evaluateThreshold(decimal('3'), lower, null, 'LOWER_IS_BETTER')).toBe('OK');
      expect(evaluateThreshold(decimal('7'), lower, null, 'LOWER_IS_BETTER')).toBe('WARNING');
      expect(evaluateThreshold(decimal('12'), lower, null, 'LOWER_IS_BETTER')).toBe('CRITICAL');
    });
  });

  describe('relative to target', () => {
    const relative = {
      warningValue: decimal('90'),
      criticalValue: decimal('75'),
      isRelativeToTarget: true,
    };

    it('reads the threshold as a percentage of the target', () => {
      // Target 1000 → warning below 900, critical below 750.
      expect(evaluateThreshold(decimal('950'), relative, decimal('1000'), 'HIGHER_IS_BETTER')).toBe(
        'OK',
      );
      expect(evaluateThreshold(decimal('850'), relative, decimal('1000'), 'HIGHER_IS_BETTER')).toBe(
        'WARNING',
      );
      expect(evaluateThreshold(decimal('700'), relative, decimal('1000'), 'HIGHER_IS_BETTER')).toBe(
        'CRITICAL',
      );
    });

    it('cannot judge a relative threshold with no target', () => {
      expect(evaluateThreshold(decimal('10'), relative, null, 'HIGHER_IS_BETTER')).toBe('OK');
    });
  });

  it('ignores a limit that has not been configured', () => {
    const warningOnly = {
      warningValue: decimal('50'),
      criticalValue: null,
      isRelativeToTarget: false,
    };

    expect(evaluateThreshold(decimal('10'), warningOnly, null, 'HIGHER_IS_BETTER')).toBe('WARNING');
  });
});
