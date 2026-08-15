from slowapi import Limiter
from slowapi.util import get_remote_address

from app.config import REDIS_URL
from app.database import IS_SQLITE

# Redis-backed in production/Postgres mode, so limits are shared correctly
# across replicas — an in-memory limiter would let each replica give every
# client its own separate quota, which isn't a rate limit at all once
# there's more than one instance (see docker-compose.yml / render.yaml).
# In-memory for the SQLite dev/test fallback, matching the same IS_SQLITE
# convention app/database.py already uses (no Redis needed for a throwaway
# local run or the boot-smoke test suite).
limiter = Limiter(
    key_func=get_remote_address,
    storage_uri="memory://" if IS_SQLITE else REDIS_URL,
)
