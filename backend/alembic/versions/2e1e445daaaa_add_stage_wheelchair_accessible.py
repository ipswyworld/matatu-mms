"""add stage wheelchair_accessible

Revision ID: 2e1e445daaaa
Revises: e8f9a0b1c2d3
Create Date: 2026-09-26

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = '2e1e445daaaa'
down_revision = 'e8f9a0b1c2d3'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'stages',
        sa.Column('wheelchair_accessible', sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade():
    op.drop_column('stages', 'wheelchair_accessible')
