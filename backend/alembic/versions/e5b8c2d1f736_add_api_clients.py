"""add api_clients

Machine principals for the partner API (Readiness List §14).
See app/api_clients.py.

Revision ID: e5b8c2d1f736
Revises: d1a7f3c9b204
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "e5b8c2d1f736"
down_revision: Union[str, Sequence[str], None] = "d1a7f3c9b204"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "api_clients",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("client_id", sa.String(), nullable=False),
        sa.Column("client_secret_hash", sa.String(), nullable=False),
        sa.Column("sacco_id", sa.String(), nullable=True),
        sa.Column("effective_role", sa.String(), nullable=False, server_default="SACCO_OPERATOR"),
        sa.Column("scopes", sa.Text(), nullable=False, server_default="[]"),
        sa.Column("quota_tier", sa.String(), nullable=False, server_default="partner"),
        sa.Column("created_by", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_reason", sa.String(), nullable=True),
        sa.ForeignKeyConstraint(["sacco_id"], ["saccos.id"]),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    # client_id is the lookup key on every token exchange.
    op.create_index("ix_api_clients_client_id", "api_clients", ["client_id"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_api_clients_client_id", table_name="api_clients")
    op.drop_table("api_clients")
