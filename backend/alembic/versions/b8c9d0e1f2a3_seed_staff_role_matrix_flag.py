"""seed staff_role_matrix_enabled feature flag

Revision ID: b8c9d0e1f2a3
Revises: a7b8c9d0e1f2
Create Date: 2026-09-25

Seeds the first real feature-flag consumer (RoleMatrix panel in the staff
app's Users & Roles page) as enabled — the panel is visible today with no
gating at all, so shipping the flag check without this seed would silently
hide it for everyone until a SUPERADMIN happened to create the row via the
ops console.
"""
from alembic import op
import sqlalchemy as sa
import datetime

revision = 'b8c9d0e1f2a3'
down_revision = 'a7b8c9d0e1f2'
branch_labels = None
depends_on = None

FLAG_KEY = "staff_role_matrix_enabled"


def upgrade():
    conn = op.get_bind()
    feature_flags = sa.table(
        'feature_flags',
        sa.column('key', sa.String),
        sa.column('description', sa.String),
        sa.column('enabled', sa.Boolean),
        sa.column('updated_by', sa.String),
        sa.column('updated_at', sa.DateTime),
    )
    existing = conn.execute(
        sa.text("SELECT 1 FROM feature_flags WHERE key = :key"), {"key": FLAG_KEY}
    ).first()
    if not existing:
        conn.execute(
            feature_flags.insert().values(
                key=FLAG_KEY,
                description="Shows the Role Matrix tab on the staff app's Users & Roles page.",
                enabled=True,
                updated_by=None,
                updated_at=datetime.datetime.now(datetime.timezone.utc),
            )
        )


def downgrade():
    op.execute(sa.text("DELETE FROM feature_flags WHERE key = :key").bindparams(key=FLAG_KEY))
