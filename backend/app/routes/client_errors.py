"""
Frontend crash reporting, so an ops console operator sees a browser-side
"System error" page the moment it happens, not only when Sentry (currently
inert — no DSN configured, see matatu-mms/matatu-mms-public's
sentry.*.config.ts) is wired up and someone goes looking there.

Deliberately unauthenticated: the whole point is a page that just crashed,
possibly because auth itself is broken, still gets reported. Rate-limited
per IP instead (app/ops_limits.py "client_error_report") since there's no
account to throttle against.

This is intentionally a thin, ops-visibility-only sibling to Sentry, not a
replacement for it — no stack symbolication, no issue grouping/dedup, no
release tracking. It exists to answer "is this happening right now" in the
one place operators already watch (the ops console's live stream), which
Sentry alone cannot do without its own alerting wired in (see
MULTI_STAKEHOLDER_REVIEW.md's Ops Centre Rebuild section).
"""
from fastapi import APIRouter, Request, status
from pydantic import BaseModel, Field

from app import ops_limits
from app.ops_metrics import metrics
from app.rate_limit import limiter

router = APIRouter(prefix="/api/client-errors", tags=["Client Error Reporting"])

# The two Next.js apps that currently carry an error.tsx/global-error.tsx
# boundary. Not enforced as a strict enum — a stray value just shows up
# as-is in the ops console rather than being rejected, since losing a real
# crash report to a validation mismatch is worse than an unrecognized label.
KNOWN_APPS = {"matatu-mms", "matatu-mms-public", "matatu-mms-ops"}


class ClientErrorReport(BaseModel):
    app: str = Field(max_length=64)
    message: str = Field(max_length=2000)
    url: str = Field(max_length=1000)
    digest: str | None = Field(default=None, max_length=200)
    stack: str | None = Field(default=None, max_length=8000)


@router.post("", status_code=status.HTTP_202_ACCEPTED)
@limiter.limit(ops_limits.limit_callable("client_error_report"))
async def report_client_error(request: Request, payload: ClientErrorReport):
    metrics.record_client_error(
        app=payload.app if payload.app in KNOWN_APPS else payload.app[:64],
        message=payload.message,
        url=payload.url,
        digest=payload.digest,
        stack=payload.stack,
    )
    # 202: accepted for the ops feed, not "processed" in any stronger sense —
    # there's nothing else for the caller to wait on.
    return {"ok": True}
