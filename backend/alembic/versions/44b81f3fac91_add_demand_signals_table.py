"""add demand_signals table

Revision ID: 44b81f3fac91
Revises: 8288e1bacdfc
Create Date: 2026-08-16 01:28:35.997361

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '44b81f3fac91'
down_revision: Union[str, Sequence[str], None] = '8288e1bacdfc'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "demand_signals",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("from_stage_id", sa.String(), sa.ForeignKey("stages.id"), nullable=False),
        sa.Column("to_stage_id", sa.String(), sa.ForeignKey("stages.id"), nullable=True),
        sa.Column("source", sa.String(), nullable=False),
        sa.Column("recorded_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_demand_signals_od", "demand_signals", ["from_stage_id", "to_stage_id"])
    op.create_index("ix_demand_signals_from", "demand_signals", ["from_stage_id"])
    op.create_index("ix_demand_signals_recorded", "demand_signals", ["recorded_at"])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("ix_demand_signals_recorded", table_name="demand_signals")
    op.drop_index("ix_demand_signals_from", table_name="demand_signals")
    op.drop_index("ix_demand_signals_od", table_name="demand_signals")
    op.drop_table("demand_signals")
