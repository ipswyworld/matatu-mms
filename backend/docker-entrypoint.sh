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
# APP_ROLE selects which process this container runs. Both roles share the
# same image and codebase (Ops Console Rebuild Spec §3.1 Path A) — the split
# is a deployment decision, not a separate service to build and version.
#
#   api            (default) the public API, workers and broadcasters
#   control-plane  ops console endpoints only, no public ingress
#
# The control plane exists so an operator can still act when the main API is
# saturated: its own process, own event loop, own DB connection pool.
case "${APP_ROLE:-api}" in
  control-plane)
    echo "Starting OPS CONTROL PLANE (app.control_plane:app)..."
    exec uvicorn app.control_plane:app --host 0.0.0.0 --port "${PORT:-8001}" --proxy-headers --forwarded-allow-ips='*'
    ;;
  *)
    exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}" --proxy-headers --forwarded-allow-ips='*'
    ;;
esac
