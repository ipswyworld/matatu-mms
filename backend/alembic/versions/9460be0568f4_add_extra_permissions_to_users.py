"""add extra_permissions to users

Revision ID: 9460be0568f4
Revises: 0454c72492a6
Create Date: 2026-08-24 00:23:19.339556

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '9460be0568f4'
down_revision: Union[str, Sequence[str], None] = '0454c72492a6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('users', sa.Column('extra_permissions', sa.Text(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('users', 'extra_permissions')
