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

# --proxy-headers makes uvicorn trust X-Forwarded-For/-Proto from the peer
# connecting to it — on Render that peer is always Render's own edge proxy,
# never the public internet directly, so trusting it here is safe.
# --forwarded-allow-ips='*' is what actually makes that trust apply (the
# uvicorn default only trusts 127.0.0.1, which never matches Render's
# proxy). Without both flags, every request's client IP resolves to
# Render's internal proxy address instead of the real visitor — which
# means app/rate_limit.py's per-IP limiter (used on /api/auth/login etc.)
# was silently rate-limiting the entire user base as if it were one
# person, not each visitor individually. This was a real production bug,
# not a tuning choice.
exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --proxy-headers --forwarded-allow-ips='*'
