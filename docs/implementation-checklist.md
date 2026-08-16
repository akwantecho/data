# Implementation Checklist

Derived from the MVP execution plan. One section per sprint; a sprint closes only
when its acceptance criteria hold and its blocking tests pass.

Legend: `[x]` done · `[ ]` not started

## Sprint 0 — Repository and architecture ✅

- [x] Inspect repository and document the starting state (`docs/current-state.md`)
- [x] Architecture decisions recorded (`docs/decisions/`, ADR-0001…0005)
- [x] pnpm monorepo: `apps/api`, `apps/web`, `packages/shared-types`, `packages/config`
- [x] Backend project boots (NestJS 11)
- [x] Frontend project boots (React 19 + Vite 7)
- [x] Initial database model as a Prisma migration (all domains from plan §8)
- [x] Database connection verified
- [x] Docker Compose stack (db + api + web) and multi-stage Dockerfiles
- [x] Environment templates (`.env.example` at root and in each app)
- [x] ESLint + Prettier across the workspace
- [x] Test structure: Jest unit, Jest+Supertest integration, Vitest frontend
- [x] CI pipeline (format, lint, typecheck, build, unit, integration, images)
- [x] `GET /api/health` returns success and reports database status
- [x] Standard error envelope + global exception filter
- [x] README and architecture documentation
- [x] Sprint 0 completion report

## Sprint 1 — Authentication and multi-tenancy ✅

- [x] Users, Argon2id password hashing, login
- [x] JWT access + refresh token rotation with reuse detection, logout
- [x] Organizations and membership, roles
- [x] Auth guard, tenant/role guard, platform guard (all global by default)
- [x] `GET /auth/me`, `GET/PATCH /organizations/current`, `POST /auth/switch-organization`
- [x] Platform admin separation (`GET /platform/organizations`, status change)
- [x] Audit logging for organization and platform changes
- [x] Development seed data
- [x] Frontend: login, protected routes, session context, organization switcher, user menu
- [x] Tests: authorization, token refresh and reuse, rate limiting, **cross-organization access denied**

## Sprint 2 — Organization structure

- [ ] Industries and industry selection
- [ ] Branches CRUD, departments CRUD
- [x] Organization settings endpoint (country, currency, timezone) — UI in Sprint 2
- [ ] Organization users / team management (invite, change role, remove)
- [ ] Frontend: settings, branches, departments, team
- [ ] Tests: CRUD, tenant isolation, invalid organization references rejected

## Sprint 3 — Data import engine

- [ ] Data sources (MANUAL, CSV)
- [ ] CSV upload with type and size limits
- [ ] Parser, preview, column detection, mapping
- [ ] Validation rules (plan §15) with per-row errors retained
- [ ] Commit, import history, duplicate-commit prevention, cancel before commit
- [ ] Data quality module (completeness, freshness, validity, confidence)
- [ ] Frontend: sources, upload wizard, mapping, validation report, summary, history
- [ ] Tests: valid import, invalid rows surfaced, duplicate blocked, isolation

## Sprint 4 — Metrics engine

- [ ] Metrics CRUD, formulas, dependencies
- [ ] Metric values, targets, thresholds
- [ ] Calculation service with topological ordering and cycle detection
- [ ] Recalculation after import
- [ ] Frontend: metrics list, create/edit, detail, target and threshold configuration
- [ ] Tests: formulas, division by zero, missing dependencies, historical values

## Sprint 5 — Industry packs

- [ ] Pack installer
- [ ] Healthcare, Hospitality, Real Estate packs
- [ ] Default health models and insight rules per pack
- [ ] Tests: correct pack installed on organization creation; no cross-industry leakage

## Sprint 6 — Executive dashboard and analytics

- [ ] `GET /dashboard/overview` aggregate endpoint
- [ ] KPI cards, trend chart, period comparison
- [ ] Date range / branch / department filters
- [ ] Analytics page and metric detail page
- [ ] Tests: dashboard numbers match backend calculations; filters apply consistently

## Sprint 7 — Health, alerts and insights

- [ ] Health model, category weights, calculator, bands
- [ ] Alert rules, alert generation, status workflow
- [ ] Insight rules and evidence
- [ ] Frontend: health overview, alerts, insights, evidence drawer
- [ ] Tests: every alert/insight explains why it was created

## Sprint 8 — Goals and decision center

- [ ] Goals CRUD, automatic progress, status calculation
- [ ] Decisions, evidence links, actions, reviews
- [ ] Frontend: goals, decision center, decision detail, review form
- [ ] Tests: metric-linked goals update automatically; decision history auditable

## Sprint 9 — AI analyst

- [ ] AI service abstraction and provider configuration
- [ ] Structured analytics context builder
- [ ] `POST /ai/query`, conversation history
- [ ] Guardrails: no fabricated numbers, no writes, data-quality disclosure
- [ ] Frontend: chat, suggested questions, metric references, period selector
- [ ] Tests: AI cannot invent values absent from context; missing data disclosed

## Sprint 10 — Production hardening

- [ ] Security and validation review
- [ ] Audit log coverage across all critical changes
- [ ] Reports module
- [ ] Structured logging, error monitoring hooks
- [ ] Index and query review, N+1 elimination
- [ ] Responsive and accessibility review
- [ ] Seed data (plan §48) and the demo scenario (plan §49)
- [ ] Production Docker and deployment documentation
- [ ] All test layers green; no critical security findings
