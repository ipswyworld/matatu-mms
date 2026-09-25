"""add data_quality_check_results

Revision ID: a3b4c5d6e7f8
Revises: f2a3b4c5d6e7
Create Date: 2026-09-25

"""
from alembic import op
import sqlalchemy as sa

revision = 'a3b4c5d6e7f8'
down_revision = 'f2a3b4c5d6e7'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'data_quality_check_results',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('check_name', sa.String(), nullable=False),
        sa.Column('checked_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('issue_count', sa.Integer(), nullable=False),
        sa.Column('sample_ids', sa.Text(), nullable=True),
    )
    op.create_index('ix_data_quality_check_results_check_name', 'data_quality_check_results', ['check_name'])
    op.create_index('ix_data_quality_check_results_id', 'data_quality_check_results', ['id'])


def downgrade():
    op.drop_index('ix_data_quality_check_results_id', table_name='data_quality_check_results')
    op.drop_index('ix_data_quality_check_results_check_name', table_name='data_quality_check_results')
    op.drop_table('data_quality_check_results')
