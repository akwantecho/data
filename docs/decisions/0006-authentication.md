# ADR-0006: httpOnly cookie sessions with rotating refresh tokens

- **Status**: Accepted (Sprint 1)

## Context

The platform holds an organization's financial and operational data. A stolen
session is the highest-impact failure available to an attacker, so the token
strategy needed deciding before any product endpoint exists. The plan requires
password hashing, JWT expiry, a refresh strategy, and explicit CSRF consideration
"depending on token strategy" (§44).

The realistic options were a bearer token held in JavaScript (localStorage or
memory) or a token in an httpOnly cookie.

## Decision

### Transport: httpOnly cookies

`sip_access` (15 minutes) and `sip_refresh` (7 days), both `HttpOnly`,
`SameSite=Lax`, `Secure` outside local HTTP development. The refresh cookie is
scoped to `Path=/api/auth`, so it is not sent to ordinary API routes.

A token in `localStorage` is readable by any script that lands on the page; one
XSS bug becomes full account takeover with an exportable token. An httpOnly
cookie cannot be read by script — XSS could still ride the session, but only from
the user's browser, only while they are online, and without exfiltrating anything
reusable later.

**CSRF**: `SameSite=Lax` stops the cross-site POST a CSRF attack needs. The client
and API are same-origin in every deployment (Nginx serves both), so no cross-site
credentialed request is legitimate. A JSON `Content-Type` is also required, which
a simple cross-site form cannot set. If a future integration requires cross-site
credentials, this decision must be revisited with an explicit CSRF token.

A `Bearer` header is still accepted for non-browser clients and integration tests.

### Password hashing: Argon2id

19 MiB memory, 2 iterations, parallelism 1 — the OWASP baseline. Memory-hard by
design, unlike bcrypt, which resists GPU cracking far less well. The salt is
generated per hash and embedded in the encoded output.

### Refresh rotation with reuse detection

Every refresh issues a new token and revokes the old one. All tokens descending
from one login share a `familyId`. Presenting an already-rotated token means the
token leaked, so the entire family is revoked: the attacker and the victim are
both signed out, and the victim notices. Without rotation a stolen refresh token
is valid for its full lifetime and nothing reveals the theft.

Only a SHA-256 hash of each refresh token is stored. SHA-256 rather than Argon2 is
correct here: the token is 256 bits from a CSPRNG, not a guessable secret, and the
lookup happens on every refresh.

### Authorization re-checked per request

The access token carries the organization and role, but `AuthorizationGuard`
re-reads membership from the database on every tenant request. A token lives 15
minutes; a user removed from an organization, or an organization that gets
suspended, must lose access immediately rather than at token expiry.

### Secrets

`JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` have no defaults and must differ.
A development fallback secret eventually reaches production; failing to boot is
the safer outcome. Production additionally refuses to start with `COOKIE_SECURE`
false or throttling disabled.

## Consequences

- The client cannot inspect the session; it asks `GET /auth/me` and treats a 401 as
  "signed out". This is why the API client refreshes once and retries on a 401.
- Concurrent requests must share one refresh call, or parallel rotations would
  trip the platform's own reuse detection. The web client single-flights it.
- Revocation is real: logout and reuse detection both revoke server-side state,
  which stateless-JWT designs cannot do.
- Membership lookups add one indexed query per tenant request. That is the price of
  immediate revocation, and it is a primary-key hit.
- Cross-origin browser clients are not supported without revisiting CSRF.
