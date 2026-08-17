# Dashboard and Analytics

How a stored value becomes a figure on screen. Every number the dashboard and the
analytics page show is produced by the API from stored values; the client formats
and never derives (plan §5.4).

> Status: built in Sprint 6. Decisions and their rationale: ADR-0010.

## The window

Every request takes the same filters:

| Filter         | Meaning                                      |
| -------------- | -------------------------------------------- |
| `from`, `to`   | A range over period starts, inclusive        |
| `branchId`     | Narrows to one branch                        |
| `departmentId` | Narrows to one department inside that branch |

Both dates are optional. The default ends at the most recent period the
organization actually reported and covers the six months up to it — a dashboard
empty because "today" has no data yet would be correct and useless.

The response echoes the window it resolved, including the **previous** window it
compared against: the same number of months immediately before when the range is
month-aligned, otherwise the same number of days.

## From stored values to a figure

```text
stored values in [previousFrom, to]
   │
   ├─ per period: reduce the slices        ← organization > branch > department
   │
   ├─ per window: reduce the periods       ← SUM / AVERAGE / LAST / MIN / MAX
   │
   └─ formula metrics: aggregate each input, then evaluate the expression
```

**Slices.** A value reported at the requested level wins; otherwise the level
directly beneath it is rolled up, one level at a time. So an organization that
reports both a company total and branch figures is not counted twice, and a
department is not added on top of the branch that contains it.

**Periods.** By the metric's own aggregation type. `LAST` is the exception worth
knowing: across periods it takes the latest, across slices it sums, because a stock
metric is the sum of the branches holding it at that moment.

**Formulas.** Recomputed from aggregated inputs, never averaged from their own
stored values. A quarter's RevPAR is quarterly revenue ÷ quarterly available rooms.
The response says which route it took in `aggregation`:

| `aggregation`            | Meaning                                       |
| ------------------------ | --------------------------------------------- |
| `SUM` … `MAX`            | The metric's own rule, applied across periods |
| `RECOMPUTED_FROM_INPUTS` | A formula, evaluated on the window's inputs   |
| `NONE`                   | Not aggregatable — nothing is shown           |

Anything with no value produces a blank, never a zero, and `missingPeriods` reports
how many periods in the window reported nothing.

## Targets

A target aggregates by its own rule (a target is set, never derived), and the
comparison is made **only over the periods that carry one**. The payload therefore
carries `target`, `targetPeriods` and `comparedToTarget` — the metric aggregated
over exactly those periods — so a single monthly target read against a year of
revenue cannot report a 900% overshoot.

## Endpoints

| Route                       | Returns                                                            |
| --------------------------- | ------------------------------------------------------------------ |
| `GET /dashboard/overview`   | KPI cards, headline trend, performance counts, health, attention   |
| `GET /analytics/options`    | Metrics, branches, departments and the reported period range       |
| `GET /analytics/metric/:id` | One metric, its inputs, its dependents and its category peers      |
| `GET /analytics/comparison` | One metric across branches or departments, or metrics side by side |

All four are readable by any member role: nothing here writes.

## KPI selection

The dashboard shows the highest-weighted metric in each of the health model's
categories. The model is the organization's own statement of what matters —
installed per industry, editable per tenant — so no industry vocabulary is
hardcoded anywhere (plan §5.2). An organization with no model falls back to the
metrics carrying the most reported values.

## What the dashboard does not do yet

- **Health scores.** The model is shown with its categories and weights and no
  score; the engine arrives in Sprint 7. A fabricated score is worse than a blank.
- **Alerts, insights, goals and decisions.** The panels read the real tables and
  are empty until the engines in Sprints 7 and 8 write their first rows.
- **Saved views and scheduled reports.** Plan §35 puts reports in Sprint 10.
