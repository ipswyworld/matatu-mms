#!/bin/bash
# Runs once, only against an empty data directory (docker-entrypoint-initdb.d
# semantics) — creates the replication role postgres-replica authenticates
# as, and opens pg_hba.conf to the docker-compose internal network for it.
set -euo pipefail

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    DO \$\$
    BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'replicator') THEN
        CREATE ROLE replicator WITH REPLICATION LOGIN PASSWORD '${POSTGRES_REPLICATION_PASSWORD}';
      END IF;
    END
    \$\$;
EOSQL

# The internal docker-compose network (see docker-compose.yml's `networks:
# internal`, a default bridge network) — scoped to that subnet, not 0.0.0.0/0,
# so this doesn't open replication to anything outside the compose stack.
echo "host replication replicator 172.16.0.0/12 scram-sha-256" >> "$PGDATA/pg_hba.conf"
echo "host all all 172.16.0.0/12 scram-sha-256" >> "$PGDATA/pg_hba.conf"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -c "SELECT pg_reload_conf();"
