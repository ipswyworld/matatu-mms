# Data Layer Scaling — TimescaleDB, PgBouncer, Read Replica (Task 11)

Status of the three items in ARCHITECTURE_DECISIONS.md §3's data-layer scaling row.
TimescaleDB is implemented; PgBouncer and the read replica are genuinely blocked on
the Render Postgres plan tier — recording exactly what's needed so upgrading the plan
is the only remaining step, not a research project.

## TimescaleDB — done, defensively

`backend/alembic/versions/fa9d8f9d651a_enable_timescaledb_and_add_vehicle_.py` adds
`vehicle_positions` (durable GPS history — previously telemetry only ever lived in a
Redis key with a 30s TTL, never persisted) and attempts to enable the `timescaledb`
extension + convert the table to a hypertable, using the same defensive
`autocommit_block()` + try/except pattern proven safe by the PostGIS migration
(Task 8) — a failure here logs a warning and lets the table exist as a plain indexed
Postgres table instead of crash-looping the deploy.

**Check `render logs` after this deploy** for "TimescaleDB extension enabled
successfully" vs. the WARNING line, the same way Task 8 confirmed PostGIS was
actually available (it was, despite being "unconfirmed" going in — don't assume
either way without checking).

`app/routes/telemetry.py`'s `update_vehicle()` now writes every position update to
this table directly (no queue in front of it yet — see §13/Task 13 for the Redis
Streams + ARQ work that will change this) and is deliberately best-effort: a DB write
failure is logged and swallowed, never allowed to break the live map, which only
depends on the Redis pub/sub path.

## PgBouncer — blocked on plan tier, not code

Render's **free-tier Postgres does not expose PgBouncer / connection pooling
configuration** — there is nothing to enable from the application side. This
requires either:

1. Upgrading the Render Postgres plan to one that includes pooling, or
2. Running a separate PgBouncer service (its own Render service or container) in
   front of the database, which the app's `DATABASE_URL` would then point at.

Nothing to build until one of those is decided — the async SQLAlchemy engine setup
in `app/database.py` doesn't need to change either way (PgBouncer in transaction
mode is a transparent proxy from the app's point of view).

## Read replica — blocked on plan tier, not code

Render's free-tier Postgres has no read-replica option; this is a paid-plan feature
per Render's own pricing tiers. Same as PgBouncer: nothing to build until the plan
is upgraded. Once available, the plan (per ARCHITECTURE_DECISIONS.md §3/§16.4) is to
point analytics/monitoring-centre dashboard queries at the replica's connection
string via a second `DATABASE_URL`-style env var, leaving the primary writer
connection untouched.
