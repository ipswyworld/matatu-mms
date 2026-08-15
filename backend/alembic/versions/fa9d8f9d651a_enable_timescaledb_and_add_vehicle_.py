"""enable timescaledb and add vehicle_positions table

Revision ID: fa9d8f9d651a
Revises: 3eb94a484694
Create Date: 2026-08-15 22:22:30.360029

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'fa9d8f9d651a'
down_revision: Union[str, Sequence[str], None] = '3eb94a484694'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    bind = op.get_bind()
    is_postgres = bind.dialect.name == "postgresql"

    # Raw DDL with IF NOT EXISTS rather than op.create_table/create_index:
    # this table's creation commits (see the autocommit_block below, which
    # forces an early commit before it runs) before the extension/hypertable
    # steps even start. If the deploy process is killed between that commit
    # and the migration's own final commit (observed in practice — Render
    # retried this migration after an interrupted attempt), a plain
    # op.create_table would hit "relation already exists" on retry and fail
    # the deploy outright. IF NOT EXISTS makes the whole migration safely
    # re-runnable regardless of where a previous attempt stopped.
    if is_postgres:
        op.execute("""
            CREATE TABLE IF NOT EXISTS vehicle_positions (
                id SERIAL PRIMARY KEY,
                matatu_id VARCHAR NOT NULL REFERENCES matatus (id),
                lat FLOAT NOT NULL,
                lng FLOAT NOT NULL,
                speed FLOAT,
                heading FLOAT,
                source VARCHAR DEFAULT 'CREW_GPS',
                recorded_at TIMESTAMP WITH TIME ZONE NOT NULL
            )
        """)
        op.execute(
            "CREATE INDEX IF NOT EXISTS ix_vehicle_positions_matatu_recorded "
            "ON vehicle_positions (matatu_id, recorded_at)"
        )
    else:
        op.create_table(
            "vehicle_positions",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("matatu_id", sa.String(), sa.ForeignKey("matatus.id"), nullable=False),
            sa.Column("lat", sa.Float(), nullable=False),
            sa.Column("lng", sa.Float(), nullable=False),
            sa.Column("speed", sa.Float(), nullable=True),
            sa.Column("heading", sa.Float(), nullable=True),
            sa.Column("source", sa.String(), server_default="CREW_GPS"),
            sa.Column("recorded_at", sa.DateTime(timezone=True), nullable=False),
        )
        op.create_index("ix_vehicle_positions_matatu_recorded", "vehicle_positions", ["matatu_id", "recorded_at"])
        return

    # Same defensive pattern as the enable_postgis migration: TimescaleDB
    # availability on this Postgres plan is unconfirmed, and
    # docker-entrypoint.sh runs migrations with `set -e` — a hard failure
    # here would crash-loop the whole deploy. Catch, log, move on; the
    # table above works fine as a plain indexed table either way.
    try:
        with op.get_context().autocommit_block():
            op.execute("CREATE EXTENSION IF NOT EXISTS timescaledb")
        print("TimescaleDB extension enabled successfully.")
    except Exception as e:
        print(f"WARNING: could not enable TimescaleDB extension ({e}). "
              f"vehicle_positions stays a plain Postgres table — fine at "
              f"current scale, but won't survive high-volume GPS ingest "
              f"without hypertable partitioning (needs a Timescale-enabled "
              f"Postgres plan).")
        return

    # create_hypertable() requires the target table to have no data yet and
    # errors if the extension setup above didn't actually succeed — wrapped
    # separately so a failure here doesn't mask whether the extension itself
    # loaded.
    try:
        op.execute(
            "SELECT create_hypertable('vehicle_positions', 'recorded_at', "
            "if_not_exists => TRUE, migrate_data => TRUE)"
        )
        print("vehicle_positions converted to a TimescaleDB hypertable.")
    except Exception as e:
        print(f"WARNING: could not convert vehicle_positions to a hypertable ({e}).")


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("ix_vehicle_positions_matatu_recorded", table_name="vehicle_positions")
    op.drop_table("vehicle_positions")
