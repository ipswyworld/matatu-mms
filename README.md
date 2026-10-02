# Mji-Move (matatu-mms)

A Nairobi City County Government (NCCG) platform that puts matatu (minibus PSV) operations on one real-time backbone: vehicle registration, live GPS telemetry, seat booking, fare compliance, fines, and enforcement. An action in one role (a booking, a fine, a passenger report) is immediately visible to every role it affects.

> **Naming:** the product is **Mji-Move**. Repo folders, package names, Render services and env vars still use the older `matatu-mms` name.

> **Note:** this is the `master` branch, which is behind the actively developed and deployed branch, [`deploy/render-demo`](https://github.com/ipswyworld/matatu-mms/tree/deploy/render-demo). Several files described below (the ops console, `render.yaml`, most docs) only exist there, so links to them point to that branch. The quick start below checks it out for you.

## Contents

- [What it does](#what-it-does)
- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Quick start (local, no Docker)](#quick-start-local-no-docker)
- [Demo accounts](#demo-accounts)
- [Configuration](#configuration)
- [Command reference](#command-reference)
- [Testing](#testing)
- [Troubleshooting](#troubleshooting)
- [Deployment](#deployment)
- [Further documentation](#further-documentation)

## What it does

| Role | Where they work | What they do |
|---|---|---|
| **Passengers** | Public app | Plan a trip, browse routes, book seats, pay fines, rate trips, save favourites, report issues |
| **Crew** (driver / conductor) | Public app | Manage seat occupancy, validate tickets, stream live GPS |
| **Sacco operators** | Public app | Onboard and verify their Sacco, register vehicles, issue crew logins, declare terminals, upload fare charts |
| **Enforcement officers** | Staff app | Compliance checks, fines and citations, enforcement cases, duty rosters and beats |
| **County officials** (Director of Mobility, Chief Officer, admins, viewers) | Staff app | Two-stage operator verification, fleet and revenue oversight, user governance, audit logs |
| **Platform operators** | Ops console | Health, config and feature flags, jobs, integrations, sessions, compliance |

## Architecture

A monorepo of one API and three Next.js front ends.

| Path | What it is | Stack | Local port |
|---|---|---|---|
| `backend/` | Core API: auth, fleet, bookings, fines, telemetry, real-time events | FastAPI, SQLAlchemy 2 (async), Alembic | `8000` |
| `matatu-mms/` | **Staff app**: admin, enforcement, verification (front door `/login`) | Next.js 14, TypeScript, Tailwind | `3000` |
| `matatu-mms-public/` | **Public app**: passengers, crew, Sacco operators (front door `/`) | Next.js 14, TypeScript, Tailwind | `3001` |
| `matatu-mms-ops/` | **Ops console**: internal platform operations | Next.js 14, TypeScript, Tailwind | `3002` |
| `nginx/`, `prometheus/`, `alertmanager/` | Reverse proxy and monitoring config | n/a | n/a |
| `scripts/` | Maintenance scripts | n/a | n/a |

- **Database:** SQLite for local dev (`backend/mms.db`, created and seeded with demo data on first start); PostgreSQL in Docker and on Render. Schema changes go through Alembic.
- **Real time:** WebSockets for GPS, notifications, and live dashboard refresh. Redis-backed broadcasting is used when Redis is available and is not required for a basic local run.
- **Sessions:** each front end signs its own session cookie with its own secret, so the three apps are independent deployments.

## Prerequisites

| Tool | Version used here | Needed for |
|---|---|---|
| Node.js | 22 (18+ should work) | the three Next.js apps |
| Python | 3.12 | the backend |
| Git | any recent | cloning |
| pm2 (optional) | 7.x | keeping dev servers running on Windows |
| Docker (optional) | any recent | the full containerised stack |

## Quick start (local, no Docker)

Run these from the repo root. Examples use PowerShell-friendly paths; on macOS/Linux use `source venv/bin/activate` instead of `venv\Scripts\activate`.

**1. Clone**

```bash
git clone https://github.com/ipswyworld/matatu-mms.git
cd matatu-mms
git checkout deploy/render-demo
```

**2. Backend (port 8000)**

```bash
cd backend
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
```

Create `backend/.env` with a signing secret (any long random string for local use). The backend will start without it, but it then generates a random key per run and every restart logs everyone out:

```ini
SECRET_KEY=change-me-to-a-long-random-string-at-least-32-chars
NAIROBIPAY_CALLBACK_SECRET=change-me-too
```

Then migrate and start:

```bash
alembic upgrade head
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

On first start the backend creates `mms.db` (SQLite) and seeds demo data. Interactive API docs: <http://127.0.0.1:8000/docs>.

**3. Front ends (one terminal each)**

Each app needs a `.env.local` (see [Configuration](#configuration)), then:

```bash
cd matatu-mms && npm install && npm run dev          # staff   -> http://localhost:3000
cd matatu-mms-public && npm install && npm run dev   # public  -> http://localhost:3001
cd matatu-mms-ops && npm install && npm run dev      # ops     -> http://localhost:3002
```

The first page load after a cold start takes 40-75 seconds while Next compiles; later loads are fast.

**4. Sign in** with a [demo account](#demo-accounts). Staff accounts use `http://localhost:3000`, passenger/crew/operator accounts use `http://localhost:3001`.

## Demo accounts

Local seed data only. Never reuse these on a real deployment.

**Staff app (`:3000`)**

| Role | Email | Password |
|---|---|---|
| Admin | admin@nairobi.go.ke | admin123 |
| Enforcement officer | enforcement@nairobi.go.ke | enforce123 |
| Viewer / executive | viewer@nairobi.go.ke | viewer123 |
| Director of Mobility | director.mobility@nairobi.go.ke | director123 |
| Chief Officer | chiefofficer@nairobi.go.ke | chief123 |
| Enforcement commander | commander@nairobi.go.ke | commander123 |
| Arresting officer | arresting.officer@nairobi.go.ke | arrest123 |
| Releasing officer | releasing.officer@nairobi.go.ke | release123 |

**Public app (`:3001`)**

| Role | Email | Password |
|---|---|---|
| Commuter (passenger) | commuter@nairobi.go.ke | pass123 |
| Driver / conductor (crew) | crew@umoinner.co.ke | crew123 |
| Sacco operator | operator@umoinner.co.ke | sacco123 |
| Operator (pending onboarding) | operator@kilimanidirect.co.ke | sacco123 |

## Configuration

`.env.example` at the repo root lists every variable for the Docker stack (database, Redis, secrets, storage, SMS, Sentry). For plain local dev you only need the following.

| File | Variables | Notes |
|---|---|---|
| `backend/.env` | `SECRET_KEY`, `NAIROBIPAY_CALLBACK_SECRET` | Strongly recommended (without `SECRET_KEY`, a random one is generated per run). `DATABASE_URL` defaults to local SQLite; set it to use Postgres. `REDIS_URL` defaults to `redis://127.0.0.1:6379/0` and is optional locally. |
| `matatu-mms/.env.local` | `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_WS_URL`, `NEXT_PUBLIC_TOMTOM_API_KEY` | API is `http://127.0.0.1:8000`, WS is `ws://127.0.0.1:8000`. The TomTom key is optional: without it the map falls back to free CARTO/OSM tiles. |
| `matatu-mms-public/.env.local` | same three as staff | Same values. |
| `matatu-mms-ops/.env.local` | `BACKEND_URL`, `OPS_SESSION_SECRET`, `GRAFANA_EMBED_URL` | `OPS_SESSION_SECRET` must be a long random string. |

Never commit `.env` files, `backend/mms.db`, or `backend/mms.db.bak-*`; they are gitignored and may contain real user data.

## Command reference

### Keep dev servers running with pm2 (recommended on Windows)

[`ecosystem.config.js`](https://github.com/ipswyworld/matatu-mms/blob/deploy/render-demo/ecosystem.config.js) defines `backend`, `staff`, `public` and `ops`. It points at each app's local `next` binary and the backend's venv Python, because pm2 cannot launch `npm.cmd` directly on Windows. pm2 processes survive closed terminals.

```bash
npm install -g pm2                                          # one-time
pm2 start ecosystem.config.js --only backend,staff,public   # add ",ops" if needed
pm2 list                                                    # status, restarts, memory
pm2 logs staff                                              # tail logs (backend | staff | public | ops)
pm2 restart public                                          # restart one app
pm2 stop all                                                # stop everything, keep entries
pm2 delete all                                              # remove everything
pm2 save                                                    # remember the current process list
pm2 resurrect                                               # restore the saved list
```

pm2 has no built-in startup support on Windows. A Task Scheduler task named `pm2-resurrect` runs `pm2 resurrect` 30 seconds after you log in, so the last `pm2 save`d list returns after a reboot. Re-run `pm2 save` whenever you add or remove an app. To recreate the task on another machine (PowerShell):

```powershell
$a = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c `"$env:APPDATA\npm\pm2.cmd`" resurrect"
$t = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"; $t.Delay = "PT30S"
Register-ScheduledTask -TaskName "pm2-resurrect" -Action $a -Trigger $t -Force
Unregister-ScheduledTask pm2-resurrect -Confirm:$false      # remove it
```

### Backend

```bash
cd backend
alembic upgrade head                      # apply migrations
alembic current                           # migration the DB is on
alembic heads                             # latest migration in code (should be exactly one)
alembic revision -m "describe change"     # create a migration
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

### Front ends

```bash
cd matatu-mms                             # or matatu-mms-public / matatu-mms-ops
npm run dev                               # dev server
npm run build && npm start                # production build and server
npm run lint
npx tsc --noEmit                          # type-check only
```

### Docker (full stack)

Brings up the backend, Postgres, Redis, all three front ends, nginx, and Prometheus/Grafana/Alertmanager.

```bash
cp .env.example .env                      # then fill in secrets
docker-compose up --build
docker-compose down
docker-compose logs -f backend
```

### Git

```bash
git status -sb
git add <files> && git commit -m "message"    # name files rather than `git add .`
git push origin deploy/render-demo            # this branch deploys to Render
```

## Testing

```bash
cd backend
pip install pytest pytest-asyncio         # test-only dependencies, not in requirements.txt
python -m pytest -q                       # security-regression and weather-bias suites (14 tests)
python test_backend.py                    # standalone legacy script, not collected by pytest
```

Type-check the front ends with `npx tsc --noEmit` in `matatu-mms/` and `matatu-mms-public/`.

## Troubleshooting

```bash
netstat -ano | findstr ":3000 :3001 :3002 :8000"   # what is listening (Windows)
curl -I http://localhost:3000                       # staff (a 307 redirect to /login is normal)
curl -I http://localhost:3001                       # public
curl http://127.0.0.1:8000/docs                     # backend
```

| Symptom | Cause and fix |
|---|---|
| "Unable to connect" on `localhost:3000` or `3001` | Nothing is running, often after a reboot. Run `pm2 resurrect`, or `pm2 start ecosystem.config.js --only backend,staff,public`. |
| "System error / Something broke down" page | Run `pm2 logs <app>` and read the real error. If it shows `__webpack_modules__[moduleId] is not a function` or `Cannot find module ...\.next\server\...`, stop the app, delete that app's `.next` folder, and start it again. |
| Browser console shows CSP `connect-src` violations for `127.0.0.1:8000` | The dev server is stale. `next.config.mjs` is only read at startup, so `pm2 restart` the app. |
| Login says "Signing in..." for a long time | First compile after a cold start; wait up to about 75 seconds. |
| Everyone is logged out every time the backend restarts | `SECRET_KEY` is not set, so the backend generates a random one per run. Set it in `backend/.env`. |
| `No module named pytest` / `pytest_asyncio` | Install them: `pip install pytest pytest-asyncio` inside `backend/venv`. |

## Deployment

Deployed on Render: see [`render.yaml`](https://github.com/ipswyworld/matatu-mms/blob/deploy/render-demo/render.yaml) for the service topology (`matatu-mms-backend`, `matatu-mms-db`, `matatu-mms-redis`, `matatu-mms-frontend`, `matatu-mms-ops`, `matatu-mms-public`) and [`DEPLOYMENT.md`](DEPLOYMENT.md) for the runbook. The `deploy/render-demo` branch is the deployed branch, so pushing to it triggers a deploy.

## Further documentation

| Document | Purpose |
|---|---|
| [`DOCS.md`](https://github.com/ipswyworld/matatu-mms/blob/deploy/render-demo/DOCS.md) | Index of every doc, marking which are current and which are point-in-time snapshots |
| [`ARCHITECTURE_DECISIONS.md`](https://github.com/ipswyworld/matatu-mms/blob/deploy/render-demo/ARCHITECTURE_DECISIONS.md) | Design decision record (the numbered sections are referenced across the docs) |
| [`RUNBOOKS.md`](https://github.com/ipswyworld/matatu-mms/blob/deploy/render-demo/RUNBOOKS.md) | Incident runbooks and dependency fallbacks |
| [`DEPLOYMENT.md`](DEPLOYMENT.md) | Self-hosted stack, nginx, observability, Postgres |
| [`BACKUP_RECOVERY_POLICY.md`](https://github.com/ipswyworld/matatu-mms/blob/deploy/render-demo/BACKUP_RECOVERY_POLICY.md) | Backup, retention, recovery targets |
| [`matatu-mms/PRODUCT.md`](matatu-mms/PRODUCT.md) | Product and design brief |
| [`CHANGELOG.md`](https://github.com/ipswyworld/matatu-mms/blob/deploy/render-demo/CHANGELOG.md) | Change history |
