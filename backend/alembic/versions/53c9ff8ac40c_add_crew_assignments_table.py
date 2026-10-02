"""add crew_assignments table

Revision ID: 53c9ff8ac40c
Revises: f4530e347588
Create Date: 2026-08-15 21:40:50.710266

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '53c9ff8ac40c'
down_revision: Union[str, Sequence[str], None] = 'f4530e347588'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "crew_assignments",
        sa.Column("id", sa.String(), primary_key=True, index=True),
        sa.Column("user_id", sa.String(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("matatu_id", sa.String(), sa.ForeignKey("matatus.id"), nullable=False),
        sa.Column("crew_role", sa.String(), nullable=False),
        sa.Column("assigned_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("unassigned_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_crew_assignments_user", "crew_assignments", ["user_id"])
    op.create_index("ix_crew_assignments_matatu", "crew_assignments", ["matatu_id"])
    # Partial-style lookup helper: "which crew are currently active on this
    # vehicle" is the hot query (crew login, operator dashboard listing).
    op.create_index(
        "ix_crew_assignments_matatu_active",
        "crew_assignments",
        ["matatu_id", "unassigned_at"],
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("ix_crew_assignments_matatu_active", table_name="crew_assignments")
    op.drop_index("ix_crew_assignments_matatu", table_name="crew_assignments")
    op.drop_index("ix_crew_assignments_user", table_name="crew_assignments")
    op.drop_table("crew_assignments")
