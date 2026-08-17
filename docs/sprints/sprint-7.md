# Sprint 7 Completion Report

```text
SPRINT: 7 — Health, Alerts and Insights
STATUS: COMPLETE — all acceptance criteria met, all blocking tests pass
```

## IMPLEMENTED

**The health score engine** (plan §26, ADR-0011)

Weighted two levels deep — metrics inside a category, categories into an overall
score — and every point traceable to a number the organization itself set.

- A metric is scored against **its own target and thresholds**: the target scores
  100, the warning line 60, the critical line 25, with a floor beneath the worst of
  them and linear interpolation between. Direction decides which side is good, so a
  no-show rate above its critical line scores the same 25 a revenue figure below its
  own would.
- Beating a target scores 100 and no more. Health is "are we where we said we would
  be", not a leaderboard.
- A metric with **nothing to be measured against is excluded** and its weight
  redistributed across what could be scored — scoring it zero would punish an
  organization for not having set a target yet, and ignoring its weight would
  silently cap the score below 100. The response says how many that happened to.
- The stored `breakdown` carries every category and every metric with its value,
  target, score, basis and contribution, so a score can be walked down to something
  someone can change. The UI does exactly that: **Why** on any category opens the
  metrics behind it.
- Bands are the organization's own (`health_models.bands`), defaulting to the plan's
  80/60/40 split.

**The alerts engine** (plan §27)

Rules installed by the industry pack (or by the tenant) evaluated against a period,
with six rule types: above/below threshold, large period change, target missed,
stale data source, degraded data quality.

- Every alert carries a **statement and the figures behind it**. A threshold rule
  reads the metric's own warning and critical values, so retuning a threshold
  retunes the alert; a breach of the critical line raises the severity above
  whatever the rule was configured with.
- **Idempotent**: one alert per rule, metric and period. Re-running after every
  import cannot fill the list with copies.
- **Self-resolving**: when a condition no longer holds, the engine resolves the
  alert itself with an event saying so, and the dashboard stops showing a problem
  that has gone away.
- **Live figures**: while an alert is open, a corrected month refreshes its numbers.
  An alert someone has resolved or dismissed is never rewritten or reopened — that
  was a decision.
- Status workflow `OPEN → ACKNOWLEDGED → RESOLVED | DISMISSED`, every transition
  recorded with its actor and note, and audited.

**The insight engine** (plan §28)

Deterministic rules over the same figures the dashboard shows.

- An insight is written **only when every condition holds**, and always in one
  transaction with one evidence row per figure it quotes.
- A rule that reads a figure which does not exist **does not fire at all** — an
  assertion built on a missing number is an assertion about nothing.
- Each evidence row records which condition it satisfied (measure, operator,
  threshold, actual), so the reasoning is legible afterwards: the UI renders it as
  "change pct above 10".
- No model is consulted anywhere. The AI layer in Sprint 9 explains what these
  engines found; it does not detect (ADR-0005).

**One motion, as the plan describes it** (plan §49)

An import commit now runs health, then alerts, then insights for the periods it
touched. Verified end to end: importing a month of worse figures moved the health
score from 67.29 to 29.15, raised three alerts including the no-show breach, and
generated the insights that explain it — from a single commit. A failure in the
analysis is logged and never undoes the import: the values are the record, the
analysis is derived.

**Two fixes the engines forced**

- **The engines read through the analytics layer.** The first implementation read
  `metric_values` directly and scored nothing, because every value in a seeded
  organization lives at branch level. A rule that reached a different number from
  the screen it points at would be worse than one that reads nothing, so all three
  now use the Sprint 6 aggregation — branch roll-ups and formulas recomputed from
  inputs included.
- **A target stands until it is replaced.** Requiring a target row per period meant
  every newly imported month arrived with nothing to be judged against. A target now
  applies forward from the period it was set until a later one replaces it, which is
  additive to Sprint 6's rule rather than a change to it: a target set in March still
  says nothing about January.

**Frontend**

- The dashboard's health placeholder is now the real panel: score, band, movement
  against the previous period, categories with their effective weights, and **Why**
  on each one.
- `/alerts` — filter by status, evidence in a drawer, acknowledge/resolve/dismiss
  with a note, and the full transition history. A viewer reads but does not decide.
- `/insights` — the narrative each rule was written with, and the figures that made
  it true, each linked to its analytics.
- `Drawer` joins the component library (plan §22).

## DATABASE CHANGES

**None.** The Sprint 0 model already carried `health_models`, `health_categories`,
`health_metric_weights`, `health_scores`, `alerts`, `alert_events`, `insights` and
`insight_evidence`, and Sprint 5 added `alert_rules.code`.
`prisma migrate diff --exit-code` confirms no drift.

The seed's final month is now deliberately mixed — volume up while revenue slips,
waiting times climbing as retention falls — and every metric the health model weighs
gets a target and thresholds. Without something having gone wrong there is nothing
for these three engines to demonstrate. Branch figures are also split by the
metric's aggregation type now, so a seeded target and a seeded value are on the same
scale.

## API CHANGES

| Method | Route                        | Access                          |
| ------ | ---------------------------- | ------------------------------- |
| GET    | `/health/current`            | Any member role                 |
| GET    | `/health/history`            | Any member role                 |
| POST   | `/health/recalculate`        | `ORGANIZATION_ADMIN`, `ANALYST` |
| POST   | `/analysis/run`              | `ORGANIZATION_ADMIN`, `ANALYST` |
| GET    | `/alerts`, `/alerts/:id`     | Any member role                 |
| PATCH  | `/alerts/:id/status`         | `ORGANIZATION_ADMIN`, `ANALYST` |
| GET    | `/insights`, `/insights/:id` | Any member role                 |

`GET /health` remains the public liveness probe: two controllers share the prefix,
no paths overlap, and a test asserts the probe still answers without a session and
still carries no tenant data.

## FRONTEND CHANGES

- `features/health/`: `HealthPanel`, `AlertsPage`, `InsightsPage`, `health-api`.
- `components/Drawer.tsx`; `DashboardPage` renders the real health panel and links
  its attention panels to the new pages.
- Routes and navigation gain `/alerts` and `/insights`.
- Design-system additions: health score display, drawer and scrim.

## TESTS

| Suite                              | Result                                  |
| ---------------------------------- | --------------------------------------- |
| API unit (Jest)                    | 308 passed, 23 suites (+75 this sprint) |
| API integration (Jest + Supertest) | 185 passed, 11 suites (+22 this sprint) |
| Web (Vitest + Testing Library)     | 110 passed, 18 files (+18 this sprint)  |

Unit tests cover the three pure engines. Scoring (35 tests): a target hit, beaten
and half-missed; thresholds alone and with a target; relative thresholds resolved
against the target and ignored without one; a threshold on the good side of the
target dropped rather than inverting the scale; lower-is-better read from the other
side; ranges penalised equally above and below; informational metrics never scored;
weight redistribution; and bands, including an organization's own. Alert rules (24):
every rule type firing and staying quiet, severity raised on a critical breach, and
an assertion that everything which fires carries a statement, figures, a title and a
description. Insight rules (16): every operator and measure, a rule that cannot fire
because a metric is missing or has no figure, and a schema that refuses a rule with
no evidence or no conditions.

The Sprint 7 gate is covered by `test/health-alerts-insights.e2e-spec.ts`:

- **Every alert explains itself** — statement, figures, description and period
  asserted on every alert the engine produced; revenue at 900 against a target of
  1200 scores 75 and says so.
- **Every insight explains itself** — evidence for each quoted figure, with the
  condition it satisfied; patients +20% and revenue per patient −25% are the numbers
  in the row.
- **Nothing fires twice** — a second run creates nothing; one alert per rule and
  period, one insight per rule and period.
- **An alert resolves itself** when the condition passes, with an event saying so,
  and **refreshes its figures** when the month is corrected.
- **A closed alert stays closed** — reopening is a `CONFLICT`.
- **The workflow is recorded** with actor and note on every transition.
- **Isolation holds** — another organization sees no alerts, no insights and no
  score; its ids 404 on read and on status change; an organization with no rules or
  model generates nothing.
- **The liveness probe is unaffected** by organizational health sharing its prefix.

Verified by hand in Chromium: the health panel showing 67.29 ATTENTION across five
categories, **Why** opening Patient Experience down to Patient Retention 63.38
against 68.05 scoring 50.69 and the note that one weighted metric could not be
scored; the alerts list, its evidence drawer, an acknowledgement recorded as
"OPEN → ACKNOWLEDGED · Organization Admin · Clinic manager is reviewing scheduling";
a viewer offered only "Close"; and the insights feed carrying the plan's own
examples with their figures.

## SECURITY CHECKS

- Every query is scoped by `organizationId` from the session; alert and insight ids
  from another tenant are `NOT_FOUND` on read and on status change.
- The status route is `ORGANIZATION_ADMIN`/`ANALYST`; a viewer reading alerts is
  refused the transition, in the API and in the UI.
- Rule definitions are re-validated when read: a rule that no longer parses is
  skipped rather than acted on.
- Nothing in this sprint accepts free-form text that reaches an engine — rules come
  from stored definitions, and the only user input is a status and a note, both Zod
  validated.
- Every status change is audited with before/after.
- The `/health` liveness probe remains public and tenant-free, asserted by test.
- No new dependencies.

## KNOWN LIMITATIONS

1. **Health scores are stored at organization level only.** The engine accepts a
   branch and the table has the column; per-branch history is a small extension, not
   a redesign, but it is not written today.
2. **No UI for editing health weights, bands or rules.** They arrive from the
   industry pack and are inspectable; editing them is a Phase 2 item the plan does
   not schedule.
3. **No alert notifications.** Alerts appear in the product; email and webhooks are
   explicitly out of MVP scope (plan §3).
4. **Insights are not re-evaluated after a correction.** An insight records what was
   noticed at the time; alerts are the live signal. Deliberate (ADR-0011), but it
   does mean a corrected month can leave an insight whose figures have moved.
5. **The engines run over the latest period, or the periods an import touched.**
   Backfilling a year of alerts and insights means re-importing those periods.
6. **`DATA_SOURCE_STALE` and `DATA_QUALITY_DEGRADED` rules are implemented and
   tested but not shipped in any pack**, because a sensible staleness window is
   organization-specific. They can be created directly.
7. **Docker images still unverified locally** (no Docker daemon in this container);
   CI builds them.

## FILES CHANGED

```text
API      src/organization-health/{scoring,scoring.spec,organization-health.service,
                                  organization-health.controller,organization-health.dto,
                                  organization-health.module}.ts
         src/alerts/{alert-rules,alert-rules.spec,alerts.service,alerts.controller,
                     alerts.dto,alerts.module}.ts
         src/insights/{insight-rules,insight-rules.spec,insights.service,
                       insights.controller,insights.dto,insights.module}.ts
         src/analysis/{analysis.service,analysis.controller,analysis.module}.ts
         src/analytics/analytics.service.ts (single-period context, targets in force)
         src/imports/{imports.service,imports.module}.ts (analysis after commit)
         src/app.module.ts, prisma/sample-history.ts
         test/health-alerts-insights.e2e-spec.ts
Web      src/features/health/{HealthPanel,AlertsPage,InsightsPage,health-api}.ts(x)
                             (+ tests for all three screens)
         src/components/Drawer.tsx
         src/features/dashboard/DashboardPage.tsx (+ test), src/app/App.tsx,
         src/components/AppShell.tsx, src/styles/global.css
Shared   packages/shared-types/src/health.ts, src/index.ts
Docs     docs/decisions/0011-health-alerts-insights.md, docs/{api,architecture,
         database,current-state,implementation-checklist}.md, docs/sprints/sprint-7.md,
         README.md
```

## ACCEPTANCE CRITERIA

| Criterion                                              | Status                                                                   |
| ------------------------------------------------------ | ------------------------------------------------------------------------ |
| Every generated alert can explain why it was created   | ✅ Statement, figures, description and period on every alert, asserted   |
| Every generated insight can explain why it was created | ✅ One evidence row per quoted figure, each naming the condition it met  |
| No unexplained AI-based generation                     | ✅ No model anywhere; rules are stored definitions, re-validated on read |
| Health model, category weights, calculator, bands      | ✅ Weighted two levels, configurable bands, full breakdown stored        |
| Alert status workflow                                  | ✅ Recorded with actor and note; closed alerts cannot be reopened        |

## NEXT SPRINT

**Sprint 8 — Goals and Decision Center.**

- Goals linked to metrics, with automatic progress from the primary metric and a
  `goal_updates` history that survives recalculation.
- Decisions with the evidence that prompted them — metrics, alerts, insights, goals —
  and actions with owners and due dates.
- Decision review against the expected outcome, which is what turns the product into
  an organizational learning loop rather than a reporting tool.
- Frontend: goals list and detail, decision centre, decision detail with evidence,
  review flow.
- Gate before Sprint 9: a goal's progress matches its metric exactly, a decision
  cannot be created without the evidence it cites, a review records what actually
  happened against what was expected, and nothing crosses a tenant boundary.

```

```
