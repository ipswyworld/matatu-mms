"""
Postgres verification harness.

Everything in this project had been tested against SQLite, which is only the
dev fallback. Production is Postgres, and several features are Postgres-only:
full-text search over GIN indexes, TimescaleDB continuous aggregates,
compression and retention. None of that code had ever executed.

This exercises the paths SQLite skips. Run against a throwaway database:

    DATABASE_URL=postgresql+asyncpg://user:pw@host:port/db python verify_postgres.py

Deliberately not a pytest suite: it needs a specific external service and
should be invoked explicitly, rather than swept up by a collector that might
find a database someone cares about.

A check that cannot run is reported SKIPPED, never passed. Counting an unrun
check as green is the precise failure this harness exists to prevent.
"""
import asyncio
import datetime
import sys
import traceback
from decimal import Decimal

RESULTS = []


def record(name, ok, detail=""):
    RESULTS.append((name, ok, detail))
    mark = "PASS" if ok else "FAIL"
    print(f"  [{mark}] {name}" + (f" - {detail}" if detail else ""))


def skip(name, detail=""):
    RESULTS.append((name, None, detail))


async def main():
    from sqlalchemy import text
    from sqlalchemy.future import select
    from app.database import engine, IS_SQLITE, AsyncSessionLocal

    print("=" * 72)
    print("POSTGRES VERIFICATION")
    print("=" * 72)

    if IS_SQLITE:
        print("\nDATABASE_URL still points at SQLite - nothing here would be exercised.")
        sys.exit(2)

    # --- Extensions -------------------------------------------------------
    print("\n[1] Extensions")
    present = {}
    async with engine.connect() as conn:
        version = (await conn.execute(text("SELECT version()"))).scalar()
        print("      " + version.split(",")[0])
        for ext in ("timescaledb", "postgis"):
            present[ext] = bool(
                (await conn.execute(
                    text("SELECT 1 FROM pg_extension WHERE extname = :e"), {"e": ext}
                )).scalar()
            )
            record("extension " + ext + " installed", present[ext])

    # --- Schema -----------------------------------------------------------
    print("\n[2] Tables created by the migration chain")
    expected = [
        "users", "fines", "matatus", "saccos", "bookings",
        "rate_limit_overrides", "system_controls", "idempotency_records",
        "api_clients", "journal_entries", "ledger_postings",
        "message_logs", "messaging_opt_outs", "vehicle_positions",
    ]
    async with engine.connect() as conn:
        rows = (await conn.execute(
            text("SELECT tablename FROM pg_tables WHERE schemaname='public'")
        )).all()
    tables = {r[0] for r in rows}
    missing = [t for t in expected if t not in tables]
    record("all expected tables present", not missing,
           ("missing: " + str(missing)) if missing else (str(len(tables)) + " tables"))

    # --- Full-text indexes (never created on SQLite) ----------------------
    print("\n[3] Full-text search indexes")
    async with engine.connect() as conn:
        rows = (await conn.execute(text(
            "SELECT indexname, indexdef FROM pg_indexes "
            "WHERE schemaname='public' AND indexname LIKE 'ix_%search%'"
        ))).all()
    found = {r[0] for r in rows}
    for idx in ("ix_fines_search", "ix_matatus_search", "ix_saccos_search", "ix_users_search"):
        record(idx + " exists", idx in found)
    gin = [r[0] for r in rows if "gin" in r[1].lower()]
    record("indexes are GIN", bool(rows) and len(gin) == len(rows),
           str(len(gin)) + "/" + str(len(rows)))

    # --- The Postgres search path itself ----------------------------------
    print("\n[4] Postgres full-text query path (never executed before)")
    from app.fulltext import search_all
    from app.models import User

    async with AsyncSessionLocal() as db:
        admin = (await db.execute(
            select(User).where(User.role == "SUPERADMIN").limit(1)
        )).scalars().first()

        if admin is None:
            record("superadmin available for search test", False, "none seeded")
        else:
            try:
                res = await search_all(db, principal=admin, term="sacco")
                record("search_all runs on Postgres", True, "engine=" + res["engine"])
                record("uses postgres full-text, not the ILIKE fallback",
                       res["engine"] == "postgres full-text", res["engine"])
            except Exception as e:
                record("search_all runs on Postgres", False,
                       type(e).__name__ + ": " + str(e)[:120])
                traceback.print_exc()

            # Why websearch_to_tsquery was chosen over to_tsquery: the latter
            # raises a syntax error on operator soup, turning a user's typo
            # into a 500.
            for nasty in ["fine & | speeding", "'unclosed", "a & & b", "!!!", "OR OR", "<>"]:
                try:
                    await search_all(db, principal=admin, term=nasty)
                    record("malformed query survives: " + repr(nasty), True)
                except Exception as e:
                    record("malformed query survives: " + repr(nasty), False, type(e).__name__)

    # --- TimescaleDB ------------------------------------------------------
    print("\n[5] TimescaleDB hypertable, aggregate, policies")

    # The extension being installed says nothing about whether the Community
    # (TSL) features are licensed. Render ships the Apache-2 build, where
    # continuous aggregates, compression and retention all raise
    # "functionality not supported under the current apache license".
    #
    # The migration originally checked only for the extension and aborted the
    # entire deploy on the first TSL statement. This harness had the same
    # blind spot and reported four FAILs for features that are simply not
    # available — which is a wrong answer, not a finding.
    licence = None
    if present["timescaledb"]:
        async with engine.connect() as conn:
            try:
                licence = (await conn.execute(
                    text("SELECT current_setting('timescaledb.license')")
                )).scalar()
            except Exception:
                licence = "unknown"
        print("      timescaledb licence: " + str(licence))

    if not present["timescaledb"]:
        print("      SKIPPED - TimescaleDB not installed on this instance.")
        print("      The migration's graceful-degradation path ran instead:")
        print("      full-text indexes created, aggregates correctly skipped.")
        skip("timescaledb objects", "extension absent")
    elif licence == "apache":
        # This is what production actually runs.
        async with engine.connect() as conn:
            hyper = (await conn.execute(text(
                "SELECT 1 FROM timescaledb_information.hypertables "
                "WHERE hypertable_name='vehicle_positions'"
            ))).scalar()
        record("vehicle_positions is a hypertable", bool(hyper),
               "hypertables ARE available under Apache")
        print("      SKIPPED (aggregate/compression/retention) - Apache licence.")
        print("      These are Timescale Community features. The migration must")
        print("      skip them without failing, which is what production needs.")
        skip("timescaledb community features", "apache licence - not licensed here")
    else:
        async with engine.connect() as conn:
            hyper = (await conn.execute(text(
                "SELECT 1 FROM timescaledb_information.hypertables "
                "WHERE hypertable_name='vehicle_positions'"
            ))).scalar()
            record("vehicle_positions is a hypertable", bool(hyper))

            agg = (await conn.execute(text(
                "SELECT 1 FROM timescaledb_information.continuous_aggregates "
                "WHERE view_name='vehicle_positions_hourly'"
            ))).scalar()
            record("continuous aggregate exists", bool(agg))

            # All scheduled jobs rather than one keyed on a guessed hypertable
            # name: the aggregate's internal hypertable is
            # _materialized_hypertable_N and N depends on creation order.
            jobs = (await conn.execute(text(
                "SELECT proc_name FROM timescaledb_information.jobs"
            ))).all()
            names = {j[0] for j in jobs}
            record("retention policy scheduled", "policy_retention" in names, str(sorted(names)))
            record("compression policy scheduled", "policy_compression" in names)
            record("aggregate refresh scheduled",
                   "policy_refresh_continuous_aggregate" in names)

    # --- Ledger on real NUMERIC -------------------------------------------
    print("\n[6] Ledger arithmetic on Postgres NUMERIC")
    from app import ledger, revenue

    async with AsyncSessionLocal() as db:
        try:
            await revenue.record_fine_issued(db, fine_id="PG-VERIFY-1", amount="1234.57")
            await db.commit()
            bal = await ledger.account_balance(db, "receivable:fines")
            record("posting round-trips as exact Decimal",
                   isinstance(bal, Decimal) and bal == Decimal("1234.57"), "balance=" + str(bal))

            dup = await revenue.record_fine_issued(db, fine_id="PG-VERIFY-1", amount="1234.57")
            await db.commit()
            record("idempotency key blocks the duplicate", dup is None)

            tb = await ledger.trial_balance(db)
            record("trial balance sums to zero", tb["balanced"], "sum=" + tb["sumOfAllPostings"])
        except Exception as e:
            record("ledger on Postgres", False, type(e).__name__ + ": " + str(e)[:150])
            traceback.print_exc()

    # --- Constraints Postgres enforces ------------------------------------
    print("\n[7] Unique constraints (the real concurrency guard)")
    from app.models import JournalEntry

    # Fresh ids per run. The first version reused fixed ids, so a second run
    # failed on the *first* insert and reported a product bug that was
    # really a harness that could only be run once.
    import uuid as _uuid

    now = datetime.datetime.now(datetime.timezone.utc)
    run = _uuid.uuid4().hex[:8]
    shared_key = "dup-key-" + run

    async with AsyncSessionLocal() as db:
        db.add(JournalEntry(id="je-" + run + "-a", description="a", idempotency_key=shared_key,
                            occurred_at=now, created_at=now))
        await db.commit()
    try:
        async with AsyncSessionLocal() as db:
            db.add(JournalEntry(id="je-" + run + "-b", description="b", idempotency_key=shared_key,
                                occurred_at=now, created_at=now))
            await db.commit()
        record("duplicate idempotency_key rejected by the database", False,
               "second insert succeeded - unique index is not enforcing")
    except Exception:
        record("duplicate idempotency_key rejected by the database", True, "unique index enforced")

    # --- Summary ----------------------------------------------------------
    print("\n" + "=" * 72)
    passed = sum(1 for _, ok, _ in RESULTS if ok is True)
    skipped = [(n, d) for n, ok, d in RESULTS if ok is None]
    failed = [n for n, ok, _ in RESULTS if ok is False]
    total = len(RESULTS) - len(skipped)

    print(str(passed) + "/" + str(total) + " checks passed")
    for name, detail in skipped:
        print("  SKIPPED (unverified, NOT passing): " + name + " - " + detail)
    if failed:
        print("\nFAILED:")
        for f in failed:
            print("  - " + f)
    print("=" * 72)

    await engine.dispose()
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    asyncio.run(main())
