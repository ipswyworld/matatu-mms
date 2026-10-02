"""composite indexes for fines activity audit logs matatus

Revision ID: 0c306b81c1c0
Revises: 8d88500c7433
Create Date: 2026-08-15 20:39:24.242066

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0c306b81c1c0'
down_revision: Union[str, Sequence[str], None] = '8d88500c7433'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Composite indexes matching the actual WHERE + ORDER BY shapes used by
    # the route handlers, not just the single-column PK/FK indexes that
    # existed before. See ARCHITECTURE_DECISIONS.md §16.2.
    op.create_index("ix_fines_matatu_status", "fines", ["matatu_id", "status"])
    op.create_index("ix_fines_status_issued_at", "fines", ["status", "issued_at"])
    op.create_index("ix_matatus_sacco_status", "matatus", ["sacco_id", "status"])
    op.create_index("ix_activity_logs_matatu_timestamp", "activity_logs", ["matatu_id", "timestamp"])
    op.create_index("ix_activity_logs_timestamp", "activity_logs", ["timestamp"])
    op.create_index("ix_audit_logs_resource_timestamp", "audit_logs", ["resource_type", "resource_id", "timestamp"])
    op.create_index("ix_audit_logs_timestamp", "audit_logs", ["timestamp"])
    op.create_index("ix_bookings_matatu_status", "bookings", ["matatu_id", "status"])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("ix_bookings_matatu_status", table_name="bookings")
    op.drop_index("ix_audit_logs_timestamp", table_name="audit_logs")
    op.drop_index("ix_audit_logs_resource_timestamp", table_name="audit_logs")
    op.drop_index("ix_activity_logs_timestamp", table_name="activity_logs")
    op.drop_index("ix_activity_logs_matatu_timestamp", table_name="activity_logs")
    op.drop_index("ix_matatus_sacco_status", table_name="matatus")
    op.drop_index("ix_fines_status_issued_at", table_name="fines")
    op.drop_index("ix_fines_matatu_status", table_name="fines")
