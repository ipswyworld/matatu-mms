"""
Background job/queue visibility + control (OPS_CONSOLE_AND_USER_ACTIVITY_SPEC.md
A.3/A.5 #4 — "cheap once #6's [Tier-1 guardrail] pattern exists").

Introspects the real ARQ queue (app/worker.py) via arq's own Job/JobDef/
JobResult classes, reading the exact Redis keys arq itself uses (arq.constants) —
not a hand-rolled queue-state guess. Two things are deliberately NOT built
here because ARQ has no such primitive to back them: a separate "dead-letter
queue" (a failed job's result — success=False — simply stays in ARQ's own
result store, which is what's surfaced below) and "pause a queue" (arq has
no pause/resume concept; the closest real lever is stopping the worker
process itself, which isn't a safe thing to expose as a button). "Retry" is
real: it re-enqueues the same function/args/kwargs as a fresh job, which
works because every job type here is documented as idempotent/retryable
(ARCHITECTURE_DECISIONS.md §17.2).
"""
import logging
from typing import List, Optional

from arq.jobs import Job
from arq.constants import default_queue_name, in_progress_key_prefix, job_key_prefix, result_key_prefix
from fastapi import APIRouter, Depends, HTTPException
from redis import asyncio as aioredis

from app.models import User
from app.schemas import JobSummaryResponse
from app.auth import requires_permission
from app.audit import stage_audit_log
from app.config import REDIS_URL
from app.worker import get_arq_pool
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import get_db

logger = logging.getLogger("app.routes.jobs")
router = APIRouter(prefix="/api/jobs", tags=["Background Jobs"])

_raw_redis: Optional[aioredis.Redis] = None


async def _get_raw_redis() -> aioredis.Redis:
    """A separate connection from app/realtime.py's get_redis(): that one
    runs with decode_responses=True for pub/sub text messages, which would
    corrupt arq's pickled binary job/result payloads if reused here."""
    global _raw_redis
    if _raw_redis is None:
        _raw_redis = aioredis.from_url(REDIS_URL, protocol=2)
    return _raw_redis


def _preview(value) -> Optional[str]:
    if value is None:
        return None
    text = str(value)
    return text if len(text) <= 300 else text[:300] + "…"


@router.get("/queue", response_model=List[JobSummaryResponse])
async def get_job_queue(
    current_user: User = Depends(requires_permission("manage_system_config")),
):
    """Every job arq currently knows about: queued/deferred (in the
    arq:queue sorted set, not yet started), in-progress, and recently
    completed (success or failure) — most recent first."""
    redis = await _get_raw_redis()
    summaries: List[JobSummaryResponse] = []

    # Queued + deferred — members of arq's own queue sorted set.
    queued_ids = await redis.zrange(default_queue_name, 0, -1)
    for raw_id in queued_ids:
        job_id = raw_id.decode() if isinstance(raw_id, bytes) else raw_id
        job = Job(job_id, redis)
        info = await job.info()
        status = await job.status()
        if info:
            summaries.append(JobSummaryResponse(
                job_id=job_id, function=info.function, status=status.value,
                enqueue_time=info.enqueue_time, job_try=info.job_try,
                start_time=None, finish_time=None, success=None, result_preview=None,
            ))

    # In-progress — a job currently being executed by the worker.
    in_progress_keys = await redis.keys(f"{in_progress_key_prefix}*")
    for key in in_progress_keys:
        job_id = key.decode().removeprefix(in_progress_key_prefix) if isinstance(key, bytes) else key.removeprefix(in_progress_key_prefix)
        job = Job(job_id, redis)
        info = await job.info()
        if info:
            summaries.append(JobSummaryResponse(
                job_id=job_id, function=info.function, status="in_progress",
                enqueue_time=info.enqueue_time, job_try=info.job_try,
                start_time=None, finish_time=None, success=None, result_preview=None,
            ))

    # Completed — arq keeps the result (success or failure) under result_key_prefix
    # for keep_result seconds (default 1h) after the job finishes.
    result_keys = await redis.keys(f"{result_key_prefix}*")
    for key in result_keys:
        job_id = key.decode().removeprefix(result_key_prefix) if isinstance(key, bytes) else key.removeprefix(result_key_prefix)
        job = Job(job_id, redis)
        result = await job.result_info()
        if result:
            summaries.append(JobSummaryResponse(
                job_id=job_id, function=result.function, status="complete",
                enqueue_time=result.enqueue_time, job_try=result.job_try,
                start_time=result.start_time, finish_time=result.finish_time,
                success=result.success, result_preview=_preview(result.result),
            ))

    summaries.sort(key=lambda s: s.finish_time or s.start_time or s.enqueue_time, reverse=True)
    return summaries[:100]


@router.post("/queue/{job_id}/retry", response_model=JobSummaryResponse)
async def retry_job(
    job_id: str,
    current_user: User = Depends(requires_permission("manage_system_config")),
    db: AsyncSession = Depends(get_db),
):
    """Re-enqueues a failed job's exact function/args/kwargs as a brand-new
    job (arq assigns it a fresh job_id — no collision with the original).
    Only meaningful for a job that actually finished unsuccessfully; queued/
    in-progress/succeeded jobs have nothing to retry."""
    redis = await _get_raw_redis()
    job = Job(job_id, redis)
    result = await job.result_info()
    if not result:
        raise HTTPException(status_code=404, detail="No completed job found with that id")
    if result.success:
        raise HTTPException(status_code=400, detail="This job already succeeded — nothing to retry")

    pool = await get_arq_pool()
    new_job = await pool.enqueue_job(result.function, *result.args, **result.kwargs)
    if new_job is None:
        raise HTTPException(status_code=500, detail="Could not enqueue retry")

    stage_audit_log(
        db, resource_type="job", resource_id=job_id, action="RETRY",
        user_id=current_user.id, new_values={"function": result.function, "newJobId": new_job.job_id},
    )
    await db.commit()

    return JobSummaryResponse(
        job_id=new_job.job_id, function=result.function, status="queued",
        enqueue_time=result.enqueue_time, job_try=1,
        start_time=None, finish_time=None, success=None, result_preview=None,
    )
