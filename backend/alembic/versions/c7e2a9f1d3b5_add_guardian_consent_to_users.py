"""add guardian consent fields to users

Revision ID: c7e2a9f1d3b5
Revises: b4d0e2f8a1c6
Create Date: 2026-08-18

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'c7e2a9f1d3b5'
down_revision: Union[str, Sequence[str], None] = 'b4d0e2f8a1c6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("is_minor", sa.Boolean(), server_default=sa.false()))
    op.add_column("users", sa.Column("guardian_name", sa.String(), nullable=True))
    op.add_column("users", sa.Column("guardian_phone", sa.String(), nullable=True))
    op.add_column("users", sa.Column("guardian_relationship", sa.String(), nullable=True))
    op.add_column("users", sa.Column("guardian_id_number", sa.String(), nullable=True))
    op.add_column("users", sa.Column("guardian_approved", sa.Boolean(), server_default=sa.false()))
    op.add_column("users", sa.Column("guardian_approved_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("users", sa.Column("guardian_approval_token", sa.String(), nullable=True))
    op.add_column("users", sa.Column("guardian_approval_token_expires_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index("ix_users_guardian_approval_token", "users", ["guardian_approval_token"])


def downgrade() -> None:
    op.drop_index("ix_users_guardian_approval_token", table_name="users")
    op.drop_column("users", "guardian_approval_token_expires_at")
    op.drop_column("users", "guardian_approval_token")
    op.drop_column("users", "guardian_approved_at")
    op.drop_column("users", "guardian_approved")
    op.drop_column("users", "guardian_id_number")
    op.drop_column("users", "guardian_relationship")
    op.drop_column("users", "guardian_phone")
    op.drop_column("users", "guardian_name")
    op.drop_column("users", "is_minor")
