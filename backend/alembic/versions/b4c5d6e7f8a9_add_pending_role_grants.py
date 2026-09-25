"""add pending_role_grants

Revision ID: b4c5d6e7f8a9
Revises: a3b4c5d6e7f8
Create Date: 2026-09-25

"""
from alembic import op
import sqlalchemy as sa

revision = 'b4c5d6e7f8a9'
down_revision = 'a3b4c5d6e7f8'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'pending_role_grants',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('user_id', sa.String(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('requested_role', sa.String(), nullable=False),
        sa.Column('requested_by', sa.String(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('requested_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('status', sa.String(), nullable=False, server_default='PENDING'),
        sa.Column('decided_by', sa.String(), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('decided_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('reason', sa.Text(), nullable=True),
    )
    op.create_index('ix_pending_role_grants_id', 'pending_role_grants', ['id'])


def downgrade():
    op.drop_index('ix_pending_role_grants_id', table_name='pending_role_grants')
    op.drop_table('pending_role_grants')
