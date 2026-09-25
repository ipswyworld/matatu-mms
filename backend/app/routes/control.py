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
import uuid
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
from app import api_clients
from app import mfa as mfa_lib
from app import network_gate
from app import ops_breakers, ops_controls, ops_limits, ops_metrics, ops_reauth, render_control

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


class ReauthBody(BaseModel):
    password: str
    mfa_code: Optional[str] = None


class CriticalBody(ReasonBody):
    """Every Critical action carries a re-auth token alongside its reason.

    Two-person approval was the original design, but this console is
    internal and everyone with access is trusted — requiring a second
    approver would mostly mean nobody is reachable at 3am. Re-auth defends
    against the threat that actually remains: a session left open on an
    unlocked laptop, or a stolen cookie.
    """
    reauth_token: str


class MaintenanceBody(CriticalBody):
    enabled: bool
    scope: str = "public"
    message: Optional[str] = None


class KillSwitchBody(CriticalBody):
    killed: bool


class RollbackDeployBody(CriticalBody):
    deploy_id: str


def require_reauth(token: str, user: User) -> None:
    if not ops_reauth.verify(token, user.id):
        raise HTTPException(
            status_code=401,
            detail="Re-authentication required or expired. Confirm your password and try again.",
        )


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
    for breaker in await ops_breakers.snapshot_cluster():
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
    # Cluster-wide rather than this process's own numbers: once the control
    # plane runs as its own process (Spec §3.1 Path A) it serves no user
    # traffic, so local metrics would read as a permanent zero while the
    # app replicas were saturated.
    aggregate = await ops_metrics.aggregate_cluster()
    controls = ops_controls.snapshot()

    worst = (
        "down" if any(d["status"] == "down" for d in dependencies)
        else "degraded" if any(d["status"] == "degraded" for d in dependencies)
        else "ok"
    )
    # An active maintenance window is not an outage, but the overview must
    # never look green while the public cannot reach the system.
    if controls["maintenance"]["enabled"] and worst == "ok":
        worst = "degraded"

    return {
        "at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "dependencies": dependencies,
        "metrics": aggregate["metrics"],
        "series": aggregate["series"],
        "queue": depth,
        "breakers": await ops_breakers.snapshot_cluster(),
        "rateLimits": list(ops_limits.current_limits().values()),
        "recentErrors": aggregate["recentErrors"],
        "recentClientErrors": aggregate["recentClientErrors"],
        "controls": controls,
        "worstStatus": worst,
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
    # Deliberately does NOT require the breaker to exist in this process:
    # a split control plane makes no webhook calls of its own, so its local
    # registry is empty and requiring local registration would make every
    # override from it fail. The name is validated against what the cluster
    # has actually published instead.
    known = await ops_breakers.known_names()
    if name not in known:
        raise HTTPException(
            status_code=404,
            detail=f"No circuit breaker named {name!r} is registered anywhere in the cluster",
        )

    local = ops_breakers.get(name)
    previous = local.override if local is not None else "auto"
    try:
        await ops_breakers.set_override(name, body.override)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    stage_audit_log(
        db, resource_type="circuit_breaker", resource_id=name, action="OVERRIDE",
        user_id=current_user.id,
        old_values={"override": previous},
        new_values={"override": body.override, "reason": body.reason},
    )
    await db.commit()
    return await ops_breakers.snapshot_cluster()


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
    job = await pool.enqueue_job("deliver_webhook_job", sub.id, sub.url, log.event_type, payload, sub.secret)

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


# --------------------------------------------------------------------------
# Partner API clients (Readiness List §14)
# --------------------------------------------------------------------------

class ApiClientCreateBody(CriticalBody):
    name: str = Field(min_length=2, max_length=120)
    sacco_id: Optional[str] = None
    scopes: List[str] = Field(default_factory=list)
    quota_tier: str = "partner"
    effective_role: str = "SACCO_OPERATOR"
    environment: str = "production"  # sandbox | production
    ip_allowlist: Optional[List[str]] = None  # CIDR strings; empty/None means unrestricted


@router.get("/api-clients")
async def list_api_clients(
    current_user: User = Depends(requires_permission("view_system_health")),
    db: AsyncSession = Depends(get_db),
):
    from app.models import ApiClient
    from app.quota import current_usage

    rows = (await db.execute(select(ApiClient).order_by(ApiClient.created_at.desc()))).scalars().all()
    out = []
    for c in rows:
        usage = await current_usage(c.client_id, c.quota_tier)
        out.append({
            "id": c.id,
            "name": c.name,
            "clientId": c.client_id,
            "saccoId": c.sacco_id,
            "effectiveRole": c.effective_role,
            "scopes": c.scope_list(),
            "quotaTier": c.quota_tier,
            "environment": c.environment,
            "ipAllowlist": json.loads(c.ip_allowlist) if c.ip_allowlist else [],
            "createdAt": c.created_at.isoformat() if c.created_at else None,
            "lastUsedAt": c.last_used_at.isoformat() if c.last_used_at else None,
            "revokedAt": c.revoked_at.isoformat() if c.revoked_at else None,
            "revokedReason": c.revoked_reason,
            "active": c.revoked_at is None,
            "usage": usage,
        })
    return out


@router.get("/api-clients/{client_id}/usage-history")
async def api_client_usage_history(
    client_id: str,
    current_user: User = Depends(requires_permission("view_system_health")),
    db: AsyncSession = Depends(get_db),
):
    """Daily request-count history for one client, for the usage graph on
    its detail view. Reads from the same quota-tracking keys
    enforce_quota() already writes on every partner request — no separate
    analytics pipeline, just a different read of data that already exists."""
    from app.models import ApiClient
    from app.quota import usage_history

    record = (
        await db.execute(select(ApiClient).where(ApiClient.client_id == client_id))
    ).scalars().first()
    if record is None:
        raise HTTPException(status_code=404, detail="No API client with that id")

    return {"clientId": client_id, "days": await usage_history(client_id, days=30)}


@router.get("/api-clients/scopes")
async def list_api_scopes(
    current_user: User = Depends(requires_permission("view_system_health")),
):
    return {"scopes": api_clients.all_scopes(), "quotaTiers": api_clients.QUOTA_TIERS}


@router.post("/api-clients", status_code=201)
async def create_api_client(
    body: ApiClientCreateBody,
    current_user: User = Depends(requires_permission("manage_system_config")),
    db: AsyncSession = Depends(get_db),
):
    """Issues partner credentials.

    The plaintext secret is returned exactly once, here, and never stored —
    only its hash is. If it is lost, the correct recovery is to revoke the
    client and issue a new one, which is also what should happen if it
    leaked, so there is no "show me the secret again" path by design.
    """
    from app.models import ApiClient, Sacco

    require_reauth(body.reauth_token, current_user)

    try:
        api_clients.validate_scopes(body.scopes)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    if body.environment not in ("sandbox", "production"):
        raise HTTPException(status_code=400, detail="environment must be 'sandbox' or 'production'")

    # A sandbox client always gets the sandbox tier regardless of what was
    # requested — the point of "sandbox" is a low, fixed ceiling a partner
    # can't accidentally (or deliberately) raise by asking for a bigger tier.
    quota_tier = "sandbox" if body.environment == "sandbox" else body.quota_tier
    if quota_tier not in api_clients.QUOTA_TIERS:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown quota tier. Valid: {', '.join(api_clients.QUOTA_TIERS)}",
        )

    # A Sacco-scoped client with no Sacco would be scoped to nothing by
    # ABAC and silently return empty results, which reads as a broken
    # integration rather than a misconfiguration. Fail loudly instead.
    if body.effective_role == "SACCO_OPERATOR" and not body.sacco_id:
        raise HTTPException(
            status_code=400,
            detail="A SACCO_OPERATOR client must be bound to a sacco_id, or it can see nothing.",
        )

    if body.sacco_id:
        sacco = (await db.execute(select(Sacco).where(Sacco.id == body.sacco_id))).scalars().first()
        if sacco is None:
            raise HTTPException(status_code=404, detail="No Sacco with that id")

    ip_allowlist = [cidr.strip() for cidr in (body.ip_allowlist or []) if cidr.strip()]
    if ip_allowlist:
        invalid = network_gate.invalid_networks(ip_allowlist)
        if invalid:
            raise HTTPException(status_code=400, detail=f"Not a valid CIDR/IP: {', '.join(invalid)}")

    client_id, client_secret = api_clients.generate_credentials()
    record = ApiClient(
        id=f"apc-{uuid.uuid4().hex[:10]}",
        name=body.name,
        client_id=client_id,
        client_secret_hash=api_clients.hash_secret(client_secret),
        sacco_id=body.sacco_id,
        effective_role=body.effective_role,
        scopes=json.dumps(body.scopes),
        quota_tier=quota_tier,
        environment=body.environment,
        ip_allowlist=json.dumps(ip_allowlist) if ip_allowlist else None,
        created_by=current_user.id,
        created_at=datetime.datetime.now(datetime.timezone.utc),
    )
    db.add(record)

    stage_audit_log(
        db, resource_type="api_client", resource_id=client_id, action="CREATE",
        user_id=current_user.id,
        new_values={
            "name": body.name, "saccoId": body.sacco_id, "scopes": body.scopes,
            "quotaTier": quota_tier, "environment": body.environment,
            "ipAllowlist": ip_allowlist, "reason": body.reason,
        },
    )
    await db.commit()

    return {
        "id": record.id,
        "name": record.name,
        "clientId": client_id,
        # Shown once. Never retrievable again.
        "clientSecret": client_secret,
        "saccoId": record.sacco_id,
        "scopes": body.scopes,
        "quotaTier": record.quota_tier,
        "environment": record.environment,
        "ipAllowlist": ip_allowlist,
        "warning": "Copy this secret now — it is not stored and cannot be shown again.",
    }


@router.post("/api-clients/{client_id}/revoke")
async def revoke_api_client(
    client_id: str,
    body: CriticalBody,
    current_user: User = Depends(requires_permission("manage_system_config")),
    db: AsyncSession = Depends(get_db),
):
    """Cuts off a client immediately.

    Revocation is a timestamp rather than a delete: a compromised client's
    history has to stay auditable after its access is cut. Existing tokens
    stop working at once because app/principals.py re-checks the record on
    every request rather than trusting the token's lifetime.
    """
    from app.models import ApiClient

    require_reauth(body.reauth_token, current_user)

    record = (
        await db.execute(select(ApiClient).where(ApiClient.client_id == client_id))
    ).scalars().first()
    if record is None:
        raise HTTPException(status_code=404, detail="No API client with that id")
    if record.revoked_at is not None:
        raise HTTPException(status_code=400, detail="That client is already revoked")

    record.revoked_at = datetime.datetime.now(datetime.timezone.utc)
    record.revoked_reason = body.reason

    stage_audit_log(
        db, resource_type="api_client", resource_id=client_id, action="REVOKE",
        user_id=current_user.id,
        new_values={"name": record.name, "reason": body.reason},
    )
    await db.commit()
    logger.warning("API client %s revoked by %s: %s", client_id, current_user.id, body.reason)
    return {"clientId": client_id, "revoked": True}


@router.get("/synthetic-checks")
async def get_synthetic_checks(
    current_user: User = Depends(requires_permission("view_system_health")),
    db: AsyncSession = Depends(get_db),
):
    """Latest synthetic uptime/latency probe per target, plus a short recent
    history for a sparkline (app/synthetic_checks.py runs the actual probes
    on a cron; this just reads what it recorded)."""
    from app.models import SyntheticCheckResult

    rows = (
        await db.execute(
            select(SyntheticCheckResult).order_by(SyntheticCheckResult.checked_at.desc()).limit(300)
        )
    ).scalars().all()

    by_target: dict = {}
    for row in rows:
        by_target.setdefault(row.target_name, []).append(row)

    return [
        {
            "targetName": name,
            "url": entries[0].url,
            "latest": {
                "ok": entries[0].ok,
                "latencyMs": entries[0].latency_ms,
                "error": entries[0].error,
                "checkedAt": entries[0].checked_at.isoformat(),
            },
            "recent": [
                {"ok": e.ok, "latencyMs": e.latency_ms, "checkedAt": e.checked_at.isoformat()}
                for e in reversed(entries[:20])
            ],
        }
        for name, entries in by_target.items()
    ]


class CostSnapshotBody(ReasonBody):
    month: str  # "YYYY-MM"
    amount_kes: str
    note: Optional[str] = None


@router.get("/cost-snapshots")
async def list_cost_snapshots(
    current_user: User = Depends(requires_permission("view_system_health")),
    db: AsyncSession = Depends(get_db),
):
    """Manually-entered monthly cost figures (Render has no billing API to
    read this from automatically — see CostSnapshot's docstring)."""
    from app.models import CostSnapshot

    rows = (
        await db.execute(select(CostSnapshot).order_by(CostSnapshot.month.asc()))
    ).scalars().all()
    return [
        {
            "id": r.id, "month": r.month, "amountKes": str(r.amount_kes),
            "note": r.note, "recordedBy": r.recorded_by, "recordedAt": r.recorded_at.isoformat(),
        }
        for r in rows
    ]


@router.post("/cost-snapshots")
async def create_cost_snapshot(
    body: CostSnapshotBody,
    current_user: User = Depends(requires_permission("manage_system_config")),
    db: AsyncSession = Depends(get_db),
):
    """Records (or overwrites) one month's cost figure — Elevated, not
    Critical: it's a data entry with no operational blast radius, same tier
    as a rate-limit change."""
    from app.models import CostSnapshot
    import re
    import decimal

    if not re.match(r"^\d{4}-(0[1-9]|1[0-2])$", body.month):
        raise HTTPException(status_code=400, detail="month must be in YYYY-MM form.")
    try:
        amount = decimal.Decimal(body.amount_kes)
    except decimal.InvalidOperation:
        raise HTTPException(status_code=400, detail="amount_kes must be a valid number.")

    now = datetime.datetime.now(datetime.timezone.utc)
    existing = (
        await db.execute(select(CostSnapshot).where(CostSnapshot.month == body.month))
    ).scalars().first()
    old_amount = str(existing.amount_kes) if existing else None
    if existing:
        existing.amount_kes = amount
        existing.note = body.note
        existing.recorded_by = current_user.id
        existing.recorded_at = now
    else:
        db.add(CostSnapshot(
            month=body.month, amount_kes=amount, note=body.note,
            recorded_by=current_user.id, recorded_at=now,
        ))

    stage_audit_log(
        db, resource_type="cost_snapshot", resource_id=body.month, action="SET",
        user_id=current_user.id,
        old_values={"amountKes": old_amount} if old_amount else None,
        new_values={"amountKes": body.amount_kes, "reason": body.reason},
    )
    await db.commit()
    return {"month": body.month, "amountKes": body.amount_kes}


@router.get("/ci-status")
async def get_ci_status(
    current_user: User = Depends(requires_permission("view_system_health")),
):
    """Latest dependency/CVE scan result from CI (app/ci_status.py) — reads
    the existing pipeline's own Jobs API result rather than running any scan
    from here."""
    from app import ci_status

    if not ci_status.GITHUB_BACKUP_TOKEN or not ci_status.GITHUB_BACKUP_REPO:
        return None

    try:
        return await ci_status.get_latest_scan_status()
    except Exception as exc:
        logger.warning("Could not fetch CI scan status: %s", exc)
        raise HTTPException(status_code=502, detail="Could not reach GitHub's Actions API.")


# --------------------------------------------------------------------------
# Critical tier: re-authentication + system-wide controls
# --------------------------------------------------------------------------

@router.post("/reauth")
async def reauthenticate(
    body: ReauthBody,
    current_user: User = Depends(requires_permission("manage_system_config")),
    db: AsyncSession = Depends(get_db),
):
    """Step-up authentication, required before any Critical action.

    Verifies the operator's password, and their MFA code when enrolled.
    Returns a short-lived token that Critical endpoints accept, proving the
    person at the keyboard is the account holder rather than whoever found
    an unlocked laptop.
    """
    from app.auth import verify_password

    if not await verify_password(body.password, current_user.password):
        await _record_reauth_failure(db, current_user, "invalid_password")
        raise HTTPException(status_code=401, detail="That password is incorrect.")

    if current_user.mfa_enabled and current_user.totp_secret:
        if not body.mfa_code:
            raise HTTPException(status_code=401, detail="Enter your authenticator code to continue.")
        if not mfa_lib.verify_totp_code(mfa_lib.decrypt_secret(current_user.totp_secret), body.mfa_code):
            await _record_reauth_failure(db, current_user, "invalid_mfa_code")
            raise HTTPException(status_code=401, detail="That authenticator code is incorrect.")

    stage_audit_log(
        db, resource_type="ops_reauth", resource_id=current_user.id, action="REAUTH_SUCCESS",
        user_id=current_user.id,
    )
    await db.commit()
    return ops_reauth.mint(current_user.id)


async def _record_reauth_failure(db: AsyncSession, user: User, reason: str) -> None:
    """A failed step-up on the most privileged console in the system is a
    security signal, not just a typo — record it either way."""
    stage_audit_log(
        db, resource_type="ops_reauth", resource_id=user.id, action="REAUTH_FAILED",
        user_id=user.id, new_values={"reason": reason},
    )
    await db.commit()


@router.get("/system-controls")
async def get_system_controls(
    current_user: User = Depends(requires_permission("view_system_health")),
):
    return ops_controls.snapshot()


async def _persist_control(
    db: AsyncSession, key: str, enabled: bool, value: dict, reason: str, user_id: str
) -> None:
    from app.models import SystemControl

    existing = (
        await db.execute(select(SystemControl).where(SystemControl.key == key))
    ).scalars().first()
    now = datetime.datetime.now(datetime.timezone.utc)
    if existing:
        existing.enabled = enabled
        existing.value = json.dumps(value)
        existing.reason = reason
        existing.updated_by = user_id
        existing.updated_at = now
    else:
        db.add(SystemControl(
            key=key, enabled=enabled, value=json.dumps(value),
            reason=reason, updated_by=user_id, updated_at=now,
        ))


@router.post("/maintenance-mode")
async def set_maintenance_mode(
    body: MaintenanceBody,
    current_user: User = Depends(requires_permission("manage_system_config")),
    db: AsyncSession = Depends(get_db),
):
    """Takes the system out of service, or puts it back.

    Scope "public" leaves staff endpoints reachable so the people handling
    the incident can keep working; "all" is a genuine full stop. The ops
    control plane itself is always exempt — the lever can never lock out
    the hand that pulls it.
    """
    require_reauth(body.reauth_token, current_user)

    if body.scope not in ops_controls.MAINTENANCE_SCOPES:
        raise HTTPException(
            status_code=400,
            detail=f"Scope must be one of: {', '.join(ops_controls.MAINTENANCE_SCOPES)}",
        )

    was_enabled = ops_controls.is_maintenance_active()
    value = {"scope": body.scope}
    if body.message:
        value["message"] = body.message

    await _persist_control(db, ops_controls.MAINTENANCE_KEY, body.enabled, value, body.reason, current_user.id)
    stage_audit_log(
        db, resource_type="system_control", resource_id=ops_controls.MAINTENANCE_KEY,
        action="ENABLE" if body.enabled else "DISABLE",
        user_id=current_user.id,
        old_values={"enabled": was_enabled},
        new_values={"enabled": body.enabled, "scope": body.scope, "reason": body.reason},
    )
    await db.commit()

    ops_controls.apply_local(ops_controls.MAINTENANCE_KEY, body.enabled, value)
    await ops_controls.publish_to_redis()
    logger.warning(
        "Maintenance mode %s (scope=%s) by %s: %s",
        "ENABLED" if body.enabled else "DISABLED", body.scope, current_user.id, body.reason,
    )
    return ops_controls.snapshot()


@router.post("/kill-switch/{feature}")
async def set_kill_switch(
    feature: str,
    body: KillSwitchBody,
    current_user: User = Depends(requires_permission("manage_system_config")),
    db: AsyncSession = Depends(get_db),
):
    """Sheds load by turning one expensive capability off cluster-wide."""
    require_reauth(body.reauth_token, current_user)

    if feature not in ops_controls.KILL_SWITCHES:
        raise HTTPException(
            status_code=404,
            detail=f"Unknown kill switch {feature!r}. Known: {', '.join(ops_controls.KILL_SWITCHES)}",
        )

    key = f"killswitch:{feature}"
    was_killed = ops_controls.is_killed(feature)

    await _persist_control(db, key, body.killed, {}, body.reason, current_user.id)
    stage_audit_log(
        db, resource_type="system_control", resource_id=key,
        action="ENABLE" if body.killed else "DISABLE",
        user_id=current_user.id,
        old_values={"killed": was_killed},
        new_values={"killed": body.killed, "reason": body.reason},
    )
    await db.commit()

    ops_controls.apply_local(key, body.killed, {})
    await ops_controls.publish_to_redis()
    logger.warning(
        "Kill switch %r %s by %s: %s",
        feature, "ENGAGED" if body.killed else "RELEASED", current_user.id, body.reason,
    )
    return ops_controls.snapshot()


@router.post("/render/{service_id}/deploy")
async def trigger_render_deploy(
    service_id: str,
    body: CriticalBody,
    current_user: User = Depends(requires_permission("manage_system_config")),
    db: AsyncSession = Depends(get_db),
):
    """Deploys a service's latest commit — the highest blast-radius action
    in the ops console, so it goes through the same Critical gate as
    maintenance mode and kill switches: reason, typed confirmation, and
    step-up re-auth, all enforced here rather than trusted from the UI."""
    require_reauth(body.reauth_token, current_user)

    if not render_control.RENDER_API_KEY:
        raise HTTPException(status_code=503, detail="RENDER_API_KEY is not configured on this service.")

    try:
        result = await render_control.trigger_deploy(service_id)
    except render_control.RenderApiError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc))

    stage_audit_log(
        db, resource_type="render_deploy", resource_id=service_id, action="TRIGGER",
        user_id=current_user.id, old_values=None,
        new_values={"reason": body.reason, "deployId": result.get("id")},
    )
    await db.commit()
    logger.warning("Render deploy triggered for service %s by %s: %s", service_id, current_user.id, body.reason)
    return {"id": result.get("id"), "status": result.get("status")}


@router.post("/render/{service_id}/rollback")
async def rollback_render_deploy(
    service_id: str,
    body: RollbackDeployBody,
    current_user: User = Depends(requires_permission("manage_system_config")),
    db: AsyncSession = Depends(get_db),
):
    """Rolls a service back to a specific previous deploy — Critical for the
    same reason as trigger_render_deploy above, plus it targets a
    caller-supplied deploy_id rather than "whatever's newest"."""
    require_reauth(body.reauth_token, current_user)

    if not render_control.RENDER_API_KEY:
        raise HTTPException(status_code=503, detail="RENDER_API_KEY is not configured on this service.")

    try:
        result = await render_control.rollback_deploy(service_id, body.deploy_id)
    except render_control.RenderApiError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc))

    stage_audit_log(
        db, resource_type="render_deploy", resource_id=service_id, action="ROLLBACK",
        user_id=current_user.id, old_values=None,
        new_values={"reason": body.reason, "rolledBackToDeployId": body.deploy_id},
    )
    await db.commit()
    logger.warning(
        "Render rollback for service %s to deploy %s by %s: %s",
        service_id, body.deploy_id, current_user.id, body.reason,
    )
    return {"id": result.get("id"), "status": result.get("status")}


@router.post("/sessions/revoke-all")
async def revoke_all_sessions_endpoint(
    body: CriticalBody,
    current_user: User = Depends(requires_permission("manage_admins")),
    db: AsyncSession = Depends(get_db),
):
    """Signs out every account in the system — the containment action for a
    suspected broad compromise, and maximally disruptive.

    The operator's own session is revoked too. That is deliberate: exempting
    it would leave exactly one live session behind during a compromise
    response, and if the operator's own account is the compromised one, the
    exemption would defeat the entire action.
    """
    require_reauth(body.reauth_token, current_user)

    from app.session_revocation import revoke_all_sessions

    users = (await db.execute(select(User))).scalars().all()
    revoked = 0
    failed = 0
    for user in users:
        try:
            await revoke_all_sessions(user.id)
            revoked += 1
        except Exception as e:
            logger.warning("Could not revoke sessions for %s: %s", user.id, e)
            failed += 1

    stage_audit_log(
        db, resource_type="user", resource_id="*", action="REVOKE_ALL_SESSIONS",
        user_id=current_user.id,
        new_values={"revokedCount": revoked, "failedCount": failed, "reason": body.reason},
    )
    await db.commit()
    logger.warning("ALL SESSIONS REVOKED by %s (%d accounts): %s", current_user.id, revoked, body.reason)
    return {"revoked": revoked, "failed": failed, "yourSessionRevoked": True}


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
