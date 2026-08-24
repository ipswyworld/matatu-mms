"""add feature_flags table

Revision ID: d4a91b6c2e57
Revises: c8f3d0a6e912
Create Date: 2026-08-24 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd4a91b6c2e57'
down_revision: Union[str, Sequence[str], None] = 'c8f3d0a6e912'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'feature_flags',
        sa.Column('key', sa.String(), nullable=False),
        sa.Column('description', sa.String(), nullable=True),
        sa.Column('enabled', sa.Boolean(), nullable=False),
        sa.Column('updated_by', sa.String(), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['updated_by'], ['users.id']),
        sa.PrimaryKeyConstraint('key'),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table('feature_flags')
