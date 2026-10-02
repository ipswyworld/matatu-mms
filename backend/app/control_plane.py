"""
Ops control plane — separate process, same codebase (Ops Console Rebuild
Spec §3.1, Path A).

Run with:
    uvicorn app.control_plane:app --host 0.0.0.0 --port 8001

Why this exists: in the single-process deployment every ops request is
served by the same FastAPI app that serves all public traffic, so during
saturation the console queues behind 500k users and fails precisely during
the incident it exists for. Running the control endpoints in their own
process gives them their own event loop, their own database connection
pool, and their own resource limits, so an operator can still act while the
main API is overwhelmed.

Deliberately the *same codebase* rather than a new service: it reuses the
existing models, RBAC, ABAC, audit, and control-route code with zero
duplication, and the split is a deployment decision rather than a rewrite.
Only the entrypoint differs.

What this process does NOT run, and why:
  * The ARQ worker — the main app owns job execution. Two workers pulling
    the same queue would double-execute jobs.
  * The realtime broadcasters — they serve user-facing WebSockets, which
    this process has no clients for.
  * The durable event consumer — same reason; it would compete with the
    main app for the same stream.
  * User-facing routers — this process is not a public API and must not
    become one. It exposes only /api/control plus a health check.

It still needs the ops state modules, because it both reads and writes
them, and they are how it reaches the app processes (Redis-mirrored rate
limits, breaker overrides, system controls).

Deployment note: this must NOT be exposed publicly. On Kubernetes it is a
Deployment with no public ingress; on the current Render setup it would be
a private service. The ops app reaches it via CONTROL_PLANE_URL.
"""
import asyncio
import logging
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

import os

from app.database import AsyncSessionLocal, engine
from app.rate_limit import limiter
from app import client_ip, network_gate
from app.routes.control import router as control_router

logger = logging.getLogger("app.control_plane")

START_TIME = time.time()


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Control plane starting...")

    from app import ops_breakers, ops_controls, ops_limits, ops_metrics

    # Seed from Postgres before serving, so a restarted control plane does
    # not briefly report coded defaults as if they were the live values.
    async with AsyncSessionLocal() as session:
        await ops_limits.load_from_db(session)
        await ops_controls.load_from_db(session)

    await ops_breakers.load_overrides()
    ops_limits.start_refresh_task()
    ops_controls.start_refresh_task()
    ops_breakers.start_refresh_task()
    # Note: no metrics *publish* task here. This process serves no user
    # traffic, so publishing its own near-zero window would dilute the
    # cluster aggregate. It only reads what the app processes publish.

    # The network gate's state is logged at startup so an operator can see
    # whether this control is actually in force, rather than assuming it.
    network_gate.log_startup_status()

    logger.info("Control plane ready.")
    yield

    logger.info("Control plane shutting down...")
    ops_limits.stop_refresh_task()
    ops_controls.stop_refresh_task()
    ops_breakers.stop_refresh_task()

    from app.realtime import close_redis
    await close_redis()
    await engine.dispose()
    logger.info("Control plane shutdown complete.")


app = FastAPI(
    title="Mji-Move — Ops Control Plane",
    description=(
        "Internal operations control plane. Not a public API: exposes only "
        "the ops console's read and action endpoints, in its own process so "
        "it stays responsive when the main API is saturated."
    ),
    version="1.0.0",
    lifespan=lifespan,
    # No public docs — this is an internal surface and its endpoint list is
    # not something to advertise.
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)


@app.middleware("http")
async def enforce_network_gate(request: Request, call_next):
    """Rejects requests from outside the configured allowlist.

    The application-layer backstop for the period before the control
    plane has no public ingress at all. /healthz is exempt: a liveness
    probe comes from the cluster, and gating it would make the pod look
    dead and get it restarted in a loop.
    """
    if request.url.path not in ("/healthz",):
        # Resolved the same way the rate limiter does. Gating on
        # request.client.host would compare an allowlist against a proxy
        # address, which either admits everyone behind it or nobody.
        client_host = client_ip.resolve(request)
        if not network_gate.is_allowed(client_host):
            logger.warning(
                "Blocked ops control plane request from %s to %s",
                client_host, request.url.path,
            )
            # 404 rather than 403: a 403 confirms something worth
            # attacking is here. An unreachable console should look
            # like nothing at all.
            return JSONResponse(status_code=404, content={"detail": "Not found"})
    return await call_next(request)


@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains"
    return response


# Only the ops console origin, from OPS_CORS_ORIGINS. Narrower than the main
# app's CORS deliberately: the staff and public apps have no business calling
# the control plane, so they are not allowed to.
#
# In the normal deployment the ops app calls this server-side anyway (its
# Next.js route handlers hold the session), so CORS is a backstop rather than
# the primary path.
_ops_origins = [o.strip() for o in os.getenv("OPS_CORS_ORIGINS", "").split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_ops_origins or ["http://localhost:3002", "http://127.0.0.1:3002"],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

app.include_router(control_router)


@app.get("/healthz", include_in_schema=False)
async def healthz():
    """Liveness for the control plane itself.

    Intentionally does not check Postgres or Redis: this endpoint answers
    "is the control plane process alive", and a probe that fails because a
    dependency is down would get the control plane restarted at exactly the
    moment an operator needs it. Dependency health is what
    /api/control/overview reports.
    """
    return {"status": "ok", "role": "control-plane", "uptimeSeconds": round(time.time() - START_TIME, 1)}
