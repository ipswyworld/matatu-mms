from slowapi import Limiter

from app.client_ip import rate_limit_key
from app.config import REDIS_URL
from app.database import IS_SQLITE

# Redis-backed in production/Postgres mode, so limits are shared correctly
# across replicas — an in-memory limiter would let each replica give every
# client its own separate quota, which isn't a rate limit at all once
# there's more than one instance (see docker-compose.yml / render.yaml).
# In-memory for the SQLite dev/test fallback, matching the same IS_SQLITE
# convention app/database.py already uses (no Redis needed for a throwaway
# local run or the boot-smoke test suite).
#
# key_func is app/client_ip.py rather than slowapi's get_remote_address,
# which returns request.client.host. Uvicorn populates that from the LAST
# entry of X-Forwarded-For, and behind Cloudflare -> Render that is an
# internal proxy address shared by every user routed through it — so the
# whole user base ended up in one rate-limit bucket and the login limiter
# tripped constantly with no real volume behind it.
#
# Confirmed on the live system, not assumed: login_events showed sign-ins
# recorded from a mix of real client addresses and RFC1918 ones
# (10.26.131.47, 10.31.99.14). See client_ip.py for the resolution order.
limiter = Limiter(
    key_func=rate_limit_key,
    storage_uri="memory://" if IS_SQLITE else REDIS_URL,
)
