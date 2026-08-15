#!/usr/bin/env bash
# Health-gated canary weight shift for the stateless API tier
# (ARCHITECTURE_DECISIONS.md §13.4). Requires docker-compose.canary.yml to
# already be running:
#
#   docker compose -f docker-compose.yml -f docker-compose.canary.yml up -d
#
# Usage:
#   scripts/canary-promote.sh <green-weight-percent>
#
# Examples:
#   scripts/canary-promote.sh 10   # 90% blue / 10% green — first canary step
#   scripts/canary-promote.sh 50   # even split
#   scripts/canary-promote.sh 100  # full cutover — green is now live, blue idle
#   scripts/canary-promote.sh 0    # rollback — instant traffic switch back to blue
#
# Health-gates on backend_green's own /healthz before shifting any traffic
# to it (per §13.3 — "do not shift traffic on container started alone").
# Does NOT gate on error-rate/latency metrics from Prometheus — the doc
# calls for that ("gate canary promotion on metrics, not on time"), which
# needs a live Prometheus instance with real traffic to query; this script
# is the mechanical weight-shift + basic health gate underneath that,
# meant to be called by a human (or a metrics-driven CI job) between steps.
set -euo pipefail

GREEN_PERCENT="${1:?Usage: canary-promote.sh <green-weight-percent 0-100>}"
NGINX_CONF="nginx/nginx.canary.conf"
COMPOSE="docker compose -f docker-compose.yml -f docker-compose.canary.yml"

if ! [[ "$GREEN_PERCENT" =~ ^[0-9]+$ ]] || [ "$GREEN_PERCENT" -lt 0 ] || [ "$GREEN_PERCENT" -gt 100 ]; then
  echo "Error: weight must be an integer 0-100." >&2
  exit 1
fi

BLUE_PERCENT=$((100 - GREEN_PERCENT))

if [ "$GREEN_PERCENT" -gt 0 ]; then
  echo "Health-checking backend_green before shifting any traffic to it..."
  if ! $COMPOSE exec -T backend_green python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/healthz')" 2>/dev/null; then
    echo "Error: backend_green failed its own /healthz check — refusing to shift traffic. Fix the deploy first." >&2
    exit 1
  fi
  echo "backend_green is healthy."
fi

echo "Shifting weights: blue=${BLUE_PERCENT}% green=${GREEN_PERCENT}%"
sed -i.bak \
  -e "s/server backend:8000 weight=[0-9]*;/server backend:8000 weight=${BLUE_PERCENT};/" \
  -e "s/server backend_green:8000 weight=[0-9]*;/server backend_green:8000 weight=${GREEN_PERCENT};/" \
  "$NGINX_CONF"
rm -f "${NGINX_CONF}.bak"

echo "Reloading nginx (zero-downtime — existing connections, including WebSockets, are unaffected)..."
$COMPOSE exec -T nginx nginx -s reload

echo "Done. blue=${BLUE_PERCENT}% green=${GREEN_PERCENT}%. Watch error rate / p99 latency before the next step."
if [ "$GREEN_PERCENT" -eq 100 ]; then
  echo "Full cutover complete. Once confident, retire the old 'backend' (blue) container and roll it forward to be the new baseline for the next release."
fi
