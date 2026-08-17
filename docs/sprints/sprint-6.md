# Sprint 6 Completion Report

```text
SPRINT: 6 — Executive Dashboard and Analytics
STATUS: COMPLETE — all acceptance criteria met, all blocking tests pass
```

## IMPLEMENTED

**Read-time aggregation** (ADR-0010) — the engine this sprint is really about

Sprint 4 stores one value per metric, period and slice. A dashboard asks "what was
revenue this quarter, across the whole organization?", which means reducing along
two axes and deciding what a _derived_ metric means once you do.

- **Slices** reduce with a value reported at the requested level winning over a
  roll-up beneath it, and roll-ups going **one level at a time**. Together those
  stop an organization that reports both a company total and branch figures being
  counted twice, and stop a department being added on top of the branch that
  contains it. Both produce plausible wrong numbers, so both are unit-tested.
- **Periods** reduce by the metric's own aggregation type. `LAST` is the exception
  worth knowing: latest across periods, summed across slices, because a portfolio's
  units are the sum of the branches holding them at that moment.
- **Formulas are recomputed from aggregated inputs**, never averaged from their own
  stored values. A quarter's RevPAR is quarterly revenue ÷ quarterly available
  rooms. The tests carry a case where the two answers diverge — 900/110 = 8.18
  recomputed against 18.00 averaged — because averaging is what most dashboards do
  and it is wrong every time the denominator moves.
- Nothing is written. A window figure is computed on request, so a corrected month
  cannot leave a stale rollup behind.

**The executive dashboard** (plan §21)

One request answers the whole screen, so every panel describes the same window and
the same slice:

- KPI cards with the window figure, the change against the preceding window, the
  target and variance, and the threshold status.
- A headline trend with this range against the previous one, plotted position by
  position so the comparison sits beside what it compares.
- Performance counts across every active metric: meeting target, behind target, no
  target, and threshold OK/warning/critical.
- The installed health model with its categories and weights — and **no score**,
  because scoring is Sprint 7 and a fabricated number on an executive dashboard is
  worse than an honest blank.
- Alerts, insights and decisions panels reading the real tables, empty until the
  engines that write them exist.
- Data quality, reported as "no imports yet" rather than a score of zero when
  nothing has been imported.

**The analytics page** (plan §24)

Pick a metric, pick a range, compare periods and slices, and see what the metric is
made of: the window figure and the previous one, change, target and variance; a
sentence saying _how_ the figure was produced (`Summed across the range`, or
`Calculated for this range from its inputs (revenue / available_rooms), not
averaged from its monthly values`) and how many periods reported nothing; a
comparison by branch or department with a chart; and the metric's inputs, its
dependants and its category peers. The chosen metric lives in the URL, so a link to
a number opens on that number.

**Global filters** (plan §21)

Date range with presets, branch, department — applied to every panel through one
request. Changing the branch clears the department, so an impossible pair never
reaches the API. The server resolves the range and echoes it back, including the
previous window, which the UI shows in words.

**Comparability fixes the data made obvious**

- The **previous window is measured in months** when the range is month-aligned.
  Counting days compared six months against five and a bit and reported the
  shortfall as a decline.
- A **target is compared only over the periods that carry one**. One monthly target
  read against a year of revenue reported a 900% overshoot; the response now carries
  `targetPeriods` and `comparedToTarget` alongside the target.

**Twelve months of sample history** (plan §48)

`prisma/sample-history.ts` reports a year of figures per branch and then runs the
real calculation service over them, so every formula metric is derived exactly as
in production. Deterministic by design — shaped by the metric code and the month
index, never by a random number — so two demonstrations show the same figures and a
screenshot can be reproduced.

**Components** (plan §22)

`FilterBar`, `KpiCard` and `SeriesChart` (the multi-series comparison chart) join
the existing set; chart animation is off, which also makes a screenshot in a test
deterministic.

## DATABASE CHANGES

**None.** Aggregation is read-time and writes nothing;
`prisma migrate diff --exit-code` confirms no drift.

The seed now also writes twelve months of sample values, targets and thresholds per
organization, and recalculates the formula metrics from them.

## API CHANGES

| Method | Route                         | Access          |
| ------ | ----------------------------- | --------------- |
| GET    | `/dashboard/overview`         | Any member role |
| GET    | `/analytics/options`          | Any member role |
| GET    | `/analytics/metric/:metricId` | Any member role |
| GET    | `/analytics/comparison`       | Any member role |

All four accept `from`, `to`, `branchId`, `departmentId`. Nothing here writes, so
there is no role split beyond membership — a viewer's whole job is to read these.

## FRONTEND CHANGES

- `features/dashboard/`: `DashboardPage`, `dashboard-api`.
- `features/analytics/`: `AnalyticsPage`.
- `components/`: `FilterBar`, `KpiCard`, `SeriesChart`; `lib/dates.ts`.
- `/dashboard` and `/analytics` routed; Overview and Analytics enabled in the
  sidebar; sign-in now lands on the dashboard rather than the system page.
- Design-system additions: filter bar, range chips, KPI cards, panel grid, warning
  badge.

## TESTS

| Suite                              | Result                                  |
| ---------------------------------- | --------------------------------------- |
| API unit (Jest)                    | 233 passed, 20 suites (+29 this sprint) |
| API integration (Jest + Supertest) | 163 passed, 10 suites (+21 this sprint) |
| Web (Vitest + Testing Library)     | 92 passed, 15 files (+16 this sprint)   |

`src/analytics/aggregation.spec.ts` (29 tests) covers the engine without a
database: the three slice levels and the roll-up rule, each aggregation type across
periods, `LAST` behaving differently on each axis, formulas recomputed rather than
averaged (including the case where the two answers differ), a formula whose input is
itself a formula, missing inputs and a zero divisor producing blanks rather than
`NaN`, a cycle read straight from the database refusing to loop, and a formula's
window widening to cover its inputs' periods.

The Sprint 6 gate is covered by `test/analytics.e2e-spec.ts`, built on figures
chosen to be checkable by hand:

- **Dashboard numbers match the backend's own calculations** — revenue sums to 900
  across two branches and three months; the same endpoint's series equals the
  metrics API's trend for the same slice, and the window figure is exactly their
  sum; a formula's inputs divide to exactly the figure shown for it.
- **Changing a filter changes every component** — a branch filter narrows the KPI
  and the headline together; a department filter uses the department's own figures;
  a narrower range moves the comparison window with it (March vs February, +50%).
- **Aggregation is correct per type** — a rate averages across branches instead of
  summing; a department's figure is not added on top of its branch.
- **Comparison reconciles** — branch rows sum to the organization total; department
  and multi-metric breakdowns return the rows asked for, in the order asked for.
- **Isolation holds** — a branch or metric from another organization is 404 on every
  route; an unauthenticated caller is 401; a viewer may read everything.
- **An empty organization reads as empty**, not as zeros, and a backwards range is
  a validation error.

Verified by hand in Chromium against the running stack: the dashboard showed five
KPI cards drawn from the hospitality health model with period-over-period changes;
filtering to Seeb Beach Resort moved every panel (OMR 2.7M → 1.2M) and said so in
words; the "Last 3 months" preset moved both the window and its comparison window;
and on the analytics page RevPAR for the range was 97.628442198403 — identical to
revenue ÷ available rooms computed from the same response, and sitting between the
two branches' 95.776 and 100.155, which is what a correct weighted roll-up must do.

## SECURITY CHECKS

- Every query is scoped by `organizationId` from the session; a branch, department
  or metric id from another tenant resolves to `NOT_FOUND` before any figure is
  computed.
- Filters are Zod-validated (ISO dates, UUIDs, ordered range, at most six metric
  ids); unknown query keys are stripped by the pipe.
- The endpoints are read-only — no route in this sprint writes anything.
- Formula evaluation reuses the Sprint 4 parser: still parsed, never executed
  (ADR-0008), and inputs resolve only within the caller's organization.
- The comparison endpoint's slice list is built from the caller's own branches and
  departments, so a slice cannot be named from outside.
- No new dependencies.

## KNOWN LIMITATIONS

1. **A window read loads the organization's values for that window.** No rollup
   tables by design (ADR-0010). Fine at MVP volumes and served by the existing
   `(organization_id, period_start)` index; materialised rollups remain available
   later if a tenant's volume demands them.
2. **Health scores are absent.** The model is displayed with weights and no score
   until Sprint 7 calculates one.
3. **Alerts, insights, goals and decisions panels are empty** — they read the real
   tables, and the engines that write to them are Sprints 7 and 8.
4. **Mixed frequencies in one window are aggregated by period start**, not
   normalised. An organization reporting one metric monthly and another quarterly
   gets correct figures for each but a chart with different point counts.
5. **No saved views, no export, no scheduled reports** — plan §35 puts reports in
   Sprint 10.
6. **Comparison covers branches, departments and metrics**, not arbitrary period
   pairs (this quarter vs the same quarter last year). The range picker can express
   it manually; a preset for it belongs with reports.
7. **The web bundle is 1.6 MB (520 kB gzipped)** — ECharts is still imported
   eagerly. Code-splitting the charts is a Sprint 10 task.
8. **Docker images still unverified locally** (no Docker daemon in this container);
   CI builds them.

## FILES CHANGED

```text
API      src/analytics/{aggregation,aggregation.spec,analytics.service,
                        dashboard.service,analytics.controller,analytics.dto,
                        analytics.module}.ts
         src/app.module.ts, src/data-quality/data-quality.module.ts
         prisma/{seed,sample-history}.ts
         test/analytics.e2e-spec.ts
Web      src/features/dashboard/{DashboardPage,dashboard-api}.ts(x) (+ test)
         src/features/analytics/AnalyticsPage.tsx (+ test)
         src/components/{FilterBar,KpiCard,SeriesChart,TrendChart}.tsx
         src/lib/dates.ts, src/test-utils.tsx
         src/app/App.tsx, src/components/AppShell.tsx,
         src/features/auth/LoginPage.tsx, src/styles/global.css
Shared   packages/shared-types/src/analytics.ts, src/index.ts
Docs     docs/decisions/0010-read-time-aggregation.md, docs/analytics.md,
         docs/{api,architecture,database,current-state,implementation-checklist}.md,
         docs/sprints/sprint-6.md, README.md
```

## ACCEPTANCE CRITERIA

| Criterion                                                  | Status                                                                                |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Dashboard numbers match backend calculations exactly       | ✅ Asserted against the metrics API's own trend, and by hand in the browser           |
| Changing the date filter changes every dashboard component | ✅ One request answers the screen; branch, department and range all tested            |
| KPI cards, trend charts, period comparison                 | ✅ Cards from the health model, trend vs previous range, branch/department breakdowns |
| Metric detail analytics with related metrics               | ✅ Inputs, dependants and category peers, each aggregated the same way                |
| Branch and department filtering                            | ✅ Including the roll-up rules that make the totals reconcile                         |

## NEXT SPRINT

**Sprint 7 — Health, Alerts and Insights.**

- Health score engine: normalise each metric against its target, thresholds and
  direction; weight by category; store the score with a breakdown that explains it.
- Alert generation from the rules the packs already installed, with status workflow
  (open → acknowledged → resolved) and every alert carrying its evidence.
- Insight evaluation from the deterministic rules already installed, each insight
  citing the figures that produced it.
- Frontend: health card on the dashboard with real scores, alerts list with
  acknowledgement, insights feed.
- Gate before Sprint 8: a health score can explain itself metric by metric, an alert
  fires exactly when its rule says so and never twice for the same period, an
  insight without evidence cannot be created, and nothing generated by any of the
  three crosses a tenant boundary.

```

```
