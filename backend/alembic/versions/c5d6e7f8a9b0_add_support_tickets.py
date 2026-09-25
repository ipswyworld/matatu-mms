"""add support_tickets

Revision ID: c5d6e7f8a9b0
Revises: b4c5d6e7f8a9
Create Date: 2026-09-25

"""
from alembic import op
import sqlalchemy as sa

revision = 'c5d6e7f8a9b0'
down_revision = 'b4c5d6e7f8a9'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'support_tickets',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('subject', sa.String(), nullable=False),
        sa.Column('description', sa.Text(), nullable=False),
        sa.Column('status', sa.String(), nullable=False, server_default='OPEN'),
        sa.Column('priority', sa.String(), nullable=False, server_default='MEDIUM'),
        sa.Column('assignee_id', sa.String(), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('reporter_name', sa.String(), nullable=False),
        sa.Column('reporter_contact', sa.String(), nullable=False),
        sa.Column('created_by', sa.String(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('resolved_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index('ix_support_tickets_id', 'support_tickets', ['id'])


def downgrade():
    op.drop_index('ix_support_tickets_id', table_name='support_tickets')
    op.drop_table('support_tickets')
