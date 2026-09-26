"""add journey_bookings table

Revision ID: d5e70ccc659f
Revises: 2e1e445daaaa
Create Date: 2026-09-26

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'd5e70ccc659f'
down_revision = '2e1e445daaaa'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'journey_bookings',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('passenger_user_id', sa.String(), nullable=False),
        sa.Column('leg1_booking_id', sa.String(), nullable=False),
        sa.Column('leg1_booking_type', sa.String(), nullable=False),
        sa.Column('leg2_booking_id', sa.String(), nullable=False),
        sa.Column('leg2_booking_type', sa.String(), nullable=False),
        sa.Column('transfer_stage_id', sa.String(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['passenger_user_id'], ['users.id']),
        sa.ForeignKeyConstraint(['transfer_stage_id'], ['stages.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_journey_bookings_id'), 'journey_bookings', ['id'], unique=False)


def downgrade():
    op.drop_index(op.f('ix_journey_bookings_id'), table_name='journey_bookings')
    op.drop_table('journey_bookings')
