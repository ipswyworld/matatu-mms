"""add rate_limit_overrides

Live-adjustable rate limits for the ops console (Ops Console Rebuild Spec
§6.1). Postgres is the source of truth; app/ops_limits.py mirrors to Redis
and caches in-process for the synchronous slowapi read path.

Revision ID: b7e4c1a9d2f5
Revises: d5f8b3a2c6e1
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "b7e4c1a9d2f5"
down_revision: Union[str, Sequence[str], None] = "d5f8b3a2c6e1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "rate_limit_overrides",
        sa.Column("scope", sa.String(), nullable=False),
        sa.Column("limit_value", sa.String(), nullable=False),
        sa.Column("reason", sa.String(), nullable=True),
        sa.Column("updated_by", sa.String(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["updated_by"], ["users.id"]),
        sa.PrimaryKeyConstraint("scope"),
    )


def downgrade() -> None:
    op.drop_table("rate_limit_overrides")
