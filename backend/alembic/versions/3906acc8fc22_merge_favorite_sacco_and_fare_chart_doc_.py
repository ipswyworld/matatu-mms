"""merge favorite_sacco and fare_chart_doc branches

Revision ID: 3906acc8fc22
Revises: a2f8c4e1b9d6, c9d3e6f2a4b8
Create Date: 2026-08-21 20:54:22.328848

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '3906acc8fc22'
down_revision: Union[str, Sequence[str], None] = ('a2f8c4e1b9d6', 'c9d3e6f2a4b8')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
