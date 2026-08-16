# ADR-0002: Shared-schema multi-tenancy with an application-enforced scope

- **Status**: Accepted (Sprint 0)

## Context

The platform is multi-tenant and tenant isolation is a Definition-of-Done item.
The realistic options were a schema (or database) per tenant, a shared schema with
PostgreSQL row-level security, or a shared schema with the scope enforced in the
application.

## Decision

One schema, one database. Every tenant-owned table carries `organization_id` and
every query is scoped by it. The scope is enforced in the application:

- `organizationId` is derived from the authenticated session, never from a request
  body or query parameter (Sprint 1 adds the guard).
- `ZodValidationPipe` strips unknown keys, so a client cannot smuggle the field in.
- Domain services take `organizationId` as an explicit argument; a Prisma query in
  a tenant service without it is a review failure.
- Composite uniqueness always leads with `organizationId`, so tenants cannot
  collide on codes or slugs.

Row-level security is deliberately deferred, not rejected: the column layout is
already RLS-ready, so it can be added as defence in depth without a data migration.

## Consequences

- Cheap operations: one connection pool, one migration run, cross-tenant platform
  queries are trivial.
- The isolation guarantee lives in code, so it has to be tested, not assumed.
  Sprint 1 ships tenant-isolation integration tests, and every later sprint adds
  isolation cases for its own endpoints.
- Metric templates intentionally have a **null** `organization_id`
  (`industry_id` set instead). Tenant-facing queries must always filter
  `organizationId: <session org>`, which excludes templates by construction.
