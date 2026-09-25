"""add environment and ip_allowlist to api_clients

Revision ID: d4e5f6a7b8c9
Revises: c3d4e5f6a7b8
Create Date: 2026-09-25

"""
from alembic import op
import sqlalchemy as sa

revision = 'd4e5f6a7b8c9'
down_revision = 'c3d4e5f6a7b8'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('api_clients', sa.Column('environment', sa.String(), nullable=False, server_default='production'))
    op.add_column('api_clients', sa.Column('ip_allowlist', sa.Text(), nullable=True))


def downgrade():
    op.drop_column('api_clients', 'ip_allowlist')
    op.drop_column('api_clients', 'environment')
