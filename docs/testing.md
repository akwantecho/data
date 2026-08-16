# Testing Strategy

Four layers, per plan §43. Sprint 0 establishes the structure and the harnesses;
each sprint fills in its own layer and cannot be reported complete with failing
blocking tests.

## Unit tests — `apps/api/src/**/*.spec.ts` (Jest)

Pure logic, no database. This is where the platform's correctness lives:

- metric formula evaluation, dependency ordering, division by zero, missing inputs
- health score normalisation and weighting
- threshold and direction logic
- goal progress
- insight rule evaluation
- data validation rules

```bash
pnpm --filter @sip/api test
pnpm --filter @sip/api test:cov
```

## Integration tests — `apps/api/test/**/*.e2e-spec.ts` (Jest + Supertest)

Boot the Nest application against a real PostgreSQL instance:

- authentication and token refresh
- **tenant isolation** — every tenant-facing endpoint gets a case proving
  organization A cannot read or write organization B's data
- import flow end to end, including rejected rows and duplicate commits
- metric calculation after import
- dashboard aggregation consistency
- goals, decisions, AI context generation

Requires `DATABASE_URL`; run migrations first.

```bash
pnpm --filter @sip/api db:migrate:deploy
pnpm --filter @sip/api test:e2e
```

## Frontend tests — `apps/web/src/**/*.test.ts(x)` (Vitest + Testing Library)

Behaviour through the DOM, network stubbed at `fetch`:

- login and protected routes
- dashboard loading, empty and error states
- metric filters
- import wizard steps
- goal and decision creation
- AI error states

```bash
pnpm --filter @sip/web test
```

## End-to-end

The demo scenario from plan §49 (create organization → install pack → import →
calculate → dashboard → alert → insight → goal → decision → AI answer), added once
the flow exists. Not started in Sprint 0.

## Conventions

- Test names state behaviour, not implementation.
- No snapshot tests for numbers — assert the value.
- Every bug fix arrives with the test that would have caught it.
- CI runs formatting, lint, typecheck, build, unit and integration tests on every
  push and pull request.
