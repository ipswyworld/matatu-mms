"""telemetry continuous aggregates, retention tiers, and full-text search

Readiness List §18. Two separate problems, both of which only appear at
production data volume:

  * GPS telemetry is by far the largest data stream in the system. At
    20-30k vehicles reporting every few seconds, raw points are needed for
    days but aggregates are needed for years — without downsampling this
    becomes the dominant storage cost and the slowest table.

  * Staff search over hundreds of thousands of fines, cases and vehicles
    cannot run on `ILIKE '%term%'`, which cannot use an index and degrades
    linearly with the table.

Everything here is Postgres-only and guarded: the SQLite dev fallback skips
it entirely, and the TimescaleDB parts skip cleanly when the extension is
absent, matching the existing enable_timescaledb migration's approach.

Revision ID: a3d6e9b7c284
Revises: f2c9d4a8e517
"""
import logging
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

logger = logging.getLogger("alembic.telemetry_aggregates")

revision: str = "a3d6e9b7c284"
down_revision: Union[str, Sequence[str], None] = "f2c9d4a8e517"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _is_postgres(bind) -> bool:
    return bind.dialect.name == "postgresql"


def _has_timescale(bind) -> bool:
    try:
        return bool(
            bind.execute(
                sa.text("SELECT 1 FROM pg_extension WHERE extname = 'timescaledb'")
            ).scalar()
        )
    except Exception:
        return False


def _try_timescale(description: str, sql: str) -> bool:
    """Runs a TimescaleDB statement that may not be licensed on this host.

    Continuous aggregates, compression and retention are Timescale
    *Community* (TSL) features. The extension being installed says nothing
    about whether they are available: Render ships the Apache-2 build, where
    `CREATE MATERIALIZED VIEW ... WITH (timescaledb.continuous)` raises

        functionality not supported under the current "apache" license

    That failure took down a whole deploy, because a raising migration aborts
    the container before uvicorn starts. These are optimisations — the table
    is perfectly usable without them — so each one degrades independently and
    says so, matching what the enable_postgis and enable_timescaledb
    migrations already do for the extensions themselves.

    Each statement gets its own savepoint: under transactional DDL a failed
    statement poisons the surrounding transaction, so without this the first
    failure would break every statement after it too.
    """
    bind = op.get_bind()
    try:
        with bind.begin_nested():
            bind.execute(sa.text(sql))
        return True
    except Exception as e:
        detail = str(e).splitlines()[0][:200] if str(e) else type(e).__name__
        logger.warning(
            "Skipping %s - not available on this Postgres (%s). "
            "Raw telemetry still works; it just will not be downsampled or aged out here.",
            description, detail,
        )
        return False


def upgrade() -> None:
    bind = op.get_bind()
    if not _is_postgres(bind):
        # SQLite dev fallback: full-text search and continuous aggregates
        # are both Postgres features. The application falls back to ILIKE
        # locally, which is correct at dev data volumes.
        return

    # --- Full-text search -------------------------------------------------
    #
    # A GIN index over a tsvector, rather than pg_trgm on ILIKE. Full-text
    # handles stemming and multi-word queries, which is what staff actually
    # type ("unpaid speeding fine" rather than a substring).
    #
    # Expression indexes rather than generated columns, so no table rewrite
    # is needed on a live table holding real enforcement history.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_fines_search
        ON fines
        USING GIN (to_tsvector('english', coalesce(reason, '') || ' ' || coalesce(id, '')))
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_matatus_search
        ON matatus
        USING GIN (to_tsvector('english', coalesce(reg_number, '') || ' ' || coalesce(id, '')))
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_saccos_search
        ON saccos
        USING GIN (to_tsvector('english', coalesce(name, '') || ' ' || coalesce(id, '')))
        """
    )
    # Users are searched by name and email constantly on the staff side.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_users_search
        ON users
        USING GIN (to_tsvector('english', coalesce(name, '') || ' ' || coalesce(email, '')))
        """
    )

    # Supporting btree indexes for the filters that accompany a search.
    op.execute("CREATE INDEX IF NOT EXISTS ix_fines_status ON fines (status)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_fines_issued_at ON fines (issued_at DESC)")

    # --- Telemetry aggregates and retention -------------------------------
    if not _has_timescale(bind):
        logger.warning(
            "TimescaleDB not installed — skipping continuous aggregates and retention. "
            "Raw vehicle_positions will grow unbounded until the extension is enabled."
        )
        # An ordinary index still helps the common per-vehicle time-range query.
        op.execute(
            "CREATE INDEX IF NOT EXISTS ix_vehicle_positions_matatu_time "
            "ON vehicle_positions (matatu_id, recorded_at DESC)"
        )
        return

    is_hypertable = bind.execute(
        sa.text(
            "SELECT 1 FROM timescaledb_information.hypertables "
            "WHERE hypertable_name = 'vehicle_positions'"
        )
    ).scalar()
    if not is_hypertable:
        logger.warning(
            "vehicle_positions is not a hypertable — skipping continuous aggregates. "
            "Convert it first (see the enable_timescaledb migration)."
        )
        return

    # Hourly rollup per vehicle. This is what powers historical replay,
    # utilisation reports and route-adherence analysis — none of which need
    # per-second fidelity, and all of which are unusably slow against raw
    # points once the table is large.
    #
    # WITH NO DATA: backfilling years of history inside a migration would
    # hold a transaction open for a very long time on a live system. The
    # refresh policy below fills it incrementally instead.
    aggregate_created = _try_timescale(
        "continuous aggregate vehicle_positions_hourly",
        """
        CREATE MATERIALIZED VIEW IF NOT EXISTS vehicle_positions_hourly
        WITH (timescaledb.continuous) AS
        SELECT
            matatu_id,
            time_bucket(INTERVAL '1 hour', recorded_at) AS bucket,
            count(*)        AS sample_count,
            avg(speed)      AS avg_speed,
            max(speed)      AS max_speed,
            avg(lat)        AS avg_lat,
            avg(lng)        AS avg_lng,
            first(lat, recorded_at) AS first_lat,
            first(lng, recorded_at) AS first_lng,
            last(lat, recorded_at)  AS last_lat,
            last(lng, recorded_at)  AS last_lng
        FROM vehicle_positions
        GROUP BY matatu_id, bucket
        WITH NO DATA
        """,
    )

    if aggregate_created:
        _try_timescale(
            "continuous aggregate refresh policy",
            """
        SELECT add_continuous_aggregate_policy('vehicle_positions_hourly',
            start_offset => INTERVAL '3 days',
            end_offset   => INTERVAL '1 hour',
            schedule_interval => INTERVAL '30 minutes',
            if_not_exists => TRUE)
        """,
        )

    # Compress raw points after a week. They stay queryable, just far
    # smaller — Timescale typically achieves better than 10x on this shape
    # of data.
    compression_enabled = _try_timescale(
        "compression settings on vehicle_positions",
        """
        ALTER TABLE vehicle_positions SET (
            timescaledb.compress,
            timescaledb.compress_segmentby = 'matatu_id',
            timescaledb.compress_orderby = 'recorded_at DESC'
        )
        """,
    )
    if compression_enabled:
        _try_timescale(
            "compression policy (7 days)",
            "SELECT add_compression_policy('vehicle_positions', INTERVAL '7 days', if_not_exists => TRUE)",
        )

    # Drop raw points after 90 days. The hourly aggregate survives, so
    # historical analysis keeps working — this discards per-second detail
    # nobody queries at that age, not the history itself.
    #
    # 90 days is a deliberate choice tied to the enforcement dispute window:
    # raw GPS is evidence while a citation can still be contested, and
    # merely storage cost afterwards. Revisit if that window changes.
    _try_timescale(
        "retention policy (90 days)",
        "SELECT add_retention_policy('vehicle_positions', INTERVAL '90 days', if_not_exists => TRUE)",
    )


def downgrade() -> None:
    bind = op.get_bind()
    if not _is_postgres(bind):
        return

    if _has_timescale(bind):
        # Same guard as upgrade(), for the same reason: on an Apache-licensed
        # TimescaleDB these functions do not exist, and a downgrade that
        # raises is worse than one that skips — it leaves the schema stranded
        # between revisions with no way forward or back.
        #
        # Each is independent so an object that was never created (because
        # the licence blocked it on the way up) does not stop the rest being
        # cleaned up.
        _try_timescale(
            "remove retention policy",
            "SELECT remove_retention_policy('vehicle_positions', if_exists => TRUE)",
        )
        _try_timescale(
            "remove compression policy",
            "SELECT remove_compression_policy('vehicle_positions', if_exists => TRUE)",
        )
        _try_timescale(
            "remove continuous aggregate policy",
            "SELECT remove_continuous_aggregate_policy('vehicle_positions_hourly', if_exists => TRUE)",
        )
        _try_timescale(
            "drop continuous aggregate",
            "DROP MATERIALIZED VIEW IF EXISTS vehicle_positions_hourly",
        )

    op.execute("DROP INDEX IF EXISTS ix_vehicle_positions_matatu_time")
    op.execute("DROP INDEX IF EXISTS ix_fines_issued_at")
    op.execute("DROP INDEX IF EXISTS ix_fines_status")
    op.execute("DROP INDEX IF EXISTS ix_users_search")
    op.execute("DROP INDEX IF EXISTS ix_saccos_search")
    op.execute("DROP INDEX IF EXISTS ix_matatus_search")
    op.execute("DROP INDEX IF EXISTS ix_fines_search")
