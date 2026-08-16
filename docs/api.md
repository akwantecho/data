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

## Implemented (Sprint 0)

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

## Planned surface

Built sprint by sprint, per the execution plan:

| Sprint | Endpoints                                                                                                               |
| ------ | ----------------------------------------------------------------------------------------------------------------------- |
| 1      | `POST /auth/login`, `POST /auth/refresh`, `GET /auth/me`, `GET/PATCH /organizations/current`                            |
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
by `ThrottlerGuard`. Auth endpoints get tighter limits in Sprint 1.

## Security headers

`helmet()` on the API; Nginx adds CSP, `X-Content-Type-Options`, `X-Frame-Options`
and `Referrer-Policy` for the client. CORS is an explicit allow-list from
`CORS_ORIGINS`; in Docker the client is served same-origin and needs none.
