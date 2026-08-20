"""add condition reports table (crowdsourced traffic/weather)

Revision ID: e3c7b1a9f2d4
Revises: d8a1e4f6b9c2
Create Date: 2026-08-20

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'e3c7b1a9f2d4'
down_revision: Union[str, Sequence[str], None] = 'd8a1e4f6b9c2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "condition_reports",
        sa.Column("id", sa.String(), primary_key=True, index=True),
        sa.Column("category", sa.String(), nullable=False),
        sa.Column("location_label", sa.String(), nullable=False),
        sa.Column("message", sa.String(), nullable=True),
        sa.Column("reporter_user_id", sa.String(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_condition_reports_created_at", "condition_reports", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_condition_reports_created_at", table_name="condition_reports")
    op.drop_table("condition_reports")
