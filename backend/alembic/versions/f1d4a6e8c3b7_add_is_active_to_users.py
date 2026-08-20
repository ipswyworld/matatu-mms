"""add is_active to users (soft-delete for admin/operator "remove user")

Revision ID: f1d4a6e8c3b7
Revises: e3c7b1a9f2d4
Create Date: 2026-08-20

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'f1d4a6e8c3b7'
down_revision: Union[str, Sequence[str], None] = 'e3c7b1a9f2d4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("is_active", sa.Boolean(), server_default=sa.true()))


def downgrade() -> None:
    op.drop_column("users", "is_active")
