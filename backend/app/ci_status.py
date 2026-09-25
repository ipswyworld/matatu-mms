"""
Dependency/CVE scan status for the ops console (Ops Console Rebuild Spec's
Phase 4 item 6) — reads what CI already produces rather than running scans
itself. .github/workflows/ci.yml's "Dependency + container vulnerability
scan" job runs pip-audit, npm audit, and Trivy on every push, but sets
`continue-on-error: true` at the job level (so one flagged CVE doesn't block
every PR) — which means the *workflow run's* own conclusion is always
"success" regardless of what the scan found. The only place the real
signal survives is that job's own conclusion, fetched separately via the
Jobs API.

Reuses GITHUB_BACKUP_TOKEN/GITHUB_BACKUP_REPO (app/backup.py) rather than
adding a new secret — that token already has this repo's Actions access,
per that module's own docstring.
"""
import logging
from typing import Optional

import httpx

from app.config import GITHUB_BACKUP_TOKEN, GITHUB_BACKUP_REPO

logger = logging.getLogger("app.ci_status")

GITHUB_API = "https://api.github.com"
WORKFLOW_FILE = "ci.yml"
SCAN_JOB_NAME = "Dependency + container vulnerability scan"


class CiStatusNotConfigured(Exception):
    pass


async def get_latest_scan_status() -> Optional[dict]:
    """The most recent completed run's scan-job conclusion, or None if
    GITHUB_BACKUP_TOKEN/GITHUB_BACKUP_REPO aren't set."""
    if not GITHUB_BACKUP_TOKEN or not GITHUB_BACKUP_REPO:
        return None

    headers = {
        "Authorization": f"Bearer {GITHUB_BACKUP_TOKEN}",
        "Accept": "application/vnd.github+json",
    }

    async with httpx.AsyncClient(timeout=20.0) as client:
        runs_res = await client.get(
            f"{GITHUB_API}/repos/{GITHUB_BACKUP_REPO}/actions/workflows/{WORKFLOW_FILE}/runs",
            headers=headers,
            params={"per_page": 1, "status": "completed"},
        )
        runs_res.raise_for_status()
        runs = runs_res.json().get("workflow_runs", [])
        if not runs:
            return None
        run = runs[0]

        jobs_res = await client.get(
            f"{GITHUB_API}/repos/{GITHUB_BACKUP_REPO}/actions/runs/{run['id']}/jobs",
            headers=headers,
        )
        jobs_res.raise_for_status()
        jobs = jobs_res.json().get("jobs", [])

    scan_job = next((j for j in jobs if j.get("name") == SCAN_JOB_NAME), None)
    return {
        "runId": run["id"],
        "runUrl": run["html_url"],
        "runCreatedAt": run["created_at"],
        "headSha": run["head_sha"][:7],
        "scanJobFound": scan_job is not None,
        "scanConclusion": scan_job.get("conclusion") if scan_job else None,
        "scanUrl": scan_job.get("html_url") if scan_job else run["html_url"],
    }
