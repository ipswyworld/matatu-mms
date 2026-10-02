"""add feature flag scheduled enable/disable columns

Revision ID: c9d0e1f2a3b4
Revises: b8c9d0e1f2a3
Create Date: 2026-09-25

"""
from alembic import op
import sqlalchemy as sa

revision = 'c9d0e1f2a3b4'
down_revision = 'b8c9d0e1f2a3'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('feature_flags', sa.Column('scheduled_enable_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('feature_flags', sa.Column('scheduled_disable_at', sa.DateTime(timezone=True), nullable=True))


def downgrade():
    op.drop_column('feature_flags', 'scheduled_disable_at')
    op.drop_column('feature_flags', 'scheduled_enable_at')
