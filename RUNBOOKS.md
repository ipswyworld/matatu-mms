# Runbooks & Dependency Fallback Behavior (Task 26)

## Dependency fallback matrix

| Dependency | What breaks if it's down | Actual fallback behavior | Where |
|---|---|---|---|
| **Postgres** | Everything — no fallback. | App fails to start (`get_db` dependency raises on every request); Render/Docker health check fails, container restarts. No degraded mode exists or should exist for the primary datastore. | `app/database.py` |
| **Redis** | Rate limiting, real-time fan-out (GPS/dashboard/notifications), durable events, ARQ queue, login throttling, session revocation. | Rate limiter: falls back to `memory://` only in SQLite/dev mode — **in Postgres/prod mode, a Redis outage means rate limiting fails; check whether slowapi fails open or closed before relying on this in an incident.** Real-time pub/sub (`app/realtime.py`): `publish()` catches and logs, never raises — live map/dashboard just stops updating, doesn't crash requests. Durable events (`app/streams.py`): `publish_event()` is the same fail-open pattern — an event is dispatched to in-process listeners regardless, just not durably recorded. ARQ worker: can't enqueue or process jobs; falls back to nothing (jobs simply don't run) until Redis returns. Login throttle (`app/login_throttle.py`) and session revocation (`app/session_revocation.py`) both fail open with a logged warning — an outage lets logins through unthrottled and skips the revocation check, rather than locking everyone out. **Live-drilled (2026-09-17)**: ran a real backend instance against an unreachable Redis (not the shared dev Redis, a throwaway pointed at a closed port) and exercised login, a plain read, and issuing a fine (which touches the ledger, the durable-event publish, and the real-time publish, all in one request) — every path degraded exactly as described above, nothing 500'd. Log lines confirming this: `app.login_throttle` "Login throttle read failed, allowing attempt", `app.session_revocation` "Failed to check session revocation ... — failing open", `app.realtime` "Redis publish to dashboard:broadcast failed — real-time fan-out degraded for this event". | `app/rate_limit.py`, `app/realtime.py`, `app/streams.py`, `app/worker.py`, `app/login_throttle.py`, `app/session_revocation.py` |
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

#### Finding the last known-good SHA and rolling back to it (Render deploys)

Render's auto-deploy watches `deploy/render-demo` — there is no "one-click
previous version" without knowing which commit that was, so this is the
actual sequence, not just "revert and push":

1. `git log --oneline deploy/render-demo -20` — find the last commit that
   deployed and was confirmed healthy. Render's own dashboard (Deploys tab,
   per service) also lists every past deploy with its commit SHA and
   whether it succeeded — cross-check there if recent history is unclear
   locally, since a deploy can fail on Render's side even for a commit
   that built and tested cleanly here.
2. One command back, without rewriting history (never force-push
   `deploy/render-demo` — that branch is what production watches, and a
   force-push race with an in-flight deploy is exactly the kind of thing
   this section exists to avoid):
   ```
   git revert --no-edit <bad-sha>..HEAD
   git push origin deploy/render-demo
   ```
   For a single bad commit, `git revert --no-edit <bad-sha>` alone is
   enough. Render redeploys automatically on the push, same as any other
   commit — there is no separate "rollback" action in Render for a
   git-connected service.
3. Confirm the rollback actually deployed (Render dashboard shows the new
   deploy's SHA matching what was just pushed, not the reverted one) before
   declaring the incident over — a revert commit that itself fails to
   build leaves the previous (bad) deploy still live.

### Suspected PII leak in a data-handling path (erasure, export, anonymization)

Synthesized from a real incident this session: an early version of the
DPA erasure path (`app/data_rights.py`) looked up consent records by the
wrong key and left a subject's actual phone number in the database after
"successful" erasure. It passed code review; it did not survive being
actually run.

1. **Don't trust the code path's own success response.** The bug above
   returned a normal 200 — the failure was silent by construction (wrong
   key means "no rows matched", not an error). Whatever the endpoint
   claims to have done, query the actual row afterward and check the
   field is gone/changed.
2. Reproduce against a real (non-empty, ideally close-to-production-shape)
   dataset, not a freshly-seeded one where every foreign key happens to
   line up by construction — the wrong-key bug above only surfaced once a
   real subject with real linked records was run through it.
3. Once confirmed: identify every row this leak could have touched (grep
   for the same lookup pattern elsewhere — a wrong-key bug in one function
   is rarely unique to that one function) before fixing just the reported
   instance.
4. Fix, then **prove it** by re-running the exact same erasure call and
   inspecting the row directly — the standard this session already set:
   found by actually running the function, not by reading the diff.
5. Assess disclosure obligations under the DPA policy (`BACKUP_RECOVERY_
   POLICY.md`) once the scope (which subjects, which fields, how long
   exposed) is known — that's a legal/compliance decision, not an
   engineering one, and shouldn't wait on the rest of this runbook to
   start being considered.

### Rate limiting / IP-based logic misbehaving behind Cloudflare → Render

Synthesized from a real incident this session: the login rate limiter and
the ops console's network gate both keyed on `request.client.host`, which
uvicorn populates from the **last** entry of `X-Forwarded-For` — behind
Cloudflare → Render, that's an internal proxy hop's address, shared by
every user routed through it, not the actual client.

1. **Symptom pattern:** a rate limit or CIDR gate that either blocks
   unrelated users together (they're sharing an apparent "IP") or fails to
   distinguish anyone at all.
2. Confirm directly against `login_events` (or equivalent request logs) —
   look for a suspicious concentration of one address, especially an
   RFC1918 (private) one, across many distinct real users. That's what
   proved this bug; it wasn't found by reading the rate-limiter code in
   isolation.
3. Fix by preferring `CF-Connecting-IP` (`app/client_ip.py`) — trusted and
   unspoofable behind Cloudflare — over blind trust in `X-Forwarded-For`
   ordering, which depends on every hop in front of the app behaving and
   on no infra change silently reordering it later.
4. This is an infra-coupled assumption, not a one-time fix: if the proxy
   chain in front of the backend ever changes (a different CDN, Cloudflare
   config change, added hop), re-verify which header/position actually
   carries the real client IP before assuming the existing fix still
   applies.

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
