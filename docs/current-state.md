# Current State

Last updated: end of Sprint 0.

## Repository state before Sprint 0

The repository was **empty** — no commits, no files, no history. Nothing was
inherited, adapted or removed; everything described below was created in Sprint 0.

## What exists now

| Area              | State                                                                                    |
| ----------------- | ---------------------------------------------------------------------------------------- |
| Monorepo          | pnpm workspace: `apps/api`, `apps/web`, `packages/shared-types`, `packages/config`       |
| API               | NestJS 11 boots, `GET /api/health` reports API + database status                         |
| Database          | PostgreSQL 16, full initial Prisma model, one applied migration                          |
| Web               | React 19 + Vite 7 boots, app shell, navigation, System Status page                       |
| Shared vocabulary | Roles, metric units/frequencies/directions, alert/goal/decision statuses, error envelope |
| Error contract    | `{ code, message, details }` via a global exception filter                               |
| Validation        | Zod for environment and DTOs (`ZodValidationPipe`)                                       |
| Security baseline | Helmet, CORS allow-list, rate limiting, 1 MB body cap, Nginx CSP                         |
| Tooling           | ESLint 9 flat config, Prettier, Jest, Vitest, GitHub Actions CI                          |
| Containers        | `docker-compose.yml` with db/api/web; multi-stage Dockerfiles                            |
| Documentation     | Architecture, database, API, industry packs, 5 ADRs, this file                           |

## Verified locally

- `pnpm -r lint` — clean
- `pnpm -r typecheck` — clean
- `pnpm -r build` — API, web and shared types all build
- `pnpm -r test` — 14 API unit tests, 7 web tests
- `pnpm --filter @sip/api test:e2e` — 2 integration tests against real PostgreSQL
- `prisma migrate deploy` + `prisma migrate diff --exit-code` — migration reproduces the schema
- API booted from `dist`: `GET /api/health` → `{"status":"ok","checks":{"database":"up"}}`
- Vite dev server proxied `/api/health` to the API successfully (browser → proxy → API → PostgreSQL)
- Production web build served and returned 200

## Not verified locally

The Docker daemon is unavailable in the development container, so the images and
the Compose stack were not built or run here. `docker compose config` validates,
and the CI `docker` job builds both images on every push — that is where the stack
is proven until someone runs it on a machine with Docker.

## Not built yet (by design)

Authentication, tenancy guards, organization structure CRUD, imports, metrics
engine, industry pack content, dashboard, health/alerts/insights, goals, decisions,
AI, reports, seed data. These are Sprints 1–10.

## Deviations from the plan document

1. **Zod instead of class-validator** for DTOs — the plan permits either; rationale
   in ADR-0003.
2. **`@sip/shared-types` is a dual ESM/CJS build** rather than a plain package,
   because the API compiles to CommonJS and the client bundles ESM (ADR-0001).
3. **The initial migration covers every domain in plan §8**, not only the tables
   Sprint 0 uses. The plan asks Sprint 0 to "create the initial database model", and
   one coherent baseline is easier to review than a schema that grows by accident.
4. **A `/system` page exists in the web app** that is not in the plan's route list.
   It is the Sprint 0 proof that the client reaches the API; it will move behind
   authentication in Sprint 1.
