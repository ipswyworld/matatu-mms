"""case-insensitive unique index on user email

Revision ID: 8d88500c7433
Revises: 90975f33da4d
Create Date: 2026-08-15 19:54:54.200846

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '8d88500c7433'
down_revision: Union[str, Sequence[str], None] = '90975f33da4d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # The application layer now normalizes email to lowercase before every
    # write (app/schemas.py's _normalized_email_validator), but that's a
    # single point of trust, not a guarantee — this closes the same gap at
    # the data layer, independent of application code. Without it,
    # Postgres's default case-sensitive uniqueness lets "John@x.com" and
    # "john@x.com" exist as two separate accounts.
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS ix_users_email_lower "
            "ON users (lower(email))"
        )


def downgrade() -> None:
    """Downgrade schema."""
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute("DROP INDEX IF EXISTS ix_users_email_lower")
