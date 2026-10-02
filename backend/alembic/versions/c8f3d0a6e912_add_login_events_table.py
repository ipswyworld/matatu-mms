"""add login_events table

Revision ID: c8f3d0a6e912
Revises: b2e7c4a19f03
Create Date: 2026-08-24 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c8f3d0a6e912'
down_revision: Union[str, Sequence[str], None] = 'b2e7c4a19f03'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'login_events',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('user_id', sa.String(), nullable=True),
        sa.Column('email', sa.String(), nullable=True),
        sa.Column('event_type', sa.String(), nullable=False),
        sa.Column('reason', sa.String(), nullable=True),
        sa.Column('ip_address', sa.String(), nullable=True),
        sa.Column('user_agent', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_login_events_id'), 'login_events', ['id'], unique=False)
    op.create_index(op.f('ix_login_events_user_id'), 'login_events', ['user_id'], unique=False)
    op.create_index(op.f('ix_login_events_created_at'), 'login_events', ['created_at'], unique=False)
    # The two actual query shapes: "this user's login history" (per-user
    # Activity tab) and "everyone's recent activity" (ops console cross-
    # account view) — both ordered by recency.
    op.create_index('ix_login_events_user_created', 'login_events', ['user_id', 'created_at'])
    op.create_index('ix_login_events_created_event', 'login_events', ['created_at', 'event_type'])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index('ix_login_events_created_event', table_name='login_events')
    op.drop_index('ix_login_events_user_created', table_name='login_events')
    op.drop_index(op.f('ix_login_events_created_at'), table_name='login_events')
    op.drop_index(op.f('ix_login_events_user_id'), table_name='login_events')
    op.drop_index(op.f('ix_login_events_id'), table_name='login_events')
    op.drop_table('login_events')
