# Current State

Last updated: end of Sprint 1.

## Repository state before Sprint 0

The repository was **empty** — no commits, no files, no history. Nothing was
inherited, adapted or removed; everything described below was created in Sprint 0.

## What exists now

| Area              | State                                                                                      |
| ----------------- | ------------------------------------------------------------------------------------------ |
| Monorepo          | pnpm workspace: `apps/api`, `apps/web`, `packages/shared-types`, `packages/config`         |
| API               | NestJS 11 boots, `GET /api/health` reports API + database status                           |
| Database          | PostgreSQL 16, full initial Prisma model, one applied migration                            |
| Web               | React 19 + Vite 7 boots, app shell, navigation, System Status page                         |
| Shared vocabulary | Roles, metric units/frequencies/directions, alert/goal/decision statuses, error envelope   |
| Error contract    | `{ code, message, details }` via a global exception filter                                 |
| Validation        | Zod for environment and DTOs (`ZodValidationPipe`)                                         |
| Security baseline | Helmet, CORS allow-list, rate limiting, 1 MB body cap, Nginx CSP                           |
| Tooling           | ESLint 9 flat config, Prettier, Jest, Vitest, GitHub Actions CI                            |
| Containers        | `docker-compose.yml` with db/api/web; multi-stage Dockerfiles                              |
| Documentation     | Architecture, database, API, industry packs, 6 ADRs, this file                             |
| Authentication    | Argon2id passwords, httpOnly cookie sessions, rotating refresh tokens with reuse detection |
| Authorization     | Global auth guard, `@Roles` membership checks, `@PlatformAdminOnly` separation             |
| Tenancy           | Organization scope from the session only; membership re-read per request                   |
| Audit             | `AuditService` writing before/after entries for organization and platform changes          |
| Seed data         | Platform admin, 3 industries, 3 organizations with branches and 3 roles each               |

## Verified locally

- `pnpm -r lint` — clean
- `pnpm -r typecheck` — clean
- `pnpm -r build` — API, web and shared types all build
- `pnpm -r test` — 59 API unit tests, 26 web tests
- `pnpm --filter @sip/api test:e2e` — 33 integration tests against real PostgreSQL
- `prisma migrate deploy` + `prisma migrate diff --exit-code` — migrations reproduce the schema
- API booted from `dist`: login → `/auth/me` → `/organizations/current` → refresh → logout,
  with platform routes refused to tenants and tenant routes refused to platform staff
- Full browser run (Chromium): unauthenticated `/system` redirects to `/login`, sign-in
  lands on the app, the user menu shows organization and role, sign-out returns to `/login`,
  and a platform admin sees the platform navigation and the cross-tenant list

## Not verified locally

The Docker daemon is unavailable in the development container, so the images and
the Compose stack were not built or run here. `docker compose config` validates,
and the CI `docker` job builds both images on every push — that is where the stack
is proven until someone runs it on a machine with Docker.

## Not built yet (by design)

Organization structure CRUD and team management (Sprint 2), imports (3), metrics
engine (4), industry pack content (5), dashboard and analytics (6),
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
7. **Seed data landed in Sprint 1 rather than Sprint 10.** Plan §48 asks for seeds
   that make the interface demonstrable immediately, and login is not demonstrable
   without users. Metric, goal and decision seeds still follow later.
