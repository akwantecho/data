# Sprint 1 Completion Report

```text
SPRINT: 1 — Authentication and Multi-Tenancy
STATUS: COMPLETE — all acceptance criteria met, all blocking tests pass
```

## IMPLEMENTED

**Authentication**

- Argon2id password hashing (OWASP baseline parameters, per-hash salt).
- Login issuing a session as two httpOnly cookies: `sip_access` (15 min) and
  `sip_refresh` (7 days, scoped to `/api/auth`). `SameSite=Lax`, `Secure` outside
  local HTTP development. Rationale and CSRF analysis in ADR-0006.
- Refresh-token rotation with **reuse detection**: tokens rotated from one login
  share a family, and replaying an already-rotated token revokes the entire family,
  signing out both the attacker and the victim.
- Logout revoking the family server-side and clearing both cookies.
- `GET /auth/me` rebuilding the session from the database.
- `POST /auth/switch-organization` re-scoping the access token to another
  membership without starting a new refresh family.
- Identical 401 for unknown email and wrong password, with a dummy hash verified
  for unknown accounts so response timing does not distinguish them.

**Multi-tenancy and authorization**

- Guards registered globally, so every new route is authenticated by default;
  exposing one requires an explicit `@Public()`.
- `@Roles(...)` verifies a live membership of the token's organization on **every**
  request rather than trusting the token, so removing a member or suspending an
  organization takes effect immediately instead of at token expiry.
- `@PlatformAdminOnly()` separates platform staff, who hold no tenant membership
  and are refused by tenant routes.
- `@OrganizationId()` is the only sanctioned source of `organizationId` in a tenant
  service — it reads the verified token, never the request body.
- `GET/PATCH /organizations/current` and platform organization list/status control.

**Governance**

- `AuditService` recording actor, organization, action, entity and before/after
  values; wired into organization updates and platform status changes. Audit
  failures are logged, never allowed to fail the operation they describe.

**Frontend**

- Login page with client-side validation sharing the Zod email rule, and
  error messages mapped from platform error codes (never raw server text).
- `SessionProvider` as the single source of session state, `ProtectedRoute` for
  redirect-with-return-path, and a user menu showing identity, organization, role,
  organization switcher and sign-out.
- API client that, on a 401, refreshes once and retries — with concurrent requests
  sharing a single refresh, because parallel rotations would trip the server's own
  reuse detection.
- Platform staff get their own navigation and a cross-tenant organizations table;
  they never see tenant screens.

**Development experience**

- Idempotent seed: platform admin, three industries, three organizations with two
  branches each, and admin/analyst/viewer users per organization.

## DATABASE CHANGES

One migration: `20260816134137_refresh_token_families`.

- `refresh_tokens.family_id` (uuid, indexed) — groups every token rotated from one
  login so a leak can be contained.
- `refresh_tokens.revoked_reason` (new enum `RefreshTokenRevocationReason`:
  `ROTATED`, `LOGOUT`, `REUSE_DETECTED`, `MEMBERSHIP_CHANGED`) — makes the audit
  question "why did this session end?" answerable.

No other schema change was needed; the Sprint 0 model already covered identity and
membership.

## API CHANGES

| Method | Route                                | Access               |
| ------ | ------------------------------------ | -------------------- |
| POST   | `/auth/login`                        | Public, 10/min/IP    |
| POST   | `/auth/refresh`                      | Public, 30/min/IP    |
| POST   | `/auth/logout`                       | Public (idempotent)  |
| GET    | `/auth/me`                           | Authenticated        |
| POST   | `/auth/switch-organization`          | Authenticated        |
| GET    | `/organizations/current`             | Any member role      |
| PATCH  | `/organizations/current`             | `ORGANIZATION_ADMIN` |
| GET    | `/platform/organizations`            | `PLATFORM_ADMIN`     |
| PATCH  | `/platform/organizations/:id/status` | `PLATFORM_ADMIN`     |

Also: `GET /health` is now explicitly `@Public()`; every other route requires a
session. `THROTTLE_ENABLED` was added so integration tests can sign in repeatedly,
and the API refuses to boot with it disabled in production.

## FRONTEND CHANGES

- `features/auth/`: `LoginPage`, `SessionProvider`, `session-context`,
  `ProtectedRoute`, session API calls.
- `features/platform/PlatformOrganizationsPage`.
- `components/UserMenu`, plus role-aware navigation in `AppShell`.
- Design-system additions: form fields, buttons, menu panel, data table.
- `lib/api-client`: refresh-and-retry with single-flight refresh.
- `test-utils.tsx`: provider-aware render helper and a path-based `fetch` stub.

## TESTS

| Suite                              | Result              |
| ---------------------------------- | ------------------- |
| API unit (Jest)                    | 59 passed, 8 suites |
| API integration (Jest + Supertest) | 33 passed, 4 suites |
| Web (Vitest + Testing Library)     | 26 passed, 5 files  |

The Sprint 1 gate — cross-organization access — is covered by
`test/tenant-isolation.e2e-spec.ts`:

- each organization sees only its own profile;
- a foreign `organizationId` in the request body is ignored (the attempted rename
  of the other tenant is asserted **not** to have happened);
- switching to a non-member organization is refused;
- access ends the moment a membership is deleted, without waiting for token expiry;
- access ends when the organization is suspended;
- an analyst may read but not modify; the admin's modification is audited;
- tenant users are refused platform routes and platform staff are refused tenant
  routes.

Also covered: rotation and reuse detection, logout revocation, disabled users,
suspended organizations at login, credential-response indistinguishability, guard
behaviour in isolation, and the login rate limit returning a safe envelope.

## SECURITY CHECKS

- Argon2id hashing; no plaintext or reversible password storage is possible.
- Only SHA-256 hashes of refresh tokens are stored, and the presented token is
  checked against the stored hash — a database dump alone does not yield sessions.
- Rotation with reuse detection bounds the damage from a stolen refresh token.
- Tokens are httpOnly, so an XSS bug cannot exfiltrate a reusable credential.
- `SameSite=Lax` plus a same-origin deployment and a JSON content type cover CSRF
  for the flows that exist (ADR-0006).
- Authentication is default-on; `@Public()` is the exception and is spelled out.
- Authorization is re-checked against the database per request.
- Login and refresh have their own tight rate limits, well below the global one.
- Account enumeration is blocked by identical responses and comparable timing.
- Signing secrets have no defaults, must differ, and must be at least 32 characters;
  production additionally refuses insecure cookies and disabled throttling.
- The login UI maps error codes to safe copy; no server text is echoed.
- Seed passwords are development-only and the production checklist says so.

## KNOWN LIMITATIONS

1. **Rate limiting is in-memory**, so limits are per API instance. A shared store
   (Redis) is required before running more than one replica.
2. **No password reset, no invitations, no MFA.** Users exist only via seed or
   direct database insert until Sprint 2 builds team management.
3. **No session list or "sign out everywhere" UI**, though the data model supports
   it — revocation exists, surfacing it does not.
4. **`PATCH /organizations/current` has no UI yet**; the settings screen is Sprint 2.
   The endpoint and its authorization are complete and tested.
5. **Audit coverage is partial by design** — organization and platform changes only.
   Sprint 10 extends it to every critical entity.
6. **Docker images still unverified locally** (no Docker daemon in this
   environment); CI builds them on every push.
7. **Cross-origin browser clients are unsupported** while cookies carry the session.
   A different deployment topology would need an explicit CSRF token.

## FILES CHANGED

```text
API      apps/api/prisma/schema.prisma, prisma/seed.ts
         apps/api/prisma/migrations/20260816134137_refresh_token_families/
         apps/api/src/auth/{auth.controller,auth.service,auth.module,auth.dto,
                            auth.types,token.service,password.service,cookies,
                            decorators}.ts (+ specs)
         apps/api/src/auth/guards/{jwt-auth,authorization}.guard.ts (+ specs)
         apps/api/src/audit/{audit.service,audit.module}.ts
         apps/api/src/organizations/{controller,service,module,dto}.ts
         apps/api/src/platform/{controller,service,module,dto}.ts
         apps/api/src/config/env.ts (+ spec), src/app.module.ts, src/main.ts
         apps/api/src/health/health.controller.ts
         apps/api/test/{auth,tenant-isolation,rate-limit}.e2e-spec.ts
         apps/api/test/helpers/{test-app,fixtures}.ts, test/setup-env.ts
Web      apps/web/src/features/auth/{LoginPage,SessionProvider,ProtectedRoute,
                                     session,session-context}.ts(x) (+ tests)
         apps/web/src/features/platform/PlatformOrganizationsPage.tsx
         apps/web/src/components/{UserMenu,AppShell}.tsx (+ tests)
         apps/web/src/lib/api-client.ts (+ tests), src/app/App.tsx, src/main.tsx
         apps/web/src/styles/global.css, src/test-utils.tsx
Shared   packages/shared-types/src/auth.ts, src/index.ts
Config   .github/workflows/ci.yml, docker-compose.yml, .env.example,
         apps/api/.env.example
Docs     docs/decisions/0006-authentication.md, docs/{api,architecture,database,
         current-state,deployment,implementation-checklist}.md,
         docs/sprints/sprint-1.md, README.md
```

## ACCEPTANCE CRITERIA

| Criterion                               | Status                                                              |
| --------------------------------------- | ------------------------------------------------------------------- |
| User cannot access another organization | ✅ Integration-tested from several angles, including body tampering |
| Platform admin access is isolated       | ✅ Refused in both directions, tested                               |
| Auth refresh works                      | ✅ Rotation verified in tests and by hand against the running API   |
| Logout works                            | ✅ Family revoked; subsequent `/auth/me` and refresh both 401       |
| Authorization tests pass                | ✅ 59 unit + 33 integration + 26 web, all green                     |

Verified by hand as well: the full browser flow (Chromium) — unauthenticated
`/system` redirects to `/login`, sign-in lands on the app, the user menu shows
organization and role, sign-out returns to `/login`, and a platform admin sees the
platform navigation with the cross-tenant organization list.

## NEXT SPRINT

**Sprint 2 — Organization Structure.**

- Industries and industry selection (guarded once data exists, per plan §37).
- Branches and departments CRUD, organization settings UI.
- Team management: invite a user, change a role, remove a member — including the
  rule that an organization cannot be left without an admin.
- Frontend: `/settings/organization`, `/settings/branches`, `/settings/departments`,
  `/settings/users`.
- Gate before Sprint 3: CRUD works, tenant isolation holds for every new endpoint,
  and invalid organization references are rejected.
