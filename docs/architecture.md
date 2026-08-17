# Architecture

> Status: Sprint 4 complete (foundation, auth, tenancy, structure, import, metrics).

## 1. What this system is

A multi-tenant strategic intelligence platform. It turns organizational data into
trusted KPIs, evaluates organizational health, detects change, explains it with
evidence, and tracks the decisions taken in response.

The value chain the platform implements:

```text
Trusted Data → Structured Metrics → Business Context → Performance Evaluation
→ Evidence-Based Insights → Management Attention → Decisions → Measured Outcomes
```

It is deliberately **not** "charts plus an LLM".

## 2. Universal Core + Industry Packs + Organization Customization

Three layers, in strict order of authority:

| Layer                      | Contains                                                                          | Lives in                                  |
| -------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------- |
| Universal Core             | Organization, Branch, Department, Dataset, Metric, Goal, Alert, Insight, Decision | Code + database schema                    |
| Industry Pack              | Default metrics, health model, insight and alert rules for one industry           | Database rows (`industry_pack_*` tables)  |
| Organization Customization | Tenant-owned metrics, targets, thresholds, health weights                         | Database rows scoped by `organization_id` |

Industry vocabulary (patient, room, unit, property) **never** enters core code or
core tables. A new industry is a data change, not a code change: the shipped packs
are definitions synced into the pack tables, and the installer reads only from
those tables, so a pack inserted by an administrator installs identically. No
engine branches on an industry code.

Installing clones template metrics into the tenant and never overwrites anything
already present under the same code, which is what makes the third layer — the
organization's own edits — survive every re-install.

## 3. Layout

```text
strategic-intelligence/
├── apps/
│   ├── api/        NestJS REST API — the only authority for calculations
│   └── web/        React + Vite client — transport and presentation only
├── packages/
│   ├── shared-types/   Domain vocabulary + API contracts shared by both apps
│   └── config/         Shared tsconfig and ESLint bases
├── docker/         Dockerfiles and Nginx config
├── docs/           This documentation set
└── docker-compose.yml
```

Backend module layout (`apps/api/src`) follows the domains in the plan: `auth`,
`organizations`, `users`, `industries`, `branches`, `departments`, `data`,
`imports`, `metrics`, `analytics`, `health`, `alerts`, `insights`, `goals`,
`decisions`, `ai`, `audit`, `platform`, plus `common` and `prisma`. Sprint 0
creates `common`, `config`, `prisma` and `health`; each later sprint adds its own.

Frontend layout (`apps/web/src`): `app/`, `components/` (shared design system),
`features/<domain>/`, `hooks/`, `lib/`, `services/`, `types/`.

## 4. Non-negotiable principles

### 4.1 Multi-tenant first

Every tenant-owned table carries `organizationId`. Every query is scoped by it.
The organization identity comes from the authenticated session, never from a
request body or query parameter — services receive it through the
`@OrganizationId()` decorator, which reads the verified access token.
`ZodValidationPipe` strips unknown keys, so a client cannot smuggle an
`organizationId` into a DTO, and `AuthorizationGuard` re-reads membership from the
database on every tenant request so revocation is immediate.

### 4.2 Calculations are server-side

Every number a user sees is computed by the API from stored values. The frontend
formats and renders; it never derives a KPI. This keeps one source of numeric
truth and makes the dashboard, reports and AI context provably consistent.

### 4.3 Metrics are data, not code

Metric definitions (unit, aggregation, frequency, direction, formula) live in the
`metrics` table. No KPI is hardcoded in a React component or a controller.

### 4.4 Determinism before intelligence

Alerts and insights come from explicit rules with recorded evidence. Anything the
platform asserts must be traceable to numbers the user can inspect.

### 4.5 AI is an explanation layer

```text
Database → Analytics Engine → Verified KPIs → Insight Context → AI → Explanation
```

The AI never calculates, never writes to operational data, and receives only
verified metric context. Missing or low-quality data is disclosed to it and by it.

### 4.6 Auditability

Critical changes record who, what, when, before, after and organization in
`audit_logs`.

## 5. Request lifecycle

```text
Client → Nginx (prod) / Vite proxy (dev)
      → Helmet + CORS allow-list
      → ThrottlerGuard        rate limit, tighter on credential routes
      → JwtAuthGuard          verifies the access cookie, attaches request.user
      → AuthorizationGuard    @Roles / @PlatformAdminOnly, re-reads membership
      → Controller (ZodValidationPipe on the DTO)
      → Domain service (organization-scoped)
      → PrismaService → PostgreSQL
      → AllExceptionsFilter on the way out
```

Guards are registered globally, so a new controller is authenticated by default;
exposing a route takes an explicit `@Public()`.

Errors always leave as `{ code, message, details }`. Stack traces, database
internals and secrets never reach a client.

## 6. Technology decisions

See `docs/decisions/` for the ADRs. Summary:

| Area       | Choice                                         |
| ---------- | ---------------------------------------------- |
| API        | NestJS 11 + TypeScript, REST                   |
| ORM        | Prisma 6 + PostgreSQL 16                       |
| Validation | Zod (env, DTOs, rule definitions)              |
| Client     | React 19, Vite 7, React Router, TanStack Query |
| Charts     | Apache ECharts                                 |
| Styling    | Design tokens + hand-written CSS               |
| Monorepo   | pnpm workspaces                                |
| Tests      | Jest (API), Vitest + Testing Library (web)     |

## 7. Sprint status

Delivered:

- **Sprint 0** — monorepo, database model, error contract, containers, CI.
- **Sprint 1** — authentication (ADR-0006), organization membership and roles,
  tenancy and platform guards, audit logging, login and session UI, seed data.
- **Sprint 2** — industries and industry selection, branches, departments, team
  management, organization settings UI.
- **Sprint 3** — data sources, the CSV import pipeline (upload → map → validate →
  commit), row-level validation with retained rejections, and rule-based data
  quality.
- **Sprint 4** — metrics CRUD, targets and thresholds, the formula engine
  (ADR-0008), recalculation after imports, manual data entry, and the metric
  catalogue and detail pages.
- **Sprint 5** — industry packs (ADR-0009): the three MVP packs as validated data,
  the catalogue sync, the transactional installer, automatic installation when an
  industry is chosen, and the platform and tenant pack screens.
- **Sprint 6** — read-time aggregation (ADR-0010), the executive dashboard and the
  analytics page: one request per screen, global date/branch/department filters,
  period comparison, branch and department breakdowns, and twelve months of sample
  history in the seed.

Not built yet:
industry pack content (5), dashboard and analytics (6), health/alerts/insights (7),
goals and decisions (8), AI analyst (9), reports and hardening (10).
