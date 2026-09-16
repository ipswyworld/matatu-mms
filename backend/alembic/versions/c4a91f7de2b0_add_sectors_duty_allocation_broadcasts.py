"""add sectors, zone geography, officer service record, duty allocation and broadcasts

Brings the enforcement roster up to parity with the county's real PTCU
monthly duty-allocation sheet: Section -> Sector -> Zone -> officer, with
ranks, manpower numbers, duty status, monthly allocation documents and
command broadcasts.

Revision ID: c4a91f7de2b0
Revises: b9e4f1c7a308
Create Date: 2026-09-16 15:40:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c4a91f7de2b0'
down_revision: Union[str, Sequence[str], None] = 'b9e4f1c7a308'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # --- Sectors -------------------------------------------------------
    # The users FKs are added separately below, after the table exists:
    # users -> zones -> sectors -> users is a circular dependency, and
    # Postgres cannot create a table with a FK to a table that does not
    # exist yet in either direction. Same reason models.py marks these two
    # constraints use_alter=True.
    op.create_table(
        "sectors",
        sa.Column("id", sa.String(), primary_key=True, index=True),
        sa.Column("code", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("description", sa.String(), nullable=True),
        sa.Column("commander_id", sa.String(), nullable=True),
        sa.Column("deputy_commander_id", sa.String(), nullable=True),
        sa.Column("contact_phone", sa.String(), nullable=True),
        sa.Column("center_lat", sa.Float(), nullable=True),
        sa.Column("center_lng", sa.Float(), nullable=True),
        sa.Column("boundary_geojson", sa.Text(), nullable=True),
        sa.Column("display_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("code", name="uq_sectors_code"),
    )
    op.create_foreign_key("fk_sectors_commander_id", "sectors", "users", ["commander_id"], ["id"])
    op.create_foreign_key("fk_sectors_deputy_commander_id", "sectors", "users", ["deputy_commander_id"], ["id"])

    # --- Zones: from a bare label to a mappable posting ----------------
    # Every column nullable / defaulted: the four existing corridor zones
    # keep working untouched, with sector_id NULL, rather than being
    # migrated into a hierarchy they were never part of.
    op.add_column("zones", sa.Column("sector_id", sa.String(), nullable=True))
    op.add_column("zones", sa.Column("code", sa.String(), nullable=True))
    op.add_column("zones", sa.Column("center_lat", sa.Float(), nullable=True))
    op.add_column("zones", sa.Column("center_lng", sa.Float(), nullable=True))
    op.add_column("zones", sa.Column("boundary_geojson", sa.Text(), nullable=True))
    op.add_column("zones", sa.Column("display_order", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("zones", sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()))
    op.create_foreign_key("fk_zones_sector_id", "zones", "sectors", ["sector_id"], ["id"])

    # --- Officer service record on users -------------------------------
    op.add_column("users", sa.Column("manpower_no", sa.String(), nullable=True))
    op.add_column("users", sa.Column("rank", sa.String(), nullable=True))
    # server_default, not just a Python-side default: existing rows need a
    # value for a NOT NULL column, and ON_DUTY is the correct answer for
    # every account that predates duty tracking — nobody was on recorded
    # leave before there was a way to record it.
    op.add_column("users", sa.Column("duty_status", sa.String(), nullable=False, server_default="ON_DUTY"))
    op.add_column("users", sa.Column("duty_status_from", sa.Date(), nullable=True))
    op.add_column("users", sa.Column("duty_status_until", sa.Date(), nullable=True))
    op.add_column("users", sa.Column("duty_status_note", sa.String(), nullable=True))
    op.add_column("users", sa.Column("gender", sa.String(), nullable=True))
    op.create_index("ix_users_manpower_no", "users", ["manpower_no"], unique=True)

    # --- Monthly duty allocation ---------------------------------------
    op.create_table(
        "duty_allocations",
        sa.Column("id", sa.String(), primary_key=True, index=True),
        sa.Column("year", sa.Integer(), nullable=False),
        sa.Column("month", sa.Integer(), nullable=False),
        sa.Column("reference_no", sa.String(), nullable=True),
        sa.Column("title", sa.String(), nullable=True),
        sa.Column("status", sa.String(), nullable=False, server_default="DRAFT"),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_by", sa.String(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("published_by", sa.String(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("year", "month", name="uq_duty_allocation_year_month"),
    )

    op.create_table(
        "duty_assignments",
        sa.Column("id", sa.String(), primary_key=True, index=True),
        sa.Column("allocation_id", sa.String(), sa.ForeignKey("duty_allocations.id"), nullable=False),
        sa.Column("officer_id", sa.String(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("sector_id", sa.String(), sa.ForeignKey("sectors.id"), nullable=True),
        sa.Column("zone_id", sa.String(), sa.ForeignKey("zones.id"), nullable=True),
        sa.Column("work_station", sa.String(), nullable=False),
        sa.Column("shift", sa.String(), nullable=False, server_default="DAY"),
        sa.Column("coverage", sa.String(), nullable=False, server_default="DAILY"),
        sa.Column("effective_from", sa.Date(), nullable=True),
        sa.Column("effective_to", sa.Date(), nullable=True),
        sa.Column("posting_role", sa.String(), nullable=True),
        sa.Column("notes", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_duty_assignments_allocation", "duty_assignments", ["allocation_id"])
    op.create_index("ix_duty_assignments_officer", "duty_assignments", ["officer_id"])

    # --- Broadcasts ----------------------------------------------------
    op.create_table(
        "broadcasts",
        sa.Column("id", sa.String(), primary_key=True, index=True),
        sa.Column("subject", sa.String(), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("priority", sa.String(), nullable=False, server_default="NORMAL"),
        sa.Column("audience", sa.String(), nullable=False),
        sa.Column("audience_sector_id", sa.String(), sa.ForeignKey("sectors.id"), nullable=True),
        sa.Column("audience_zone_id", sa.String(), sa.ForeignKey("zones.id"), nullable=True),
        sa.Column("sent_by", sa.String(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_broadcasts_sent_at", "broadcasts", ["sent_at"])

    op.create_table(
        "broadcast_recipients",
        sa.Column("id", sa.Integer(), primary_key=True, index=True, autoincrement=True),
        sa.Column("broadcast_id", sa.String(), sa.ForeignKey("broadcasts.id"), nullable=False),
        sa.Column("officer_id", sa.String(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("broadcast_id", "officer_id", name="uq_broadcast_recipient"),
    )
    op.create_index("ix_broadcast_recipients_broadcast", "broadcast_recipients", ["broadcast_id"])
    op.create_index("ix_broadcast_recipients_officer", "broadcast_recipients", ["officer_id"])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("ix_broadcast_recipients_officer", table_name="broadcast_recipients")
    op.drop_index("ix_broadcast_recipients_broadcast", table_name="broadcast_recipients")
    op.drop_table("broadcast_recipients")
    op.drop_index("ix_broadcasts_sent_at", table_name="broadcasts")
    op.drop_table("broadcasts")

    op.drop_index("ix_duty_assignments_officer", table_name="duty_assignments")
    op.drop_index("ix_duty_assignments_allocation", table_name="duty_assignments")
    op.drop_table("duty_assignments")
    op.drop_table("duty_allocations")

    op.drop_index("ix_users_manpower_no", table_name="users")
    op.drop_column("users", "gender")
    op.drop_column("users", "duty_status_note")
    op.drop_column("users", "duty_status_until")
    op.drop_column("users", "duty_status_from")
    op.drop_column("users", "duty_status")
    op.drop_column("users", "rank")
    op.drop_column("users", "manpower_no")

    # Drop the zones FK before the sectors table it points at.
    op.drop_constraint("fk_zones_sector_id", "zones", type_="foreignkey")
    op.drop_column("zones", "is_active")
    op.drop_column("zones", "display_order")
    op.drop_column("zones", "boundary_geojson")
    op.drop_column("zones", "center_lng")
    op.drop_column("zones", "center_lat")
    op.drop_column("zones", "code")
    op.drop_column("zones", "sector_id")

    op.drop_constraint("fk_sectors_deputy_commander_id", "sectors", type_="foreignkey")
    op.drop_constraint("fk_sectors_commander_id", "sectors", type_="foreignkey")
    op.drop_table("sectors")
