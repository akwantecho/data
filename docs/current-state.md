# Current State

Last updated: end of Sprint 7.

## Repository state before Sprint 0

The repository was **empty** — no commits, no files, no history. Nothing was
inherited, adapted or removed; everything described below was created in Sprint 0.

## What exists now

| Area                     | State                                                                                      |
| ------------------------ | ------------------------------------------------------------------------------------------ |
| Monorepo                 | pnpm workspace: `apps/api`, `apps/web`, `packages/shared-types`, `packages/config`         |
| API                      | NestJS 11 boots, `GET /api/health` reports API + database status                           |
| Database                 | PostgreSQL 16, full initial Prisma model, one applied migration                            |
| Web                      | React 19 + Vite 7 boots, app shell, navigation, System Status page                         |
| Shared vocabulary        | Roles, metric units/frequencies/directions, alert/goal/decision statuses, error envelope   |
| Error contract           | `{ code, message, details }` via a global exception filter                                 |
| Validation               | Zod for environment and DTOs (`ZodValidationPipe`)                                         |
| Security baseline        | Helmet, CORS allow-list, rate limiting, 1 MB body cap, Nginx CSP                           |
| Tooling                  | ESLint 9 flat config, Prettier, Jest, Vitest, GitHub Actions CI                            |
| Containers               | `docker-compose.yml` with db/api/web; multi-stage Dockerfiles                              |
| Documentation            | Architecture, database, API, industry packs, analytics, 11 ADRs, this file                 |
| Authentication           | Argon2id passwords, httpOnly cookie sessions, rotating refresh tokens with reuse detection |
| Authorization            | Global auth guard, `@Roles` membership checks, `@PlatformAdminOnly` separation             |
| Tenancy                  | Organization scope from the session only; membership re-read per request                   |
| Audit                    | `AuditService` writing before/after entries for organization and platform changes          |
| Seed data                | Platform admin, 3 industries, 3 organizations with branches and 3 roles each               |
| Organization structure   | Industry selection, branches, departments, team management, settings UI                    |
| Data import              | CSV upload → map → validate → commit, auditable rows, duplicate protection, quality score  |
| Metrics engine           | Metrics CRUD, parsed formulas with a dependency graph, server-side calculation, targets    |
| Industry packs           | Three MVP packs as validated data, catalogue sync, transactional non-destructive installer |
| Dashboard & analytics    | Read-time aggregation, one-request dashboard, global filters, period and slice comparison  |
| Health, alerts, insights | Weighted health scoring with a full breakdown, alert workflow, deterministic insights      |

## Verified locally

- `pnpm -r lint` — clean
- `pnpm -r typecheck` — clean
- `pnpm -r build` — API, web and shared types all build
- `pnpm -r test` — 308 API unit tests, 110 web tests
- `pnpm --filter @sip/api test:e2e` — 185 integration tests against real PostgreSQL
- `prisma migrate deploy` + `prisma migrate diff --exit-code` — migrations reproduce the schema
- API booted from `dist`: login → `/auth/me` → `/organizations/current` → refresh → logout,
  with platform routes refused to tenants and tenant routes refused to platform staff
- Full browser run (Chromium): unauthenticated `/system` redirects to `/login`, sign-in
  lands on the app, the user menu shows organization and role, sign-out returns to `/login`,
  and a platform admin sees the platform navigation and the cross-tenant list
- Full browser run of the settings screens: creating a branch, the duplicate-code
  conflict surfacing the server message, a department attached to that branch, a role
  change applying, the organization profile saving, and a viewer seeing no write controls
- Full browser run of the metrics engine: defining a chained formula through the UI,
  a bad formula refused with the server's reason, two hand-entered values producing a
  calculated `net_profit` (29,650) and `net_margin` (23.0919%), and a target and
  thresholds driving the status badge — values confirmed directly in PostgreSQL
- Full browser run of health, alerts and insights: the dashboard health panel showing
  67.29 ATTENTION with its five categories, "Why" opening Patient Experience down to
  Patient Retention 63.38 against a target of 68.05 scoring 50.69; the alerts list with
  its evidence drawer, an acknowledgement recorded with actor and note, and a viewer
  seeing only "Close"; and the insights feed carrying the plan's own examples with the
  figures and the condition each one satisfied
- Full run of the plan §49 demonstration through the API: importing a month of worse
  figures moved the health score 67.29 → 29.15 (−38.14), raised three alerts including
  the no-show breach, and generated the insights that explain it — all from one commit
- Full browser run of the dashboard and analytics: KPI cards with period-over-period
  change, a branch filter moving every panel at once (OMR 2.7M → 1.2M), a range
  preset moving the window and the comparison window with it, and RevPAR on the
  analytics page recomputed for the range from revenue ÷ available rooms —
  97.628442198403, matching the API's own figure to the digit, and sitting between
  the two branches' 95.776 and 100.155
- Full browser run of the industry packs: the platform catalogue listing three packs
  and syncing them, a pack inspected in full, the tenant settings card showing the
  installed hospitality pack and its health model, a re-install reporting 12 metrics
  kept and nothing added, and hand-entered revenue, available rooms and occupied
  rooms producing calculated occupancy 77%, ADR 57.534 and RevPAR 44.301 — checked
  in PostgreSQL, and consistent with each other (44.301 = 57.534 × 0.77)
- Full browser run of the import wizard against a deliberately messy 10-row CSV:
  suggested mapping, validation reporting 6 valid and 4 rejected with per-row reasons,
  commit writing 6 metric values, the rejected rows listed on the import detail page,
  a re-upload of the same file blocked, and data quality updating to 68/100

## Not verified locally

The Docker daemon is unavailable in the development container, so the images and
the Compose stack were not built or run here. `docker compose config` validates,
and the CI `docker` job builds both images on every push — that is where the stack
is proven until someone runs it on a machine with Docker.

## Not built yet (by design)

Goals and decisions (Sprint 8), AI analyst (9), reports and production hardening
(10).

## Deviations from the plan document

1. **Zod instead of class-validator** for DTOs — the plan permits either; rationale
   in ADR-0003.
2. **`@sip/shared-types` is a dual ESM/CJS build** rather than a plain package,
   because the API compiles to CommonJS and the client bundles ESM (ADR-0001).
3. **The initial migration covers every domain in plan §8**, not only the tables
   Sprint 0 uses. The plan asks Sprint 0 to "create the initial database model", and
   one coherent baseline is easier to review than a schema that grows by accident.
4. **A `/system` page exists in the web app** that is not in the plan's route list.
   It is the proof that the client reaches the API; it now sits behind authentication.
5. **Sessions use httpOnly cookies rather than bearer tokens** (ADR-0006). The plan
   requires a JWT with a refresh strategy and CSRF consideration; cookies satisfy
   both and remove the XSS token-theft path.
6. **`POST /auth/switch-organization` is not in the plan's route list.** A user can
   belong to several organizations, so the session needs a supported way to change
   scope; without it the active organization would be unchangeable after login.
7. **Adding a member sets an initial password instead of sending an invitation.**
   There is no email infrastructure in the MVP, so an administrator creating an
   account chooses a first password (≥12 characters) and hands it over. Invitation
   links and password reset are Phase 2; the plan lists neither for the MVP.
8. **Branches and departments carrying reported data are deactivated, not deleted.**
   The plan's "never silently discard data" rule applied to structure: deleting
   would cascade away metric values, so the API returns `CONFLICT` instead.
9. **The seed creates four universal metrics per organization** (revenue, expenses,
   customers, satisfaction score) before installing the industry pack. `revenue`
   therefore already exists when the pack installs, which is why every seeded tenant
   reports one metric "kept" — the installer's non-destructive rule, visible in the
   demonstration data.
10. **Imports target metric values directly rather than the `datasets` tables.**
    Plan §14 ends the flow at "recalculate affected metrics", and §15 validates metric
    codes, so the long-format CSV maps onto `metric_values`. The `datasets` and
    `dataset_columns` tables stay unused until a source type needs arbitrary schemas.
11. **Stored formulas evaluate one period and one slice at a time**; aggregation
    across periods and slices is read-time instead (Sprint 6, ADR-0010), where a
    formula is recomputed from its aggregated inputs rather than averaged.
12. **Industry packs install both insight and alert rules from one pack table.**
    Plan §8.5 gives a pack a single rule table; alert rules are rules a pack installs
    too, so each row records its kind and alert codes carry an `alert:` prefix
    (ADR-0009). `alert_rules` gained a `code` column so installation is idempotent.
13. **Organizations are still created only by the seed.** Plan §42 asks that
    creating an organization with an industry install its templates; with no signup
    or create-organization API in the MVP, the equivalent for a live tenant is
    selecting its industry, and both the seed and that path call the same installer.
14. **A metric code cannot be changed after creation.** Formulas, CSV mappings and
    packs all refer to metrics by code, so renaming one would orphan all three. The
    name remains editable.
15. **Dashboard KPI cards come from the health model** rather than the four metric
    names plan §21 lists. The model states what an organization weighs, per industry
    and per tenant, so the cards follow it instead of hardcoding industry vocabulary
    the architecture forbids (ADR-0010).
16. **Aggregation is read-time only.** No rollup tables: a window figure is computed
    on request from stored values, so a corrected month cannot leave a stale total
    behind.
17. **A target stands until it is replaced** (ADR-0011). The plan does not say either
    way; requiring a target per period would leave every newly imported month
    unscoreable, which is the opposite of what §49 asks for.
18. **Organizational health shares the `/health` prefix** with the unauthenticated
    liveness probe: `GET /health` stays public and carries no tenant data, while
    `/health/current` and `/health/history` are tenant-scoped. A test asserts both.
19. **Seed data landed in Sprint 1 rather than Sprint 10.** Plan §48 asks for seeds
    that make the interface demonstrable immediately, and login is not demonstrable
    without users. Metric, goal and decision seeds still follow later.
