"""add officer_positions table

Revision ID: a3f9c1e7b2d4
Revises: 1d1f8fb1c67b
Create Date: 2026-08-16 19:10:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a3f9c1e7b2d4'
down_revision: Union[str, Sequence[str], None] = '1d1f8fb1c67b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "officer_positions",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("officer_id", sa.String(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("lat", sa.Float(), nullable=False),
        sa.Column("lng", sa.Float(), nullable=False),
        sa.Column("speed", sa.Float(), nullable=True),
        sa.Column("heading", sa.Float(), nullable=True),
        sa.Column("recorded_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_officer_positions_officer", "officer_positions", ["officer_id"])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("ix_officer_positions_officer", table_name="officer_positions")
    op.drop_table("officer_positions")
