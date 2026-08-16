# API

Base URL: `/api` (configurable with `API_PREFIX`).

## Conventions

- REST, JSON in and out.
- Request bodies validated with Zod through `ZodValidationPipe`; unknown keys are
  stripped, so a client cannot inject fields such as `organizationId`.
- Every list endpoint that can grow is paginated: `{ items, page, pageSize, total }`.
- The organization is resolved from the authenticated session, never from the
  request body (Sprint 1).
- Errors always use the envelope below.

## Error envelope

```json
{
  "code": "VALIDATION_ERROR",
  "message": "The request could not be processed.",
  "details": [{ "field": "currencyCode", "message": "String must contain exactly 3 character(s)" }]
}
```

| Code                     | HTTP |
| ------------------------ | ---- |
| `VALIDATION_ERROR`       | 400  |
| `UNAUTHENTICATED`        | 401  |
| `FORBIDDEN`              | 403  |
| `NOT_FOUND`              | 404  |
| `CONFLICT`               | 409  |
| `PAYLOAD_TOO_LARGE`      | 413  |
| `UNSUPPORTED_MEDIA_TYPE` | 415  |
| `RATE_LIMITED`           | 429  |
| `INTERNAL_ERROR`         | 500  |
| `SERVICE_UNAVAILABLE`    | 503  |

Codes are defined once in `@sip/shared-types` and consumed by both apps.

## Authentication

Sessions are httpOnly cookies, not bearer tokens the client can read (ADR-0006):

| Cookie        | Lifetime   | Scope       | Purpose                    |
| ------------- | ---------- | ----------- | -------------------------- |
| `sip_access`  | 15 minutes | `/`         | Authenticates each request |
| `sip_refresh` | 7 days     | `/api/auth` | Rotation only              |

Because the client cannot see when the access token expires, the expected client
behaviour on a 401 is: call `POST /auth/refresh` once, then retry the original
request. Concurrent requests must share one refresh call — parallel rotations trip
the server's reuse detection and end the session.

A `Authorization: Bearer <access token>` header is also accepted for non-browser
clients.

### Access rules

| Marker                 | Requirement                                                    |
| ---------------------- | -------------------------------------------------------------- |
| `@Public()`            | None — currently `/health` and the credential endpoints        |
| `@Roles(...)`          | Live membership of the token's organization with a listed role |
| `@PlatformAdminOnly()` | `platformRole = PLATFORM_ADMIN`; never tenant-scoped           |

Authentication is the default: a route with no marker still requires a valid
session. Membership is re-read from the database on every tenant request, so
removing a user or suspending an organization takes effect immediately.

## Implemented (Sprints 0–1)

### `GET /api/health`

Liveness plus database readiness. Always 200 — a degraded database is reported in
the body so monitoring can distinguish "API down" from "database down".

```json
{
  "status": "ok",
  "service": "strategic-intelligence-api",
  "version": "0.1.0",
  "uptimeSeconds": 42,
  "checks": { "database": "up" },
  "timestamp": "2026-01-01T00:00:00.000Z"
}
```

### `POST /api/auth/login`

Body `{ email, password }`. Returns the session and sets both cookies. Limited to
10 attempts per minute per IP. Wrong password and unknown email return an identical
401, so accounts cannot be enumerated.

```json
{
  "user": {
    "id": "…",
    "email": "admin@alpha-medical.local",
    "fullName": "…",
    "platformRole": null
  },
  "memberships": [
    {
      "organizationId": "…",
      "organizationName": "Alpha Medical Group",
      "organizationSlug": "alpha-medical",
      "organizationStatus": "ACTIVE",
      "role": "ORGANIZATION_ADMIN",
      "isDefault": true
    }
  ],
  "activeOrganizationId": "…",
  "activeRole": "ORGANIZATION_ADMIN"
}
```

### `POST /api/auth/refresh`

Rotates the refresh token and re-issues the access token. Returns the same session
shape. Replaying an already-rotated token revokes the whole family and returns 401.
Limited to 30 attempts per minute per IP.

### `POST /api/auth/logout`

Revokes the token family and clears both cookies. Always 204, with or without a
session.

### `GET /api/auth/me`

The current session, rebuilt from the database.

### `POST /api/auth/switch-organization`

Body `{ organizationId }`. Re-scopes the access token to another membership; 403
for an organization the caller does not belong to. The refresh family is preserved —
switching context is not a new login.

### `GET /api/organizations/current`

The caller's own organization. Any member role.

### `PATCH /api/organizations/current`

`ORGANIZATION_ADMIN` only. Accepts `name`, `countryCode`, `currencyCode`,
`timezone`; everything else is stripped. Writes an `organization.updated` audit
entry with before/after values. The organization is taken from the session, so an
`organizationId` in the body is ignored.

### `GET /api/platform/organizations`

`PLATFORM_ADMIN` only. Paginated (`page`, `pageSize`, max 100) list across tenants.

### `PATCH /api/platform/organizations/:id/status`

`PLATFORM_ADMIN` only. Body `{ status }`. Suspending an organization locks its
members out of every tenant route on their next request.

## Planned surface

Built sprint by sprint, per the execution plan:

| Sprint | Endpoints                                                                                                               |
| ------ | ----------------------------------------------------------------------------------------------------------------------- |
| 2      | `/branches`, `/departments`, `/organization-users`, `/industries`                                                       |
| 3      | `/data-sources`, `/imports/upload`, `/imports/:id/map`, `/imports/:id/validate`, `/imports/:id/commit`, `/data-quality` |
| 4      | `/metrics`, `/metrics/:id/values`, `/metrics/:id/trend`, `/metric-targets`                                              |
| 5      | `/platform/industry-packs` (install/inspect)                                                                            |
| 6      | `/dashboard/overview`, `/analytics/metric/:metricId`, `/analytics/comparison`                                           |
| 7      | `/health/current`, `/health/history`, `/alerts`, `PATCH /alerts/:id/status`, `/insights`                                |
| 8      | `/goals`, `/decisions`, `POST /decisions/:id/review`                                                                    |
| 9      | `POST /ai/query`, `/ai/conversations`                                                                                   |
| 10     | `/audit`, `/reports`                                                                                                    |

## Rate limiting

Global throttle of `RATE_LIMIT` requests per minute per IP (default 120), applied
by `ThrottlerGuard`. `POST /auth/login` allows 10 per minute and
`POST /auth/refresh` 30. Exceeding a limit returns `RATE_LIMITED` (429).

The limiter is in-memory, so it is per API instance. Running more than one replica
needs a shared store before the limits mean anything.

## Security headers

`helmet()` on the API; Nginx adds CSP, `X-Content-Type-Options`, `X-Frame-Options`
and `Referrer-Policy` for the client. CORS is an explicit allow-list from
`CORS_ORIGINS`; in Docker the client is served same-origin and needs none.
