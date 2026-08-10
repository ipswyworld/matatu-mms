# Deployment — nginx, observability, Postgres, self-hosted stack

This covers what was added to take the system from "runs on my laptop" toward
"runs on our own servers, self-regulated, 24/7."

## What's here

| Path | Purpose |
|---|---|
| `docker-compose.yml` | Ties backend, frontend, nginx, Prometheus, Alertmanager, Grafana together. |
| `nginx/` | Reverse proxy: TLS termination, rate limiting, gzip, security headers, WebSocket upgrade for GPS telemetry + live dashboard feed. See `nginx/README.md` for certificate setup. |
| `prometheus/` | Scrape config (`prometheus.yml`) + starter alert rules (`alerts.yml`) — backend down, elevated 5xx rate, high p95 latency. |
| `alertmanager/` | Routes firing alerts somewhere real. **Ships with a placeholder webhook — point it at Slack/PagerDuty/SMS before relying on it.** |
| `backend/Dockerfile` | Backend container image. |
| `matatu-mms/Dockerfile` | Frontend container image (multi-stage Next.js build). |
| `.env.example` | Every environment variable the stack needs. Copy to `.env` and fill in real values — never commit the real file. |

## Backend observability additions

- **`GET /healthz`** — liveness only (process is up). No DB check, so a slow
  DB fails readiness, not liveness.
- **`GET /readyz`** — readiness (can this instance actually serve traffic:
  DB reachable via `SELECT 1`). Returns 503 if not.
- **`GET /metrics`** — Prometheus format via `prometheus-fastapi-instrumentator`.
  Request count/latency/status broken down by route. **Never exposed
  publicly** — nginx explicitly returns 403 on `/metrics`; Prometheus
  scrapes it directly over the Docker network.
- **Structured JSON logs** (`app/logging_config.py`) — every log line is a
  JSON object (`timestamp`, `level`, `logger`, `message`, plus whatever you
  pass via `extra={...}`), so a log aggregator (Loki/ELK) can actually query
  them instead of you grepping stdout.

## Database — Postgres + Alembic

SQLite is gone as the real target: it single-writer-locks the whole file,
which caps concurrency hard. Postgres is now the default in
`docker-compose.yml` (a `postgres` service, schema owned by Alembic
migrations under `backend/alembic/`). SQLite is still available as an
explicit opt-out (`DATABASE_URL=sqlite+aiosqlite:///./data/mms.db`) for a
zero-setup throwaway local run — in that mode the app still self-creates
its schema on startup like before, since there's no migration history worth
preserving for a disposable dev file.

**Connection pooling** (`app/database.py`): Postgres gets a real pool
(`pool_size=20`, `max_overflow=10`, `pool_pre_ping=True`, 30-minute
recycle) instead of SQLite's `NullPool`. Tune `pool_size` against your
actual concurrent request volume once you have production numbers — 20 is
a reasonable starting point, not a measured ceiling.

**Migration workflow going forward** — no more "delete the db file":

```bash
# After changing a model in app/models.py:
cd backend
DATABASE_URL=postgresql+asyncpg://matatu:PASSWORD@localhost:5432/matatu_mms \
  python -m alembic revision --autogenerate -m "describe the change"
# Review the generated file under alembic/versions/ — autogenerate is a
# starting point, not infallible (it won't catch every rename, check
# constraint, etc. — read the diff).
DATABASE_URL=postgresql+asyncpg://matatu:PASSWORD@localhost:5432/matatu_mms \
  python -m alembic upgrade head
```

In Docker, migrations run automatically: `backend/docker-entrypoint.sh`
runs `alembic upgrade head` before starting uvicorn whenever `DATABASE_URL`
is a `postgresql*` URL, and skips it (falls back to `create_all`) for
SQLite.

**Verified this session** against a real `postgres:16-alpine` container (not
just written-and-assumed): migration generation and apply, all 16 tables
created correctly, seed data landing correctly, login, a real read endpoint,
and a real write endpoint (a booking) round-tripping through Postgres.

## Frontend

- **`GET /api/health`** — liveness only, doesn't call the backend.
- `lib/data.ts` / `lib/actions.ts` now read `BACKEND_URL` from the
  environment (falls back to `http://127.0.0.1:8000` for local dev without
  Docker) instead of a hardcoded value — this is what lets the frontend
  container reach the backend container by service name (`http://backend:8000`)
  inside the Docker network.
- Browser-facing links to uploaded documents/photos read
  `NEXT_PUBLIC_BACKEND_URL` (baked in at build time, so it's visible
  client-side) — set this to your real public origin in `.env` once you have
  one; behind nginx everything is same-origin so this can eventually become
  a relative path, but for now it needs the explicit origin.

## Running it

```bash
cp .env.example .env
# edit .env — real secrets, real domain once you have one
docker compose up -d --build
docker compose ps
curl -k https://localhost/          # -k because the dev cert is self-signed
docker compose exec nginx nginx -t  # validate the nginx config on your box
```

Grafana is at `http://127.0.0.1:3001` (bound to localhost only — put it
behind nginx or a VPN before exposing it, it is **not** meant to be public).
Prometheus and Alertmanager are similarly localhost-only.

## What I could not verify in this session

Docker Desktop's engine would not start in this environment (no GUI
session available to the sandbox), so the compose stack has **not** been
run end-to-end here. What I could and did verify directly:

- Every YAML file (`docker-compose.yml`, `prometheus.yml`, `alerts.yml`,
  `alertmanager.yml`) parses as valid YAML.
- `nginx.conf` has balanced braces (a basic structural check — **not** the
  same as `nginx -t`).
- The backend's `/healthz`, `/readyz`, and `/metrics` endpoints all work
  correctly against the actual running dev server, and structured JSON
  logging is confirmed in the live log output.

**Before this goes anywhere near real traffic**, run on your own machine
(or the target server):

```bash
docker compose config          # catches env-var interpolation / schema errors
docker compose up -d --build
docker compose exec nginx nginx -t
docker compose logs -f backend # confirm JSON logs, no startup errors
curl -k https://localhost/healthz
curl -k https://localhost/api/health   # through nginx, not the frontend directly
```

## Still outstanding (not built this session)

- **Real TLS certificate** — the shipped cert is self-signed, dev-only.
- **Postgres read replica** for analytics/data-science access — everything
  still reads/writes the single primary; a scoped `DATA_ANALYST` role
  reading a replica (not the OLTP primary) is a follow-up from the audit.
- **Grafana dashboards** — Prometheus is scraping and Grafana is wired up,
  but no dashboards are provisioned yet; you'll see raw metrics only until
  dashboards are built or imported.
- **Alertmanager receiver** — currently a placeholder webhook. Wire it to
  Slack/PagerDuty/SMS before you actually depend on it paging someone.
