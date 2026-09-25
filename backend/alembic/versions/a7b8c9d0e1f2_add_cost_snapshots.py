"""add cost_snapshots

Revision ID: a7b8c9d0e1f2
Revises: f6a7b8c9d0e1
Create Date: 2026-09-25

"""
from alembic import op
import sqlalchemy as sa

revision = 'a7b8c9d0e1f2'
down_revision = 'f6a7b8c9d0e1'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'cost_snapshots',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('month', sa.String(), nullable=False, unique=True),
        sa.Column('amount_kes', sa.Numeric(12, 2), nullable=False),
        sa.Column('note', sa.Text(), nullable=True),
        sa.Column('recorded_by', sa.String(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('recorded_at', sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index('ix_cost_snapshots_month', 'cost_snapshots', ['month'])
    op.create_index('ix_cost_snapshots_id', 'cost_snapshots', ['id'])


def downgrade():
    op.drop_index('ix_cost_snapshots_id', table_name='cost_snapshots')
    op.drop_index('ix_cost_snapshots_month', table_name='cost_snapshots')
    op.drop_table('cost_snapshots')
