"""money to numeric and timestamps to real datetime

Revision ID: 2e438f79e7bb
Revises: 0c306b81c1c0
Create Date: 2026-08-15 21:07:18.673215

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '2e438f79e7bb'
down_revision: Union[str, Sequence[str], None] = '0c306b81c1c0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


MONEY_COLUMNS = [
    ("routes", "fare_kes"),
    ("crime_records", "fine_amount_kes"),
    ("fines", "amount_kes"),
    ("bookings", "fare_kes"),
    ("offence_types", "default_fine_kes"),
    ("enforcement_cases", "fine_amount_kes"),
]

# (table, column, nullable) — nullable matters for the downgrade path,
# where a column that started NOT NULL as a string must stay NOT NULL
# after casting back.
TIMESTAMP_COLUMNS = [
    ("saccos", "created_at", True),
    ("saccos", "application_submitted_at", True),
    ("saccos", "director_mobility_decided_at", True),
    ("saccos", "chief_officer_decided_at", True),
    ("users", "terms_accepted_at", True),
    ("users", "reset_token_expires_at", True),
    ("matatus", "created_at", False),
    ("activity_logs", "timestamp", False),
    ("crime_records", "timestamp", False),
    ("fines", "issued_at", False),
    ("bookings", "booked_at", False),
    ("passenger_reports", "created_at", False),
    ("audit_logs", "timestamp", False),
    ("enforcement_cases", "created_at", False),
    ("enforcement_cases", "paid_at", True),
    ("enforcement_cases", "released_at", True),
    ("webhook_logs", "timestamp", False),
]

DATE_COLUMNS = [
    ("fines", "due_date", False),
]


def upgrade() -> None:
    """Upgrade schema."""
    # §21.1/§21.2 in ARCHITECTURE_DECISIONS.md — money as Float loses cent
    # precision under repeated arithmetic (reconciliation drift against
    # NairobiPay), and timestamps as String meant ordering only held as
    # long as every writer emitted byte-identical ISO-8601, with no real
    # date arithmetic possible in SQL. Done now, before real financial data
    # exists, while a direct ALTER is still cheap — see the doc for the
    # full reasoning and the expand/contract approach this would need once
    # there's live production data to protect.
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return

    for table, column in MONEY_COLUMNS:
        op.alter_column(
            table, column,
            type_=sa.Numeric(12, 2),
            postgresql_using=f"{column}::numeric(12,2)",
        )

    for table, column, nullable in TIMESTAMP_COLUMNS:
        op.alter_column(
            table, column,
            type_=sa.DateTime(timezone=True),
            postgresql_using=f"{column}::timestamptz",
            nullable=nullable,
        )

    for table, column, nullable in DATE_COLUMNS:
        op.alter_column(
            table, column,
            type_=sa.Date(),
            postgresql_using=f"{column}::date",
            nullable=nullable,
        )


def downgrade() -> None:
    """Downgrade schema."""
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return

    for table, column, nullable in DATE_COLUMNS:
        op.alter_column(
            table, column,
            type_=sa.String(),
            postgresql_using=f"{column}::text",
            nullable=nullable,
        )

    for table, column, nullable in TIMESTAMP_COLUMNS:
        op.alter_column(
            table, column,
            type_=sa.String(),
            postgresql_using=f"{column}::text",
            nullable=nullable,
        )

    for table, column in MONEY_COLUMNS:
        op.alter_column(
            table, column,
            type_=sa.Float(),
            postgresql_using=f"{column}::float8",
        )
