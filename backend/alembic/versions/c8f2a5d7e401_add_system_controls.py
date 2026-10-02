"""add system_controls

Maintenance mode and feature kill switches for the ops console
(Ops Console Rebuild Spec §21.3, Critical tier). See app/ops_controls.py.

Revision ID: c8f2a5d7e401
Revises: b7e4c1a9d2f5
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "c8f2a5d7e401"
down_revision: Union[str, Sequence[str], None] = "b7e4c1a9d2f5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "system_controls",
        sa.Column("key", sa.String(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("value", sa.Text(), nullable=True),
        sa.Column("reason", sa.String(), nullable=True),
        sa.Column("updated_by", sa.String(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["updated_by"], ["users.id"]),
        sa.PrimaryKeyConstraint("key"),
    )


def downgrade() -> None:
    op.drop_table("system_controls")
