"""add stage and route_stage tables for BRN digitization

Revision ID: f4530e347588
Revises: 311917b90975
Create Date: 2026-08-15 21:26:53.628287

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f4530e347588'
down_revision: Union[str, Sequence[str], None] = '311917b90975'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column("routes", sa.Column("brn_serial", sa.String(), nullable=True))
    op.add_column("routes", sa.Column("base_route_id", sa.String(), nullable=True))
    op.add_column("routes", sa.Column("corridor", sa.String(), nullable=True))
    op.add_column("routes", sa.Column("start_point", sa.String(), nullable=True))
    op.add_column("routes", sa.Column("end_point", sa.String(), nullable=True))
    op.create_index("ix_routes_brn_serial", "routes", ["brn_serial"])
    op.create_foreign_key(
        "fk_routes_base_route_id", "routes", "routes",
        ["base_route_id"], ["id"],
    )

    op.create_table(
        "stages",
        sa.Column("id", sa.String(), primary_key=True, index=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("code", sa.String(), nullable=True),
        sa.Column("stage_type", sa.String(), server_default="STAGE"),
        sa.Column("zone", sa.String(), nullable=True),
        sa.Column("lat", sa.Float(), nullable=True),
        sa.Column("lng", sa.Float(), nullable=True),
        sa.Column("geocoded", sa.Boolean(), server_default=sa.false()),
    )

    op.create_table(
        "route_stages",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("route_id", sa.String(), sa.ForeignKey("routes.id"), nullable=False),
        sa.Column("stage_id", sa.String(), sa.ForeignKey("stages.id"), nullable=False),
        sa.Column("sequence", sa.Integer(), nullable=False),
        sa.Column("direction", sa.String(), nullable=False),
    )
    op.create_index("ix_route_stages_route_direction", "route_stages", ["route_id", "direction", "sequence"])
    op.create_index("ix_route_stages_stage", "route_stages", ["stage_id"])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("ix_route_stages_stage", table_name="route_stages")
    op.drop_index("ix_route_stages_route_direction", table_name="route_stages")
    op.drop_table("route_stages")
    op.drop_table("stages")
    op.drop_constraint("fk_routes_base_route_id", "routes", type_="foreignkey")
    op.drop_index("ix_routes_brn_serial", table_name="routes")
    op.drop_column("routes", "end_point")
    op.drop_column("routes", "start_point")
    op.drop_column("routes", "corridor")
    op.drop_column("routes", "base_route_id")
    op.drop_column("routes", "brn_serial")
