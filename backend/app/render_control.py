"""
Deploy trigger/rollback for the ops console's Infrastructure page — the
highest blast-radius action in the whole ops-console gap-closure pass
(matatu-mms-ops/lib/render.ts already reads Render's API for the service
health matrix; this module is the write side, kept in the backend
specifically so it gets require_reauth + stage_audit_log like every other
Critical action, neither of which matatu-mms-ops's Next.js server has).

Render's deploy-trigger endpoint (`POST /v1/services/{id}/deploys`) is a
long-documented, stable part of their public API — it's exactly what
"Manual Deploy" in Render's own dashboard calls. Their rollback endpoint
(`POST /v1/services/{id}/rollback`) is real but has not been exercised
live from this codebase; test it against a non-production service before
relying on it during an actual incident.
"""
import logging
from typing import Optional

import httpx

from app.config import RENDER_API_KEY

logger = logging.getLogger("app.render_control")

RENDER_API_BASE = "https://api.render.com/v1"


class RenderNotConfigured(Exception):
    """RENDER_API_KEY isn't set on this service."""


class RenderApiError(Exception):
    def __init__(self, status_code: int, detail: str):
        self.status_code = status_code
        super().__init__(detail)


async def _call(path: str, body: Optional[dict] = None) -> dict:
    if not RENDER_API_KEY:
        raise RenderNotConfigured()

    async with httpx.AsyncClient(timeout=30.0) as client:
        res = await client.post(
            f"{RENDER_API_BASE}{path}",
            headers={
                "Authorization": f"Bearer {RENDER_API_KEY}",
                "Accept": "application/json",
                "Content-Type": "application/json",
            },
            json=body or {},
        )

    if res.status_code >= 400:
        detail = res.text
        try:
            detail = res.json().get("message", detail)
        except Exception:
            pass
        raise RenderApiError(res.status_code, detail)

    return res.json()


async def trigger_deploy(service_id: str) -> dict:
    """Deploys the latest commit on the service's configured branch."""
    return await _call(f"/services/{service_id}/deploys")


async def rollback_deploy(service_id: str, deploy_id: str) -> dict:
    """Rolls back to a specific previous deploy of this service."""
    return await _call(f"/services/{service_id}/rollback", {"deployId": deploy_id})
