"""
In-process rolling request metrics for the ops console's live stream
(Ops Console Rebuild Spec §3.2).

This is deliberately NOT a replacement for Prometheus/Grafana, which remain
the system of record for metrics (readiness list §5). It exists because the
ops console needs a handful of numbers available immediately, from the same
process, with no external dependency — so the console still shows request
rate and error rate during exactly the incidents where the metrics backend
may itself be unreachable.

Storage is a fixed ring of one-second buckets. Memory is bounded and
constant regardless of traffic: latency samples per bucket are capped, so a
traffic spike costs no extra memory, at the cost of p95 becoming an estimate
over a sample rather than an exact figure. For an operations dashboard that
is the correct trade.
"""
import asyncio
import json
import logging
import os
import socket
import time
from collections import deque
from typing import Deque, Dict, List, Optional

logger = logging.getLogger("app.ops_metrics")

WINDOW_SECONDS = 300           # 5 minutes of history
MAX_SAMPLES_PER_BUCKET = 100   # caps memory under load; p95 becomes sampled

# Cross-process publication (Phase 4). A split control-plane process serves
# no user traffic of its own, so without this the overview would report
# zero requests while the app processes were saturated. Each process
# publishes its own rolling snapshot under a short TTL; the console
# aggregates whatever is currently alive, which also gives a correct
# cluster-wide view once there is more than one replica.
PUBLISH_KEY_PREFIX = "ops:metrics:"
PUBLISH_TTL_SECONDS = 20
PUBLISH_INTERVAL_SECONDS = 5
INSTANCE_ID = f"{socket.gethostname()}:{os.getpid()}"


class _Bucket:
    __slots__ = ("second", "requests", "errors", "server_errors", "latencies")

    def __init__(self, second: int):
        self.second = second
        self.requests = 0
        self.errors = 0          # 4xx + 5xx
        self.server_errors = 0   # 5xx only
        self.latencies: List[float] = []


class RequestMetrics:
    def __init__(self) -> None:
        self._buckets: Deque[_Bucket] = deque(maxlen=WINDOW_SECONDS)
        self._recent_errors: Deque[dict] = deque(maxlen=50)

    def _current_bucket(self) -> _Bucket:
        now = int(time.time())
        if self._buckets and self._buckets[-1].second == now:
            return self._buckets[-1]
        bucket = _Bucket(now)
        self._buckets.append(bucket)
        return bucket

    def record(self, *, duration_ms: float, status_code: int, method: str, path: str) -> None:
        bucket = self._current_bucket()
        bucket.requests += 1
        if len(bucket.latencies) < MAX_SAMPLES_PER_BUCKET:
            bucket.latencies.append(duration_ms)
        if status_code >= 400:
            bucket.errors += 1
        if status_code >= 500:
            bucket.server_errors += 1
            # Only 5xx go to the incident feed. 4xx are usually the client's
            # problem and would drown the signal an operator is looking for.
            self._recent_errors.append({
                "at": time.time(),
                "method": method,
                "path": path,
                "status": status_code,
                "durationMs": round(duration_ms, 1),
            })

    def _window(self, seconds: int) -> List[_Bucket]:
        cutoff = int(time.time()) - seconds
        return [b for b in self._buckets if b.second > cutoff]

    def snapshot(self, seconds: int = 60) -> Dict[str, object]:
        buckets = self._window(seconds)
        total = sum(b.requests for b in buckets)
        errors = sum(b.errors for b in buckets)
        server_errors = sum(b.server_errors for b in buckets)

        latencies: List[float] = []
        for b in buckets:
            latencies.extend(b.latencies)
        latencies.sort()

        def percentile(p: float) -> Optional[float]:
            if not latencies:
                return None
            idx = min(int(len(latencies) * p), len(latencies) - 1)
            return round(latencies[idx], 1)

        return {
            "windowSeconds": seconds,
            "requestsPerSecond": round(total / seconds, 2) if seconds else 0.0,
            "totalRequests": total,
            "errorCount": errors,
            "serverErrorCount": server_errors,
            "errorRate": round(errors / total, 4) if total else 0.0,
            "p50Ms": percentile(0.50),
            "p95Ms": percentile(0.95),
            "p99Ms": percentile(0.99),
        }

    def series(self, seconds: int = 60) -> List[dict]:
        """Per-second series for sparklines. Gaps are filled with zeroes so
        the client can render a continuous line without interpolating."""
        now = int(time.time())
        by_second = {b.second: b for b in self._window(seconds)}
        out: List[dict] = []
        for sec in range(now - seconds + 1, now + 1):
            bucket = by_second.get(sec)
            out.append({
                "t": sec,
                "requests": bucket.requests if bucket else 0,
                "errors": bucket.errors if bucket else 0,
            })
        return out

    def recent_errors(self) -> List[dict]:
        return list(reversed(self._recent_errors))


metrics = RequestMetrics()

_publish_task: Optional[asyncio.Task] = None


async def publish_snapshot() -> None:
    """Publishes this process's rolling window to Redis under a short TTL,
    so a replica that dies drops out of the aggregate instead of lingering."""
    from app.realtime import get_redis
    try:
        r = await get_redis()
        payload = {
            "instance": INSTANCE_ID,
            "metrics": metrics.snapshot(60),
            "series": metrics.series(60),
            "recentErrors": metrics.recent_errors()[:20],
        }
        await r.set(f"{PUBLISH_KEY_PREFIX}{INSTANCE_ID}", json.dumps(payload), ex=PUBLISH_TTL_SECONDS)
    except Exception as e:
        logger.debug("Could not publish metrics snapshot: %s", e)


async def aggregate_cluster() -> Dict[str, object]:
    """Merges every live process's published window into one view.

    Counts sum cleanly. Percentiles do not — merging p95s is not
    mathematically valid — so the worst p95 across instances is reported
    and labelled as such. For an operations dashboard, "the slowest replica
    is at 900ms" is the useful and honest answer; a fabricated blended
    figure would be neither.
    """
    from app.realtime import get_redis

    instances: List[dict] = []
    try:
        r = await get_redis()
        for key in await r.keys(f"{PUBLISH_KEY_PREFIX}*"):
            raw = await r.get(key)
            if raw:
                instances.append(json.loads(raw))
    except Exception as e:
        logger.debug("Could not read cluster metrics: %s", e)

    # Always include this process, even if Redis is unreachable — a console
    # that shows nothing because Redis is down is useless precisely then.
    if not any(i.get("instance") == INSTANCE_ID for i in instances):
        instances.append({
            "instance": INSTANCE_ID,
            "metrics": metrics.snapshot(60),
            "series": metrics.series(60),
            "recentErrors": metrics.recent_errors()[:20],
        })

    total = sum(i["metrics"]["totalRequests"] for i in instances)
    errors = sum(i["metrics"]["errorCount"] for i in instances)
    server_errors = sum(i["metrics"]["serverErrorCount"] for i in instances)

    def worst(field: str) -> Optional[float]:
        values = [i["metrics"].get(field) for i in instances if i["metrics"].get(field) is not None]
        return max(values) if values else None

    # Series are per-second and aligned on wall-clock seconds, so they sum.
    series_by_t: Dict[int, dict] = {}
    for inst in instances:
        for point in inst.get("series", []):
            acc = series_by_t.setdefault(point["t"], {"t": point["t"], "requests": 0, "errors": 0})
            acc["requests"] += point["requests"]
            acc["errors"] += point["errors"]

    recent: List[dict] = []
    for inst in instances:
        recent.extend(inst.get("recentErrors", []))
    recent.sort(key=lambda e: e.get("at", 0), reverse=True)

    return {
        "metrics": {
            "windowSeconds": 60,
            "requestsPerSecond": round(total / 60, 2),
            "totalRequests": total,
            "errorCount": errors,
            "serverErrorCount": server_errors,
            "errorRate": round(errors / total, 4) if total else 0.0,
            "p50Ms": worst("p50Ms"),
            "p95Ms": worst("p95Ms"),
            "p99Ms": worst("p99Ms"),
            "latencyIsWorstInstance": len(instances) > 1,
            "instanceCount": len(instances),
        },
        "series": [series_by_t[t] for t in sorted(series_by_t)],
        "recentErrors": recent[:50],
    }


async def _publish_loop() -> None:
    while True:
        try:
            await asyncio.sleep(PUBLISH_INTERVAL_SECONDS)
            await publish_snapshot()
        except asyncio.CancelledError:
            raise
        except Exception as e:
            logger.debug("Metrics publish skipped: %s", e)


def start_publish_task() -> None:
    global _publish_task
    if _publish_task is None:
        _publish_task = asyncio.create_task(_publish_loop())


def stop_publish_task() -> None:
    global _publish_task
    if _publish_task is not None:
        _publish_task.cancel()
        _publish_task = None
