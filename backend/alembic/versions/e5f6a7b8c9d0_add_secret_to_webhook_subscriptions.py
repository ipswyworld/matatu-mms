"""add secret to webhook_subscriptions

Revision ID: e5f6a7b8c9d0
Revises: d4e5f6a7b8c9
Create Date: 2026-09-25

"""
from alembic import op
import sqlalchemy as sa

revision = 'e5f6a7b8c9d0'
down_revision = 'd4e5f6a7b8c9'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('webhook_subscriptions', sa.Column('secret', sa.String(), nullable=True))


def downgrade():
    op.drop_column('webhook_subscriptions', 'secret')
