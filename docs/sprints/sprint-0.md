# Sprint 0 Completion Report

```text
SPRINT: 0 — Repository and Architecture
STATUS: COMPLETE — all acceptance criteria met, all blocking tests pass
```

## IMPLEMENTED

- Repository inspected and documented. It was **empty** (no commits, no files);
  everything below was created in this sprint. See `docs/current-state.md`.
- pnpm monorepo: `apps/api`, `apps/web`, `packages/shared-types`, `packages/config`.
- NestJS 11 API that boots, connects to PostgreSQL, and serves `GET /api/health`.
- React 19 + Vite 7 client that boots, with app shell, navigation reflecting the
  planned information architecture, design tokens, and a System Status page that
  proves the browser → API → database path.
- Shared domain vocabulary (`@sip/shared-types`): roles, organization statuses,
  metric units/frequencies/directions/aggregations, data source and import
  statuses, alert severities/statuses, goal statuses, decision statuses and review
  results, health bands and their default ranges, plus the API error contract.
  Published as a dual ESM/CJS build so the CommonJS API and the ESM client can both
  consume it.
- Standardised error envelope `{ code, message, details }` with a global exception
  filter that maps framework errors onto platform codes and never leaks stack
  traces, database internals or secrets.
- Zod-based validation: environment validated at boot (the API refuses to start on
  an invalid environment), DTOs validated per route through `ZodValidationPipe`.
- Security baseline: Helmet, CORS allow-list, per-IP rate limiting, 1 MB JSON body
  cap, Nginx CSP and hardening headers, `.env` files git-ignored.
- Docker Compose stack (PostgreSQL + API + web) with multi-stage Dockerfiles and
  container healthchecks; the API applies migrations on start.
- GitHub Actions CI: formatting, lint, typecheck, migration-drift check, build,
  unit tests, integration tests against a real PostgreSQL service, and both Docker
  image builds.
- Documentation set: architecture, database, API, industry packs, testing,
  deployment, current state, implementation checklist, and five ADRs.

## DATABASE CHANGES

One migration: `20260816130338_initial_platform_schema` — 50 tables, 23 enums,
66 indexes/unique constraints, covering every domain in plan §8:

| Domain          | Tables                                                                                                                                 |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Identity        | `users`, `refresh_tokens`, `organization_users`                                                                                        |
| Organization    | `industries`, `organizations`, `branches`, `departments`                                                                               |
| Data management | `data_sources`, `datasets`, `dataset_columns`, `data_imports`, `data_import_rows`, `data_validation_errors`                            |
| Metrics         | `metrics`, `metric_formulas`, `metric_values`, `metric_targets`, `metric_thresholds`, `metric_dependencies`                            |
| Industry packs  | `industry_packs`, `industry_pack_metrics`, `industry_pack_health_models`, `industry_pack_insight_rules`, `organization_industry_packs` |
| Health          | `health_models`, `health_categories`, `health_metric_weights`, `health_scores`                                                         |
| Alerts          | `alert_rules`, `alerts`, `alert_events`                                                                                                |
| Insights        | `insight_rules`, `insights`, `insight_evidence`                                                                                        |
| Goals           | `goals`, `goal_metrics`, `goal_updates`                                                                                                |
| Decisions       | `decisions`, `decision_actions`, `decision_metrics`, `decision_alerts`, `decision_insights`, `decision_goals`, `decision_reviews`      |
| AI              | `ai_conversations`, `ai_messages`, `ai_queries`                                                                                        |
| Governance      | `audit_logs`, `organization_settings`, `platform_settings`                                                                             |

Model decisions worth noting:

- Every tenant-owned table carries `organization_id`, with the leading index on it.
- Metric and money values are `Decimal(20,6)` — never `Float`.
- `metric_values` is unique on
  `(organization_id, metric_id, branch_id, department_id, period_type, period_start)`,
  which makes imports and recalculation idempotent.
- Metrics are scoped either to an industry (template) or an organization
  (tenant-owned), with uniqueness enforced per scope.
- `data_imports` is unique on `(organization_id, checksum)`, blocking duplicate
  commits of the same file.
- Raw import rows and per-row validation errors are retained, so invalid data is
  never silently discarded.

## API CHANGES

- `GET /api/health` — returns `{ status, service, version, uptimeSeconds, checks: { database }, timestamp }`.
  Always 200, so a degraded database is reported in the body rather than masked as
  a transport failure.
- Global prefix `/api`, configurable via `API_PREFIX`.
- Global exception filter emitting the platform error envelope.
- Global throttler (`RATE_LIMIT`, default 120 requests/minute/IP).

## FRONTEND CHANGES

- `AppShell` with sidebar navigation matching plan §41 (unbuilt routes rendered
  disabled rather than hidden, so the information architecture is visible now).
- `PageHeader`, `LoadingState`, `ErrorState`, `EmptyState` — the first shared
  components of the design system.
- Design tokens (`tokens.css`) for colour, type, spacing, shape and layout, with a
  dark-scheme variant; all layout uses logical properties, so RTL needs no rewrite.
- Typed API client with `ApiError` carrying the platform error envelope, and a
  TanStack Query client that does not retry 4xx responses.
- `/system` page rendering live API and database status.

## TESTS

| Suite                              | Result              |
| ---------------------------------- | ------------------- |
| API unit (Jest)                    | 14 passed, 4 suites |
| API integration (Jest + Supertest) | 2 passed            |
| Web (Vitest + Testing Library)     | 7 passed, 2 files   |

Coverage of note: environment validation and defaults; error-filter mapping,
including a case asserting an internal error message containing a password never
reaches the response; `ZodValidationPipe` stripping unknown keys (the tenancy
defence) and producing per-field details; health reporting in both healthy and
degraded states; API client success, error-envelope and non-JSON-failure paths;
System Status page success and error states.

Also verified manually: API booted from `dist` returning
`{"status":"ok","checks":{"database":"up"}}`, the Vite dev proxy forwarding
`/api/health` through to PostgreSQL, the production web bundle served over HTTP,
and `prisma migrate diff --exit-code` confirming the migration reproduces the
schema exactly.

## SECURITY CHECKS

- Helmet security headers on the API; CSP, `X-Content-Type-Options`,
  `X-Frame-Options` and `Referrer-Policy` on the web container.
- CORS is an explicit allow-list; in Docker the client is same-origin.
- Rate limiting enabled globally from the first endpoint.
- Request bodies capped at 1 MB before any parser sees them.
- Zod strips unknown keys, so clients cannot inject fields such as `organizationId`.
- Errors never expose stack traces, database internals or secrets (asserted by test).
- Only refresh token **hashes** have a column; no plaintext token storage is possible.
- No secrets committed: `.env` files are ignored, only `.env.example` is tracked.
- Prisma parameterises all queries; the raw query in use is a constant `SELECT 1`.
- Containers run the API as the non-root `node` user.

## KNOWN LIMITATIONS

1. **Docker images were not built locally** — the Docker daemon is unavailable in
   this development container. `docker compose config` validates, and the CI
   `docker` job builds both images on every push, but the stack has not been run.
2. **No authentication yet**, so `GET /api/health` and `/system` are public. This is
   correct for a health endpoint; the System Status page moves behind auth in Sprint 1.
3. **Tenant isolation is designed but not yet enforced** — there are no tenant
   endpoints to enforce it on. Guards and isolation tests are Sprint 1 deliverables.
4. **The schema is ahead of the code.** Tables for imports, metrics, health, alerts,
   insights, goals, decisions and AI exist with no services behind them yet.
5. **No seed data** — Sprint 10 per the plan; earlier if it speeds up development.
6. **Rate limiting is in-memory**, so it is per-instance. A shared store (Redis) is
   needed before running more than one API replica.

## FILES CHANGED

87 files added (the repository was empty). Highlights:

```text
Root            package.json, pnpm-workspace.yaml, docker-compose.yml,
                .prettierrc.json, .gitignore, .dockerignore, .env.example, README.md
CI              .github/workflows/ci.yml
Docker          docker/api.Dockerfile, docker/web.Dockerfile, docker/nginx.conf
API             apps/api/prisma/schema.prisma
                apps/api/prisma/migrations/20260816130338_initial_platform_schema/
                apps/api/src/{main,app.module}.ts
                apps/api/src/config/env.ts (+ spec)
                apps/api/src/common/errors/{api-exception,all-exceptions.filter}.ts (+ spec)
                apps/api/src/common/pipes/zod-validation.pipe.ts (+ spec)
                apps/api/src/prisma/{prisma.service,prisma.module}.ts
                apps/api/src/health/{health.controller,health.service,health.module}.ts (+ spec)
                apps/api/test/health.e2e-spec.ts
Web             apps/web/src/main.tsx, src/app/{App.tsx,query-client.ts}
                apps/web/src/components/{AppShell,PageHeader,states}.tsx
                apps/web/src/features/system/SystemStatusPage.tsx (+ test)
                apps/web/src/lib/api-client.ts (+ test)
                apps/web/src/styles/{tokens,global}.css
                apps/web/{vite.config.ts,index.html,vitest.setup.ts}
Packages        packages/shared-types/src/{enums,api,index}.ts
                packages/config/{tsconfig.base.json,eslint.base.js}
Docs            docs/{architecture,database,api,industry-packs,testing,deployment,
                current-state,implementation-checklist}.md
                docs/decisions/0001…0005, docs/sprints/sprint-0.md
```

## ACCEPTANCE CRITERIA

| Criterion                       | Status                                                     |
| ------------------------------- | ---------------------------------------------------------- |
| Backend boots                   | ✅ `node dist/main.js` serves `/api`                       |
| Frontend boots                  | ✅ dev server and production build both verified           |
| DB connection works             | ✅ migration applied; health reports `database: up`        |
| Docker stack works              | ⚠️ config validates; images build in CI, not runnable here |
| CI runs                         | ✅ workflow committed; every step verified locally         |
| Health endpoint returns success | ✅ `{"status":"ok","checks":{"database":"up"}}`            |

## NEXT SPRINT

**Sprint 1 — Authentication and Multi-Tenancy.**

- Users with hashed passwords; login; JWT access tokens with refresh rotation and
  revocation; logout.
- Organizations, membership, roles; `GET /auth/me`, `GET /organizations/current`.
- Auth guard, tenant guard, role guard; platform admin separated from tenants.
- Frontend: login page, protected routes, organization context, user menu.
- Gate to pass before Sprint 2: authorization tests green, refresh and logout
  working, and integration tests proving a user of organization A cannot read or
  write organization B's data.
