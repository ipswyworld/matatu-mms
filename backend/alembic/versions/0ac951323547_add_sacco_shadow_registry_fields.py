"""add sacco shadow registry fields

Revision ID: 0ac951323547
Revises: b61b4587ae2c
Create Date: 2026-08-21 21:17:40.621959

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0ac951323547'
down_revision: Union[str, Sequence[str], None] = 'b61b4587ae2c'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column("saccos", sa.Column("shadow_contact_name", sa.String(), nullable=True))
    op.add_column("saccos", sa.Column("shadow_contact_phone", sa.String(), nullable=True))
    op.add_column("saccos", sa.Column("shadow_source", sa.String(), nullable=True))
    op.add_column("saccos", sa.Column("compliance_deadline", sa.DateTime(timezone=True), nullable=True))
    op.add_column("saccos", sa.Column("invited_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("saccos", "invited_at")
    op.drop_column("saccos", "compliance_deadline")
    op.drop_column("saccos", "shadow_source")
    op.drop_column("saccos", "shadow_contact_phone")
    op.drop_column("saccos", "shadow_contact_name")
