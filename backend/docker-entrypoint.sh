#!/bin/sh
set -e

# Only Postgres has real migration history to apply — the SQLite dev
# fallback still self-creates its schema on startup (see main.py).
case "$DATABASE_URL" in
  postgresql*)
    echo "Applying database migrations..."
    alembic upgrade head
    ;;
  *)
    echo "Non-Postgres DATABASE_URL — skipping Alembic, app will self-create the schema."
    ;;
esac

exec uvicorn app.main:app --host 0.0.0.0 --port 8000
