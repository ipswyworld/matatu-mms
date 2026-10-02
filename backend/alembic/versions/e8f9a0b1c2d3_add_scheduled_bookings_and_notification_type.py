"""add scheduled_bookings table and notification.type column

Revision ID: e8f9a0b1c2d3
Revises: d7e8f9a0b1c2
Create Date: 2026-09-27

"""
from alembic import op
import sqlalchemy as sa

revision = 'e8f9a0b1c2d3'
down_revision = 'd7e8f9a0b1c2'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'notifications',
        sa.Column('type', sa.String(), nullable=True, server_default='GENERIC'),
    )

    op.create_table(
        'scheduled_bookings',
        sa.Column('id', sa.String(), primary_key=True, index=True),
        sa.Column('route_id', sa.String(), sa.ForeignKey('routes.id'), nullable=False),
        sa.Column('matatu_id', sa.String(), sa.ForeignKey('matatus.id'), nullable=True),
        sa.Column('passenger_user_id', sa.String(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('passenger_name', sa.String(), nullable=False),
        sa.Column('phone', sa.String(), nullable=False),
        sa.Column('origin_stage_id', sa.String(), sa.ForeignKey('stages.id'), nullable=False),
        sa.Column('destination_stage_id', sa.String(), sa.ForeignKey('stages.id'), nullable=True),
        sa.Column('scheduled_departure', sa.DateTime(timezone=True), nullable=False),
        sa.Column('seat_numbers', sa.String(), nullable=False),
        sa.Column('fare_kes', sa.Numeric(12, 2), nullable=False),
        sa.Column('status', sa.String(), nullable=False, server_default='PENDING'),
        sa.Column('reminder_sent_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('is_recurring', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('recurrence_parent_id', sa.String(), sa.ForeignKey('scheduled_bookings.id'), nullable=True),
        sa.Column('accessibility_flag', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('trusted_contact_phone', sa.String(), nullable=True),
        sa.Column('share_token', sa.String(), nullable=True),
        sa.Column('share_expires_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('grace_period_minutes', sa.Integer(), nullable=False, server_default='15'),
        sa.Column('grace_expires_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('reassigned_from_matatu_id', sa.String(), sa.ForeignKey('matatus.id'), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index('ix_scheduled_bookings_scheduled_departure', 'scheduled_bookings', ['scheduled_departure'])
    op.create_index('ix_scheduled_bookings_share_token', 'scheduled_bookings', ['share_token'], unique=True)


def downgrade():
    op.drop_index('ix_scheduled_bookings_share_token', table_name='scheduled_bookings')
    op.drop_index('ix_scheduled_bookings_scheduled_departure', table_name='scheduled_bookings')
    op.drop_table('scheduled_bookings')
    op.drop_column('notifications', 'type')
