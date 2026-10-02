"""add synthetic_check_results

Revision ID: f6a7b8c9d0e1
Revises: e5f6a7b8c9d0
Create Date: 2026-09-25

"""
from alembic import op
import sqlalchemy as sa

revision = 'f6a7b8c9d0e1'
down_revision = 'e5f6a7b8c9d0'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'synthetic_check_results',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('target_name', sa.String(), nullable=False),
        sa.Column('url', sa.String(), nullable=False),
        sa.Column('ok', sa.Boolean(), nullable=False),
        sa.Column('latency_ms', sa.Integer(), nullable=True),
        sa.Column('error', sa.Text(), nullable=True),
        sa.Column('checked_at', sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index('ix_synthetic_check_results_target_name', 'synthetic_check_results', ['target_name'])
    op.create_index('ix_synthetic_check_results_id', 'synthetic_check_results', ['id'])


def downgrade():
    op.drop_index('ix_synthetic_check_results_id', table_name='synthetic_check_results')
    op.drop_index('ix_synthetic_check_results_target_name', table_name='synthetic_check_results')
    op.drop_table('synthetic_check_results')
