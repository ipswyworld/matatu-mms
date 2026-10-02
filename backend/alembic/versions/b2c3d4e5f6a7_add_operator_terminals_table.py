"""add operator_terminals table

Revision ID: b2c3d4e5f6a7
Revises: a1b2c3d4e5f6
Create Date: 2026-09-25

"""
from alembic import op
import sqlalchemy as sa

revision = 'b2c3d4e5f6a7'
down_revision = 'a1b2c3d4e5f6'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'operator_terminals',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('sacco_id', sa.String(), nullable=False),
        sa.Column('route_id', sa.String(), nullable=False),
        sa.Column('label', sa.String(), nullable=False),
        sa.Column('stage_id', sa.String(), nullable=True),
        sa.Column('lat', sa.Float(), nullable=True),
        sa.Column('lng', sa.Float(), nullable=True),
        sa.Column('geocoded', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('match_status', sa.String(), nullable=False, server_default='PENDING'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['sacco_id'], ['saccos.id']),
        sa.ForeignKeyConstraint(['route_id'], ['routes.id']),
        sa.ForeignKeyConstraint(['stage_id'], ['stages.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_operator_terminals_id', 'operator_terminals', ['id'])
    op.create_index('ix_operator_terminals_sacco_id', 'operator_terminals', ['sacco_id'])
    op.create_index('ix_operator_terminals_route_id', 'operator_terminals', ['route_id'])
    op.create_index('ix_operator_terminals_stage_id', 'operator_terminals', ['stage_id'])
    op.create_index('ix_operator_terminals_match_status', 'operator_terminals', ['match_status'])


def downgrade():
    op.drop_index('ix_operator_terminals_match_status', table_name='operator_terminals')
    op.drop_index('ix_operator_terminals_stage_id', table_name='operator_terminals')
    op.drop_index('ix_operator_terminals_route_id', table_name='operator_terminals')
    op.drop_index('ix_operator_terminals_sacco_id', table_name='operator_terminals')
    op.drop_index('ix_operator_terminals_id', table_name='operator_terminals')
    op.drop_table('operator_terminals')
