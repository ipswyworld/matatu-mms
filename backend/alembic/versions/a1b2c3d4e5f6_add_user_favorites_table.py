"""add user_favorites table

Revision ID: a1b2c3d4e5f6
Revises: 582303fcf921
Create Date: 2026-09-25

"""
import secrets
import datetime

from alembic import op
import sqlalchemy as sa

revision = 'a1b2c3d4e5f6'
down_revision = '582303fcf921'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'user_favorites',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('user_id', sa.String(), nullable=False),
        sa.Column('sacco_id', sa.String(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id']),
        sa.ForeignKeyConstraint(['sacco_id'], ['saccos.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_user_favorites_id', 'user_favorites', ['id'])
    op.create_index('ix_user_favorites_user_id', 'user_favorites', ['user_id'])
    op.create_index(
        'uq_user_favorites_user_sacco', 'user_favorites', ['user_id', 'sacco_id'], unique=True
    )

    # Backfill from the existing single-value users.favorite_sacco_id column.
    # That column is left in place (see models.py's UserFavorite docstring)
    # but the app stops writing to it as of this feature — this table is
    # the source of truth going forward. Done in Python via SQLAlchemy Core
    # (not a raw dialect-specific SQL string) so it works identically on
    # SQLite (local dev, IS_SQLITE in app/database.py) and Postgres (prod).
    bind = op.get_bind()
    users = sa.table("users", sa.column("id"), sa.column("favorite_sacco_id"))
    user_favorites = sa.table(
        "user_favorites",
        sa.column("id"), sa.column("user_id"), sa.column("sacco_id"), sa.column("created_at"),
    )
    now = datetime.datetime.now(datetime.timezone.utc)
    rows = bind.execute(
        sa.select(users.c.id, users.c.favorite_sacco_id).where(users.c.favorite_sacco_id.is_not(None))
    ).fetchall()
    for user_id, sacco_id in rows:
        bind.execute(
            user_favorites.insert().values(
                id=f"fav-{secrets.token_hex(4)}", user_id=user_id, sacco_id=sacco_id, created_at=now,
            )
        )


def downgrade():
    op.drop_index('uq_user_favorites_user_sacco', table_name='user_favorites')
    op.drop_index('ix_user_favorites_user_id', table_name='user_favorites')
    op.drop_index('ix_user_favorites_id', table_name='user_favorites')
    op.drop_table('user_favorites')
