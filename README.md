# Mji-Move (matatu-mms)

A Nairobi City County Government (NCCG) system for managing matatu (minibus
PSV) fleet operations end to end: vehicle registration, live GPS telemetry,
seat booking, fare compliance, fines, and enforcement — all wired to one
event pipeline so an action in one role (a booking, a fine, a passenger
report) is immediately visible to the roles it affects.

Five roles, one backend: **Passengers** (book seats, report issues),
**Crew** (driver/conductor — seat occupancy, ticket validation, live GPS),
**Enforcement officers** (compliance, fines, citations), **Sacco operators**
(fleet onboarding/licensing), and **Admins** (county-wide oversight).

See [`matatu-mms/PRODUCT.md`](matatu-mms/PRODUCT.md) for the full product/design brief and
[`ARCHITECTURE_DECISIONS.md`](ARCHITECTURE_DECISIONS.md) for system design rationale.

## Repo layout

This is a multi-service monorepo:

| Path | What it is | Stack |
|---|---|---|
| `backend/` | Core API — auth, fleet, bookings, fines, telemetry, real-time events | FastAPI + SQLAlchemy (Postgres/SQLite) + Redis + arq workers |
| `matatu-mms/` | Admin/enforcement/sacco dashboard | Next.js 14 (App Router, TS, Tailwind) |
| `matatu-mms-public/` | Passenger-facing app (booking, reporting) | Next.js 14 (App Router, TS, Tailwind) |
| `matatu-mms-ops/` | Internal ops dashboard | Next.js 14 (App Router, TS, Tailwind) |
| `nginx/`, `prometheus/`, `alertmanager/` | Reverse proxy + observability stack config | — |
| `scripts/` | Ops/maintenance scripts | — |

Operational runbooks and status docs live at the repo root: [`DEPLOYMENT.md`](DEPLOYMENT.md),
[`RUNBOOKS.md`](RUNBOOKS.md), [`BACKUP_RECOVERY_POLICY.md`](BACKUP_RECOVERY_POLICY.md),
[`SESSION_SECURITY_STATUS.md`](SESSION_SECURITY_STATUS.md),
[`TENANT_ISOLATION_AUDIT.md`](TENANT_ISOLATION_AUDIT.md), and others listed in the repo root.

## Running locally

### Everything, via Docker Compose (recommended)

Brings up the backend, Postgres, Redis, all three frontends, nginx, and the
Prometheus/Grafana/Alertmanager monitoring stack:

```bash
cp .env.example .env   # fill in secrets
docker-compose up --build
```

### Individual services, for day-to-day dev

See the [Command reference](#command-reference) below for backend, frontend, pm2 and test commands.

### Demo accounts (admin dashboard)

| Role | Email | Password |
|---|---|---|
| Admin | admin@nairobi.go.ke | admin123 |
| Enforcement Officer | enforcement@nairobi.go.ke | enforce123 |
| Sacco Operator | operator@umoinner.co.ke | sacco123 |
| Viewer / Executive | viewer@nairobi.go.ke | viewer123 |

## Command reference

All commands run from the repo root unless a `cd` is shown. Ports: backend `8000`,
staff dashboard `3000`, public app `3001`, ops dashboard `3002`.

### Keep dev servers running with pm2 (recommended on Windows)

[`ecosystem.config.js`](ecosystem.config.js) defines `backend`, `staff`, `public` and `ops`.
It points at each app's local `next` binary and the backend's venv Python, because pm2 can't
launch `npm.cmd` directly on Windows. pm2 processes survive closed terminals and tool sessions.

```bash
npm install -g pm2                              # one-time
pm2 start ecosystem.config.js --only backend,staff,public   # add ",ops" if needed
pm2 list                                        # status, restarts, memory
pm2 logs staff                                  # tail one app's logs (backend | staff | public | ops)
pm2 restart public                              # restart one app
pm2 stop all                                    # stop everything (keeps the entries)
pm2 delete all                                  # remove everything
pm2 save                                        # remember the current process list
pm2 resurrect                                   # bring the saved list back (run after a reboot)
```

pm2 does not auto-start on boot by itself; run `pm2 resurrect` after restarting Windows.

### Backend (FastAPI)

```bash
cd backend
python -m venv venv && venv\Scripts\activate    # macOS/Linux: source venv/bin/activate
pip install -r requirements.txt
alembic upgrade head                            # apply DB migrations
alembic current                                 # which migration the DB is on
alembic heads                                   # latest migration in the code (should be one)
alembic revision -m "describe change"           # new migration
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

API docs are served at `http://127.0.0.1:8000/docs`.

### Backend tests

```bash
cd backend
pip install pytest pytest-asyncio               # test-only deps, not in requirements.txt
python -m pytest -q                             # security-regression + weather-bias suites
python test_backend.py                          # standalone legacy script (not collected by pytest)
```

### Frontends (staff `matatu-mms`, public `matatu-mms-public`, ops `matatu-mms-ops`)

```bash
cd matatu-mms                                   # or matatu-mms-public / matatu-mms-ops
npm install
npm run dev                                     # dev server
npm run build && npm start                      # production build and server
npm run lint
npx tsc --noEmit                                # type-check without building
```

### Docker

```bash
cp .env.example .env                            # then fill in secrets
docker-compose up --build                       # full stack incl. Postgres, Redis, nginx, monitoring
docker-compose down                             # stop and remove containers
docker-compose logs -f backend                  # follow one service's logs
```

### Health and troubleshooting

```bash
netstat -ano | findstr ":3000 :3001 :3002 :8000"   # what is listening (Windows)
curl -I http://localhost:3000                       # staff app (307 redirect to /login is normal)
curl -I http://localhost:3001                       # public app
curl http://127.0.0.1:8000/docs                     # backend
```

| Symptom | Fix |
|---|---|
| "Unable to connect" on `localhost:3000/3001` | Nothing is running (often after a reboot). `pm2 resurrect`, or `pm2 start ecosystem.config.js --only backend,staff,public`. |
| Dev page shows "System error / Something broke down" | Check `pm2 logs <app>`; if you see `__webpack_modules__[moduleId] is not a function` or `Cannot find module ...\.next\server\...`, stop the app, delete that app's `.next` folder, and start it again. |
| Browser console: CSP `connect-src` violations for `127.0.0.1:8000` | The dev server is stale. `next.config.mjs` is only read at startup, so `pm2 restart` the app. |
| First page load takes 40-75 s | Normal cold compile in `next dev`; later loads are fast. |

### Git

```bash
git status -sb
git add <files> && git commit -m "message"      # prefer naming files over `git add .`
git push origin deploy/render-demo              # this branch deploys to Render
```

Never commit `.env`, `backend/mms.db`, or `backend/mms.db.bak-*` (real user data); they are gitignored.

## Deployment

Deployed on Render — see [`render.yaml`](render.yaml) for the full service topology
(`matatu-mms-backend`, `matatu-mms-db`, `matatu-mms-redis`, `matatu-mms-frontend`,
`matatu-mms-ops`, `matatu-mms-public`) and [`DEPLOYMENT.md`](DEPLOYMENT.md) for the
deploy runbook.

## Configuration

Copy `.env.example` to `.env` and fill in the values — it covers database URL, Redis,
JWT/session secrets, SMS provider, Sentry DSN, and object storage credentials used
across the backend and frontends.
