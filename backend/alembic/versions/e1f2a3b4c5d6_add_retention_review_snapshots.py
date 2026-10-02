"""add retention_review_snapshots

Revision ID: e1f2a3b4c5d6
Revises: d0e1f2a3b4c5
Create Date: 2026-09-25

"""
from alembic import op
import sqlalchemy as sa

revision = 'e1f2a3b4c5d6'
down_revision = 'd0e1f2a3b4c5'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'retention_review_snapshots',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('scanned_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('table_name', sa.String(), nullable=False),
        sa.Column('eligible_count', sa.Integer(), nullable=False),
        sa.Column('oldest_eligible_date', sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index('ix_retention_review_snapshots_table_name', 'retention_review_snapshots', ['table_name'])
    op.create_index('ix_retention_review_snapshots_id', 'retention_review_snapshots', ['id'])


def downgrade():
    op.drop_index('ix_retention_review_snapshots_id', table_name='retention_review_snapshots')
    op.drop_index('ix_retention_review_snapshots_table_name', table_name='retention_review_snapshots')
    op.drop_table('retention_review_snapshots')
