"""add idempotency_records

Replay protection for state-changing endpoints (Readiness List §15, §20).
See app/idempotency.py.

Revision ID: d1a7f3c9b204
Revises: c8f2a5d7e401
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "d1a7f3c9b204"
down_revision: Union[str, Sequence[str], None] = "c8f2a5d7e401"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "idempotency_records",
        sa.Column("key", sa.String(), nullable=False),
        sa.Column("actor_id", sa.String(), nullable=True),
        sa.Column("endpoint", sa.String(), nullable=False),
        sa.Column("request_fingerprint", sa.String(), nullable=False),
        sa.Column("response_body", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("key"),
    )
    # Purging by age is the only query that scans this table.
    op.create_index(
        "ix_idempotency_records_created_at", "idempotency_records", ["created_at"]
    )


def downgrade() -> None:
    op.drop_index("ix_idempotency_records_created_at", table_name="idempotency_records")
    op.drop_table("idempotency_records")
