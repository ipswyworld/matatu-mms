# Runbooks & Dependency Fallback Behavior (Task 26)

## Dependency fallback matrix

| Dependency | What breaks if it's down | Actual fallback behavior | Where |
|---|---|---|---|
| **Postgres** | Everything — no fallback. | App fails to start (`get_db` dependency raises on every request); Render/Docker health check fails, container restarts. No degraded mode exists or should exist for the primary datastore. | `app/database.py` |
| **Redis** | Rate limiting, real-time fan-out (GPS/dashboard/notifications), durable events, ARQ queue. | Rate limiter: falls back to `memory://` only in SQLite/dev mode — **in Postgres/prod mode, a Redis outage means rate limiting fails; check whether slowapi fails open or closed before relying on this in an incident.** Real-time pub/sub (`app/realtime.py`): `publish()` catches and logs, never raises — live map/dashboard just stops updating, doesn't crash requests. Durable events (`app/streams.py`): `publish_event()` is the same fail-open pattern — an event is dispatched to in-process listeners regardless, just not durably recorded. ARQ worker: can't enqueue or process jobs; falls back to nothing (jobs simply don't run) until Redis returns. | `app/rate_limit.py`, `app/realtime.py`, `app/streams.py`, `app/worker.py` |
| **TomTom (maps/routing)** | Map tiles, route geometry calls. | Not yet wired with a circuit breaker specifically — a TomTom outage would surface as failed tile loads / blank map areas in the frontend. No server-side dependency on TomTom for core booking/fare flows (those use BRN-digitized Stage/RouteStage data, not live TomTom calls). | Frontend `GisMap.tsx` |
| **NTSA IRMS** | Nothing today — **not integrated yet** (§9.1, genuinely blocked on external access, see `NTSA_IRMS_INTEGRATION_CHECKLIST.md`). | N/A until it exists. When built, the plan is: adapter pattern + circuit breaker (`app/resilience.py`) + poll-into-store rather than live-per-request calls, so an IRMS outage degrades to "positions stop updating" rather than blocking requests. | Planned, not built |
| **NairobiPay** | Fine payment confirmation. | Inbound webhook callback only (`payments.py`) — if NairobiPay's systems are down, callbacks simply don't arrive; fines stay `PENDING` until they do. No outbound synchronous dependency on NairobiPay in the request path. | `app/routes/payments.py` |
| **Sentry** | Error tracking/alerting. | SDK is fail-open by design (never blocks the request it's instrumenting) — a Sentry outage means errors aren't reported, not that requests fail. | `sentry_sdk` init in `app/main.py` |
| **Webhook delivery targets** (operator-configured) | Nothing on our side — outbound only. | Circuit breaker per subscription (`app/listeners.py`'s `subscription_breakers`) — after 3 failures, that specific subscription's breaker opens for 30s and further attempts are rejected fast rather than retried into a dead endpoint. **Known limitation (§4.3): breaker state is in-process only — resets on restart, not shared across replicas**, so it doesn't mean what it appears to mean once this runs multi-instance. | `app/listeners.py`, `app/resilience.py` |
| **ARQ task worker** | Anything routed through it (currently just the standalone `deliver_webhook_job` — see `app/worker.py` docstring for what's NOT yet migrated onto it). | Runs in-process, started at app startup in Postgres mode. If the worker task dies (uncaught exception outside its own try/except), enqueued jobs pile up unprocessed until the next deploy restarts it — **no separate alerting on worker-task death exists yet**; this is a real gap, not a designed fallback. | `app/worker.py`, `app/main.py` lifespan |
| **OpenTelemetry collector** | Distributed tracing. | Deliberately fails open by design, not by accident: if `OTEL_EXPORTER_OTLP_ENDPOINT` is unset (current default — no collector deployed), spans are created but never exported; zero behavior change to the app either way. | `app/tracing.py` |

## Incident runbooks

### Backend won't start after a deploy

1. Check `render logs` (or `docker compose logs backend`) for the actual startup error —
   this project's discipline is `set -e` in `docker-entrypoint.sh`, so a failed migration
   or a Python import error both surface here immediately, not as a silent crash-loop.
2. **Most likely cause: a migration failure.** Look for `alembic.runtime.migration` lines.
   If the error is `relation already exists` or `current transaction is aborted`, the
   migration isn't idempotent against a retry — see the `enable_timescaledb` migration's
   commit history for the exact pattern of fix (raw `IF NOT EXISTS` DDL,
   `autocommit_block()` isolation per risky step).
3. If it's a Python import/syntax error, the previous deploy is still live (Render keeps
   the last successful deploy running until a new one succeeds) — no live outage, but the
   fix needs to land before any further changes can ship.
4. Roll back: revert the offending commit and push again, or (self-hosted docker-compose
   path only) use `scripts/canary-promote.sh 0` if a canary is in flight.

### Webhook deliveries all failing for one Sacco

1. Check `GET /api/webhooks/logs?sacco_id=...` for the actual `error_message` on recent
   attempts.
2. If it's `"Execution blocked: Circuit Breaker is OPEN"`, the target has failed 3 times
   in the last 30s-recovery-window — this is working as designed, not a bug. Confirm the
   operator's endpoint is actually reachable before assuming a system problem.
3. If deliveries were fine and stopped abruptly across *all* subscriptions at once,
   suspect Redis (durable-event publish failing) or the backend process having restarted
   (in-process breaker state reset) rather than the individual targets.

### Database connection pool exhausted

1. Symptom: requests hang or time out under load, no application-level error.
2. This project has no PgBouncer yet (`DATA_LAYER_SCALING_STATUS.md` — blocked on Render
   plan tier). At current single-instance scale this shouldn't occur under normal traffic;
   if it does, check for a connection leak (a session opened without the `async with`
   pattern, or a background task holding a session open across an `await` that never
   returns) rather than assuming it's a load problem.

### Live map / GPS tracking stopped updating

1. Check Redis connectivity first (`redis-cli ping` against the configured `REDIS_URL`) —
   this is the most common cause per the fallback matrix above.
2. Confirm the durable event consumer and ARQ worker tasks are still alive — check for
   `"Durable event consumer started."` / `"ARQ task worker started."` in the most recent
   startup logs; if the consumer loop's `except Exception` branch is repeatedly logging
   `"Event consumer loop error"`, Redis is reachable but something else is wrong (auth,
   stream/group state) — see `app/streams.py`'s `consume_events_forever`.
3. Vehicle positions are also durably written to `vehicle_positions` (Task 11) regardless
   of the live pub/sub path — a query against that table confirms whether ingest itself is
   working even if the live map display isn't.

## Not done in this pass

A full disaster-recovery runbook (database restore drill, RPO/RTO-driven procedures) is
Task 28's scope, not duplicated here — see `BACKUP_RECOVERY_POLICY.md` once written.
