"""add phone and OTP columns to users

Revision ID: b4d0e2f8a1c6
Revises: a3f9c1e7b2d4
Create Date: 2026-08-18 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b4d0e2f8a1c6'
down_revision: Union[str, Sequence[str], None] = 'a3f9c1e7b2d4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column("users", sa.Column("phone", sa.String(), nullable=True))
    op.create_index("ix_users_phone", "users", ["phone"], unique=True)
    op.add_column("users", sa.Column("phone_otp_code", sa.String(), nullable=True))
    op.add_column("users", sa.Column("phone_otp_expires_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("users", "phone_otp_expires_at")
    op.drop_column("users", "phone_otp_code")
    op.drop_index("ix_users_phone", table_name="users")
    op.drop_column("users", "phone")
