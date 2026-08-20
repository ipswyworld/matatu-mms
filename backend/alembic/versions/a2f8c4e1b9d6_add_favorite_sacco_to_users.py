"""add favorite_sacco_id to users

Revision ID: a2f8c4e1b9d6
Revises: f1d4a6e8c3b7
Create Date: 2026-08-20

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'a2f8c4e1b9d6'
down_revision: Union[str, Sequence[str], None] = 'f1d4a6e8c3b7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("favorite_sacco_id", sa.String(), sa.ForeignKey("saccos.id"), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "favorite_sacco_id")
