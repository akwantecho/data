# ADR-0008: A parsed formula language, evaluated per slice with decimal arithmetic

- **Status**: Accepted (Sprint 4)

## Context

Metric formulas are stored strings written by users: `net_profit / revenue * 100`.
Three things had to be decided before any of them could be evaluated — how the
expression is executed, what arithmetic it uses, and what "one calculation" is
scoped to.

## Decision

### Parsed, never evaluated

The expression is tokenised and parsed into an AST by a recursive-descent parser,
then walked. `eval` and `new Function` are not used anywhere.

This is not a stylistic preference. A stored formula is user input that reaches
the server; evaluating it as JavaScript would let anyone who can define a metric
run arbitrary code with the API's privileges — the database connection included.
The parser accepts only numbers, metric codes, `+ - * /`, brackets and unary
minus; anything else is a parse error, and a test asserts that `process.exit(1)`
and `revenue; DROP TABLE metrics` are both rejected.

### Decimal arithmetic

Evaluation uses `Prisma.Decimal` (decimal.js), the same representation the values
are stored in. A margin computed through JavaScript numbers would drift from the
figures it was derived from — `0.1 + 0.2 !== 0.3` — and management numbers cannot
disagree with themselves (ADR-0004).

### Failure is a result, not an exception

Two situations are expected rather than exceptional: an input has no value for the
period, and a divisor is zero. Both return a typed result the caller records as a
_skip_ with a reason. The alternatives were storing `NaN`/`Infinity` (a number that
is not a number, propagating silently into dashboards and AI context) or throwing
and abandoning the whole run because one metric in one period lacked an input.

decimal.js returns `Infinity` for `x / 0`, so the divisor is checked explicitly
before dividing.

### Calculated per slice

A formula is evaluated for one period **and** one branch/department combination,
using only values from that same slice. A branch's margin therefore uses that
branch's own revenue, and the organization-level margin uses organization-level
figures. Mixing slices — dividing a branch's profit by the organization's revenue —
would produce a number nobody reported and no one could reproduce.

A slice with a missing input simply produces no value for that metric, which is
how "we cannot calculate this yet" is represented.

### Ordering and cycles

Formula metrics are topologically sorted before evaluation, so a formula that
reads another calculated metric sees the fresh value in the same pass. Cycles are
rejected **at save time**, when the user can still fix them, with the loop spelled
out (`a → b → c → a`). The engine checks again at run time and refuses the whole
run rather than looping, because a cycle reaching that point means the data was
changed outside the API.

### Replace, never accumulate

A recalculation deletes the calculated values in its scope and writes the new ones
in one transaction. A **targeted** run (after an import) is scoped to the periods
that changed; a **full** run replaces everything for those metrics. The distinction
matters: when every input for a period disappears, that period produces no slice
at all, so a scope derived from surviving slices would leave the stale derived
value behind. This was caught by the test that withdraws an input and expects the
calculated value to vanish.

## Consequences

- Formulas are safe to store and to run, and a new operator is a parser change with
  a test, not a security review.
- Users get precise errors at save time (unknown metric, loop, malformed syntax)
  and precise skips at calculation time (which input, which period).
- The engine is pure enough to unit-test exhaustively without a database: 25 tests
  cover parsing, precedence, precision, missing inputs, division by zero and cycle
  detection.
- Cost: a full recalculation reads every stored value for the organization. That is
  fine at MVP volumes and is already narrowed to the touched periods after an
  import; a metric-level dependency filter is the next optimisation if needed.
- Formulas cannot yet aggregate across periods or slices (`sum of last 12 months`,
  `organization total from branches`). Those are read-time analytics, and belong
  with the dashboard in Sprint 6.
