"""
Ops control plane (Ops Console Rebuild Spec §6).

Everything the ops console needs beyond read-only display: a live state
feed and the actions an operator takes during an incident.

Two deliberate constraints, both inherited from what the underlying
libraries actually support rather than what would be nice to have:

  * ARQ has no pause/resume primitive and no separate dead-letter queue —
    app/routes/jobs.py already documents this. So "drain the queue" is not
    implemented here rather than faked with something that looks like a
    pause but isn't. Job *cancellation* is real (arq's Job.abort()), and
    "retry every failed job" is real (bulk of the existing retry path).
  * Circuit-breaker overrides are per-process, because a breaker guards
    this process's calls to a dependency. See app/ops_breakers.py.

Path prefix is /api/control specifically so this router can later be
lifted into its own uvicorn entrypoint (Spec §3.1 Path A) with no client
changes — the split is a deployment change, not a rewrite.
"""
import asyncio
import datetime
import json
import logging
import time
from typing import List, Optional

from arq.constants import default_queue_name, in_progress_key_prefix, result_key_prefix
from arq.jobs import Job
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from starlette.responses import StreamingResponse

from app.audit import stage_audit_log
from app.auth import requires_permission
from app.database import engine, get_db
from app.models import RateLimitOverride, User, WebhookLog, WebhookSubscription
from app.ops_metrics import metrics
from app.realtime import get_redis
from app import ops_breakers, ops_limits

logger = logging.getLogger("app.routes.control")
router = APIRouter(prefix="/api/control", tags=["Ops Control Plane"])

STREAM_INTERVAL_SECONDS = 3


# --------------------------------------------------------------------------
# Request bodies
# --------------------------------------------------------------------------

class ReasonBody(BaseModel):
    """Every Elevated action carries an operator-supplied reason.

    The audit trail already records that something happened and who did it;
    the reason is what makes it possible to understand *why* six months
    later, which is the difference between an audit trail and a log.
    """
    reason: str = Field(min_length=3, max_length=500)


class RateLimitBody(ReasonBody):
    # None restores the coded default rather than pinning the current value.
    limit_value: Optional[str] = None


class BreakerBody(ReasonBody):
    override: str  # auto | open | closed


class RevokeSessionsBody(ReasonBody):
    user_id: str


# --------------------------------------------------------------------------
# Shared state collection
# --------------------------------------------------------------------------

async def _queue_depth() -> dict:
    """Queue depth by state, read from the same arq Redis keys
    app/routes/jobs.py introspects."""
    try:
        from app.routes.jobs import _get_raw_redis
        redis = await _get_raw_redis()
        queued = await redis.zcard(default_queue_name)
        in_progress = len(await redis.keys(f"{in_progress_key_prefix}*"))
        results = await redis.keys(f"{result_key_prefix}*")

        failed = 0
        # Bounded scan: an operator needs to know "are there failures",
        # not an exact count across an unbounded result store.
        for key in results[:200]:
            job_id = key.decode() if isinstance(key, bytes) else key
            job_id = job_id.removeprefix(result_key_prefix)
            info = await Job(job_id, redis).result_info()
            if info and not info.success:
                failed += 1

        return {
            "queued": queued,
            "inProgress": in_progress,
            "completed": len(results),
            "failed": failed,
            "reachable": True,
            "error": None,
        }
    except Exception as e:
        return {
            "queued": 0, "inProgress": 0, "completed": 0, "failed": 0,
            "reachable": False, "error": str(e)[:200],
        }


async def _dependency_states() -> List[dict]:
    """Red/amber/green for each hard dependency, with a measured latency —
    the top strip of the incident overview."""
    states: List[dict] = []

    started = time.perf_counter()
    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
        states.append({
            "name": "Database", "status": "ok",
            "latencyMs": round((time.perf_counter() - started) * 1000, 1), "error": None,
        })
    except SQLAlchemyError as e:
        states.append({"name": "Database", "status": "down", "latencyMs": None, "error": str(e)[:200]})

    started = time.perf_counter()
    try:
        r = await get_redis()
        await r.ping()
        states.append({
            "name": "Redis", "status": "ok",
            "latencyMs": round((time.perf_counter() - started) * 1000, 1), "error": None,
        })
    except Exception as e:
        states.append({"name": "Redis", "status": "down", "latencyMs": None, "error": str(e)[:200]})

    depth = await _queue_depth()
    if not depth["reachable"]:
        queue_status = "down"
    elif depth["failed"] > 0:
        queue_status = "degraded"
    else:
        queue_status = "ok"
    states.append({
        "name": "Job queue", "status": queue_status, "latencyMs": None,
        "error": depth["error"],
    })

    # A tripped breaker is a degraded dependency, which is exactly the
    # framing an operator wants rather than a separate list to cross-check.
    for breaker in ops_breakers.snapshot():
        states.append({
            "name": breaker["description"] or breaker["name"],
            "status": "degraded" if breaker["effectivelyBlocking"] else "ok",
            "latencyMs": None,
            "error": (
                f"Breaker {breaker['state']}"
                + (f" (manually held {breaker['override']})" if breaker["override"] != "auto" else "")
                if breaker["effectivelyBlocking"] else None
            ),
        })

    return states


async def _collect_snapshot() -> dict:
    dependencies = await _dependency_states()
    depth = await _queue_depth()
    return {
        "at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "dependencies": dependencies,
        "metrics": metrics.snapshot(60),
        "series": metrics.series(60),
        "queue": depth,
        "breakers": ops_breakers.snapshot(),
        "rateLimits": list(ops_limits.current_limits().values()),
        "recentErrors": metrics.recent_errors(),
        "worstStatus": (
            "down" if any(d["status"] == "down" for d in dependencies)
            else "degraded" if any(d["status"] == "degraded" for d in dependencies)
            else "ok"
        ),
    }


# --------------------------------------------------------------------------
# Read endpoints
# --------------------------------------------------------------------------

@router.get("/overview")
async def get_overview(
    current_user: User = Depends(requires_permission("view_system_health")),
):
    """One aggregated read for the incident overview's first paint. The SSE
    stream takes over for ongoing updates."""
    return await _collect_snapshot()


@router.get("/stream")
async def stream_state(
    current_user: User = Depends(requires_permission("view_system_health")),
):
    """Server-Sent Events feed of the same snapshot.

    SSE rather than WebSocket deliberately (Spec §3.2): the feed is
    unidirectional, actions travel over ordinary POSTs, and SSE brings its
    own reconnection semantics rather than needing the connection-lifecycle
    handling a WebSocket would.

    The browser cannot attach an Authorization header to EventSource, so
    the ops app proxies this through its own Next.js route handler, which
    holds the session cookie and adds the bearer token server-side. That
    keeps the token out of the URL.
    """
    async def event_generator():
        try:
            while True:
                try:
                    snapshot = await _collect_snapshot()
                    yield f"event: snapshot\ndata: {json.dumps(snapshot)}\n\n"
                except Exception as e:
                    # A failure to collect must not kill the stream — the
                    # console losing its feed during an incident is the
                    # exact moment it is most needed.
                    logger.warning("Ops snapshot failed: %s", e)
                    yield f"event: error\ndata: {json.dumps({'message': str(e)[:200]})}\n\n"
                await asyncio.sleep(STREAM_INTERVAL_SECONDS)
        except asyncio.CancelledError:
            raise

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            # Defeats proxy buffering, which would otherwise hold events
            # until a buffer fills and make a "live" feed arrive in bursts.
            "X-Accel-Buffering": "no",
        },
    )


# --------------------------------------------------------------------------
# Rate limits (Elevated)
# --------------------------------------------------------------------------

@router.get("/rate-limits")
async def list_rate_limits(
    current_user: User = Depends(requires_permission("view_system_health")),
):
    return list(ops_limits.current_limits().values())


@router.patch("/rate-limits/{scope}")
async def update_rate_limit(
    scope: str,
    body: RateLimitBody,
    current_user: User = Depends(requires_permission("manage_system_config")),
    db: AsyncSession = Depends(get_db),
):
    """Adjusts a live rate limit. `limit_value: null` restores the coded default."""
    if scope not in ops_limits.DEFAULTS:
        raise HTTPException(status_code=404, detail=f"Unknown rate limit scope: {scope}")

    previous = ops_limits.limit_for(scope)

    if body.limit_value is not None:
        try:
            ops_limits.parse_limit(body.limit_value)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))

    existing = (
        await db.execute(select(RateLimitOverride).where(RateLimitOverride.scope == scope))
    ).scalars().first()

    if body.limit_value is None:
        if existing:
            await db.delete(existing)
    elif existing:
        existing.limit_value = body.limit_value
        existing.reason = body.reason
        existing.updated_by = current_user.id
        existing.updated_at = datetime.datetime.now(datetime.timezone.utc)
    else:
        db.add(RateLimitOverride(
            scope=scope,
            limit_value=body.limit_value,
            reason=body.reason,
            updated_by=current_user.id,
            updated_at=datetime.datetime.now(datetime.timezone.utc),
        ))

    stage_audit_log(
        db, resource_type="rate_limit", resource_id=scope, action="UPDATE",
        user_id=current_user.id,
        old_values={"limitValue": previous},
        new_values={"limitValue": body.limit_value or ops_limits.DEFAULTS[scope], "reason": body.reason},
    )
    await db.commit()

    ops_limits.apply_local(scope, body.limit_value)
    await ops_limits.publish_to_redis()

    return {"scope": scope, "effective": ops_limits.limit_for(scope), "previous": previous}


# --------------------------------------------------------------------------
# Circuit breakers (Elevated)
# --------------------------------------------------------------------------

@router.get("/circuit-breakers")
async def list_circuit_breakers(
    current_user: User = Depends(requires_permission("view_system_health")),
):
    return ops_breakers.snapshot()


@router.post("/circuit-breakers/{name}")
async def override_circuit_breaker(
    name: str,
    body: BreakerBody,
    current_user: User = Depends(requires_permission("manage_system_config")),
    db: AsyncSession = Depends(get_db),
):
    breaker = ops_breakers.get(name)
    if breaker is None:
        raise HTTPException(status_code=404, detail=f"No registered circuit breaker named {name!r}")
    previous = breaker.override
    try:
        ops_breakers.set_override(name, body.override)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    stage_audit_log(
        db, resource_type="circuit_breaker", resource_id=name, action="OVERRIDE",
        user_id=current_user.id,
        old_values={"override": previous},
        new_values={"override": body.override, "reason": body.reason},
    )
    await db.commit()
    return ops_breakers.snapshot()


# --------------------------------------------------------------------------
# Jobs (Routine)
# --------------------------------------------------------------------------

@router.post("/jobs/{job_id}/cancel")
async def cancel_job(
    job_id: str,
    current_user: User = Depends(requires_permission("manage_system_config")),
    db: AsyncSession = Depends(get_db),
):
    """Aborts a queued or running job via arq's own abort mechanism.

    Requires the worker to run with allow_abort_jobs=True (set in
    app/worker.py). Aborting a job that has already finished is a no-op
    that reports as not-abortable rather than an error, since the operator's
    intent — "make this stop" — is already satisfied.
    """
    from app.routes.jobs import _get_raw_redis
    redis = await _get_raw_redis()
    job = Job(job_id, redis)

    info = await job.info()
    if info is None:
        raise HTTPException(status_code=404, detail="No job found with that id")

    try:
        aborted = await job.abort(timeout=5)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Could not abort job: {str(e)[:200]}")

    stage_audit_log(
        db, resource_type="job", resource_id=job_id, action="CANCEL",
        user_id=current_user.id,
        new_values={"function": getattr(info, "function", None), "aborted": bool(aborted)},
    )
    await db.commit()
    return {"jobId": job_id, "aborted": bool(aborted)}


@router.post("/jobs/retry-all-failed")
async def retry_all_failed(
    current_user: User = Depends(requires_permission("manage_system_config")),
    db: AsyncSession = Depends(get_db),
):
    """Bulk of the existing single-job retry.

    ARQ has no dead-letter queue as such — a failed job's result simply
    stays in its result store (see app/routes/jobs.py). "Retry all failed"
    therefore means: re-enqueue every unsuccessful result currently held.
    """
    from app.routes.jobs import _get_raw_redis
    from app.worker import get_arq_pool

    redis = await _get_raw_redis()
    pool = await get_arq_pool()

    retried: List[str] = []
    failures: List[str] = []

    for key in (await redis.keys(f"{result_key_prefix}*"))[:200]:
        raw = key.decode() if isinstance(key, bytes) else key
        original_id = raw.removeprefix(result_key_prefix)
        info = await Job(original_id, redis).result_info()
        if not info or info.success:
            continue
        try:
            new_job = await pool.enqueue_job(info.function, *info.args, **info.kwargs)
            if new_job is not None:
                retried.append(new_job.job_id)
        except Exception as e:
            logger.warning("Could not re-enqueue %s: %s", original_id, e)
            failures.append(original_id)

    stage_audit_log(
        db, resource_type="job", resource_id="*", action="RETRY_ALL_FAILED",
        user_id=current_user.id,
        new_values={"retriedCount": len(retried), "failedToEnqueue": len(failures)},
    )
    await db.commit()
    return {"retried": len(retried), "failedToEnqueue": len(failures), "newJobIds": retried}


# --------------------------------------------------------------------------
# Webhooks (Routine)
# --------------------------------------------------------------------------

@router.post("/webhooks/{log_id}/replay")
async def replay_webhook(
    log_id: int,
    current_user: User = Depends(requires_permission("manage_system_config")),
    db: AsyncSession = Depends(get_db),
):
    """Re-delivers a recorded webhook attempt through the normal queued
    delivery path, so it inherits the same retry and breaker behaviour as
    an original delivery rather than bypassing them."""
    log = (await db.execute(select(WebhookLog).where(WebhookLog.id == log_id))).scalars().first()
    if log is None:
        raise HTTPException(status_code=404, detail="No webhook log entry with that id")

    sub = (
        await db.execute(select(WebhookSubscription).where(WebhookSubscription.id == log.subscription_id))
    ).scalars().first()
    if sub is None:
        raise HTTPException(status_code=404, detail="That subscription no longer exists")

    try:
        payload = json.loads(log.payload)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="Stored payload is not valid JSON and cannot be replayed")

    from app.worker import get_arq_pool
    pool = await get_arq_pool()
    job = await pool.enqueue_job("deliver_webhook_job", sub.id, sub.url, log.event_type, payload)

    stage_audit_log(
        db, resource_type="webhook_log", resource_id=str(log_id), action="REPLAY",
        user_id=current_user.id,
        new_values={"subscriptionId": sub.id, "eventType": log.event_type,
                    "jobId": job.job_id if job else None},
    )
    await db.commit()
    return {"logId": log_id, "jobId": job.job_id if job else None}


@router.get("/webhooks/recent")
async def recent_webhook_deliveries(
    limit: int = 50,
    current_user: User = Depends(requires_permission("view_system_health")),
    db: AsyncSession = Depends(get_db),
):
    rows = (
        await db.execute(select(WebhookLog).order_by(WebhookLog.id.desc()).limit(min(limit, 200)))
    ).scalars().all()
    return [
        {
            "id": r.id,
            "subscriptionId": r.subscription_id,
            "eventType": r.event_type,
            "statusCode": r.status_code,
            "errorMessage": r.error_message,
            "attempt": r.attempt,
            "timestamp": r.timestamp.isoformat() if r.timestamp else None,
            "succeeded": r.status_code is not None and 200 <= r.status_code < 300,
        }
        for r in rows
    ]


# --------------------------------------------------------------------------
# Sessions and accounts (Elevated)
# --------------------------------------------------------------------------

@router.post("/sessions/revoke")
async def revoke_user_sessions(
    body: RevokeSessionsBody,
    current_user: User = Depends(requires_permission("manage_admins")),
    db: AsyncSession = Depends(get_db),
):
    """Invalidates every existing token for one account.

    Gated on manage_admins rather than manage_system_config: this can lock
    out an Admin or Super Admin, so it belongs with the other account-tier
    powers, matching how routes/users.py already gates admin management.
    """
    user = (await db.execute(select(User).where(User.id == body.user_id))).scalars().first()
    if user is None:
        raise HTTPException(status_code=404, detail="No user with that id")

    from app.session_revocation import revoke_all_sessions
    await revoke_all_sessions(body.user_id)

    stage_audit_log(
        db, resource_type="user", resource_id=body.user_id, action="REVOKE_SESSIONS",
        user_id=current_user.id,
        new_values={"targetName": user.name, "reason": body.reason},
    )
    await db.commit()
    return {"userId": body.user_id, "revoked": True}


@router.post("/users/{user_id}/lock")
async def lock_user(
    user_id: str,
    body: ReasonBody,
    current_user: User = Depends(requires_permission("manage_admins")),
    db: AsyncSession = Depends(get_db),
):
    """Deactivates an account and drops its live sessions in one step.

    Deactivating without revoking would leave an already-issued token valid
    until expiry, which is not what "lock this account" means to the person
    clicking it during a suspected compromise.
    """
    user = (await db.execute(select(User).where(User.id == user_id))).scalars().first()
    if user is None:
        raise HTTPException(status_code=404, detail="No user with that id")
    if user.id == current_user.id:
        raise HTTPException(status_code=400, detail="You cannot lock your own account")

    was_active = user.is_active
    user.is_active = False

    from app.session_revocation import revoke_all_sessions
    await revoke_all_sessions(user_id)

    stage_audit_log(
        db, resource_type="user", resource_id=user_id, action="LOCK",
        user_id=current_user.id,
        old_values={"isActive": was_active},
        new_values={"isActive": False, "targetName": user.name, "reason": body.reason},
    )
    await db.commit()
    return {"userId": user_id, "isActive": False}


@router.post("/users/{user_id}/unlock")
async def unlock_user(
    user_id: str,
    body: ReasonBody,
    current_user: User = Depends(requires_permission("manage_admins")),
    db: AsyncSession = Depends(get_db),
):
    user = (await db.execute(select(User).where(User.id == user_id))).scalars().first()
    if user is None:
        raise HTTPException(status_code=404, detail="No user with that id")

    was_active = user.is_active
    user.is_active = True

    stage_audit_log(
        db, resource_type="user", resource_id=user_id, action="UNLOCK",
        user_id=current_user.id,
        old_values={"isActive": was_active},
        new_values={"isActive": True, "targetName": user.name, "reason": body.reason},
    )
    await db.commit()
    return {"userId": user_id, "isActive": True}


@router.post("/users/{user_id}/reset-mfa")
async def reset_user_mfa(
    user_id: str,
    body: ReasonBody,
    current_user: User = Depends(requires_permission("manage_admins")),
    db: AsyncSession = Depends(get_db),
):
    """Clears MFA enrolment for a staff member locked out of their
    authenticator, so they can re-enrol on next sign-in.

    Sessions are revoked at the same time: if the reason for this is a lost
    or compromised device, leaving that device's existing session alive
    would defeat the point.
    """
    user = (await db.execute(select(User).where(User.id == user_id))).scalars().first()
    if user is None:
        raise HTTPException(status_code=404, detail="No user with that id")
    if not user.mfa_enabled and user.totp_secret is None:
        raise HTTPException(status_code=400, detail="That account does not have MFA enrolled")

    user.mfa_enabled = False
    user.totp_secret = None
    user.mfa_backup_codes = None

    from app.session_revocation import revoke_all_sessions
    await revoke_all_sessions(user_id)

    stage_audit_log(
        db, resource_type="user", resource_id=user_id, action="RESET_MFA",
        user_id=current_user.id,
        new_values={"targetName": user.name, "reason": body.reason},
    )
    await db.commit()
    return {"userId": user_id, "mfaEnabled": False}
