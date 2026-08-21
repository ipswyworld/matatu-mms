"""add case dispute review fields

Revision ID: b61b4587ae2c
Revises: 3906acc8fc22
Create Date: 2026-08-21 20:54:39.109612

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b61b4587ae2c'
down_revision: Union[str, Sequence[str], None] = '3906acc8fc22'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column("enforcement_cases", sa.Column("disputed_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("enforcement_cases", sa.Column("reviewer_id", sa.String(), nullable=True))
    op.add_column("enforcement_cases", sa.Column("review_notes", sa.Text(), nullable=True))
    op.add_column("enforcement_cases", sa.Column("resolution", sa.String(), nullable=True))
    op.add_column("enforcement_cases", sa.Column("resolution_reason", sa.Text(), nullable=True))
    op.add_column("enforcement_cases", sa.Column("resolved_by_id", sa.String(), nullable=True))
    op.add_column("enforcement_cases", sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True))
    op.create_foreign_key(
        "fk_enforcement_cases_reviewer_id", "enforcement_cases", "users", ["reviewer_id"], ["id"]
    )
    op.create_foreign_key(
        "fk_enforcement_cases_resolved_by_id", "enforcement_cases", "users", ["resolved_by_id"], ["id"]
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint("fk_enforcement_cases_resolved_by_id", "enforcement_cases", type_="foreignkey")
    op.drop_constraint("fk_enforcement_cases_reviewer_id", "enforcement_cases", type_="foreignkey")
    op.drop_column("enforcement_cases", "resolved_at")
    op.drop_column("enforcement_cases", "resolved_by_id")
    op.drop_column("enforcement_cases", "resolution_reason")
    op.drop_column("enforcement_cases", "resolution")
    op.drop_column("enforcement_cases", "review_notes")
    op.drop_column("enforcement_cases", "reviewer_id")
    op.drop_column("enforcement_cases", "disputed_at")
