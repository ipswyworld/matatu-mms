"""Upload storage abstraction — local disk (dev default) or S3-compatible
object storage (set S3_BUCKET + friends in app/config.py to switch).

Every upload route (saccos.py, crimes.py, enforcement_cases.py, reports.py)
used to duplicate this: build a per-record directory, write the file, and
construct the "/uploads/..." path stored in the DB. Centralizing it here
means the storage backend is a config change, not a per-route rewrite — and
it's the actual fix for uploaded files vanishing on every Render redeploy
(local disk under ./uploads resets to empty on every deploy/restart there,
since no persistent Disk is attached to the backend service).
"""

import asyncio
import logging
import os
import uuid

from app.config import S3_BUCKET, S3_ENDPOINT_URL, S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_PUBLIC_URL_BASE

logger = logging.getLogger("app.storage")

LOCAL_UPLOAD_ROOT = os.path.join(os.getcwd(), "uploads")

USING_S3 = bool(S3_BUCKET and S3_PUBLIC_URL_BASE)
if S3_BUCKET and not S3_PUBLIC_URL_BASE:
    logger.warning(
        "S3_BUCKET is set but S3_PUBLIC_URL_BASE is not — falling back to "
        "local disk storage. Uploaded files will NOT survive a redeploy "
        "until S3_PUBLIC_URL_BASE is also set."
    )

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


async def save_upload(category: str, entity_id: str, original_filename: str, contents: bytes, prefix: str = "") -> str:
    """Stores `contents` under `{category}/{entity_id}/{prefix}{uuid8}_{safe_name}`
    and returns the URL to persist on the model (a "/uploads/..." relative
    path in local mode, matching StaticFiles' mount in app/main.py; a full
    public URL in S3 mode). `prefix` is used as-is (e.g. "registration_cert_")
    for routes that need a recognizable filename per document type.
    """
    safe_name = os.path.basename(original_filename or "file")
    stored_name = f"{prefix}{uuid.uuid4().hex[:8]}_{safe_name}"
    key = f"{category}/{entity_id}/{stored_name}"

    if USING_S3:
        await asyncio.to_thread(_put_object_sync, key, contents)
        return f"{S3_PUBLIC_URL_BASE.rstrip('/')}/{key}"

    dest_dir = os.path.join(LOCAL_UPLOAD_ROOT, category, entity_id)
    os.makedirs(dest_dir, exist_ok=True)
    dest_path = os.path.join(dest_dir, stored_name)
    with open(dest_path, "wb") as f:
        f.write(contents)
    return f"/uploads/{key}"
