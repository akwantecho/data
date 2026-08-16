# Deployment

> Sprint 0 baseline. Hardening (backups, monitoring, TLS automation) is Sprint 10.

## Topology

```text
Browser → Nginx (web container, port 80)
            ├── /            static React bundle
            └── /api/        proxied to the API container
                              API (Node 22, port 3000)
                                → PostgreSQL 16
```

Serving the client and the API from the same origin means the browser never makes
a cross-origin request, so CORS is only relevant for local `vite dev`.

## Local stack

```bash
cp .env.example .env
docker compose up --build
```

- Web: http://localhost:8080
- API: http://localhost:3000/api/health
- PostgreSQL: localhost:5432

The API container runs `prisma migrate deploy` before starting, so a fresh
environment converges to the current schema automatically.

## Running without Docker

```bash
pnpm install
pnpm --filter @sip/shared-types build
cp apps/api/.env.example apps/api/.env      # point DATABASE_URL at your PostgreSQL
pnpm --filter @sip/api db:migrate
pnpm --filter @sip/api db:seed              # development accounts, see docs/database.md
pnpm --filter @sip/api dev                  # http://localhost:3000/api
pnpm --filter @sip/web dev                  # http://localhost:5173
```

## Environment variables

### API (`apps/api/.env`)

| Variable             | Default                 | Notes                                                    |
| -------------------- | ----------------------- | -------------------------------------------------------- |
| `NODE_ENV`           | `development`           | `production` in deployed environments                    |
| `PORT`               | `3000`                  |                                                          |
| `API_PREFIX`         | `api`                   | Must match the Nginx proxy path                          |
| `DATABASE_URL`       | —                       | Required; the API refuses to boot without it             |
| `CORS_ORIGINS`       | `http://localhost:5173` | Comma separated allow-list                               |
| `RATE_LIMIT`         | `120`                   | Requests per minute per IP                               |
| `THROTTLE_ENABLED`   | `true`                  | Tests only may set false; rejected in production         |
| `LOG_LEVEL`          | `log`                   |                                                          |
| `JWT_ACCESS_SECRET`  | —                       | Required, ≥32 chars, must differ from the refresh secret |
| `JWT_REFRESH_SECRET` | —                       | Required, ≥32 chars                                      |
| `JWT_ACCESS_TTL`     | `900`                   | Access token lifetime in seconds                         |
| `JWT_REFRESH_TTL`    | `604800`                | Refresh token lifetime in seconds                        |
| `COOKIE_SECURE`      | `false`                 | Must be true in production (enforced at boot)            |
| `COOKIE_DOMAIN`      | unset                   | Set when the API and client share a parent domain        |

Generate secrets with `openssl rand -base64 48`. The API refuses to boot with a
missing, short, or duplicated secret — there is no development fallback, because a
fallback secret eventually ships to production.

### Compose (`.env`)

`POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `POSTGRES_PORT`, `API_PORT`,
`WEB_PORT`, `CORS_ORIGINS`, `RATE_LIMIT`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`,
`JWT_ACCESS_TTL`, `JWT_REFRESH_TTL`, `COOKIE_SECURE`.

Compose fails fast if the JWT secrets are unset — it will not start the stack with
placeholder credentials.

Secrets are never committed. `.env` files are git-ignored; only `.env.example`
files are tracked.

## Production checklist

- [ ] Strong, generated `POSTGRES_PASSWORD`; database not published to the host
- [ ] Freshly generated `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET`, stored in the
      deployment's secret manager and never committed
- [ ] `COOKIE_SECURE=true` (the API refuses to boot otherwise in production)
- [ ] Seed data **not** applied — `db:seed` creates known development passwords
- [ ] `NODE_ENV=production`
- [ ] TLS terminated in front of the web container (Caddy, or Nginx with certbot)
- [ ] `CORS_ORIGINS` restricted to the real client origin
- [ ] Managed or scheduled PostgreSQL backups, with a tested restore
- [ ] Container/host log shipping and an error-monitoring hook
- [ ] `/api/health` wired to uptime monitoring
- [ ] Image builds pinned to a tagged commit

## Rollback

Application: redeploy the previous image tag. Database: migrations are forward-only
by default — a change that cannot be rolled forward safely needs a compensating
migration, written and reviewed before the deploy that requires it.
