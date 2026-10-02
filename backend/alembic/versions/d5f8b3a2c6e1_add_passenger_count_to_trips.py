"""add passenger_count to trips

Revision ID: d5f8b3a2c6e1
Revises: c7f28a5e6d19
Create Date: 2026-08-27

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'd5f8b3a2c6e1'
down_revision: Union[str, Sequence[str], None] = 'c7f28a5e6d19'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("trips", sa.Column("passenger_count", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("trips", "passenger_count")
