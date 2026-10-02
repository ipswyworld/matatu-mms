"""add doc_fare_chart to saccos (required verification document)

Revision ID: c9d3e6f2a4b8
Revises: f1d4a6e8c3b7
Create Date: 2026-08-20

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'c9d3e6f2a4b8'
down_revision: Union[str, Sequence[str], None] = 'f1d4a6e8c3b7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("saccos", sa.Column("doc_fare_chart", sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column("saccos", "doc_fare_chart")
