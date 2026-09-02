"""add message_logs and messaging_opt_outs

Delivery tracking, cost accounting and consent for outbound SMS
(Readiness List §19). See app/messaging.py.

Revision ID: b9e4f1c7a308
Revises: a3d6e9b7c284
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "b9e4f1c7a308"
down_revision: Union[str, Sequence[str], None] = "a3d6e9b7c284"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "message_logs",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("phone", sa.String(), nullable=False),
        sa.Column("user_id", sa.String(), nullable=True),
        sa.Column("category", sa.String(), nullable=False),
        sa.Column("channel", sa.String(), nullable=False, server_default="sms"),
        sa.Column("segments", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("is_unicode", sa.Boolean(), nullable=False, server_default=sa.false()),
        # Numeric(12,4): per-segment rates are sub-shilling, so two decimal
        # places would round every individual message to zero and lose the
        # total entirely.
        sa.Column("cost_kes", sa.Numeric(12, 4), nullable=False, server_default="0"),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("error", sa.String(), nullable=True),
        sa.Column("delivered_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("provider_message_id", sa.String(), nullable=True),
        sa.Column("reference_type", sa.String(), nullable=True),
        sa.Column("reference_id", sa.String(), nullable=True),
        sa.Column("body_preview", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_message_logs_phone", "message_logs", ["phone"])
    op.create_index("ix_message_logs_category", "message_logs", ["category"])
    op.create_index("ix_message_logs_status", "message_logs", ["status"])
    op.create_index("ix_message_logs_created_at", "message_logs", ["created_at"])
    # Delivery receipts arrive asynchronously and are matched on this.
    op.create_index("ix_message_logs_provider_id", "message_logs", ["provider_message_id"])

    op.create_table(
        "messaging_opt_outs",
        sa.Column("phone", sa.String(), nullable=False),
        sa.Column("opted_out_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("opted_in_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("source", sa.String(), nullable=True),
        sa.PrimaryKeyConstraint("phone"),
    )


def downgrade() -> None:
    op.drop_table("messaging_opt_outs")
    op.drop_index("ix_message_logs_provider_id", table_name="message_logs")
    op.drop_index("ix_message_logs_created_at", table_name="message_logs")
    op.drop_index("ix_message_logs_status", table_name="message_logs")
    op.drop_index("ix_message_logs_category", table_name="message_logs")
    op.drop_index("ix_message_logs_phone", table_name="message_logs")
    op.drop_table("message_logs")
