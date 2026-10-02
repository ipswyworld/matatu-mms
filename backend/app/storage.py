"""Upload storage abstraction — local disk (dev default), S3-compatible
object storage, or DB-backed (file bytes stored as a Postgres row).

Every upload route (saccos.py, crimes.py, enforcement_cases.py, reports.py)
used to duplicate this: build a per-record directory, write the file, and
construct the "/uploads/..." path stored in the DB. Centralizing it here
means the storage backend is a config change, not a per-route rewrite — and
it's the actual fix for uploaded files vanishing on every Render redeploy
(local disk under ./uploads resets to empty on every deploy/restart there,
since no persistent Disk is attached to the backend service).

Three backends, picked via STORAGE_BACKEND (app/config.py):
  - "local" (default when nothing else is configured) — dev and the
    self-hosted docker-compose stack, which already mounts a real
    persistent volume over ./uploads.
  - "s3" (auto-selected once S3_BUCKET + S3_PUBLIC_URL_BASE are set) —
    real object storage, once there's an account with billing set up
    somewhere (R2, B2, Supabase Storage...).
  - "db" (explicit opt-in, e.g. render.yaml sets STORAGE_BACKEND=db) —
    file bytes stored as a row in the UploadedFile table, riding on the
    same Postgres this app already pays nothing for. No new account, no
    payment method, works today — the practical default for a free-tier
    Render deploy before anyone's ready to add billing to an object
    storage provider.
"""

import asyncio
import logging
import mimetypes
import os
import uuid
import datetime

from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import (
    STORAGE_BACKEND, S3_BUCKET, S3_ENDPOINT_URL, S3_REGION,
    S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_PUBLIC_URL_BASE,
)

logger = logging.getLogger("app.storage")

LOCAL_UPLOAD_ROOT = os.path.join(os.getcwd(), "uploads")

_s3_configured = bool(S3_BUCKET and S3_PUBLIC_URL_BASE)
if S3_BUCKET and not S3_PUBLIC_URL_BASE:
    logger.warning(
        "S3_BUCKET is set but S3_PUBLIC_URL_BASE is not — S3 storage stays "
        "disabled until both are set."
    )

if STORAGE_BACKEND == "db":
    BACKEND = "db"
elif STORAGE_BACKEND == "s3" or (not STORAGE_BACKEND and _s3_configured):
    BACKEND = "s3"
else:
    BACKEND = "local"

# Covers every current caller: scene/crime photos (jpg/png/webp) and Sacco
# compliance documents (pdf) — saccos.py is the one route that isn't
# strictly images, so an images-only list would reject a real registration
# certificate upload.
MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024  # 10MB
ALLOWED_UPLOAD_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".pdf"}
ALLOWED_UPLOAD_CONTENT_TYPES = {
    "image/jpeg", "image/png", "image/webp", "application/pdf",
}

_s3_client = None


def _get_s3_client():
    global _s3_client
    if _s3_client is None:
        import boto3
        _s3_client = boto3.client(
            "s3",
            endpoint_url=S3_ENDPOINT_URL or None,
            region_name=S3_REGION,
            aws_access_key_id=S3_ACCESS_KEY_ID,
            aws_secret_access_key=S3_SECRET_ACCESS_KEY,
        )
    return _s3_client


def _put_object_sync(key: str, contents: bytes) -> None:
    _get_s3_client().put_object(Bucket=S3_BUCKET, Key=key, Body=contents)


async def save_upload(
    category: str,
    entity_id: str,
    original_filename: str,
    contents: bytes,
    db: AsyncSession = None,
    prefix: str = "",
) -> str:
    """Stores `contents` under `{category}/{entity_id}/{prefix}{uuid8}_{safe_name}`
    and returns the URL to persist on the model. `db` is required for the
    "db" backend (every call site already has a session in scope from its
    own request) — ignored otherwise. `prefix` is used as-is (e.g.
    "registrationCert_") for routes that need a recognizable filename per
    document type.
    """
    if len(contents) > MAX_UPLOAD_SIZE_BYTES:
        raise HTTPException(
            status_code=400,
            detail=f"File is too large — the limit is {MAX_UPLOAD_SIZE_BYTES // (1024 * 1024)}MB.",
        )

    safe_name = os.path.basename(original_filename or "file")
    ext = os.path.splitext(safe_name)[1].lower()
    guessed_type = mimetypes.guess_type(safe_name)[0] or "application/octet-stream"
    if ext not in ALLOWED_UPLOAD_EXTENSIONS or guessed_type not in ALLOWED_UPLOAD_CONTENT_TYPES:
        raise HTTPException(
            status_code=400,
            detail="Unsupported file type. Only JPG, PNG, WEBP, and PDF are accepted.",
        )

    stored_name = f"{prefix}{uuid.uuid4().hex[:8]}_{safe_name}"
    key = f"{category}/{entity_id}/{stored_name}"

    if BACKEND == "db":
        if db is None:
            raise RuntimeError("save_upload(): STORAGE_BACKEND=db requires a db session")
        from app.models import UploadedFile
        content_type = mimetypes.guess_type(safe_name)[0] or "application/octet-stream"
        db.add(UploadedFile(
            key=key,
            content_type=content_type,
            data=contents,
            created_at=datetime.datetime.now(datetime.timezone.utc),
        ))
        # Not committed here — the caller's own await db.commit() (after it
        # sets the model field pointing at this URL) persists both together,
        # so a failure between the two can't leave an orphaned file row.
        return f"/api/uploads/{key}"

    if BACKEND == "s3":
        await asyncio.to_thread(_put_object_sync, key, contents)
        return f"{S3_PUBLIC_URL_BASE.rstrip('/')}/{key}"

    dest_dir = os.path.join(LOCAL_UPLOAD_ROOT, category, entity_id)
    os.makedirs(dest_dir, exist_ok=True)
    dest_path = os.path.join(dest_dir, stored_name)
    with open(dest_path, "wb") as f:
        f.write(contents)
    return f"/uploads/{key}"
