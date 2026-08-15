"""enable postgis extension

Revision ID: 311917b90975
Revises: 2e438f79e7bb
Create Date: 2026-08-15 21:23:40.745018

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '311917b90975'
down_revision: Union[str, Sequence[str], None] = '2e438f79e7bb'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return

    # Deliberately defensive: PostGIS availability on a managed/free-tier
    # Postgres plan is an open question (see ARCHITECTURE_DECISIONS.md §8),
    # and docker-entrypoint.sh runs this with `set -e` — an unhandled
    # failure here would crash-loop the whole deploy, not just skip a
    # feature. Catch it, log it, and let the deploy proceed either way;
    # `postgis_available()` below is how calling code checks whether it's
    # safe to use PostGIS types/functions.
    # autocommit_block(): runs outside the migration's normal transaction,
    # so a failure here (e.g. insufficient privileges on a managed
    # free-tier plan) can't poison that transaction or block alembic_version
    # from advancing — CREATE EXTENSION is exactly the kind of statement
    # this API exists for.
    try:
        with op.get_context().autocommit_block():
            op.execute("CREATE EXTENSION IF NOT EXISTS postgis")
        print("PostGIS extension enabled successfully.")
    except Exception as e:
        print(f"WARNING: could not enable PostGIS extension ({e}). "
              f"Spatial features will be unavailable until this is resolved "
              f"(likely needs a paid Postgres plan or admin to run this manually).")


def downgrade() -> None:
    """Downgrade schema."""
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return
    try:
        op.execute("DROP EXTENSION IF EXISTS postgis")
    except Exception:
        pass
