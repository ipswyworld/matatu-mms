"""add beats and beat_assignments tables

Revision ID: 8288e1bacdfc
Revises: fa9d8f9d651a
Create Date: 2026-08-16 01:14:06.888596

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '8288e1bacdfc'
down_revision: Union[str, Sequence[str], None] = 'fa9d8f9d651a'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "beats",
        sa.Column("id", sa.String(), primary_key=True, index=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("route_id", sa.String(), sa.ForeignKey("routes.id"), nullable=False),
        sa.Column("from_stage_id", sa.String(), sa.ForeignKey("stages.id"), nullable=False),
        sa.Column("to_stage_id", sa.String(), sa.ForeignKey("stages.id"), nullable=False),
        sa.Column("zone_id", sa.String(), sa.ForeignKey("zones.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_beats_route", "beats", ["route_id"])

    op.create_table(
        "beat_assignments",
        sa.Column("id", sa.String(), primary_key=True, index=True),
        sa.Column("officer_id", sa.String(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("beat_id", sa.String(), sa.ForeignKey("beats.id"), nullable=False),
        sa.Column("shift_date", sa.Date(), nullable=False),
        sa.Column("shift_start", sa.DateTime(timezone=True), nullable=False),
        sa.Column("shift_end", sa.DateTime(timezone=True), nullable=False),
        sa.Column("assigned_by", sa.String(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_beat_assignments_officer_date", "beat_assignments", ["officer_id", "shift_date"])
    op.create_index("ix_beat_assignments_beat_date", "beat_assignments", ["beat_id", "shift_date"])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("ix_beat_assignments_beat_date", table_name="beat_assignments")
    op.drop_index("ix_beat_assignments_officer_date", table_name="beat_assignments")
    op.drop_table("beat_assignments")
    op.drop_index("ix_beats_route", table_name="beats")
    op.drop_table("beats")
