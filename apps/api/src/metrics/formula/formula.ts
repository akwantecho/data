import { Prisma } from '@prisma/client';

/**
 * A tiny arithmetic language for metric formulas: `net_profit / revenue * 100`.
 *
 * It is parsed into an AST and evaluated with decimal arithmetic — never with
 * `eval` or `Function`, which would let a stored string execute arbitrary code
 * with the server's privileges, and never with JavaScript numbers, which would
 * quietly lose precision on money (ADR-0004).
 */

export type Node =
  | { kind: 'number'; value: string }
  | { kind: 'metric'; code: string }
  | { kind: 'unary'; operator: '-'; operand: Node }
  | { kind: 'binary'; operator: '+' | '-' | '*' | '/'; left: Node; right: Node };

export class FormulaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FormulaError';
  }
}

type Token =
  | { type: 'number'; value: string }
  | { type: 'identifier'; value: string }
  | { type: 'operator'; value: '+' | '-' | '*' | '/' }
  | { type: 'paren'; value: '(' | ')' };

const IDENTIFIER_START = /[a-z_]/i;
const IDENTIFIER_PART = /[a-z0-9_]/i;
const DIGIT = /[0-9]/;

export function tokenize(expression: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;

  while (index < expression.length) {
    const character = expression[index];

    if (/\s/.test(character)) {
      index += 1;
      continue;
    }

    if (character === '(' || character === ')') {
      tokens.push({ type: 'paren', value: character });
      index += 1;
      continue;
    }

    if (character === '+' || character === '-' || character === '*' || character === '/') {
      tokens.push({ type: 'operator', value: character });
      index += 1;
      continue;
    }

    if (DIGIT.test(character) || (character === '.' && DIGIT.test(expression[index + 1] ?? ''))) {
      let value = '';
      let seenDot = false;

      while (index < expression.length) {
        const next = expression[index];

        if (DIGIT.test(next)) {
          value += next;
        } else if (next === '.' && !seenDot) {
          seenDot = true;
          value += next;
        } else {
          break;
        }

        index += 1;
      }

      tokens.push({ type: 'number', value });
      continue;
    }

    if (IDENTIFIER_START.test(character)) {
      let value = '';

      while (index < expression.length && IDENTIFIER_PART.test(expression[index])) {
        value += expression[index];
        index += 1;
      }

      tokens.push({ type: 'identifier', value: value.toLowerCase() });
      continue;
    }

    throw new FormulaError(`Unexpected character "${character}" in the formula.`);
  }

  return tokens;
}

/**
 * Recursive-descent parser.
 *
 *   expression := term (('+' | '-') term)*
 *   term       := factor (('*' | '/') factor)*
 *   factor     := '-' factor | number | identifier | '(' expression ')'
 */
export function parseFormula(expression: string): Node {
  const trimmed = expression.trim();

  if (trimmed.length === 0) {
    throw new FormulaError('The formula is empty.');
  }

  const tokens = tokenize(trimmed);
  let position = 0;

  const peek = (): Token | undefined => tokens[position];

  const parseExpression = (): Node => {
    let left = parseTerm();

    for (;;) {
      const token = peek();

      if (token?.type === 'operator' && (token.value === '+' || token.value === '-')) {
        position += 1;
        left = { kind: 'binary', operator: token.value, left, right: parseTerm() };
        continue;
      }

      return left;
    }
  };

  const parseTerm = (): Node => {
    let left = parseFactor();

    for (;;) {
      const token = peek();

      if (token?.type === 'operator' && (token.value === '*' || token.value === '/')) {
        position += 1;
        left = { kind: 'binary', operator: token.value, left, right: parseFactor() };
        continue;
      }

      return left;
    }
  };

  const parseFactor = (): Node => {
    const token = peek();

    if (!token) {
      throw new FormulaError('The formula ends unexpectedly.');
    }

    if (token.type === 'operator' && token.value === '-') {
      position += 1;
      return { kind: 'unary', operator: '-', operand: parseFactor() };
    }

    if (token.type === 'operator' && token.value === '+') {
      position += 1;
      return parseFactor();
    }

    if (token.type === 'number') {
      position += 1;
      return { kind: 'number', value: token.value };
    }

    if (token.type === 'identifier') {
      position += 1;
      return { kind: 'metric', code: token.value };
    }

    if (token.type === 'paren' && token.value === '(') {
      position += 1;
      const inner = parseExpression();
      const closing = peek();

      if (closing?.type !== 'paren' || closing.value !== ')') {
        throw new FormulaError('A closing bracket is missing.');
      }

      position += 1;
      return inner;
    }

    throw new FormulaError(`Unexpected "${token.value}" in the formula.`);
  };

  const ast = parseExpression();

  if (position < tokens.length) {
    throw new FormulaError(`Unexpected "${tokens[position].value}" in the formula.`);
  }

  return ast;
}

/** Metric codes the formula reads, in first-appearance order, without duplicates. */
export function collectDependencies(node: Node): string[] {
  const found: string[] = [];

  const walk = (current: Node): void => {
    switch (current.kind) {
      case 'metric':
        if (!found.includes(current.code)) {
          found.push(current.code);
        }
        return;
      case 'unary':
        walk(current.operand);
        return;
      case 'binary':
        walk(current.left);
        walk(current.right);
        return;
      default:
        return;
    }
  };

  walk(node);

  return found;
}

export type EvaluationResult =
  | { ok: true; value: Prisma.Decimal }
  | { ok: false; reason: 'MISSING_INPUT'; detail: string }
  | { ok: false; reason: 'DIVISION_BY_ZERO'; detail: string };

/**
 * Evaluates a parsed formula against the values available for one period and
 * slice.
 *
 * A missing input or a division by zero is a *result*, not an exception: the
 * platform must be able to say "this KPI could not be calculated, and here is
 * why" rather than storing a wrong number or a NaN.
 */
export function evaluateFormula(node: Node, values: Map<string, Prisma.Decimal>): EvaluationResult {
  try {
    return { ok: true, value: evaluateNode(node, values) };
  } catch (error) {
    if (error instanceof MissingInput) {
      return { ok: false, reason: 'MISSING_INPUT', detail: error.code };
    }

    if (error instanceof DivisionByZero) {
      return { ok: false, reason: 'DIVISION_BY_ZERO', detail: error.expression };
    }

    throw error;
  }
}

class MissingInput extends Error {
  constructor(readonly code: string) {
    super(`Missing value for "${code}"`);
  }
}

class DivisionByZero extends Error {
  constructor(readonly expression: string) {
    super('Division by zero');
  }
}

function evaluateNode(node: Node, values: Map<string, Prisma.Decimal>): Prisma.Decimal {
  switch (node.kind) {
    case 'number':
      return new Prisma.Decimal(node.value);

    case 'metric': {
      const value = values.get(node.code);

      if (value === undefined) {
        throw new MissingInput(node.code);
      }

      return value;
    }

    case 'unary':
      return evaluateNode(node.operand, values).negated();

    case 'binary': {
      const left = evaluateNode(node.left, values);
      const right = evaluateNode(node.right, values);

      switch (node.operator) {
        case '+':
          return left.plus(right);
        case '-':
          return left.minus(right);
        case '*':
          return left.times(right);
        case '/':
          // decimal.js would return Infinity here, which is not a number a KPI
          // can be, so the caller is told the calculation is impossible instead.
          if (right.isZero()) {
            throw new DivisionByZero(describe(node.right));
          }
          return left.dividedBy(right);
      }
    }
  }
}

/** Renders a node back to text, for error messages. */
export function describe(node: Node): string {
  switch (node.kind) {
    case 'number':
      return node.value;
    case 'metric':
      return node.code;
    case 'unary':
      return `-${describe(node.operand)}`;
    case 'binary':
      return `${describe(node.left)} ${node.operator} ${describe(node.right)}`;
  }
}

/**
 * Orders formula metrics so every metric is calculated after the metrics it
 * reads, and reports any cycle instead of looping forever.
 */
export function topologicalOrder(metrics: Array<{ code: string; dependencies: string[] }>): {
  order: string[];
  cycle: string[] | null;
} {
  const byCode = new Map(metrics.map((metric) => [metric.code, metric]));
  const order: string[] = [];
  const state = new Map<string, 'visiting' | 'done'>();
  const stack: string[] = [];

  let cycle: string[] | null = null;

  const visit = (code: string): void => {
    if (cycle || state.get(code) === 'done') {
      return;
    }

    if (state.get(code) === 'visiting') {
      const start = stack.indexOf(code);
      cycle = [...stack.slice(start), code];
      return;
    }

    const metric = byCode.get(code);

    if (!metric) {
      // Not a formula metric: it is either a stored value or unknown, and both
      // are handled at evaluation time.
      return;
    }

    state.set(code, 'visiting');
    stack.push(code);

    for (const dependency of metric.dependencies) {
      visit(dependency);
    }

    stack.pop();
    state.set(code, 'done');
    order.push(code);
  };

  for (const metric of metrics) {
    visit(metric.code);
  }

  return { order: cycle ? [] : order, cycle };
}
