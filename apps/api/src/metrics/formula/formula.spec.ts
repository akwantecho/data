import { Prisma } from '@prisma/client';
import {
  collectDependencies,
  evaluateFormula,
  FormulaError,
  parseFormula,
  topologicalOrder,
} from './formula';

const values = (entries: Record<string, string>) =>
  new Map(Object.entries(entries).map(([code, value]) => [code, new Prisma.Decimal(value)]));

/** Parses and evaluates in one step, for readability in the tests. */
function calculate(expression: string, inputs: Record<string, string>) {
  return evaluateFormula(parseFormula(expression), values(inputs));
}

function expectValue(expression: string, inputs: Record<string, string>, expected: string) {
  const result = calculate(expression, inputs);

  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value.toString()).toBe(expected);
  }
}

describe('parseFormula', () => {
  it('parses a metric reference', () => {
    expect(parseFormula('revenue')).toEqual({ kind: 'metric', code: 'revenue' });
  });

  it('lower-cases metric codes, so REVENUE and revenue are the same metric', () => {
    expect(parseFormula('Revenue')).toEqual({ kind: 'metric', code: 'revenue' });
  });

  it('rejects an empty formula', () => {
    expect(() => parseFormula('   ')).toThrow(FormulaError);
  });

  it('rejects unbalanced brackets', () => {
    expect(() => parseFormula('(revenue / expenses')).toThrow(/closing bracket/i);
    expect(() => parseFormula('revenue)')).toThrow(/Unexpected/);
  });

  it('rejects a dangling operator', () => {
    expect(() => parseFormula('revenue /')).toThrow(/ends unexpectedly/i);
    expect(() => parseFormula('* revenue')).toThrow(/Unexpected/);
  });

  it('rejects characters that are not part of the language', () => {
    // This is the line that stops a stored formula from becoming code execution.
    expect(() => parseFormula('process.exit(1)')).toThrow(FormulaError);
    expect(() => parseFormula('revenue; DROP TABLE metrics')).toThrow(FormulaError);
    expect(() => parseFormula('revenue ^ 2')).toThrow(/Unexpected character/);
  });
});

describe('evaluateFormula', () => {
  it('evaluates the plan’s own example', () => {
    expectValue('net_profit / revenue * 100', { net_profit: '12500', revenue: '100000' }, '12.5');
  });

  it('respects operator precedence', () => {
    expectValue('a + b * c', { a: '2', b: '3', c: '4' }, '14');
    expectValue('(a + b) * c', { a: '2', b: '3', c: '4' }, '20');
  });

  it('evaluates left to right for equal precedence', () => {
    expectValue('a - b - c', { a: '10', b: '3', c: '2' }, '5');
    expectValue('a / b / c', { a: '100', b: '5', c: '2' }, '10');
  });

  it('handles unary minus', () => {
    expectValue('-revenue', { revenue: '500' }, '-500');
    expectValue('0 - -revenue', { revenue: '500' }, '500');
  });

  it('keeps decimal precision that a float would lose', () => {
    // 0.1 + 0.2 !== 0.3 in binary floating point.
    expectValue('a + b', { a: '0.1', b: '0.2' }, '0.3');
    expectValue('a * b', { a: '1.15', b: '100' }, '115');
  });

  it('handles large money values exactly', () => {
    expectValue('a + b', { a: '99999999999.999999', b: '0.000001' }, '100000000000');
  });

  it('reports a missing input instead of guessing', () => {
    const result = calculate('net_profit / revenue', { revenue: '100' });

    expect(result).toEqual({ ok: false, reason: 'MISSING_INPUT', detail: 'net_profit' });
  });

  it('reports division by zero instead of returning infinity', () => {
    const result = calculate('net_profit / revenue', { net_profit: '10', revenue: '0' });

    expect(result).toEqual({ ok: false, reason: 'DIVISION_BY_ZERO', detail: 'revenue' });
  });

  it('reports division by an expression that evaluates to zero', () => {
    const result = calculate('a / (b - c)', { a: '10', b: '5', c: '5' });

    expect(result).toMatchObject({ ok: false, reason: 'DIVISION_BY_ZERO' });
  });

  it('allows a zero numerator', () => {
    expectValue('a / b', { a: '0', b: '5' }, '0');
  });

  it('is deterministic for repeated evaluation', () => {
    const ast = parseFormula('(a + b) / c * 100');
    const inputs = values({ a: '1', b: '2', c: '3' });

    const first = evaluateFormula(ast, inputs);
    const second = evaluateFormula(ast, inputs);

    expect(first).toEqual(second);
  });
});

describe('collectDependencies', () => {
  it('lists each referenced metric once, in order of appearance', () => {
    expect(collectDependencies(parseFormula('(revenue - expenses) / revenue * 100'))).toEqual([
      'revenue',
      'expenses',
    ]);
  });

  it('returns nothing for a constant expression', () => {
    expect(collectDependencies(parseFormula('100 / 4'))).toEqual([]);
  });
});

describe('topologicalOrder', () => {
  it('orders dependants after their dependencies', () => {
    const { order, cycle } = topologicalOrder([
      { code: 'margin_pct', dependencies: ['net_profit', 'revenue'] },
      { code: 'net_profit', dependencies: ['revenue', 'expenses'] },
    ]);

    expect(cycle).toBeNull();
    expect(order.indexOf('net_profit')).toBeLessThan(order.indexOf('margin_pct'));
  });

  it('ignores dependencies that are stored rather than calculated', () => {
    const { order } = topologicalOrder([{ code: 'margin', dependencies: ['revenue'] }]);

    expect(order).toEqual(['margin']);
  });

  it('detects a direct cycle and names it', () => {
    const { order, cycle } = topologicalOrder([
      { code: 'a', dependencies: ['b'] },
      { code: 'b', dependencies: ['a'] },
    ]);

    expect(order).toEqual([]);
    expect(cycle).toEqual(['a', 'b', 'a']);
  });

  it('detects a self-reference', () => {
    const { cycle } = topologicalOrder([{ code: 'a', dependencies: ['a'] }]);

    expect(cycle).toEqual(['a', 'a']);
  });

  it('detects an indirect cycle', () => {
    const { cycle } = topologicalOrder([
      { code: 'a', dependencies: ['b'] },
      { code: 'b', dependencies: ['c'] },
      { code: 'c', dependencies: ['a'] },
    ]);

    expect(cycle).toEqual(['a', 'b', 'c', 'a']);
  });

  it('handles a diamond without duplicating work', () => {
    const { order, cycle } = topologicalOrder([
      { code: 'top', dependencies: ['left', 'right'] },
      { code: 'left', dependencies: ['base'] },
      { code: 'right', dependencies: ['base'] },
      { code: 'base', dependencies: ['revenue'] },
    ]);

    expect(cycle).toBeNull();
    expect(order).toHaveLength(4);
    expect(order.indexOf('base')).toBeLessThan(order.indexOf('left'));
    expect(order.indexOf('right')).toBeLessThan(order.indexOf('top'));
  });
});
