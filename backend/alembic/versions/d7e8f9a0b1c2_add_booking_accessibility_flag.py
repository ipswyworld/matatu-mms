"""add booking accessibility_flag

Revision ID: d7e8f9a0b1c2
Revises: c5d6e7f8a9b0
Create Date: 2026-09-27

"""
from alembic import op
import sqlalchemy as sa

revision = 'd7e8f9a0b1c2'
down_revision = 'c5d6e7f8a9b0'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'bookings',
        sa.Column('accessibility_flag', sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade():
    op.drop_column('bookings', 'accessibility_flag')
