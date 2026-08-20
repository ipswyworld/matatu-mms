"""add trips table

Revision ID: d8a1e4f6b9c2
Revises: c7e2a9f1d3b5
Create Date: 2026-08-20

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'd8a1e4f6b9c2'
down_revision: Union[str, Sequence[str], None] = 'c7e2a9f1d3b5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "trips",
        sa.Column("id", sa.String(), primary_key=True, index=True),
        sa.Column("matatu_id", sa.String(), sa.ForeignKey("matatus.id"), nullable=False),
        sa.Column("route_id", sa.String(), sa.ForeignKey("routes.id"), nullable=False),
        sa.Column("origin_stage_id", sa.String(), sa.ForeignKey("stages.id"), nullable=False),
        sa.Column("destination_stage_id", sa.String(), sa.ForeignKey("stages.id"), nullable=False),
        sa.Column("started_by", sa.String(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("status", sa.String(), server_default="QUEUED"),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("departed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_trips_matatu_id", "trips", ["matatu_id"])
    op.create_index("ix_trips_route_id", "trips", ["route_id"])
    op.create_index("ix_trips_status", "trips", ["status"])


def downgrade() -> None:
    op.drop_index("ix_trips_status", table_name="trips")
    op.drop_index("ix_trips_route_id", table_name="trips")
    op.drop_index("ix_trips_matatu_id", table_name="trips")
    op.drop_table("trips")
