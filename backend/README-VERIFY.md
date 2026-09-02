# Postgres verification

Everything in this project is developed against SQLite, which is only the
dev fallback. Production is Postgres, and several features are Postgres-only:
full-text search over GIN indexes, TimescaleDB continuous aggregates,
compression, and retention. Those code paths do not execute on SQLite at
all — the migration returns early and `fulltext.py` takes its ILIKE branch.

`verify_postgres.py` exercises them. Run it against a throwaway database
before any release that touches search, telemetry, or the ledger.

## Spin up a matching instance

TimescaleDB and PostGIS are both needed to exercise everything; the image
below has both, and matches what production should run.

```bash
docker run -d --name mms-verify-pg \
  -e POSTGRES_USER=matatu -e POSTGRES_PASSWORD=testpw -e POSTGRES_DB=matatu_mms \
  -p 55432:5432 timescale/timescaledb-ha:pg16
```

## Run

```bash
export DATABASE_URL="postgresql+asyncpg://matatu:testpw@127.0.0.1:55432/matatu_mms"
export SECRET_KEY="verify-only-not-for-production"
export REDIS_URL="redis://127.0.0.1:6379/4"

python -m alembic upgrade head
python -c "import asyncio; from app.database import AsyncSessionLocal; from app.seed import seed_data; asyncio.run((lambda: (lambda s: s)(None))()) " 2>/dev/null || true
python verify_postgres.py
```

Seeding matters: the search checks need a SUPERADMIN to scope against, and
without one they report a failure that is really missing fixtures.

## What it checks

1. TimescaleDB and PostGIS extensions present
2. Every expected table created by the migration chain
3. Full-text GIN indexes exist and are actually GIN
4. `search_all` runs the Postgres path, not the ILIKE fallback — including
   that malformed queries (`a & & b`, `'unclosed`) do not raise, which is
   why `websearch_to_tsquery` was chosen over `to_tsquery`
5. Hypertable, continuous aggregate, retention/compression/refresh policies
6. Ledger amounts round-trip as exact `Decimal` through Postgres `NUMERIC`
7. The unique index on `idempotency_key` is enforced by the database

A check that cannot run reports SKIPPED, never PASS. On plain Postgres
without TimescaleDB, section 5 skips and says so — the graceful-degradation
path is exercised, but the aggregates remain unverified.
