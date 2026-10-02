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

    if not is_postgres:
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

    # A prior deploy attempt got as far as creating this table (with a
    # single-column PRIMARY KEY (id)) before TimescaleDB's create_hypertable
    # rejected it — a hypertable requires every unique index, including the
    # primary key, to include the partitioning column. The table has no
    # real data yet (telemetry persistence is new in this same change), so
    # dropping and recreating with the correct composite key is simpler and
    # safer than an in-place ALTER, and makes this migration idempotent
    # regardless of which partial state a previous attempt left behind.
    op.execute("DROP TABLE IF EXISTS vehicle_positions")
    op.execute("""
        CREATE TABLE vehicle_positions (
            id SERIAL,
            matatu_id VARCHAR NOT NULL REFERENCES matatus (id),
            lat FLOAT NOT NULL,
            lng FLOAT NOT NULL,
            speed FLOAT,
            heading FLOAT,
            source VARCHAR DEFAULT 'CREW_GPS',
            recorded_at TIMESTAMP WITH TIME ZONE NOT NULL,
            PRIMARY KEY (id, recorded_at)
        )
    """)
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_vehicle_positions_matatu_recorded "
        "ON vehicle_positions (matatu_id, recorded_at)"
    )

    # Same defensive pattern as the enable_postgis migration: TimescaleDB
    # availability on this Postgres plan is unconfirmed, and
    # docker-entrypoint.sh runs migrations with `set -e` — a hard failure
    # here would crash-loop the whole deploy. autocommit_block() also
    # isolates each attempt in its own auto-committing mini-transaction, so
    # a failure can't poison the migration's main transaction and block the
    # final alembic_version update the way the plain try/except version did
    # (observed in practice: create_hypertable failed, and the subsequent
    # UPDATE alembic_version failed too with "current transaction is
    # aborted" because the failed statement was never rolled back).
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

    try:
        with op.get_context().autocommit_block():
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
