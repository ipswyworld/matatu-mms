#!/bin/bash
# Real Postgres streaming replication, not a mock: on first start (empty
# PGDATA), pg_basebackup clones the primary and drops a standby.signal so
# Postgres starts in standby/hot_standby mode; on every later restart it
# just starts normally against the already-cloned, continuously-streamed
# data directory.
set -euo pipefail

PGDATA="/var/lib/postgresql/data"

until pg_isready -h "$PRIMARY_HOST" -p "$PRIMARY_PORT" -U "$PRIMARY_USER" >/dev/null 2>&1; do
  echo "replica: waiting for primary ($PRIMARY_HOST:$PRIMARY_PORT) to be ready..."
  sleep 2
done

if [ -z "$(ls -A "$PGDATA" 2>/dev/null)" ]; then
  echo "replica: empty data directory — cloning primary via pg_basebackup"
  export PGPASSWORD="$REPLICATOR_PASSWORD"
  pg_basebackup \
    --host="$PRIMARY_HOST" --port="$PRIMARY_PORT" --username="$PRIMARY_USER" \
    --pgdata="$PGDATA" --wal-method=stream --write-recovery-conf \
    --checkpoint=fast --progress
  chmod 700 "$PGDATA"
  echo "replica: base backup complete, starting in standby mode"
else
  echo "replica: existing data directory found, resuming as standby"
fi

exec docker-entrypoint.sh postgres
