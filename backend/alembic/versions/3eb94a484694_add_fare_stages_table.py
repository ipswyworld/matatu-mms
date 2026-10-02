"""add fare_stages table

Revision ID: 3eb94a484694
Revises: 53c9ff8ac40c
Create Date: 2026-08-15 22:14:25.662936

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '3eb94a484694'
down_revision: Union[str, Sequence[str], None] = '53c9ff8ac40c'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "fare_stages",
        sa.Column("id", sa.String(), primary_key=True, index=True),
        sa.Column("route_id", sa.String(), sa.ForeignKey("routes.id"), nullable=False),
        sa.Column("from_stage_id", sa.String(), sa.ForeignKey("stages.id"), nullable=True),
        sa.Column("to_stage_id", sa.String(), sa.ForeignKey("stages.id"), nullable=True),
        sa.Column("from_label", sa.String(), nullable=False),
        sa.Column("to_label", sa.String(), nullable=False),
        sa.Column("fare_kes", sa.Numeric(12, 2), nullable=False),
        sa.Column("direction", sa.String(), nullable=True),
        sa.Column("source", sa.String(), server_default="MANUAL"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_fare_stages_route", "fare_stages", ["route_id"])
    op.create_index("ix_fare_stages_from_stage", "fare_stages", ["from_stage_id"])
    op.create_index("ix_fare_stages_to_stage", "fare_stages", ["to_stage_id"])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("ix_fare_stages_to_stage", table_name="fare_stages")
    op.drop_index("ix_fare_stages_from_stage", table_name="fare_stages")
    op.drop_index("ix_fare_stages_route", table_name="fare_stages")
    op.drop_table("fare_stages")
