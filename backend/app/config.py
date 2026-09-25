import logging
import os
import secrets
from dotenv import load_dotenv

# Load .env file if it exists
load_dotenv()

logger = logging.getLogger("app.config")

# Secrets resolve through app/secrets_provider.py: environment first,
# then Infisical when configured, then the default. A no-op passthrough
# to os.getenv unless INFISICAL_TOKEN is set (Readiness List §4).
from app import secrets_provider

DATABASE_URL = secrets_provider.get("DATABASE_URL", "sqlite+aiosqlite:///./mms.db")
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

# Optional read-replica connection (DATA_LAYER_SCALING_STATUS.md's
# read-replica plan) — unset by default, so every deployment without one
# configured (which is every deployment today except the self-hosted
# docker-compose stack's postgres-replica service) behaves exactly as
# before. Same driver-suffix normalization as the primary URL above.
DATABASE_URL_READONLY = secrets_provider.get("DATABASE_URL_READONLY", "")
if DATABASE_URL_READONLY.startswith("postgresql://"):
    DATABASE_URL_READONLY = DATABASE_URL_READONLY.replace("postgresql://", "postgresql+asyncpg://", 1)
elif DATABASE_URL_READONLY.startswith("postgres://"):
    DATABASE_URL_READONLY = DATABASE_URL_READONLY.replace("postgres://", "postgresql+asyncpg://", 1)

REDIS_URL = secrets_provider.get("REDIS_URL", "redis://127.0.0.1:6379/0")

# Recorded before the auto-generated fallbacks below overwrite these — the
# /system console needs to know whether a secret was actually configured
# without ever seeing the secret's value itself.
SECRET_KEY_IS_CONFIGURED = bool(secrets_provider.get("SECRET_KEY"))
NAIROBIPAY_CALLBACK_SECRET_IS_CONFIGURED = bool(secrets_provider.get("NAIROBIPAY_CALLBACK_SECRET"))
SENTRY_DSN = secrets_provider.get("SENTRY_DSN")

SECRET_KEY = secrets_provider.get("SECRET_KEY")
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
NAIROBIPAY_CALLBACK_SECRET = secrets_provider.get("NAIROBIPAY_CALLBACK_SECRET")
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
AFRICASTALKING_USERNAME = secrets_provider.get("AFRICASTALKING_USERNAME")
AFRICASTALKING_API_KEY = secrets_provider.get("AFRICASTALKING_API_KEY")
SMS_SENDER_ID = os.getenv("SMS_SENDER_ID")  # optional registered short code / sender name

# Object storage for uploaded files (verification documents, scene/crime
# photos) — see app/storage.py. Unset by default: local disk under ./uploads
# is fine for dev, but is NOT persistent on most hosting platforms (Render's
# free/starter web services have no disk survives a redeploy or restart).
# Set all four to switch to S3-compatible storage (AWS S3, Cloudflare R2,
# Backblaze B2, MinIO...) before a deployment that needs uploads to survive
# redeploys. S3_ENDPOINT_URL stays unset for real AWS S3; set it for any
# S3-compatible alternative (e.g. R2's account-specific endpoint).
S3_BUCKET = secrets_provider.get("S3_BUCKET")
S3_ENDPOINT_URL = secrets_provider.get("S3_ENDPOINT_URL")
S3_REGION = os.getenv("S3_REGION", "auto")
S3_ACCESS_KEY_ID = secrets_provider.get("S3_ACCESS_KEY_ID")
S3_SECRET_ACCESS_KEY = secrets_provider.get("S3_SECRET_ACCESS_KEY")
# The base URL files are served back from — a public-read bucket's own
# endpoint, or a CDN/custom domain in front of it. Uploaded files here have
# never been access-controlled (the local-disk path is a plain unauthenticated
# StaticFiles mount today), so a public-read bucket matches existing behavior
# rather than narrowing it.
S3_PUBLIC_URL_BASE = os.getenv("S3_PUBLIC_URL_BASE")

# Automated database backup (app/backup.py). Ships row data as a gzipped
# JSON asset on a GitHub Release rather than requiring a new object-storage
# account with billing (S3 above is unconfigured for this deployment for
# exactly that reason — no account with billing set up yet). GitHub is
# infrastructure this project already has and pays nothing extra for.
# Unset means backups are skipped with a loud warning, not silently
# no-op'd — see app/backup.py's own module docstring.
GITHUB_BACKUP_TOKEN = secrets_provider.get("GITHUB_BACKUP_TOKEN")
# owner/repo, e.g. "ipswyworld/matatu-mms" — deliberately not defaulted to
# this project's own repo: a hardcoded default here would silently start
# writing releases to a specific GitHub account/repo the moment someone
# else deploys this codebase and configures only the token.
GITHUB_BACKUP_REPO = os.getenv("GITHUB_BACKUP_REPO")
BACKUP_RETENTION_DAYS = int(os.getenv("BACKUP_RETENTION_DAYS", "30"))

# Render API (app/render_control.py) — deploy trigger/rollback from the ops
# console. Deliberately a separate key from matatu-mms-ops's own
# RENDER_API_KEY (which only ever reads Render's API for the service health
# matrix): this one lives on the backend service specifically because the
# write path needs require_reauth + stage_audit_log, which only exist here.
# Unset means the control-plane endpoints return a clear 503 rather than a
# confusing failure deep inside an httpx call.
RENDER_API_KEY = secrets_provider.get("RENDER_API_KEY")

# Synthetic uptime checks (app/synthetic_checks.py) — each frontend's own
# /api/health, hit from this backend on a schedule. Unset targets are
# skipped individually rather than failing the whole check run: a fresh
# deployment that hasn't set the public app's URL yet still gets checks for
# whichever apps it has configured.
STAFF_APP_URL = os.getenv("STAFF_APP_URL")
PUBLIC_APP_URL = os.getenv("PUBLIC_APP_URL")
OPS_APP_URL = os.getenv("OPS_APP_URL")

# Cloudflare Turnstile — bot protection on login/register/password-reset
# (Security Checklist #12). Unset by default: local dev and any deploy
# that hasn't created a Turnstile site yet keeps working exactly as
# before, with the check skipped entirely (see app/turnstile.py) rather
# than failing closed on a missing credential.
TURNSTILE_SECRET_KEY = os.getenv("TURNSTILE_SECRET_KEY")

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

# Server-side TomTom key for the Traffic Incident Details API (app/traffic.py)
# — deliberately separate from NEXT_PUBLIC_TOMTOM_API_KEY, which is baked
# into the frontend bundle for map tiles and is not a secret once shipped.
# This one is never sent to a browser, so it can carry a real request quota
# without that quota being exposed to anyone who opens devtools. Unset is a
# supported, graceful state (same as NAIROBIPAY/AFRICASTALKING above) — the
# crowdsourced half of the Live Updates feed keeps working on its own.
TOMTOM_API_KEY = secrets_provider.get("TOMTOM_API_KEY")
