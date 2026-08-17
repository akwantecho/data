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

## Implemented (Sprints 0–4)

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

### `GET /api/industries`

Active industries, for the selector. Any member role.

### `PUT /api/organizations/current/industry`

`ORGANIZATION_ADMIN` only. Body `{ industryId }`. Refused with `CONFLICT` once the
organization has metric values or imports (plan §37) — the industry decides the
metric pack, so a late change would leave history describing a model that no longer
applies.

### `GET/POST /api/branches`, `GET/PATCH/DELETE /api/branches/:id`

Read for any member role, write for `ORGANIZATION_ADMIN`. `?includeInactive=true`
returns deactivated branches too; the default hides them.

`code` is unique per organization (`CONFLICT` on collision) and is the identifier
CSV imports will map to. `DELETE` succeeds only for a branch with no departments and
no metric values — otherwise `CONFLICT` telling the caller to deactivate instead, so
reported numbers are never silently destroyed.

### `GET/POST /api/departments`, `GET/PATCH/DELETE /api/departments/:id`

Same access rules and delete policy. `branchId` is optional (null means
organization-wide) and must belong to the caller's organization — a foreign id is a
`VALIDATION_ERROR` on the `branchId` field, never a silent accept. Supports
`?branchId=` and `?includeInactive=`.

### `GET /api/organization-users`

The team. Any member role; passwords and hashes are never included.

### `POST /api/organization-users`

`ORGANIZATION_ADMIN` only. Body `{ email, role, fullName?, temporaryPassword? }`.
An existing platform user is simply given a membership; an unknown email creates the
account, which requires `fullName` and an initial `temporaryPassword` (≥12
characters, mixed case and a digit). Platform staff cannot be added to a tenant.

### `PATCH /api/organization-users/:userId`

`ORGANIZATION_ADMIN` only. Body `{ role }`. Refused with `CONFLICT` when it would
remove the organization's last administrator.

### `DELETE /api/organization-users/:userId`

`ORGANIZATION_ADMIN` only. Removes the membership, keeping the user account (they
may belong to other organizations). Access ends on the member's very next request —
`AuthorizationGuard` re-reads membership rather than trusting the token. Refused for
the last administrator.

### `GET/POST /api/data-sources`, `PATCH/DELETE /api/data-sources/:id`

Read for any member; create and update for `ORGANIZATION_ADMIN` and `ANALYST`
(analysts import data, so they manage what they import from); delete for
`ORGANIZATION_ADMIN`, and only while the source has no import history.

### The import pipeline

Five steps, each persisted, so an import is an auditable operation rather than a
transient upload (plan §14). Upload/map/validate/commit/cancel require
`ORGANIZATION_ADMIN` or `ANALYST`; reading is open to any member.

| Step | Route                        | Notes                                                                                                                                                                                                        |
| ---- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1    | `POST /imports/upload`       | `multipart/form-data` with `file` and optional `dataSourceId`. `.csv` only, 10 MB and 50,000 rows maximum. Returns columns, a suggested mapping, sample rows and the metric codes this organization accepts. |
| 2    | `POST /imports/:id/map`      | `{ metricCode, period, value, branchCode?, departmentCode?, currency? }` — each value is a **column name from the file**.                                                                                    |
| 3    | `POST /imports/:id/validate` | Checks every row and stores the outcome. Re-runnable after a mapping fix.                                                                                                                                    |
| 4    | `POST /imports/:id/commit`   | Writes accepted rows into `metric_values`.                                                                                                                                                                   |
| —    | `POST /imports/:id/cancel`   | Abandons an import before commit; the record and rows are kept.                                                                                                                                              |

Reading: `GET /imports` (paginated), `GET /imports/:id` (summary plus issues), and
`GET /imports/:id/rows?status=REJECTED` for the rows exactly as received.

**The expected CSV shape** is one row per measurement:

```text
Metric,Period,Value,Branch
revenue,2026-01,128400,muscat
customers,2026-01,1240,muscat
```

Periods are written as `2026-01` (month), `2026-Q1`, `2026-W05`, `2026` or
`2026-01-31`, and the shape decides the period type — which must match the metric's
own frequency.

**Duplicate protection**: an import is unique on `(organization, file checksum)`.
Re-uploading a file that was already committed returns `CONFLICT`; re-uploading one
that was cancelled or abandoned simply replaces it. Committing twice is refused.

**Idempotence**: metric values are keyed by
`(metric, period, branch, department)`, so re-importing a corrected file for the
same period replaces the value instead of double counting.

### `GET/POST /api/metrics`, `GET/PATCH/DELETE /api/metrics/:id`

Read for any member; create and update for `ORGANIZATION_ADMIN` and `ANALYST`;
delete for `ORGANIZATION_ADMIN` only, and only for a metric with no stored values,
no dependants and no industry-pack origin — otherwise `CONFLICT` pointing at
deactivation.

A metric carries `code`, `name`, `unit`, `aggregationType`, `frequency`,
`direction` and an optional `category`. `aggregationType: FORMULA` makes it a
calculated metric and requires a `formula`.

**Formulas** are arithmetic over metric codes: `net_profit / revenue * 100`. They
are parsed, never evaluated as code (ADR-0008), and validated on save: the syntax
must parse, every referenced code must exist in the organization, and the result
must not create a cycle — the error names the loop.

### `GET /api/metrics/:id`

The metric detail payload (plan §25): definition, formula, dependencies and
dependants, current and previous value, period-over-period change, target and
variance to it, thresholds and the resulting status, the trend series and the last
update time.

### `GET /api/metrics/:id/trend`

The series alone, oldest first, optionally for one branch.

### `POST /api/metrics/:id/values`

Manual data entry (plan §2). Body `{ period, value, branchId?, departmentId? }`.
The period is parsed exactly as an import parses it and must match the metric's
frequency; a calculated metric is refused. Entering a value replaces any previous
value for the same period and slice, then triggers a recalculation of that period.

### `PUT /api/metrics/:id/target`

Body `{ period, targetValue, minValue?, maxValue?, branchId? }`. Replaces the
target for that period rather than adding another.

### `PUT /api/metrics/:id/threshold`

Body `{ warningValue?, criticalValue?, isRelativeToTarget? }`. A relative threshold
is read as a percentage of the target. Direction decides what a breach is: for
`LOWER_IS_BETTER` a value _above_ the limit breaches it.

### `POST /api/metrics/recalculate`

Recalculates every formula metric for the organization and returns
`{ calculated, skipped }`, where each skip names the metric, the period and why —
`MISSING_INPUT` with the missing code, or `DIVISION_BY_ZERO`. Committing an import
runs the same recalculation automatically, scoped to the periods the file touched.

### `GET /api/dashboard/overview`

Any member role. The whole executive dashboard in one request (plan §21): the
resolved window, KPI cards, the headline trend, performance counts against
thresholds and targets, the installed health model, open alerts/insights/goals/
decisions, and the data-quality summary.

Query: `from`, `to` (ISO dates over period starts), `branchId`, `departmentId`.
Both dates are optional — the default is the six months up to the most recent
period the organization reported. See [`analytics.md`](analytics.md) and ADR-0010.

### `GET /api/analytics/options`

Any member role. Metrics, branches, departments and the earliest/latest period with
any stored value, so the filter bar never invents an id.

### `GET /api/analytics/metric/:metricId`

Any member role. One metric over the window: the aggregate, the aggregate over the
preceding window, the change, the target and variance, the threshold status, both
series, plus the metrics it is calculated from, the metrics calculated from it, and
its category peers.

### `GET /api/analytics/comparison`

Any member role. `breakdown=BRANCH|DEPARTMENT` compares one metric (`metricId`)
across slices; `breakdown=METRIC` compares several metrics (`metricIds`, comma
separated, max 6) over the same window, in the order asked for.

### `GET /api/health/current`

Any member role. The latest health score, the one before it, the bands it is read
against and the model that produced it. The score carries its full breakdown:
every category with its weight and score, and every metric with its value, target,
score, contribution and the basis it was scored on. Optional `branchId`.

`GET /api/health` (no sub-path) is the unauthenticated service liveness probe and
is unrelated — see the Health section above.

### `GET /api/health/history`

Any member role. Overall score and band per period, oldest first. `limit` up to 60.

### `POST /api/health/recalculate`

`ORGANIZATION_ADMIN`, `ANALYST`. Rescores every period the organization has data
for, replacing existing scores rather than adding to them.

### `POST /api/analysis/run`

`ORGANIZATION_ADMIN`, `ANALYST`. Runs health, then alerts, then insights for the
latest period with data — the same sequence an import commit runs (plan §49).
Returns what each engine did.

### `GET /api/alerts`, `GET /api/alerts/:id`

Any member role. Paginated, filterable by `status`, `severity` and `metricId`. Each
alert carries its rule, metric, period, severity, status and the evidence that
raised it; the detail adds every status transition with its actor and note.

### `PATCH /api/alerts/:id/status`

`ORGANIZATION_ADMIN`, `ANALYST`. Body `{ status, note? }`. Moves an alert through
`OPEN → ACKNOWLEDGED → RESOLVED | DISMISSED`; a closed alert cannot be reopened
(`CONFLICT`), because that was a decision.

### `GET /api/insights`, `GET /api/insights/:id`

Any member role. Paginated, filterable by `severity` and `category`. Every insight
carries its narrative and one evidence row per figure it quotes, including which
condition that figure satisfied.

### `GET /api/industry-packs`

Any member role. What applies to this organization: the industry, the packs
published for it (with `installedVersion` when installed), the organization's own
health model as installed, and the counts of pack metrics and rules it holds. A
pack for another industry never appears here.

### `GET /api/industry-packs/:id`

Any member role. Full contents of a pack: metrics with formulas, health categories
with weights, insight rules and alert rules with the metrics each reads. Resolved
through the caller's industry — a pack from another industry is `NOT_FOUND`, not
`FORBIDDEN`, because a tenant has no business knowing it exists.

### `POST /api/industry-packs/:id/install`

`ORGANIZATION_ADMIN` only. Installs the pack into the organization and returns what
it did: `metricsCreated`, `metricsKept`, `healthModelCreated`,
`healthCategoriesCreated`, and created/kept counts for both kinds of rule.

Idempotent and non-destructive: anything already present under the same code is
left exactly as the organization has it, so re-installing picks up what a newer
pack version added without undoing a customization. The whole install is one
transaction.

### `GET /api/data-quality`

Rule-based quality for the organization (plan §16): overall score, completeness,
validity, freshness, days since the last import, rejected-row count, confidence and
a per-source breakdown. Any member role.

### `GET /api/platform/industry-packs`

`PLATFORM_ADMIN` only. Every published pack across every industry, with its version
and what it installs.

### `GET /api/platform/industry-packs/:id`

`PLATFORM_ADMIN` only. The same detail payload as the tenant route, without the
industry restriction.

### `POST /api/platform/industry-packs/sync`

`PLATFORM_ADMIN` only. Re-reads the shipped catalogue into the pack tables and
returns per-pack counts. Installed organizations are untouched: syncing changes
what a _future_ install produces, and an existing tenant picks it up by installing
again.

### `GET /api/platform/organizations`

`PLATFORM_ADMIN` only. Paginated (`page`, `pageSize`, max 100) list across tenants.

### `PATCH /api/platform/organizations/:id/status`

`PLATFORM_ADMIN` only. Body `{ status }`. Suspending an organization locks its
members out of every tenant route on their next request.

## Planned surface

Built sprint by sprint, per the execution plan:

| Sprint | Endpoints                                                                                                                        |
| ------ | -------------------------------------------------------------------------------------------------------------------------------- |
| 2      | `/branches`, `/departments`, `/organization-users`, `/industries`                                                                |
| 3      | `/data-sources`, `/imports/upload`, `/imports/:id/map`, `/imports/:id/validate`, `/imports/:id/commit`, `/data-quality`          |
| 4      | `/metrics`, `/metrics/:id/values`, `/metrics/:id/trend`, `/metric-targets`                                                       |
| 5      | `/industry-packs`, `/industry-packs/:id/install`, `/platform/industry-packs`, `/platform/industry-packs/sync`                    |
| 6      | `/dashboard/overview`, `/analytics/options`, `/analytics/metric/:metricId`, `/analytics/comparison`                              |
| 7      | `/health/current`, `/health/history`, `/health/recalculate`, `/analysis/run`, `/alerts`, `PATCH /alerts/:id/status`, `/insights` |
| 8      | `/goals`, `/decisions`, `POST /decisions/:id/review`                                                                             |
| 9      | `POST /ai/query`, `/ai/conversations`                                                                                            |
| 10     | `/audit`, `/reports`                                                                                                             |

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
