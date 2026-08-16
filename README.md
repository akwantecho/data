# Universal Strategic Intelligence Platform

A multi-tenant web platform that turns organizational data into trusted KPIs,
organizational health scores, evidence-based insights and tracked decisions —
across multiple industries.

The product is not "charts plus AI". It implements a loop:

```text
Trusted Data → Structured Metrics → Business Context → Performance Evaluation
→ Evidence-Based Insights → Management Attention → Decisions → Measured Outcomes
```

MVP industries: **Healthcare**, **Hospitality / Tourism**, **Real Estate**.
Architecture: **Universal Core + Industry Packs + Organization Customization**.

> **Status: Sprint 1 complete** — foundation, authentication, multi-tenancy and
> platform separation. Organization structure lands in Sprint 2.
> See [`docs/current-state.md`](docs/current-state.md).

## Stack

| Layer          | Technology                                                          |
| -------------- | ------------------------------------------------------------------- |
| Client         | React 19, TypeScript, Vite 7, React Router, TanStack Query, ECharts |
| API            | NestJS 11, TypeScript, REST, Zod validation                         |
| Data           | PostgreSQL 16, Prisma 6                                             |
| Infrastructure | Docker, Docker Compose, Nginx                                       |
| Tooling        | pnpm workspaces, ESLint 9, Prettier, Jest, Vitest, GitHub Actions   |

## Quick start

Requires Node 22+, pnpm 10+, and PostgreSQL 16 (or Docker).

```bash
pnpm install
pnpm --filter @sip/shared-types build

cp apps/api/.env.example apps/api/.env      # set DATABASE_URL and the JWT secrets
pnpm --filter @sip/api db:migrate
pnpm --filter @sip/api db:seed              # development accounts

pnpm --filter @sip/api dev                  # API  → http://localhost:3000/api
pnpm --filter @sip/web dev                  # Web  → http://localhost:5173
```

Sign in at http://localhost:5173 with a seeded account (development only):

| Account                       | Role               |
| ----------------------------- | ------------------ |
| `admin@alpha-medical.local`   | Organization admin |
| `analyst@alpha-medical.local` | Analyst            |
| `platform@sip.local`          | Platform admin     |

All seeded accounts use `Password123!`.

Or the whole stack in containers:

```bash
cp .env.example .env
docker compose up --build                   # web → http://localhost:8080
```

Verify: `curl http://localhost:3000/api/health`

```json
{ "status": "ok", "checks": { "database": "up" }, ... }
```

## Repository layout

```text
apps/
  api/                 NestJS API — the only authority for calculations
    prisma/            Schema, migrations and development seed
    src/auth/          Sessions, guards, decorators
    src/audit/         Audit trail
    src/common/        Error contract, validation pipe
    src/config/        Validated environment
    src/health/        Health endpoint
    src/organizations/ Tenant-scoped organization profile
    src/platform/      Platform administration
  web/                 React client — transport and presentation only
    src/app/           Router, query client
    src/components/    Shared design-system components
    src/features/      One folder per product domain
    src/lib/           API client
    src/styles/        Design tokens
packages/
  shared-types/        Domain vocabulary + API contracts (dual ESM/CJS build)
  config/              Shared tsconfig and ESLint bases
docker/                Dockerfiles, Nginx config
docs/                  Architecture, database, API, industry packs, ADRs
```

## Commands

| Command                             | Description                                 |
| ----------------------------------- | ------------------------------------------- |
| `pnpm -r build`                     | Build every package                         |
| `pnpm -r lint`                      | ESLint across the workspace                 |
| `pnpm -r typecheck`                 | TypeScript, no emit                         |
| `pnpm -r test`                      | Unit tests (API) and component tests (web)  |
| `pnpm --filter @sip/api test:e2e`   | Integration tests (needs PostgreSQL)        |
| `pnpm format` / `pnpm format:check` | Prettier                                    |
| `pnpm --filter @sip/api db:migrate` | Create and apply a migration                |
| `pnpm --filter @sip/api db:seed`    | Load development accounts and organizations |
| `pnpm --filter @sip/api db:studio`  | Prisma Studio                               |

## Engineering rules

These are enforced in review, not aspirational:

1. Every tenant-owned table carries `organizationId`, and every query is scoped by
   it. The organization comes from the session, never from the client.
2. All business calculations happen server-side. The frontend never derives a KPI.
3. Metrics are database-driven. No KPI is hardcoded in a component.
4. Insights and alerts are deterministic and carry evidence.
5. AI explains verified numbers. It never calculates, and never writes.
6. Schema changes ship as migrations.
7. Every domain ships with tests; a sprint with failing blocking tests is not done.
8. Invalid data is surfaced, never silently discarded.
9. Errors leave the API as `{ code, message, details }` — no stack traces, no
   database internals, no secrets.

## Documentation

- [`docs/architecture.md`](docs/architecture.md) — layers, principles, request lifecycle
- [`docs/database.md`](docs/database.md) — data model and conventions
- [`docs/api.md`](docs/api.md) — API conventions, error contract, planned surface
- [`docs/industry-packs.md`](docs/industry-packs.md) — how an industry is added as data
- [`docs/testing.md`](docs/testing.md) — test layers and what belongs in each
- [`docs/deployment.md`](docs/deployment.md) — running the stack and going to production
- [`docs/decisions/`](docs/decisions/) — architecture decision records
- [`docs/sprints/`](docs/sprints/) — sprint completion reports
