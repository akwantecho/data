# ADR-0010: Aggregating at read time, and recomputing formulas from their inputs

- **Status**: Accepted (Sprint 6)

## Context

Sprint 4 stores one value per metric, period and slice, and calculates formulas
the same way. A dashboard asks a different question: "what was revenue this
quarter, across the whole organization?" Answering it means reducing along two
axes — the slices inside a period, and the periods inside a window — and deciding
what a _derived_ metric means once you do.

## Decision

### Aggregation happens at read time, and writes nothing

The stored values remain the only record of what was reported. A window figure is
computed on request and never persisted.

The alternative — materialising quarterly and yearly rollups — is what a warehouse
does at volume, and it buys nothing here: a correction to one month would leave
stale rollups behind, and the plan's non-negotiable is that a number can always be
traced to the values it came from. At MVP volumes the query is a filtered read of
one organization's values for the window.

### A figure reported at the requested level wins over a roll-up beneath it

Values live at three levels: the organization, a branch, or a department inside a
branch. When several exist for the same period, the request's own level is used if
it reported; otherwise the next level down is rolled up — **one level at a time**.

Both halves matter. Preferring the reported total stops an organization that
reports both a company figure and branch figures from being counted twice, and the
total it reported is the one it stands behind. Rolling up only one level stops a
department's revenue being added on top of the branch that already contains it.
Both cases are asserted in the unit tests, because both produce a plausible wrong
number rather than an obvious one.

### Slices reduce by the metric's own rule, with one exception

`SUM` sums, `AVERAGE` averages, `MIN`/`MAX` take extremes. `LAST` — used for stock
metrics like units under management — **sums across slices** while still taking the
latest across periods: "last" is a statement about time, and a portfolio's units
are the sum of the branches holding them at that moment.

### A formula is recomputed from aggregated inputs, never averaged

A quarter's RevPAR is quarterly revenue divided by quarterly available rooms. It is
_not_ the mean of three monthly RevPARs — that is a different number, and one
nobody reported. The engine therefore aggregates each input over the window
(recursively, since an input may itself be a formula) and evaluates the expression
on those aggregates, reusing the Sprint 4 parser and decimal arithmetic (ADR-0008).

The unit tests carry a case where the two answers diverge: revenue 300 then 600
against 10 then 100 rooms gives 900/110 = 8.18 recomputed, against 18 averaged.
Averaging is what most dashboards do, and it is wrong every time the denominator
moves.

When any input has no aggregate for the window, the metric has none either. A
partial denominator produces a confident wrong answer, which is worse than a blank.

### The previous window is measured in months when the range is month-aligned

Every comparison shows "vs the previous period". Counting that period in days
compares six months against five and a bit, and reports the shortfall as decline.
When both ends of the range fall on the first of a month — which is how monthly
period starts are stored — the previous window is the same number of _months_
immediately before. Otherwise it falls back to the same number of days.

### A target is compared only over the periods that have one

Set one monthly revenue target, then read a year of revenue against it, and the
API would report a 900% overshoot. So the comparison is made over the periods that
actually carry a target: the response carries the aggregated target, how many
periods it covers, and the metric aggregated over exactly those periods
(`comparedToTarget`), with the variance computed between the two.

### KPI cards come from the health model

Plan §21 asks for Revenue, Profit, Customer volume and Growth "or industry
equivalent" — and the equivalent is exactly what the industry pack's health model
already states, weighted, per industry, and editable by the tenant. The dashboard
therefore shows the highest-weighted metric in each health category.

Hardcoding four codes would have put industry vocabulary in the dashboard, which
plan §5.2 forbids outright. An organization with no health model falls back to the
metrics carrying the most reported values — the only evidence available about what
it tracks — and the fallback is all-or-nothing, because topping a weighted model up
with unweighted metrics would present them as equals.

## Consequences

- Any range works, including one nobody anticipated, and every panel on a screen
  describes the same window because they are answered by one request.
- Derived metrics are right at every zoom level, which is the property that makes
  the dashboard and the metric detail page agree.
- A full read loads the organization's values for the window rather than a
  pre-aggregated row. That is fine at MVP volumes; the index on
  `(organization_id, period_start)` serves it, and materialised rollups remain
  available later if a tenant's volume demands them.
- Blanks appear where data is missing rather than zeros, and the API reports how
  many periods in a window reported nothing so the UI can say so.
- Health scores are not part of this: the model is displayed with no score until
  the engine in Sprint 7 fills it in.
