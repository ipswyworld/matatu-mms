"""add backup_restore_tests

Revision ID: d0e1f2a3b4c5
Revises: c9d0e1f2a3b4
Create Date: 2026-09-25

"""
from alembic import op
import sqlalchemy as sa

revision = 'd0e1f2a3b4c5'
down_revision = 'c9d0e1f2a3b4'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'backup_restore_tests',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('tested_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('success', sa.Boolean(), nullable=False),
        sa.Column('duration_seconds', sa.Numeric(10, 2), nullable=False),
        sa.Column('backup_tag', sa.String(), nullable=True),
        sa.Column('row_counts', sa.Text(), nullable=True),
        sa.Column('error', sa.Text(), nullable=True),
    )
    op.create_index('ix_backup_restore_tests_id', 'backup_restore_tests', ['id'])


def downgrade():
    op.drop_index('ix_backup_restore_tests_id', table_name='backup_restore_tests')
    op.drop_table('backup_restore_tests')
