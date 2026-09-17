"""add can_release_cases to users

Revision ID: 67bda3e48043
Revises: c4a91f7de2b0
Create Date: 2026-09-17

"""
from alembic import op
import sqlalchemy as sa

revision = '67bda3e48043'
down_revision = 'c4a91f7de2b0'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'users',
        sa.Column('can_release_cases', sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade():
    op.drop_column('users', 'can_release_cases')
