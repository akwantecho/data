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
pnpm --filter @sip/api dev                  # http://localhost:3000/api
pnpm --filter @sip/web dev                  # http://localhost:5173
```

## Environment variables

### API (`apps/api/.env`)

| Variable       | Default                 | Notes                                        |
| -------------- | ----------------------- | -------------------------------------------- |
| `NODE_ENV`     | `development`           | `production` in deployed environments        |
| `PORT`         | `3000`                  |                                              |
| `API_PREFIX`   | `api`                   | Must match the Nginx proxy path              |
| `DATABASE_URL` | —                       | Required; the API refuses to boot without it |
| `CORS_ORIGINS` | `http://localhost:5173` | Comma separated allow-list                   |
| `RATE_LIMIT`   | `120`                   | Requests per minute per IP                   |
| `LOG_LEVEL`    | `log`                   |                                              |

### Compose (`.env`)

`POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `POSTGRES_PORT`, `API_PORT`,
`WEB_PORT`, `CORS_ORIGINS`, `RATE_LIMIT`.

Secrets are never committed. `.env` files are git-ignored; only `.env.example`
files are tracked.

## Production checklist

- [ ] Strong, generated `POSTGRES_PASSWORD`; database not published to the host
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
