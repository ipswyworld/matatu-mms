# Service Extraction Readiness — Telemetry Ingest + WS Gateway (Task 14)

ARCHITECTURE_DECISIONS.md §2.2/§2.3 call for splitting telemetry ingest and the WebSocket
gateway out of the monolith early, since they scale differently (write-heavy vs.
request-driven) and have different durability needs (a dropped GPS ping is acceptable, a
dropped payment is not).

**Not actually deployed as separate services in this pass** — Render's current setup is a
single free-tier web service per app (`matatu-mms-backend`), and there's no second service
slot to run an extracted process on. Splitting the deployment is a hosting-plan decision,
not a code change (same category as PgBouncer/read-replica — see
`DATA_LAYER_SCALING_STATUS.md`). What's done here is the structural work that makes the
eventual extraction mechanical rather than archaeological, per §2.1's stated goal.

## Current boundary audit

`backend/app/routes/telemetry.py` — the entire telemetry ingest + WS gateway surface — was
audited for cross-module reach-in. Its only imports from the rest of the app are:

- `app.auth.get_current_user`, `app.config.{ALGORITHM,SECRET_KEY}` — JWT verification for
  the crew WebSocket's connect-time auth check.
- `app.database.{get_db,AsyncSessionLocal}` — DB session access.
- `app.models.{Matatu,User,VehiclePosition}` — `Matatu`/`User` read-only, for the
  ownership check (a CREW account may only stream telemetry for their own Sacco's
  vehicle); `VehiclePosition` is telemetry's own table (Task 11).
- `app.realtime.{ChannelBroadcaster,get_redis,publish}` — the shared Redis pub/sub
  primitives, already a standalone module with no dependencies on business-logic code.

No other route module reaches into `telemetry.py`'s internals (`live_vehicles()`,
`update_vehicle()`, the broadcaster instance) except `app.main` wiring the router and
broadcaster lifecycle — the same pattern every other route module follows. **This module
is already extraction-ready**: pulling it into a standalone FastAPI app would mean copying
this one file plus its four narrow imports, pointed at the same Postgres/Redis instances.

## What extraction would look like, once a second service exists

1. New minimal FastAPI app: `telemetry.py`'s router + the `telemetry_broadcaster` +
   `VehiclePosition` model + the `Matatu`/`User` read paths it needs (or a thin internal
   API call back to the monolith for the ownership check, avoiding a shared ORM
   dependency entirely — the cleaner long-term shape).
2. Same `DATABASE_URL`/`REDIS_URL` as the monolith initially (shared Postgres, shared
   Redis) — no data migration needed on day one.
3. Frontend's `NEXT_PUBLIC_WS_URL` points at the new service instead of the monolith.
4. Once stable, telemetry write traffic gets its own connection pool (PgBouncer, §3) so a
   telemetry spike can no longer contend with the business app's Postgres connections —
   the actual failure mode §2.2 is protecting against.

## Module boundaries within the monolith (§2.1)

The doc's stated module list — `licensing · fleet · enforcement · revenue · routing ·
bookings` — maps loosely onto the existing route-file organization
(`saccos.py`≈licensing, `matatus.py`≈fleet, `crimes.py`/`enforcement_cases.py`≈enforcement,
`fines.py`/`payments.py`≈revenue, `routes.py`/`fare_stages.py`≈routing, `bookings.py`).
`app/models.py` remains a single shared file with all ORM models — genuinely splitting it
into per-module model files with enforced no-cross-reach is a large, high-risk refactor of
already-hardened, production-verified code, and is deliberately **not** done in this pass.
The realistic near-term win is the convention already in place: routes only import the
specific models they need (verified above for telemetry), which is what keeps a future
split mechanical. A hard technical enforcement (e.g. import-linter rules in CI) is a
reasonable follow-up once the module list above is actually settled.
