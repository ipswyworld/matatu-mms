"""
Automated database backup — the recurring job db-backups/backup_db.py never
was. That script was a one-off: written and run once, by hand, ahead of the
2026-09-12 account migration, sitting on disk since as a manual reference,
not a schedule. BACKUP_RECOVERY_POLICY.md was blunt about the result: "this
system has no automated backup at all — RPO is whatever the last manual
export happened to be." app/worker.py's cron schedule (WorkerSettings.
cron_jobs) is what actually turns this into a recurring job.

Same dump strategy as the one-off script and for the same reason: schema is
fully reproducible from the Alembic migration chain already in git, so only
row data needs backing up, as JSON rather than a pg_dump-equivalent (no
pg_dump binary in this project's slim Docker image, and JSON is trivially
restorable with plain asyncpg/aiosqlite, no external tool required — see
db-backups/restore_db.py's approach, which this mirrors).

Storage target: a GitHub Release asset on this repo, not S3. S3 is wired
(app/storage.py) but unconfigured for this deployment specifically because
no object-storage account with billing exists yet (app/storage.py's own
docstring). GitHub is infrastructure this project already pays nothing
extra for and already trusts with production secrets access (Actions,
GITHUB_TOKEN) — a new signup is not a fair price for something as basic as
"back up the database." Retention is enforced by deleting old releases,
bounding storage growth (GitHub imposes no hard quota on release assets,
but nothing here should rely on that going unmanaged forever).

Failure mode: if GITHUB_BACKUP_TOKEN/GITHUB_BACKUP_REPO aren't set, or the
current database isn't Postgres (dev SQLite has nothing worth a recurring
remote backup), the job logs a clear warning and returns — it does not
raise. A cron job that crashes the worker loop over a config gap is worse
than one that just says why it skipped.
"""
import datetime
import gzip
import json
import logging
from typing import Any, Dict, List, Optional

import httpx
from sqlalchemy import text

from app.config import GITHUB_BACKUP_TOKEN, GITHUB_BACKUP_REPO, BACKUP_RETENTION_DAYS
from app.database import engine, IS_SQLITE

logger = logging.getLogger("app.backup")

GITHUB_API = "https://api.github.com"
# Distinguishes this job's releases from any real release of the app itself
# in the same repo's release list — both the tag prefix and marked
# `prerelease` so they never show as a normal release to anyone browsing
# GitHub's UI looking for an app version to install.
TAG_PREFIX = "db-backup-"


def _json_default(value: Any) -> Any:
    """Mirrors db-backups/backup_db.py's `default()` — the same set of
    Postgres row types (Decimal, UUID, datetime, bytes) that plain
    `json.dumps` can't handle on its own."""
    import decimal
    import uuid

    if isinstance(value, (datetime.datetime, datetime.date, datetime.time)):
        return value.isoformat()
    if isinstance(value, decimal.Decimal):
        return str(value)
    if isinstance(value, uuid.UUID):
        return str(value)
    if isinstance(value, (bytes, bytearray, memoryview)):
        return bytes(value).hex()
    raise TypeError(f"Not serializable: {type(value)}")


async def _table_names() -> List[str]:
    async with engine.connect() as conn:
        if IS_SQLITE:
            result = await conn.execute(
                text("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
            )
        else:
            result = await conn.execute(
                text("SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename")
            )
        return [row[0] for row in result.fetchall()]


async def dump_database() -> bytes:
    """Dumps every table's rows to gzipped JSON. Real, live rows read
    through the same async engine the app itself uses — not a second
    connection pool, not a shelled-out pg_dump."""
    table_names = await _table_names()
    tables: Dict[str, List[dict]] = {}

    async with engine.connect() as conn:
        for name in table_names:
            result = await conn.execute(text(f'SELECT * FROM "{name}"'))
            tables[name] = [dict(row._mapping) for row in result.fetchall()]

    manifest = {
        "backed_up_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "row_counts": {name: len(rows) for name, rows in tables.items()},
        "tables": tables,
    }
    payload = json.dumps(manifest, default=_json_default).encode("utf-8")
    return gzip.compress(payload)


async def _github_request(method: str, path: str, **kwargs) -> httpx.Response:
    headers = {
        "Authorization": f"Bearer {GITHUB_BACKUP_TOKEN}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    headers.update(kwargs.pop("headers", {}))
    async with httpx.AsyncClient(timeout=60.0) as client:
        return await client.request(method, f"{GITHUB_API}{path}", headers=headers, **kwargs)


async def upload_backup(data: bytes, tag: str) -> str:
    """Creates a GitHub Release tagged `tag` and attaches `data` as a gzip
    asset. Returns the release's HTML URL. Raises on any non-2xx — the
    caller (run_scheduled_backup) is what decides this is a log-and-skip,
    not this function silently swallowing a failed backup."""
    create_resp = await _github_request(
        "POST",
        f"/repos/{GITHUB_BACKUP_REPO}/releases",
        json={
            "tag_name": tag,
            "name": f"Database backup {tag.removeprefix(TAG_PREFIX)}",
            "body": "Automated nightly database backup (app/backup.py). Not an application release.",
            "prerelease": True,
            "draft": False,
        },
    )
    create_resp.raise_for_status()
    release = create_resp.json()

    # The asset-upload endpoint is a *different* host (uploads.github.com),
    # templated in the release response rather than a fixed path — GitHub's
    # API is documented this way specifically so callers don't hardcode it.
    upload_url = release["upload_url"].split("{")[0]
    async with httpx.AsyncClient(timeout=120.0) as client:
        asset_resp = await client.post(
            upload_url,
            params={"name": f"{tag}.json.gz"},
            headers={
                "Authorization": f"Bearer {GITHUB_BACKUP_TOKEN}",
                "Content-Type": "application/gzip",
            },
            content=data,
        )
    asset_resp.raise_for_status()
    return release["html_url"]


async def download_latest_backup() -> Optional[Dict[str, Any]]:
    """Fetches and decompresses the most recent backup release's asset —
    the read side of upload_backup(), needed for app/restore_verify.py's
    restore-test cron. Returns None (not an error) when no backup release
    exists yet, matching this module's established "unconfigured/absent is
    a normal state" convention."""
    if not GITHUB_BACKUP_TOKEN or not GITHUB_BACKUP_REPO:
        return None

    resp = await _github_request(
        "GET", f"/repos/{GITHUB_BACKUP_REPO}/releases", params={"per_page": 50}
    )
    resp.raise_for_status()
    releases = [r for r in resp.json() if r["tag_name"].startswith(TAG_PREFIX)]
    if not releases:
        return None
    # GitHub returns releases newest-first already, but sort explicitly —
    # nothing here should rely on an undocumented ordering guarantee.
    releases.sort(key=lambda r: r["created_at"], reverse=True)
    latest = releases[0]

    asset = next((a for a in latest.get("assets", []) if a["name"].endswith(".json.gz")), None)
    if asset is None:
        return None

    async with httpx.AsyncClient(timeout=120.0, follow_redirects=True) as client:
        asset_resp = await client.get(
            asset["url"],
            headers={
                "Authorization": f"Bearer {GITHUB_BACKUP_TOKEN}",
                "Accept": "application/octet-stream",
            },
        )
    asset_resp.raise_for_status()

    manifest = json.loads(gzip.decompress(asset_resp.content))
    manifest["_tag"] = latest["tag_name"]
    return manifest


async def enforce_retention(retention_days: int = BACKUP_RETENTION_DAYS) -> int:
    """Deletes backup releases (and their tags) older than retention_days.
    Returns how many were deleted. Only ever touches releases whose tag
    starts with TAG_PREFIX — never anything that could be a real app
    release, regardless of how retention_days is configured."""
    cutoff = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=retention_days)
    deleted = 0
    page = 1
    while True:
        resp = await _github_request(
            "GET", f"/repos/{GITHUB_BACKUP_REPO}/releases", params={"per_page": 100, "page": page}
        )
        resp.raise_for_status()
        releases = resp.json()
        if not releases:
            break
        for release in releases:
            if not release["tag_name"].startswith(TAG_PREFIX):
                continue
            created_at = datetime.datetime.fromisoformat(release["created_at"].replace("Z", "+00:00"))
            if created_at >= cutoff:
                continue
            del_resp = await _github_request("DELETE", f"/repos/{GITHUB_BACKUP_REPO}/releases/{release['id']}")
            del_resp.raise_for_status()
            # The release and the underlying git tag are two separate
            # objects in GitHub's model — deleting the release alone leaves
            # an orphaned tag ref cluttering the repo's tag list forever.
            tag_del_resp = await _github_request(
                "DELETE", f"/repos/{GITHUB_BACKUP_REPO}/git/refs/tags/{release['tag_name']}"
            )
            if tag_del_resp.status_code not in (204, 404):
                logger.warning("Backup release %s deleted, but tag ref cleanup returned %s", release["tag_name"], tag_del_resp.status_code)
            deleted += 1
        page += 1
    return deleted


async def run_scheduled_backup(ctx) -> str:
    """The actual ARQ cron job (app/worker.py's WorkerSettings.cron_jobs).
    `ctx` is arq's job context, unused here — every other job function in
    app/worker.py takes it too, for signature consistency with arq's
    calling convention, not because this job needs it."""
    if IS_SQLITE:
        logger.info("Skipping scheduled backup: dev SQLite has nothing worth a recurring remote backup.")
        return "skipped: sqlite"
    if not GITHUB_BACKUP_TOKEN or not GITHUB_BACKUP_REPO:
        logger.warning(
            "Scheduled backup skipped: GITHUB_BACKUP_TOKEN/GITHUB_BACKUP_REPO not configured. "
            "The database has NO automated backup while this is unset."
        )
        return "skipped: not configured"

    tag = f"{TAG_PREFIX}{datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H%M%SZ')}"
    try:
        data = await dump_database()
        url = await upload_backup(data, tag)
        deleted = await enforce_retention()
        logger.info("Backup %s uploaded (%d bytes gzipped) -> %s; pruned %d expired backup(s).", tag, len(data), url, deleted)
        return url
    except Exception:
        # A failed backup must be loud in the logs, but must not crash the
        # worker loop that also runs webhook delivery (app/worker.py) —
        # tomorrow's scheduled attempt is the real retry, not a raised
        # exception that kills every other job this process runs.
        logger.exception("Scheduled backup failed for tag %s", tag)
        return f"failed: {tag}"
