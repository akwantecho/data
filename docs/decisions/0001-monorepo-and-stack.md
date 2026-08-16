# ADR-0001: pnpm monorepo with NestJS API and Vite client

- **Status**: Accepted (Sprint 0)

## Context

The plan specifies React/TypeScript/Vite on the front and NestJS/Prisma/PostgreSQL
on the back, in a repository holding `apps/web`, `apps/api`, `packages/shared-types`
and `packages/config`. The two apps must share a domain vocabulary (roles, metric
units, alert statuses, the error envelope) without duplicating it.

## Decision

pnpm workspaces, four packages, no build orchestrator (Turborepo/Nx) for now —
`pnpm -r` with topological ordering is enough at this size and keeps the toolchain
small.

`@sip/shared-types` is published to both consumers as a **dual build**: ESM for
Vite, CommonJS for the NestJS runtime, selected through the `exports` map. This
avoids the CJS-importing-ESM failure mode without forcing the API to ESM.

`@sip/config` holds the shared `tsconfig.base.json` and ESLint flat-config base so
lint and compiler settings cannot drift between packages.

## Consequences

- One `pnpm install`; one lockfile; cross-package changes land in one commit.
- `@sip/shared-types` must be built before the apps typecheck. `pnpm -r build`
  handles the ordering; CI builds it explicitly before lint/typecheck.
- If build times become a problem, a task runner can be added later without
  changing the package layout.
