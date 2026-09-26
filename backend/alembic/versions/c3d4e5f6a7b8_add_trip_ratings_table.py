"""add trip_ratings table

Revision ID: c3d4e5f6a7b8
Revises: b2c3d4e5f6a7
Create Date: 2026-09-25

"""
from alembic import op
import sqlalchemy as sa

revision = 'c3d4e5f6a7b8'
down_revision = 'b2c3d4e5f6a7'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'trip_ratings',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('booking_id', sa.String(), nullable=False),
        sa.Column('matatu_id', sa.String(), nullable=False),
        sa.Column('sacco_id', sa.String(), nullable=False),
        sa.Column('driver_user_id', sa.String(), nullable=True),
        sa.Column('conductor_user_id', sa.String(), nullable=True),
        sa.Column('rating', sa.Integer(), nullable=False),
        sa.Column('comment', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['booking_id'], ['bookings.id']),
        sa.ForeignKeyConstraint(['matatu_id'], ['matatus.id']),
        sa.ForeignKeyConstraint(['sacco_id'], ['saccos.id']),
        sa.ForeignKeyConstraint(['driver_user_id'], ['users.id']),
        sa.ForeignKeyConstraint(['conductor_user_id'], ['users.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.CheckConstraint('rating >= 1 AND rating <= 5', name='ck_trip_ratings_rating_range'),
    )
    op.create_index('ix_trip_ratings_id', 'trip_ratings', ['id'])
    op.create_index('ix_trip_ratings_booking_id', 'trip_ratings', ['booking_id'], unique=True)
    op.create_index('ix_trip_ratings_sacco_id', 'trip_ratings', ['sacco_id'])
    op.create_index('ix_trip_ratings_driver_user_id', 'trip_ratings', ['driver_user_id'])
    op.create_index('ix_trip_ratings_conductor_user_id', 'trip_ratings', ['conductor_user_id'])


def downgrade():
    op.drop_index('ix_trip_ratings_conductor_user_id', table_name='trip_ratings')
    op.drop_index('ix_trip_ratings_driver_user_id', table_name='trip_ratings')
    op.drop_index('ix_trip_ratings_sacco_id', table_name='trip_ratings')
    op.drop_index('ix_trip_ratings_booking_id', table_name='trip_ratings')
    op.drop_index('ix_trip_ratings_id', table_name='trip_ratings')
    op.drop_table('trip_ratings')
