"""add data_subject_requests

Revision ID: f2a3b4c5d6e7
Revises: e1f2a3b4c5d6
Create Date: 2026-09-25

"""
from alembic import op
import sqlalchemy as sa

revision = 'f2a3b4c5d6e7'
down_revision = 'e1f2a3b4c5d6'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'data_subject_requests',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('request_type', sa.String(), nullable=False),
        sa.Column('subject_name', sa.String(), nullable=False),
        sa.Column('subject_contact', sa.String(), nullable=False),
        sa.Column('description', sa.Text(), nullable=False),
        sa.Column('status', sa.String(), nullable=False, server_default='RECEIVED'),
        sa.Column('received_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('resolved_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('resolved_by', sa.String(), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('resolution_notes', sa.Text(), nullable=True),
    )
    op.create_index('ix_data_subject_requests_id', 'data_subject_requests', ['id'])


def downgrade():
    op.drop_index('ix_data_subject_requests_id', table_name='data_subject_requests')
    op.drop_table('data_subject_requests')
