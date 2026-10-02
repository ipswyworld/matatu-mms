"""add crew_number to users

Revision ID: c7f28a5e6d19
Revises: d4a91b6c2e57
Create Date: 2026-08-26 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c7f28a5e6d19'
down_revision: Union[str, Sequence[str], None] = 'd4a91b6c2e57'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Not unique: a driver and their conductor share one crew_number by
    # design (see app/routes/crew.py's issue_crew_credentials) — exactly
    # two User rows are expected to carry the same value.
    op.add_column('users', sa.Column('crew_number', sa.String(), nullable=True))
    op.create_index('ix_users_crew_number', 'users', ['crew_number'])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index('ix_users_crew_number', table_name='users')
    op.drop_column('users', 'crew_number')
