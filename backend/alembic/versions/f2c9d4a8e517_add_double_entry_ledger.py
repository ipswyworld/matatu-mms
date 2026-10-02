"""add double-entry ledger

County revenue accounting (Readiness List §15). See app/ledger.py.

Revision ID: f2c9d4a8e517
Revises: e5b8c2d1f736
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "f2c9d4a8e517"
down_revision: Union[str, Sequence[str], None] = "e5b8c2d1f736"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "journal_entries",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("description", sa.String(), nullable=False),
        sa.Column("reference_type", sa.String(), nullable=True),
        sa.Column("reference_id", sa.String(), nullable=True),
        sa.Column("idempotency_key", sa.String(), nullable=True),
        sa.Column("actor_id", sa.String(), nullable=True),
        sa.Column("reverses_entry_id", sa.String(), nullable=True),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["reverses_entry_id"], ["journal_entries.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_journal_entries_reference_type", "journal_entries", ["reference_type"])
    op.create_index("ix_journal_entries_reference_id", "journal_entries", ["reference_id"])
    op.create_index("ix_journal_entries_occurred_at", "journal_entries", ["occurred_at"])
    op.create_index("ix_journal_entries_reverses", "journal_entries", ["reverses_entry_id"])
    # Unique, so a replayed payment callback loses at the database rather
    # than racing two processes to both credit the county.
    op.create_index(
        "ix_journal_entries_idempotency_key", "journal_entries", ["idempotency_key"], unique=True
    )

    op.create_table(
        "ledger_postings",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("entry_id", sa.String(), nullable=False),
        sa.Column("line_number", sa.Integer(), nullable=False),
        sa.Column("account", sa.String(), nullable=False),
        # Numeric, never Float. See the model docstring.
        sa.Column("amount", sa.Numeric(14, 2), nullable=False),
        sa.Column("memo", sa.String(), nullable=True),
        sa.ForeignKeyConstraint(["entry_id"], ["journal_entries.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_ledger_postings_entry_id", "ledger_postings", ["entry_id"])
    op.create_index("ix_ledger_postings_account", "ledger_postings", ["account"])


def downgrade() -> None:
    op.drop_index("ix_ledger_postings_account", table_name="ledger_postings")
    op.drop_index("ix_ledger_postings_entry_id", table_name="ledger_postings")
    op.drop_table("ledger_postings")
    op.drop_index("ix_journal_entries_idempotency_key", table_name="journal_entries")
    op.drop_index("ix_journal_entries_reverses", table_name="journal_entries")
    op.drop_index("ix_journal_entries_occurred_at", table_name="journal_entries")
    op.drop_index("ix_journal_entries_reference_id", table_name="journal_entries")
    op.drop_index("ix_journal_entries_reference_type", table_name="journal_entries")
    op.drop_table("journal_entries")
