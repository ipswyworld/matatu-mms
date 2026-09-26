"""add vehicle_position_reports table

Revision ID: a35e0ac485f8
Revises: d5e70ccc659f
Create Date: 2026-09-26

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'a35e0ac485f8'
down_revision = 'd5e70ccc659f'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'vehicle_position_reports',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('matatu_id', sa.String(), nullable=False),
        sa.Column('reporter_user_id', sa.String(), nullable=False),
        sa.Column('reporter_lat', sa.Float(), nullable=False),
        sa.Column('reporter_lng', sa.Float(), nullable=False),
        sa.Column('claimed_lat', sa.Float(), nullable=False),
        sa.Column('claimed_lng', sa.Float(), nullable=False),
        sa.Column('discrepancy_meters', sa.Float(), nullable=False),
        sa.Column('flagged', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('resolved', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.ForeignKeyConstraint(['matatu_id'], ['matatus.id']),
        sa.ForeignKeyConstraint(['reporter_user_id'], ['users.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_vehicle_position_reports_id'), 'vehicle_position_reports', ['id'], unique=False)
    op.create_index('ix_vpr_matatu_created', 'vehicle_position_reports', ['matatu_id', 'created_at'], unique=False)


def downgrade():
    op.drop_index('ix_vpr_matatu_created', table_name='vehicle_position_reports')
    op.drop_index(op.f('ix_vehicle_position_reports_id'), table_name='vehicle_position_reports')
    op.drop_table('vehicle_position_reports')
