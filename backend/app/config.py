import logging
import os
import secrets
from dotenv import load_dotenv

# Load .env file if it exists
load_dotenv()

logger = logging.getLogger("app.config")

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite+aiosqlite:///./mms.db")
REDIS_URL = os.getenv("REDIS_URL", "redis://127.0.0.1:6379/0")

SECRET_KEY = os.getenv("SECRET_KEY")
if not SECRET_KEY:
    # No hardcoded fallback — a fixed default secret checked into source is
    # itself the vulnerability (anyone reading the repo can forge valid
    # JWTs). Generate a random one for this process instead: dev/local runs
    # work with zero setup, but every restart invalidates existing tokens,
    # which is exactly the pressure that should push a real deployment to
    # set SECRET_KEY explicitly.
    SECRET_KEY = secrets.token_hex(32)
    logger.warning(
        "SECRET_KEY not set — generated a random one for this process. "
        "Tokens will stop validating on restart. Set SECRET_KEY in the "
        "environment before deploying."
    )
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "60"))
SESSION_COOKIE_NAME = os.getenv("SESSION_COOKIE_NAME", "mms_session")

# Simulates webhook configuration
WEBHOOK_MAX_RETRIES = int(os.getenv("WEBHOOK_MAX_RETRIES", "5"))
WEBHOOK_TIMEOUT = float(os.getenv("WEBHOOK_TIMEOUT", "5.0"))

# Bump this whenever /terms content materially changes, so consent records
# stay tied to the version of the Terms a user actually agreed to.
TERMS_VERSION = os.getenv("TERMS_VERSION", "2026-07-25")

# Safaricom Daraja doesn't sign C2B callback payloads, so the standard
# protection is a secret, unguessable path segment known only to your Daraja
# app config — anyone who doesn't know this token gets a 404, not a fine
# marked paid. Same random-per-process fallback pattern as SECRET_KEY: works
# with zero setup locally, forces a real value before deployment.
MPESA_CALLBACK_SECRET = os.getenv("MPESA_CALLBACK_SECRET")
if not MPESA_CALLBACK_SECRET:
    MPESA_CALLBACK_SECRET = secrets.token_urlsafe(24)
    logger.warning(
        "MPESA_CALLBACK_SECRET not set — generated a random one for this "
        "process: %s . Configure this exact value as your Daraja callback "
        "URL's secret segment, and set it explicitly before deploying.",
        MPESA_CALLBACK_SECRET,
    )
