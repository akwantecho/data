# Current State

Last updated: end of Sprint 4.

## Repository state before Sprint 0

The repository was **empty** — no commits, no files, no history. Nothing was
inherited, adapted or removed; everything described below was created in Sprint 0.

## What exists now

| Area                   | State                                                                                      |
| ---------------------- | ------------------------------------------------------------------------------------------ |
| Monorepo               | pnpm workspace: `apps/api`, `apps/web`, `packages/shared-types`, `packages/config`         |
| API                    | NestJS 11 boots, `GET /api/health` reports API + database status                           |
| Database               | PostgreSQL 16, full initial Prisma model, one applied migration                            |
| Web                    | React 19 + Vite 7 boots, app shell, navigation, System Status page                         |
| Shared vocabulary      | Roles, metric units/frequencies/directions, alert/goal/decision statuses, error envelope   |
| Error contract         | `{ code, message, details }` via a global exception filter                                 |
| Validation             | Zod for environment and DTOs (`ZodValidationPipe`)                                         |
| Security baseline      | Helmet, CORS allow-list, rate limiting, 1 MB body cap, Nginx CSP                           |
| Tooling                | ESLint 9 flat config, Prettier, Jest, Vitest, GitHub Actions CI                            |
| Containers             | `docker-compose.yml` with db/api/web; multi-stage Dockerfiles                              |
| Documentation          | Architecture, database, API, industry packs, 8 ADRs, this file                             |
| Authentication         | Argon2id passwords, httpOnly cookie sessions, rotating refresh tokens with reuse detection |
| Authorization          | Global auth guard, `@Roles` membership checks, `@PlatformAdminOnly` separation             |
| Tenancy                | Organization scope from the session only; membership re-read per request                   |
| Audit                  | `AuditService` writing before/after entries for organization and platform changes          |
| Seed data              | Platform admin, 3 industries, 3 organizations with branches and 3 roles each               |
| Organization structure | Industry selection, branches, departments, team management, settings UI                    |
| Data import            | CSV upload → map → validate → commit, auditable rows, duplicate protection, quality score  |
| Metrics engine         | Metrics CRUD, parsed formulas with a dependency graph, server-side calculation, targets    |

## Verified locally

- `pnpm -r lint` — clean
- `pnpm -r typecheck` — clean
- `pnpm -r build` — API, web and shared types all build
- `pnpm -r test` — 180 API unit tests, 67 web tests
- `pnpm --filter @sip/api test:e2e` — 124 integration tests against real PostgreSQL
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

Industry pack content (Sprint 5), dashboard and analytics (6),
health/alerts/insights (7), goals and decisions (8), AI analyst (9), reports and
production hardening (10).

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
9. **The seed now creates four universal metrics per organization** (revenue,
   expenses, customers, satisfaction score) so the import wizard is demonstrable
   before the metrics engine exists. Industry-specific metrics still arrive with the
   packs in Sprint 5.
10. **Imports target metric values directly rather than the `datasets` tables.**
    Plan §14 ends the flow at "recalculate affected metrics", and §15 validates metric
    codes, so the long-format CSV maps onto `metric_values`. The `datasets` and
    `dataset_columns` tables stay unused until a source type needs arbitrary schemas.
11. **Formulas cannot aggregate across periods or slices yet** (no "sum of last 12
    months", no organization total derived from branches). Those are read-time
    analytics and belong with the dashboard in Sprint 6.
12. **Seed data landed in Sprint 1 rather than Sprint 10.** Plan §48 asks for seeds
    that make the interface demonstrable immediately, and login is not demonstrable
    without users. Metric, goal and decision seeds still follow later.
