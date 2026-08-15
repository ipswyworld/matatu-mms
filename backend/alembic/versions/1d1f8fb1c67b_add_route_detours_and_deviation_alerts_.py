"""add route_detours and deviation_alerts tables

Revision ID: 1d1f8fb1c67b
Revises: 44b81f3fac91
Create Date: 2026-08-16 01:32:13.311752

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '1d1f8fb1c67b'
down_revision: Union[str, Sequence[str], None] = '44b81f3fac91'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "route_detours",
        sa.Column("id", sa.String(), primary_key=True, index=True),
        sa.Column("route_id", sa.String(), sa.ForeignKey("routes.id"), nullable=False),
        sa.Column("from_stage_id", sa.String(), sa.ForeignKey("stages.id"), nullable=False),
        sa.Column("to_stage_id", sa.String(), sa.ForeignKey("stages.id"), nullable=False),
        sa.Column("alternate_description", sa.Text(), nullable=False),
        sa.Column("active", sa.Boolean(), server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_route_detours_route", "route_detours", ["route_id"])

    op.create_table(
        "deviation_alerts",
        sa.Column("id", sa.String(), primary_key=True, index=True),
        sa.Column("matatu_id", sa.String(), sa.ForeignKey("matatus.id"), nullable=False),
        sa.Column("route_id", sa.String(), sa.ForeignKey("routes.id"), nullable=False),
        sa.Column("lat", sa.Float(), nullable=False),
        sa.Column("lng", sa.Float(), nullable=False),
        sa.Column("distance_meters", sa.Float(), nullable=False),
        sa.Column("detected_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("resolved", sa.Boolean(), server_default=sa.false()),
    )
    op.create_index("ix_deviation_alerts_matatu", "deviation_alerts", ["matatu_id", "resolved"])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("ix_deviation_alerts_matatu", table_name="deviation_alerts")
    op.drop_table("deviation_alerts")
    op.drop_index("ix_route_detours_route", table_name="route_detours")
    op.drop_table("route_detours")
