# ADR-0003: Zod for validation, not class-validator

- **Status**: Accepted (Sprint 0)

## Context

The plan allows "Zod or class-validator". The platform needs validation in three
places: environment configuration at boot, request DTOs, and the JSON rule
definitions stored for alerts, insights and health models. The frontend also
validates forms, and the plan already lists Zod there.

## Decision

Zod everywhere on the backend; no `class-validator`/`class-transformer`, and no
global Nest `ValidationPipe`. Request DTOs are validated per route with
`ZodValidationPipe`, which converts failures into the platform error envelope
(`VALIDATION_ERROR` plus per-field details).

## Consequences

- One validation mental model across env, DTOs, stored rule definitions and client
  forms — and schemas can eventually be shared through `@sip/shared-types`.
- Schemas are values, so rule definitions read from the database can be validated
  with the same tool as HTTP input. Decorator-based validation cannot do that.
- `whitelist: true` behaviour comes free: Zod objects strip unknown keys, which is
  part of the tenancy defence (ADR-0002).
- Cost: each route must attach the pipe explicitly. That is intentional — it keeps
  the schema visible next to the handler it guards.
- The API refuses to boot on an invalid environment rather than failing later at
  runtime.
