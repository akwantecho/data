# Sprint 4 Completion Report

```text
SPRINT: 4 — Metrics Engine
STATUS: COMPLETE — all acceptance criteria met, all blocking tests pass
```

## IMPLEMENTED

**Metric definitions** (plan §17)

- CRUD over tenant-owned metrics: code, name, description, category, unit
  (`CURRENCY`, `PERCENTAGE`, `NUMBER`, `RATIO`, `COUNT`, `SCORE`, `DAYS`, `HOURS`),
  aggregation type, frequency, direction (`HIGHER_IS_BETTER` / `LOWER_IS_BETTER` /
  `NEUTRAL`), active flag.
- `code` is unique per organization and immutable after creation — imports, formulas
  and future insight rules all key on it, so renaming it would silently orphan them.
- A metric with stored values is deactivated rather than deleted; deleting it would
  cascade its history away. The service returns `CONFLICT` and says so.
- System metrics (installed later by an industry pack) cannot be edited or deleted by
  a tenant; the flag exists now so Sprint 5 has somewhere to land.

**Formulas and the dependency graph** (plan §18, ADR-0008)

A calculated metric carries an expression over other metric codes:
`net_profit / revenue * 100`.

- **Parsed, never evaluated.** Tokeniser plus recursive-descent parser producing an
  AST; `eval` and `new Function` appear nowhere. Numbers, metric codes, `+ - * /`,
  brackets and unary minus are the entire grammar — anything else is a parse error.
- **Decimal arithmetic** throughout (`Prisma.Decimal`), the same representation the
  values are stored in, so a derived figure never disagrees with its inputs.
- **Validated at save time**: unknown metric codes are named, a metric cannot
  reference itself, and cycles are refused with the loop spelled out
  (`a → b → c → a`). Referenced codes are stored as `metric_dependencies` rows, so
  the graph is queryable and "what breaks if I change this" is answerable.
- **Topologically ordered** at run time, so a formula reading another calculated
  metric sees the fresh value in the same pass.

**Calculation** (plan §19)

- Evaluated **per slice**: one period and one branch/department combination, using
  only values from that same slice. A branch's margin uses that branch's revenue.
- **Missing input** and **division by zero** are typed results, not exceptions. The
  slice produces no value and the run records a skip naming the metric, the period
  and the reason. One unusable slice never abandons the run, and `NaN`/`Infinity` is
  never stored.
- **Replace, never accumulate.** A run deletes the calculated values in its scope and
  writes the new ones in a single transaction. A targeted run (after an import or a
  manual entry) is scoped to the touched periods; a full run replaces everything for
  those metrics — which is what makes a withdrawn input remove the value derived
  from it.
- Triggered automatically after an import commit, after a manual value is recorded,
  and on demand from the metrics page.

**Targets, thresholds and history** (plan §20, §25)

- One target per metric, period and branch, with optional min/max band.
- Warning and critical thresholds, absolute or expressed relative to the target,
  interpreted through the metric's direction — for a `LOWER_IS_BETTER` metric a value
  _above_ the threshold is the breach.
- Metric detail returns current value, previous value, percentage change, variance to
  target, threshold status, the dependency and dependent lists, and a trend series.
  Every one of those numbers is computed on the server; the UI formats, it does not
  calculate (plan §5).

**Manual entry** (plan §2, closing Sprint 3's limitation #2)

A single value entered by hand goes through the same period parsing and the same
validation rules as an imported row — frequency must match, the value must parse,
percentages and counts are range-checked — and is stored with
`source_type = MANUAL`. Calculated metrics refuse manual entry outright.

**Frontend**

- `/metrics` — catalogue grouped by category, showing unit, frequency, direction,
  latest value and value count, with a **Recalculate** action that reports what was
  written and what was skipped.
- Create/edit dialog with live formula help: available metric codes are listed, and
  the server's parse error (`Unknown metric: made_up_thing`) is shown against the
  formula field.
- `/metrics/:id` — the plan §25 layout: header with current value and change, target
  and variance, threshold status badge, ECharts trend with the target as a marker
  line, formula and dependencies for calculated metrics, and dialogs for value,
  target and thresholds.
- Values are formatted in the organization's own currency through `Intl.NumberFormat`,
  at that currency's precision — OMR renders three decimals, not two (plan §10).

## DATABASE CHANGES

**None.** The Sprint 0 model already carried `metrics`, `metric_formulas`,
`metric_dependencies`, `metric_values`, `metric_targets` and `metric_thresholds`,
including `source_type` and `is_calculated`.
`prisma migrate diff --exit-code` confirms no drift.

The seed is unchanged from Sprint 3 (four universal metrics per organization); a
calculated metric is created through the UI or the API rather than seeded, so the
formula path is exercised the way a user would exercise it.

## API CHANGES

| Method | Route                    | Access                          |
| ------ | ------------------------ | ------------------------------- |
| GET    | `/metrics`               | Any member role                 |
| GET    | `/metrics/:id`           | Any member role                 |
| GET    | `/metrics/:id/trend`     | Any member role                 |
| POST   | `/metrics`               | `ORGANIZATION_ADMIN`, `ANALYST` |
| PATCH  | `/metrics/:id`           | `ORGANIZATION_ADMIN`, `ANALYST` |
| DELETE | `/metrics/:id`           | `ORGANIZATION_ADMIN`            |
| POST   | `/metrics/recalculate`   | `ORGANIZATION_ADMIN`, `ANALYST` |
| POST   | `/metrics/:id/values`    | `ORGANIZATION_ADMIN`, `ANALYST` |
| PUT    | `/metrics/:id/target`    | `ORGANIZATION_ADMIN`, `ANALYST` |
| PUT    | `/metrics/:id/threshold` | `ORGANIZATION_ADMIN`, `ANALYST` |

`POST /metrics/recalculate` is declared before `GET /metrics/:id` so the literal
path is not swallowed by the parameter route.

## FRONTEND CHANGES

- `features/metrics/`: `MetricsPage`, `MetricDetailPage`, `MetricDialog`,
  `metrics-api`.
- `features/organization/organization-context.ts`: `useOrganization()`, the source of
  the currency used for formatting.
- `components/TrendChart.tsx`: ECharts line chart reading the design tokens, with an
  optional target marker line.
- `lib/format.ts`: `formatMetricValue`, `formatChange`, `changeTone` — unit-aware
  and currency-aware formatting in one place.
- Sidebar and routes now include Metrics; design-system additions for the detail
  header, stat blocks and status badges.

## TESTS

| Suite                              | Result                                  |
| ---------------------------------- | --------------------------------------- |
| API unit (Jest)                    | 180 passed, 17 suites (+38 this sprint) |
| API integration (Jest + Supertest) | 124 passed, 8 suites (+32 this sprint)  |
| Web (Vitest + Testing Library)     | 67 passed, 11 files (+11 this sprint)   |

`src/metrics/formula/formula.spec.ts` (25 tests) covers the engine without a
database: tokenising and precedence, brackets and unary minus, decimal precision
(`0.1 + 0.2`), unknown symbols, `process.exit(1)` and `revenue; DROP TABLE metrics`
both rejected as parse errors, missing inputs and division by zero as typed results,
dependency collection, topological ordering and cycle detection.

`src/metrics/metrics.service.spec.ts` covers the pure helpers — percentage change
(including from zero and from nothing), variance to target, and threshold evaluation
in both directions, absolute and relative to target.

The Sprint 4 gate is covered by `test/metrics.e2e-spec.ts`:

- **Metrics calculate server-side** — a formula metric created through the API
  produces `metric_values` rows with `is_calculated = true` and
  `source_type = CALCULATED`, after an import commit and after a manual entry.
- **Dependency order is safe** — a metric whose formula reads another calculated
  metric gets the fresh value in the same run (chained `net_profit` → `net_margin`),
  and a cycle is refused at save time with the loop named.
- **Division by zero and missing dependencies are handled** — both produce no value
  and a skip carrying the metric code, the period start and the reason; the rest of
  the run still writes.
- **Historical values are stored correctly** — several periods calculate
  independently, each against its own period's inputs, with the right period end.
- **Withdrawing an input removes what was derived from it** — the test that caught a
  real bug: when every input for a period disappears there is no slice to scope a
  delete to, so a full run now replaces wholesale.
- **Isolation holds** — metrics, values, targets, thresholds, trend and detail all
  404 across organizations; a formula cannot reference another tenant's metric code;
  recalculation touches only the caller's organization (asserted with a dedicated
  organization fixture so the shared seed cannot mask it).
- Also: immutable code, deactivate-instead-of-delete, viewer refused on every write
  route, manual entry refused on calculated metrics, frequency mismatch rejected.

Verified by hand in Chromium against the running stack: created `net_profit`
(`revenue - expenses`) and the chained `net_margin` (`net_profit / revenue * 100`)
through the UI, watched a bad formula refused with
`formula: Unknown metric: made_up_thing`, entered revenue 128,400 and expenses 98,750
by hand, and confirmed the results in PostgreSQL —

```text
expenses   |  98750.000000 | f | MANUAL
net_margin |     23.091900 | t | CALCULATED
net_profit |  29650.000000 | t | CALCULATED
revenue    | 128400.000000 | f | MANUAL
```

## SECURITY CHECKS

- **Formulas are parsed, never executed.** No `eval`, no `new Function`, no dynamic
  import; the grammar admits nothing that could reach the runtime. Asserted by test
  with both a JavaScript payload and a SQL payload.
- Formula references resolve only against metrics in the caller's organization, so a
  formula cannot read another tenant's figures.
- Every metric query is scoped by `organizationId`; a metric id alone resolves
  nothing (asserted on all ten routes).
- `organizationId` is taken from the session, never from the request body — the Zod
  pipe strips unknown keys, so a client-supplied one cannot survive.
- Writes are `ORGANIZATION_ADMIN`/`ANALYST`; deletion is admin-only; viewers are
  refused on every mutation.
- Create, update, delete, manual entry, target, threshold and recalculation are all
  audited with before/after.
- Recalculation is transactional: a run either replaces its scope or changes nothing.
- Skip lists are capped (100 entries) so a pathological run cannot return an
  unbounded response.

## KNOWN LIMITATIONS

1. **Formulas cannot aggregate across periods or slices.** `sum of the last 12
months` and `organization total rolled up from branches` are not expressible.
   Those are read-time analytics and belong with the dashboard in Sprint 6 (ADR-0008).
2. **A full recalculation reads every stored value for the organization.** Fine at
   MVP volumes, and already narrowed to the touched periods after an import; a
   metric-level dependency filter is the next optimisation if it is ever needed.
3. **Recalculation is synchronous**, like the import commit. Same asynchronous-ready
   shape, same absent queue.
4. **One target per metric/period/branch, no department-level targets.** The column
   exists; the API does not expose it yet because nothing consumes it.
5. **Thresholds are single-valued** (warning, critical) rather than banded ranges;
   health bands in Sprint 7 are the richer model.
6. **No metric value history/audit view in the UI.** Values are versioned in the
   audit log but the detail page shows the trend, not who changed what.
7. **The web bundle is now 1.58 MB (516 kB gzipped)**, up from 0.9 MB: ECharts is
   imported eagerly. Code-splitting the chart behind a dynamic import is a Sprint 10
   task, when the dashboard has settled which charts it actually needs.
8. **Docker images still unverified locally** (no Docker daemon in this container);
   CI builds them.

## FILES CHANGED

```text
API      src/metrics/{metrics.controller,metrics.service,metrics.module,metrics.dto,
                      calculation.service}.ts
         src/metrics/formula/{formula,formula.spec}.ts
         src/metrics/metrics.service.spec.ts
         src/imports/{imports.service,imports.module}.ts  (recalculate after commit)
         src/app.module.ts
         test/metrics.e2e-spec.ts
Web      src/features/metrics/{MetricsPage,MetricDetailPage,MetricDialog,
                               metrics-api}.ts(x) (+ MetricDetailPage.test.tsx)
         src/features/organization/organization-context.ts
         src/components/TrendChart.tsx, src/lib/format.ts
         src/app/App.tsx, src/components/AppShell.tsx, src/styles/global.css
Shared   packages/shared-types/src/metrics.ts, src/enums.ts, src/index.ts
Docs     docs/decisions/0008-formula-engine.md, docs/{api,architecture,database,
         current-state,implementation-checklist}.md, docs/sprints/sprint-4.md, README.md
```

## ACCEPTANCE CRITERIA

| Criterion                              | Status                                                          |
| -------------------------------------- | --------------------------------------------------------------- |
| Metrics calculate server-side          | ✅ Formula engine in the API; the UI only formats               |
| Dependency order is safe               | ✅ Topological ordering; cycles refused at save time and at run |
| Division by zero handled               | ✅ Typed result → skip with a reason, no value stored           |
| Missing dependencies handled           | ✅ Same, naming the missing input and the period                |
| Historical values are stored correctly | ✅ Per period and per slice, with the right period end          |
| Formula tests cover them               | ✅ 25 unit tests plus the integration gate above                |
| Organization isolation passes          | ✅ Every route, plus formula resolution and recalculation scope |

## NEXT SPRINT

**Sprint 5 — Industry Packs.**

- Pack definition as data: template metrics, health model, insight rules, versioned.
- Installation into an organization — clone templates, materialise the model, record
  what was installed at which version.
- The three MVP packs: Healthcare, Hospitality/Tourism, Real Estate, each with the
  metrics the plan lists (§28–§30).
- Organization customization on top of an installed pack: rename, reweight, disable,
  add tenant-owned metrics alongside.
- Frontend: pack browser, install flow, installed-pack management.
- Gate before Sprint 6: a pack installs cleanly into a fresh organization, its metrics
  behave exactly like tenant-owned ones (formulas, targets, thresholds, calculation),
  customization survives, and no pack data leaks between tenants.

```

```
