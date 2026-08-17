# Sprint 8 Completion Report

```text
SPRINT: 8 — Goals and Decision Center
STATUS: COMPLETE — all acceptance criteria met, all blocking tests pass
```

## IMPLEMENTED

**Goals that maintain themselves** (plan §29, ADR-0012)

A metric-linked goal is never updated by hand. The metric already says where the
organization is; the goal says where it meant to be, and everything else is derived
from the two.

- **Progress is measured from the baseline**, not from zero: lifting revenue from 400
  to 500 is half done at 450, not 90% done. Direction falls out of the arithmetic —
  bringing a no-show rate from 12 down to 8 has a negative span, and 10 is still half
  way — so there is no separate downward code path to get wrong.
- The current value is read **through the analytics engine over the goal's own
  window** (ADR-0010), so a goal's progress is the same figure the dashboard would
  show for that range. If the two could disagree, one of them would be wrong and
  nobody could say which.
- **The system owns the status; a person owns the intent.** `DRAFT` and `CANCELLED`
  are left exactly as someone set them. `ON_TRACK`, `AT_RISK`, `OFF_TRACK` and
  `ACHIEVED` are claims about how the goal is going: progress is compared with where
  the calendar says it should be, and a lag of ten points or less is on track,
  twenty-five or less is at risk, more than that is off track.
- A goal can **un-achieve itself**. One that reached its target and slipped back is
  reported on the figures that hold now.
- A recalculation that changes nothing **writes nothing**. A history row is appended
  only when the value, the progress or the status actually moved, and the row says
  which — otherwise every import would bury the moments that mattered under identical
  entries.
- Deleting a goal a decision cites is **refused**, not cascaded. Cancelling keeps the
  goal and its history.

**The decision centre** (plan §30)

One screen for everything competing for management attention, in the order the plan
sets: critical issues, warnings, opportunities, open decisions, recently reviewed —
plus goals that have fallen behind. It is a read over what the engines already
produced; nothing is recalculated here.

- Every item carries straight into a decision with **itself as the evidence** —
  "Decide on this" opens the dialog with that alert or insight already cited.
- **Opportunities are insights of `INFO` severity**: the packs use that severity for
  observations that are favourable rather than alarming, so the section needs no
  second detector and no separate definition of what an opportunity is. One
  opportunity rule was added to each MVP pack for this.

**Decisions that cannot exist without evidence** (plan §31)

- Creating a decision requires at least one metric, alert, insight or goal, and an
  edit **cannot remove the last one**. This is not paperwork: a decision recorded
  without the figures that prompted it cannot be reviewed later, because there is
  nothing to review it against.
- Every referenced record is checked to **belong to the caller's organization** before
  it is linked, so a decision can never cite — or leak the title of — another tenant's
  alert.
- Actions record what someone will actually do and whether it is done.

**Reviews judged against the expectation as it stood** (plan §32)

- Recording a review **copies the decision's expected outcome onto it**, so later
  edits to the decision cannot rewrite what the review was judged against. Reviews
  accumulate; none is ever replaced.
- Reviewing a `DRAFT` decision is refused — a decision that has not been taken cannot
  have turned out any way yet.
- Create, edit, action and review all write to the audit log with actor and
  before/after.

**Goals wired into the analysis run**

`POST /analysis/run` and every import commit now run health → alerts → insights →
goals. Goals are refreshed **once per run rather than once per period**, because a
goal spans its own window rather than a reporting period; the response shape changed
from an array to `{ periods, goals }` to say so honestly.

**Seed data (plan §48, §49)**

The seed now runs the real analysis stack over the twelve months it reports, then
sets goals and a decision on top of what that produced — so a fresh database
demonstrates the §49 story without anyone importing anything first. Every figure is
derived from the seeded history rather than invented: a cumulative goal targets a
year's worth of the metric's own monthly average uplifted by its ambition, and a rate
goal starts from wherever the rate stood when its window opened. The window runs six
reported months behind and six ahead, so goals arrive genuinely mid-flight — on the
seeded data Alpha Medical Group's revenue goal reads 43.56% against 46.43% expected
(on track) while its retention goal reads 0% (off track), which is the plan's "goal
becomes at risk" step.

## DATABASE CHANGES

None. The `goals`, `goal_metrics`, `goal_updates`, `decisions`, `decision_actions`,
`decision_metrics`, `decision_alerts`, `decision_insights`, `decision_goals` and
`decision_reviews` tables were all created in the Sprint 0 baseline migration and are
used as designed. `prisma migrate diff --exit-code` reports no difference between the
migrations and the schema.

## API CHANGES

| Method   | Route                                       | Roles              |
| -------- | ------------------------------------------- | ------------------ |
| `GET`    | `/api/goals`                                | any member         |
| `GET`    | `/api/goals/:id`                            | any member         |
| `POST`   | `/api/goals`                                | admin, analyst     |
| `PATCH`  | `/api/goals/:id`                            | admin, analyst     |
| `DELETE` | `/api/goals/:id`                            | admin, analyst     |
| `POST`   | `/api/goals/:id/notes`                      | admin, analyst     |
| `POST`   | `/api/goals/recalculate`                    | admin, analyst     |
| `GET`    | `/api/decisions`                            | any member         |
| `GET`    | `/api/decisions/centre`                     | any member         |
| `GET`    | `/api/decisions/:id`                        | any member         |
| `POST`   | `/api/decisions`                            | admin, analyst     |
| `PATCH`  | `/api/decisions/:id`                        | admin, analyst     |
| `POST`   | `/api/decisions/:id/actions`                | admin, analyst     |
| `PATCH`  | `/api/decisions/:id/actions/:actionId`      | admin, analyst     |
| `DELETE` | `/api/decisions/:id/actions/:actionId`      | admin, analyst     |
| `POST`   | `/api/decisions/:id/review`                 | admin, analyst     |

Changed: `POST /api/analysis/run` now returns `{ periods, goals }` rather than a bare
array, so the goal recalculation it performs is reported rather than hidden.

## FRONTEND CHANGES

- **`/goals`** — every goal with its progress bar, the pace the calendar expects
  marked on the same bar, status filters that query the API rather than the browser,
  and a dialog for setting one. Figures are formatted with the linked metric's own
  unit and the organization's currency.
- **`/goals/:id`** — baseline, current, target, window and time left; the full
  history of every automatic recalculation and hand-written note with who made it;
  the decisions citing the goal; and cancel/delete with the conflict surfaced.
- **`/decisions`** — the decision centre, with "Decide on this" on every item.
- **`/decisions/:id`** — where the decision stands, its evidence in one table with
  every item linked back to its own record, its actions, and the review form.
- **Dashboard** — a "Goal performance" panel, and "Decisions needing attention" now
  links to the centre.
- Navigation: Goals and Decision Center are no longer placeholders.

## TESTS

| Suite                                    | Result                              |
| ---------------------------------------- | ----------------------------------- |
| `pnpm -r lint`                           | clean                               |
| `pnpm -r typecheck`                      | clean                               |
| `pnpm -r build`                          | API, web and shared types all build |
| API unit (`pnpm --filter @sip/api test`) | 329 passed (24 suites)              |
| Web (`pnpm --filter @sip/web test`)      | 131 passed (21 files)               |
| API integration (`test:e2e`)             | 207 passed (12 suites)              |
| `prisma migrate diff --exit-code`        | no difference                       |

New this sprint:

- `goal-progress.spec.ts` — 21 unit tests over the pure arithmetic: measurement from
  the baseline, downward goals, clamping at both ends, calendar pace, the status
  ladder, and the cases with nothing to judge.
- `goals-decisions.e2e-spec.ts` — 22 integration tests against real PostgreSQL. The
  goal arithmetic is asserted to the digit (revenue summing to 2,700 over the window,
  57.5% of a 4,000 climb, 90% after another month is reported), a recalculation that
  changes nothing writes no history row, a foreign metric is refused, a viewer is
  refused, another tenant sees nothing, evidence cannot be edited away, a refused edit
  leaves the record untouched, a review keeps the expectation it was judged against
  after the decision is edited, a `DRAFT` decision cannot be reviewed, a cited goal
  cannot be deleted, and the audit log carries every one of those transitions with its
  actor.
- `GoalsPage.test.tsx` (8) and `DecisionCentrePage.test.tsx` (6),
  `DecisionDetailPage.test.tsx` (7).

## SECURITY CHECKS

- Every goal and decision query is scoped by `organizationId` taken from the session,
  never from the request body. Cross-tenant reads return 404, and the integration
  suite asserts it for goals, decisions and the centre.
- **Evidence references are validated against the caller's organization** before they
  are linked. Without that check a decision could cite another tenant's alert by id
  and read its title back through the detail endpoint — the suite asserts the refusal.
- Writes are `ORGANIZATION_ADMIN` or `ANALYST`; `VIEWER` can read everything and
  change nothing, asserted on the API and in the browser tests.
- Every decision create, edit, action change and review writes an audit entry with
  actor, IP and before/after. Asserted end to end.
- Unauthenticated requests to `/goals` and `/decisions/centre` return 401.
- Evidence replacement is validated **before** anything is deleted and applied in one
  transaction, so a refused edit cannot leave a decision with its reasoning half
  removed.

## KNOWN LIMITATIONS

- **Goal figures are as current as the last analysis run.** That happens on every
  import commit and can be triggered by hand, but a goal is not recalculated on read.
- **Goal progress uses the goal's own window, so a goal whose window predates the
  reported history has no current value** and stays `ACTIVE` rather than being scored
  against nothing.
- **The Opportunities panel is empty on the seeded data.** The opportunity rules fire
  on genuinely favourable conditions (spare capacity with rising demand, occupancy
  above 85% with a flat rate, a full portfolio with flat revenue per unit), and the
  seeded final month is deliberately a bad one. The path is covered by the integration
  test rather than by the demonstration data.
- **A decision's owner and an action's owner must already be members**; there is no
  invitation flow, as in earlier sprints.
- **Decision status is set by hand.** Nothing infers `COMPLETED` from all actions
  being done — the plan does not ask for it, and a decision can be finished without
  every action being ticked.
- **Docker was not run here.** The daemon is unavailable in the development container;
  `docker compose config` validates and CI builds both images on every push.

## FILES CHANGED

**API**

- `src/goals/goal-progress.ts`, `goal-progress.spec.ts` — the pure arithmetic
- `src/goals/goals.service.ts`, `goals.controller.ts`, `goals.dto.ts`, `goals.module.ts`
- `src/decisions/decisions.service.ts`, `decisions.controller.ts`, `decisions.dto.ts`,
  `decisions.module.ts`
- `src/analysis/analysis.service.ts`, `.controller.ts`, `.module.ts` — goals in the run
- `src/analytics/dashboard.service.ts` — goal pace on the dashboard panel
- `src/imports/imports.service.ts` — the new run shape, goals counted in the audit entry
- `src/industry-packs/catalogue/{healthcare,hospitality,real-estate}.ts` — one
  opportunity rule each
- `src/app.module.ts`
- `prisma/sample-goals.ts` (new), `prisma/seed.ts` — analysis, goals and decisions seeded
- `test/goals-decisions.e2e-spec.ts` (new), `test/health-alerts-insights.e2e-spec.ts`

**Shared types**

- `src/goals.ts` (new), `src/health.ts`, `src/analytics.ts`, `src/index.ts`

**Web**

- `src/features/goals/` — `GoalsPage`, `GoalDetailPage`, `GoalDialog`,
  `GoalProgressBar`, `goal-display.ts`, `goals-api.ts`, `GoalsPage.test.tsx`
- `src/features/decisions/` — `DecisionCentrePage`, `DecisionDetailPage`,
  `DecisionDialog`, `decisions-api.ts`, two test files
- `src/features/dashboard/DashboardPage.tsx`, `src/features/health/health-api.ts`
- `src/app/App.tsx`, `src/components/AppShell.tsx`, `src/styles/global.css`

**Docs**

- `docs/decisions/0012-goals-and-decisions.md` (new)
- `docs/api.md`, `docs/architecture.md`, `docs/current-state.md`, this report

## ACCEPTANCE CRITERIA

| Criterion (plan §42)                  | Status | Evidence                                                                                                                                                                                                          |
| ------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Metric-linked goals update automatically | ✅  | A goal created against a metric reads its current value from the analytics engine on creation, after every import commit, and on demand. Asserted to the digit in integration tests, and confirmed in the browser against seeded data (43.56% of a 12% revenue growth goal, recalculated when a further month was reported). |
| Decision history remains auditable    | ✅     | Every create, edit, action change and review writes an audit entry with actor, IP and before/after; reviews keep the expected outcome as it stood, so editing the decision afterwards cannot rewrite what a review was judged against. Both asserted in the integration suite. |

## NEXT SPRINT

Sprint 9 — AI Analyst: the AI service abstraction, structured analytics context,
query endpoint, conversation history, guardrails and error handling; the chat UI with
suggested questions, metric references and a context period selector. The boundary
from ADR-0005 holds: the model explains figures the platform produced and never
becomes their source.
