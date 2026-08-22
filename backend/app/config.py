import logging
import os
import secrets
from dotenv import load_dotenv

# Load .env file if it exists
load_dotenv()

logger = logging.getLogger("app.config")

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite+aiosqlite:///./mms.db")
# Hosted Postgres providers (Render, Heroku, Railway, Neon...) hand out a
# bare "postgresql://" or "postgres://" connection string. SQLAlchemy's
# create_async_engine needs an explicit async driver suffix — without it,
# it silently picks the sync psycopg2 driver, which isn't installed here
# (only asyncpg is), and fails at engine-creation time with a confusing
# ModuleNotFoundError. Normalize once, here, rather than requiring every
# deploy target to know to hand-edit its connection string.
if DATABASE_URL.startswith("postgresql://"):
    DATABASE_URL = DATABASE_URL.replace("postgresql://", "postgresql+asyncpg://", 1)
elif DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql+asyncpg://", 1)
REDIS_URL = os.getenv("REDIS_URL", "redis://127.0.0.1:6379/0")

# Recorded before the auto-generated fallbacks below overwrite these — the
# /system console needs to know whether a secret was actually configured
# without ever seeing the secret's value itself.
SECRET_KEY_IS_CONFIGURED = bool(os.getenv("SECRET_KEY"))
NAIROBIPAY_CALLBACK_SECRET_IS_CONFIGURED = bool(os.getenv("NAIROBIPAY_CALLBACK_SECRET"))
SENTRY_DSN = os.getenv("SENTRY_DSN")

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
# "Remember me" — a login opting in gets a token/cookie that lasts this long
# instead of ACCESS_TOKEN_EXPIRE_MINUTES. Deliberately a separate, much
# longer-lived grant rather than just raising the default expiry for
# everyone, since most logins are on shared/staff devices where a long-lived
# token is the wrong default.
REMEMBER_ME_EXPIRE_DAYS = int(os.getenv("REMEMBER_ME_EXPIRE_DAYS", "30"))
SESSION_COOKIE_NAME = os.getenv("SESSION_COOKIE_NAME", "mms_session")

# Simulates webhook configuration
WEBHOOK_MAX_RETRIES = int(os.getenv("WEBHOOK_MAX_RETRIES", "5"))
WEBHOOK_TIMEOUT = float(os.getenv("WEBHOOK_TIMEOUT", "5.0"))

# Bump this whenever /terms content materially changes, so consent records
# stay tied to the version of the Terms a user actually agreed to.
TERMS_VERSION = os.getenv("TERMS_VERSION", "2026-07-25")

# NairobiPay doesn't sign its callback payloads, so the standard protection
# is a secret, unguessable path segment known only to this server and the
# NairobiPay gateway config — anyone who doesn't know this token gets a 404,
# not a fine marked paid. Same random-per-process fallback pattern as
# SECRET_KEY: works with zero setup locally, forces a real value before
# deployment (and before NairobiPay's real API is wired in).
NAIROBIPAY_CALLBACK_SECRET = os.getenv("NAIROBIPAY_CALLBACK_SECRET")
if not NAIROBIPAY_CALLBACK_SECRET:
    NAIROBIPAY_CALLBACK_SECRET = secrets.token_urlsafe(24)
    logger.warning(
        "NAIROBIPAY_CALLBACK_SECRET not set — generated a random one for "
        "this process: %s . Configure this exact value as your NairobiPay "
        "callback URL's secret segment, and set it explicitly before "
        "deploying.",
        NAIROBIPAY_CALLBACK_SECRET,
    )

# SMS (phone-based password reset OTP). No real provider is wired in yet —
# same "not available yet" situation as NairobiPay's real API — so
# app/sms.py falls back to logging the OTP server-side when these aren't
# set, exactly like the email reset link does today. Set both to switch a
# real deployment over to Africa's Talking (the standard Kenyan SMS
# gateway); the send_sms() call site is the only place that needs to change
# for a different provider.
AFRICASTALKING_USERNAME = os.getenv("AFRICASTALKING_USERNAME")
AFRICASTALKING_API_KEY = os.getenv("AFRICASTALKING_API_KEY")
SMS_SENDER_ID = os.getenv("SMS_SENDER_ID")  # optional registered short code / sender name

# Object storage for uploaded files (verification documents, scene/crime
# photos) — see app/storage.py. Unset by default: local disk under ./uploads
# is fine for dev, but is NOT persistent on most hosting platforms (Render's
# free/starter web services have no disk survives a redeploy or restart).
# Set all four to switch to S3-compatible storage (AWS S3, Cloudflare R2,
# Backblaze B2, MinIO...) before a deployment that needs uploads to survive
# redeploys. S3_ENDPOINT_URL stays unset for real AWS S3; set it for any
# S3-compatible alternative (e.g. R2's account-specific endpoint).
S3_BUCKET = os.getenv("S3_BUCKET")
S3_ENDPOINT_URL = os.getenv("S3_ENDPOINT_URL")
S3_REGION = os.getenv("S3_REGION", "auto")
S3_ACCESS_KEY_ID = os.getenv("S3_ACCESS_KEY_ID")
S3_SECRET_ACCESS_KEY = os.getenv("S3_SECRET_ACCESS_KEY")
# The base URL files are served back from — a public-read bucket's own
# endpoint, or a CDN/custom domain in front of it. Uploaded files here have
# never been access-controlled (the local-disk path is a plain unauthenticated
# StaticFiles mount today), so a public-read bucket matches existing behavior
# rather than narrowing it.
S3_PUBLIC_URL_BASE = os.getenv("S3_PUBLIC_URL_BASE")

# Explicit override for which backend app/storage.py uses — "local", "s3",
# or "db" (store file bytes as a row in Postgres, alongside everything
# else). Sensible default when unset: S3 if configured above, otherwise
# local. "db" needs no external account/payment method at all since it
# rides on the same Postgres this app already has — the practical choice
# for a free-tier Render deploy where nobody's added billing to an object
# storage provider yet. Not a forever architecture at real upload volume,
# but genuinely fine at this project's current scale.
STORAGE_BACKEND = os.getenv("STORAGE_BACKEND", "").strip().lower()

# The one place an outbound message needs an absolute, clickable URL rather
# than a relative path — the reset-password links above are only ever
# logged (no real provider configured), so a relative path was fine; the
# guardian approval SMS is written to actually be sent once Africa's
# Talking is configured, and a guardian tapping a link with no scheme opens
# nothing. Defaults to the local public-app dev port.
PUBLIC_FRONTEND_URL = os.getenv("PUBLIC_FRONTEND_URL", "http://localhost:3001")
