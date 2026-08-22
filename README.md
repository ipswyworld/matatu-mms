# NCCG Matatu Management System (matatu-mms)

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

**Backend** (FastAPI, port 8000):

```bash
cd backend
python -m venv venv && source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt
alembic upgrade head
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

**Admin dashboard** (Next.js, port 3000):

```bash
cd matatu-mms
npm install
npm run dev
```

**Passenger app** (Next.js, port 3001):

```bash
cd matatu-mms-public
npm install
npm run dev        # or: npm run dev:public from matatu-mms/ if running both from one checkout
```

**Ops dashboard** (Next.js, port 3002):

```bash
cd matatu-mms-ops
npm install
npm run dev
```

Each frontend also has `npm run build`, `npm start` (production server), and `npm run lint`.

### Demo accounts (admin dashboard)

| Role | Email | Password |
|---|---|---|
| Admin | admin@nairobi.go.ke | admin123 |
| Enforcement Officer | enforcement@nairobi.go.ke | enforce123 |
| Sacco Operator | operator@umoinner.co.ke | sacco123 |
| Viewer / Executive | viewer@nairobi.go.ke | viewer123 |

## Deployment

Deployed on Render — see [`render.yaml`](render.yaml) for the full service topology
(`matatu-mms-backend`, `matatu-mms-db`, `matatu-mms-redis`, `matatu-mms-frontend`,
`matatu-mms-ops`, `matatu-mms-public`) and [`DEPLOYMENT.md`](DEPLOYMENT.md) for the
deploy runbook.

## Configuration

Copy `.env.example` to `.env` and fill in the values — it covers database URL, Redis,
JWT/session secrets, SMS provider, Sentry DSN, and object storage credentials used
across the backend and frontends.
