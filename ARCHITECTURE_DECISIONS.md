# Architecture & Platform Decisions

Decision record for the Nairobi City County Matatu Management System (matatu-mms).

**Status:** agreed direction, not yet implemented unless noted.
**Last updated:** 2026-08-11

---

## 0. Scope context

The system is being built against Nairobi's **new** Bus Route Network (BRN), defined in
*Bus Route Network Plan for Nairobi — Final Report (Nov 2023)*, NTU International A/S for
NCCG Mobility & Works, EU/ISKTS-funded.

Planning figures that drive every sizing decision below:

| Figure | Value |
|---|---|
| Routes (county + inter-county) | 120 |
| Buses required at peak hour | ~3,500 |
| Route headways | 3–10 min |
| Initial vehicle capacity | ~40 seats (policy target 51+) |
| Share of corridor travel demand carried | ~80% |

**The new BRN is mandatory scope.** Existing open datasets (e.g. Digital Matatus GTFS)
describe the *current* network and may supplement, but never replace, this plan.

---

## 1. Confirmed decisions

### 1.1 Payments — NairobiPay only

**NairobiPay is the sole payment rail. M-Pesa / Safaricom Daraja is permanently excluded**
and must not be proposed as an option, fallback, or comparison.

Current state: `backend/app/routes/payments.py` is a stub awaiting real API credentials.
NairobiPay does not sign its callback payloads, so authenticity rests on the secret path
segment (`NAIROBIPAY_CALLBACK_SECRET`) — see the blocker in §5.1.

### 1.2 Spatial data — adopt PostGIS

Approved. PostGIS is server-side storage and query; TomTom is client-side rendering.
They never interact directly — PostGIS emits GeoJSON, which MapLibre/TomTom consumes
natively. No compatibility risk.

Enables: nearest-stage lookup, "vehicles within N metres of this stage", and route-corridor
containment tests for adherence monitoring (§1.6).

### 1.3 Route model — variants and direction are first-class

Table 5 of the BRN report carries a separate **"Routing on Return Journey Thro CBD"**
column, which proves inbound and outbound paths are asymmetric. The data model must
represent:

- **Direction** explicitly (inbound / outbound are not mirror images).
- **Variants** as first-class entities, not naming convention: `2A, 18A, 27A, 33A, 36A,
  49A, 59A, 63A, 76A, 89B, 89C`.
- **Corridor** as a grouping attribute. Map colours encode the arterial road (Ngong Rd,
  Juja Rd, Jogoo Rd, Argwings Kodhek, Waiyaki Way / Lower Kabete, James Gichuru, Limuru Rd,
  Thika / Kiambu Rd, Mombasa Rd), *not* route identity. Orbital routes are uncoloured.
- **Provisional route numbers.** Report §5.3.4 states the serial numbers are for expediency
  and a permanent NMA-wide numbering scheme is still required. Use surrogate primary keys;
  treat the displayed route number as mutable metadata.

### 1.4 Fare charts — structured data, never PDF blobs

Operators must upload a fare chart at licence registration. That upload is **parsed into
structured fare-stage records**; storing the PDF alone delivers no intelligence.

`pdfplumber` is already a backend dependency and covers this.

**Open tension to resolve:** the BRN report recommends the county set seasonal ticket
tariffs uniformly across all PSVs irrespective of vehicle size. If county policy sets
tariffs, operator-submitted charts must be *validated against* that policy rather than
treated as authoritative. Decide which is source of truth before building.

### 1.5 Vehicle positioning — NTSA IRMS primary, phone GPS secondary

- **Primary:** NTSA IRMS APIs (availability assumed, not yet confirmed).
- **Secondary:** browser geolocation from the crew device.
- **Platform:** web app for now. Native mobile is a later phase.

See §5.2 — browser geolocation has hard limits that materially affect this strategy.

### 1.6 Route-adherence monitoring — accepted

With defined route geometry plus live positions, deviation detection becomes automatic.
Implementation: store each route corridor as a buffered polygon in PostGIS; a position
outside the buffer for longer than a tolerance window raises a deviation event. Cheap with
a GiST index.

### 1.7 USSD / SMS fallback — accepted

A passenger pickup product that requires a smartphone excludes a large share of riders.
USSD/SMS is a first-class access channel, not a nice-to-have.

### 1.8 Offline-tolerant crew app — deferred

Connectivity along these corridors is unreliable; the crew app must queue and sync rather
than fail. **Deferred to the native mobile app phase** — not applicable to the current web
app.

---

## 2. Service architecture — modular monolith with two carve-outs

**Do not adopt microservices.** At current team size the distributed tax — tracing, partial
failure, cross-service transactions, deploy orchestration — buys nothing.

### 2.1 The monolith

Keep the FastAPI application as a **modular monolith** with hard internal boundaries:

```
licensing · fleet · enforcement · revenue · routing · bookings
```

Each module owns its tables and is reached through a service interface. No module reaches
into another's ORM models. This keeps future extraction mechanical rather than archaeological.

### 2.2 Carve-out 1 — Telemetry ingest

**Split this out early.** 3,500 buses at a 5-second ping is roughly **700 writes/sec
sustained, ~60M rows/day**.

It shares nothing with the CRUD application:

| | Telemetry | Business app |
|---|---|---|
| Scaling curve | Write-heavy, linear in fleet size | Request-driven |
| Durability need | A dropped GPS ping is acceptable | A dropped payment is not |
| Failure blast radius | Should be isolated | — |

Sharing a process means a telemetry spike takes down operator registration.

### 2.3 Carve-out 2 — Real-time WebSocket gateway

The FastAPI app currently holds WebSocket connections directly. Long-lived stateful
connections pin memory, and — the real problem — **every deploy drops every connected
passenger's live map**.

Split the gateway out and back fan-out with Redis, so business logic can ship continuously
without interrupting live tracking.

### 2.4 Everything else

Stays in the monolith until it demonstrably hurts.

---

## 3. Data layer

| Component | Decision | Rationale |
|---|---|---|
| **PostGIS** | Adopt | §1.2 |
| **TimescaleDB** | Adopt for GPS history | Postgres extension, so it coexists with PostGIS in one engine. Hypertables, native compression, retention policies. A plain table will not survive 60M rows/day. |
| **PgBouncer** | Adopt, transaction mode | Async FastAPI across multiple replicas exhausts Postgres connections fast. The most common way this stack falls over in production. |
| **Read replica** | Adopt | Monitoring-centre dashboards and analytics must not contend with the telemetry write path. |

---

## 4. Event backbone and durable jobs

### 4.1 The current risk

`backend/app/events.py` dispatches via `asyncio.create_task` and swallows failures into a
log line. Fire-and-forget: no retry, no durability. A process restart mid-dispatch
**silently loses the event**. For audit logs, notifications, and payment callbacks that is
data loss, not a performance concern.

### 4.2 The fix — two layers

1. **Redis Streams** (not pub/sub) for telemetry and cross-service events — persistence,
   consumer groups, replay.
2. **A real task queue.** ARQ fits the async stack best (Redis-backed, FastAPI-native);
   Celery if the larger ecosystem is wanted. Route through it: fare-chart parsing, TomTom
   routing calls for route geometry, report generation, notification delivery — each with
   retries and a dead-letter path.

### 4.3 Caveat on existing resilience helpers

`backend/app/resilience.py` provides a circuit breaker and retry, but both hold state
**in-process only**. State resets on restart and is not shared across replicas. Acceptable
today; they will not mean what they appear to mean once running multi-replica.

---

## 5. Blockers before horizontal scaling

### 5.1 Per-process secret generation breaks multi-replica

`backend/app/config.py` generates a random `SECRET_KEY` (line 29) and a random
`NAIROBIPAY_CALLBACK_SECRET` (line 55) when the env vars are unset.

This is a deliberate, well-reasoned choice for local development, and the code comments
explain why. **The failure mode changes qualitatively at multi-replica:**

- A JWT signed by replica A **will not validate on replica B** — users get random,
  intermittent auth failures rather than a clean error.
- Each replica advertises a **different** NairobiPay callback secret, so callbacks succeed
  or 404 depending on which replica they land on.

**Both env vars must be explicitly set and identical across all replicas** before running
more than one instance. Treat as a hard prerequisite, not a warning.

### 5.2 Browser geolocation cannot track a backgrounded web app

Per §1.5 the platform is a web app for now. Browser geolocation **stops when the tab is
backgrounded or the device screen locks**, and on iOS Safari background positioning is
effectively unavailable to a PWA.

A web-only crew-tracking strategy will therefore have coverage gaps whenever the driver
locks their phone — which is most of the time. Implications:

- Treat **NTSA IRMS as the load-bearing source**, with phone GPS as opportunistic fill-in.
- A Screen Wake Lock plus a foreground "on shift" screen is best-effort mitigation, not a
  fix.
- If continuous positioning turns out to be a hard product requirement, that is an argument
  for the native app phase, and it should be surfaced early rather than discovered in pilot.

---

## 6. Load balancing and edge

- **Keep nginx** (or move to Traefik for dynamic service discovery). Run **multiple backend
  replicas** behind it — there is exactly one today.
- **No sticky sessions for WebSockets.** With fan-out through Redis, any node can serve any
  client — that is the point of the gateway split (§2.3). Session affinity makes scaling and
  connection draining worse.
- Set **generous WS idle timeouts** and enable **connection draining** on deploy.
- **Split traffic pools:** passenger-facing (untrusted, spiky, aggressive rate limits) vs
  county/operator admin (authenticated, predictable). A passenger-side surge must not
  starve enforcement officers.
- **Add rate limiting — there is none today.** Minimum coverage: auth endpoints, booking /
  pickup requests, and the NairobiPay callback.

---

## 7. Orchestration

**Docker Compose is the current ceiling.** No rolling deploys, no health-based
rescheduling, no horizontal autoscaling.

For 3,500 vehicles and public passenger traffic a real orchestrator is required. Given team
size, prefer a **managed container platform over hand-rolled Kubernetes** — self-managed k8s
operational burden competes directly with shipping features.

---

## 8. Observability

Already in place: Prometheus, Alertmanager, Grafana, Sentry, JSON structured logging.

**Missing and mandatory once services split: OpenTelemetry tracing.** The moment telemetry
ingest and the WS gateway are separate processes, *"why was this passenger's ETA wrong"*
stops being answerable from logs alone. Far cheaper to add before the split than after.

---

## 9. External service dependencies

### 9.1 NTSA IRMS — treat as hostile infrastructure

IRMS is a government API outside our control, and the entire tracking premise depends on it.

- Wrap it in an **adapter / anti-corruption layer** so its data model never leaks into the
  domain model.
- **Cache aggressively.**
- **Circuit-break it** using the existing `resilience.py` breaker.
- **Never place IRMS latency in a user request path.** Poll into our own store; serve users
  from that store.

**Critical unknown to establish before design is locked: IRMS update frequency.** If IRMS
refreshes on a 30-second cycle, the "live" map is 30 seconds stale, which directly limits
what can honestly be promised to passengers about arrival times. Confirm this before
building ETA features on top of it.

### 9.2 TomTom — design the cost model now

| Call type | Frequency | Strategy |
|---|---|---|
| Route geometry snapping | One-time, 120 routes | Snap once, **store the polyline permanently**. Cacheable forever. |
| Per-passenger ETA | Scales with user count | **Do not call TomTom per request.** |

Compute ETAs internally from vehicle position plus progress along the stored route
polyline. Use TomTom only for traffic-aware correction, not as the primary ETA engine.
Decide this before the API bill forces the decision.

---

## 10. Compliance and data protection

**Kenya Data Protection Act 2019 applies.** Continuous GPS traces of named drivers, plus
passenger pickup requests, are personal data. A county government system performing
location tracking sits squarely in DPIA territory.

Required:

- **Documented retention limits** for location history. TimescaleDB retention policies
  (§3) are the enforcement mechanism, but the retention *period* is a deliberate policy
  decision, not a technical default.
- **Purpose limitation** — location data collected for service operation must not be
  silently repurposed.
- **Access controls on trace history** — who may query an individual driver's movement
  history, and is that access itself audited?

Decide these explicitly rather than inheriting whatever the database happens to keep.

---

## 11. Resilience, capacity and testing

### 11.1 Explicit backpressure on telemetry ingest

Decide **in code** what happens when ingest cannot keep up. GPS pings are droppable by
design — make that explicit:

- Bounded queue with **drop-oldest** semantics.
- A **dropped-pings metric** exported to Prometheus.

The failure to avoid is unbounded queueing into an OOM kill.

### 11.2 Telemetry load generator

700 writes/sec behaviour cannot be discovered on a development machine. Build a **synthetic
fleet simulator** — deliberately separate from production, unlike the fake movement
correctly removed from `GisMap.tsx` — to soak-test ingest, the WebSocket gateway, and
stage-capacity logic **before** a pilot rather than during one.

### 11.3 Zero-downtime schema migration discipline

Alembic against a hypertable ingesting 60M rows/day is unforgiving: a blocking
`ALTER TABLE` is an outage.

- Adopt **expand/contract** as standard practice.
- No long-held locks, no blocking rewrites on large tables.
- Add a **migration review gate** in CI (§14) before reaching scale.

This discipline is also a hard prerequisite for blue/green deploys (§13), where two
application versions run against one database simultaneously.

---

## 12. Security defence-in-depth

**Adopt Postgres row-level security.** The existing ABAC layer (`backend/app/abac.py`) is
solid, but with many operators sharing one database, RLS ensures a single ORM query bug
cannot leak operator A's fleet to operator B.

App-tier authorisation and database-tier isolation should both hold independently. For a
multi-tenant government system the second layer justifies its cost.

See also §6 for rate limiting, which is currently absent entirely.

---

## 13. Deployment strategy — blue/green and canary

### 13.1 Current state

`nginx/nginx.conf` defines single-server upstreams:

```nginx
upstream backend_upstream { server backend:8000; }
upstream frontend_upstream { ... }
```

One instance each, no weighting, no traffic-splitting capability. Every deploy is a hard
restart with downtime.

### 13.2 Two different problems needing two different mechanisms

The stateless API and the stateful WebSocket gateway **cannot share a cutover strategy**:

| Tier | Strategy | Reason |
|---|---|---|
| **Stateless API** (monolith, telemetry ingest) | **Weighted canary**, then full cutover | Requests are short-lived; shifting a percentage is safe and gives real production signal. |
| **WebSocket gateway** (§2.3) | **Drain-based rolling** — never an instant cut | Connections are long-lived. An instant switch drops every passenger's live map simultaneously. |

### 13.3 Blue/green requirements

Blue/green means two complete stacks with traffic switched between them. For this system
specifically:

- **The database is shared and does not get a colour.** Both versions run against one
  database, so **every migration must be backward-compatible with the previous release**
  (§11.3). This is non-negotiable — blue/green without expand/contract corrupts data
  during rollback.
- **Rollback must be a traffic switch, not a redeploy.** Keep the previous colour warm long
  enough to roll back instantly.
- **Health-gate the cutover** using existing endpoints (`/healthz` backend,
  `/api/health` frontend). Do not shift traffic on "container started" alone.
- **Connection draining** on the retiring colour, with generous WebSocket idle timeouts
  (§6).

### 13.4 Canary implementation

For the stateless tier, nginx supports weighted upstreams natively:

```nginx
upstream backend_upstream {
    server backend_blue:8000  weight=9;
    server backend_green:8000 weight=1;   # 10% canary
}
```

`split_clients` is the alternative when a **sticky** percentage split is wanted (same client
consistently routed to the same colour) rather than per-request weighting.

**Gate canary promotion on metrics, not on time.** Error rate and p99 latency from the
existing Prometheus setup should decide promotion or rollback automatically. A canary
nobody watches is just a slower deploy.

Note: an orchestrator (§7) provides all of this natively. Hand-rolling blue/green in
Docker Compose is possible but is largely reimplementing what the orchestrator gives free.

---

## 14. CI/CD

### 14.1 Current state

`.github/workflows/ci.yml` runs on push and PR to `master`/`main`:

- **Frontend** — `npx tsc --noEmit` + `npm run build`
- **Backend** — `python test_backend.py` boot-smoke suite (login, RBAC scoping, fine
  issuance + audit log, dispute, NairobiPay callback, webhook delivery)

**There is no CD.** No image build, no registry push, no deploy job, no environment gates.

### 14.2 The most important CI gap

**Tests run against SQLite; production runs on Postgres.**

`test_backend.py` deliberately uses a throwaway SQLite database so CI needs no services.
That proves the app *boots and its logic holds* — it does **not** prove it works on the
engine actually deployed. SQL dialect, transaction semantics, concurrency behaviour, and
locking all differ. The gap widens considerably once PostGIS and TimescaleDB are added
(§1.2, §3), since neither has any SQLite equivalent.

**Recommendation:** keep the fast SQLite suite as a pre-check, and add a second job running
the same suite against a **Postgres + PostGIS service container**. Spatial and time-series
code paths cannot be meaningfully tested any other way.

### 14.3 CI additions

| Check | Purpose |
|---|---|
| Postgres/PostGIS integration suite | §14.2 — the critical gap |
| Alembic migration up **and** down | Catch irreversible or blocking migrations before deploy (§11.3) |
| `pip-audit` / `npm audit` | Dependency CVEs |
| Container image scan (Trivy or Grype) | Base-image CVEs |
| Secret scanning (gitleaks) | Given per-process secret fallbacks (§5.1), leaked real secrets are a live risk |
| Lint / format (ruff, eslint) | Currently absent |
| `docker compose build` verification | CI never builds the images that actually ship |

### 14.4 CD pipeline shape

```
PR  →  lint + typecheck + unit + integration (Postgres/PostGIS) + migration check
    →  build & scan images  →  push to registry (immutable, git-SHA tagged)
    →  deploy to staging (automatic)  →  smoke tests
    →  deploy to production (manual approval)  →  canary 10%
    →  metric-gated promotion or automatic rollback
```

Principles:

- **Build once, promote the same artefact.** Never rebuild between staging and production —
  tag images by git SHA and promote that exact image.
- **Migrations run as a separate, explicit step**, not on application startup. Startup
  migrations race across replicas (§5.1 shows what multi-replica assumptions cost).
- **Staging must run Postgres + PostGIS + Redis**, matching production. Staging on SQLite
  would reproduce the §14.2 problem one environment later.
- **Production deploys require manual approval** — this is government infrastructure.

---

## 15. Security findings (confirmed in code)

### 15.1 Double sign-up — email normalisation is inconsistent

**Confirmed bug.** Email is normalised in some registration paths and not others:

| Location | Handling |
|---|---|
| `auth.py:23` — login | `User.email == credentials.email` — **raw** |
| `auth.py:88` — self-registration | `User.email == credentials.email` — **raw** |
| `saccos.py:126` — operator onboarding | `payload.email` — **raw** |
| `users.py:35`, `users.py:95` — admin user creation | `.lower().strip()` — normalised |
| `auth.py:152` — password reset | `.lower().strip()` — normalised |

`User.email` is `unique=True`, but **Postgres `varchar` uniqueness is case-sensitive**.
Consequences:

1. **Duplicate accounts.** `John@nairobi.go.ke` and `john@nairobi.go.ke` both register
   successfully — same human, two accounts, two audit trails.
2. **Silent login failure.** A user who registered as `John@…` and later types `john@…`
   gets *"Invalid email or password"*. Indistinguishable from a wrong password, and the
   same shape as the staff login loops fixed previously.
3. **Inconsistent collision behaviour.** An admin creating a user normalises; the same
   person self-registering does not. The two paths disagree about whether an account
   already exists.

**Fix:** normalise (`.lower().strip()`) at a single choke point — ideally a Pydantic
validator on the email field so no call site can forget — and add a **case-insensitive
unique index** (`CREATE UNIQUE INDEX ... ON users (lower(email))`) so the database enforces
it regardless of application code.

### 15.2 Registration is a check-then-insert race (TOCTOU)

Every registration path does `SELECT ... WHERE email = ?` and then `INSERT`. Two concurrent
requests can both pass the existence check; the second then violates the unique constraint
and raises an unhandled `IntegrityError` — surfacing as a **500** rather than the intended
400 *"User email already registered"*.

Low probability at current traffic, but it is exactly the class of bug that appears under
load and is untestable after the fact.

**Fix:** treat the database constraint as the source of truth. Keep the pre-check for a
friendly message, but wrap the insert and translate `IntegrityError` into the same 400.

### 15.3 Stored XSS via vehicle registration number

**Confirmed vector.** `components/GisMap.tsx` builds marker markup with `innerHTML`:

```
GisMap.tsx:66   el.innerHTML = `<span>🚐 ${reg}</span>...`
GisMap.tsx:203  el.innerHTML = `<span>🚐 ${v.reg_number}</span>...`
```

`reg_number` is **operator-controlled** — set at vehicle registration and via bulk import.
React escapes interpolated values by default; `innerHTML` bypasses that entirely. An
operator who registers a vehicle with markup in the plate field gets script execution in
the browser of **every user viewing the live map**, including county administrators. That is
stored XSS with privilege escalation potential.

**Fix:** build the marker with `document.createElement` + `textContent`, or render markers
through React. Never `innerHTML` with server-supplied data. Additionally, validate
`reg_number` against a strict plate pattern at the API boundary.

`app/layout.tsx:51` also uses `dangerouslySetInnerHTML`, but for a hardcoded JSON-LD schema
object. Acceptable as-is; keep it static, and never interpolate user data into it.

### 15.4 Runtime protection

Currently absent. Recommended, in order of value:

- **Content-Security-Policy** header — the structural mitigation for §15.3. A strict CSP
  turns a successful injection into a blocked script.
- Standard security headers: `X-Content-Type-Options`, `Referrer-Policy`,
  `Strict-Transport-Security`, `X-Frame-Options`.
- **Rate limiting** (§6) — still absent, and it is the front line for credential stuffing
  against `/api/auth/login`.
- Input validation at the API boundary via Pydantic constraints, not only in the UI.

---

## 16. Data access and performance

### 16.1 Pagination — effectively absent

**Confirmed gap.** Across all route modules only two queries bound their result set
(`dashboard.py:29` `limit(5)`, `webhooks.py:72` `limit(100)`). Every other collection
endpoint returns **the entire table**: `/api/matatus`, `/api/fines`, `/api/activity`,
`/api/audit-logs`, `/api/users`, `/api/bookings`.

At 3,500 vehicles — with fines, activity logs and audit logs growing without bound — this
becomes the system's first hard performance wall, and it hits the frontend too, since
several pages now filter client-side over the full set (Fleet Registry, Revenue & Fines).

**Recommendation:** cursor (keyset) pagination, not `OFFSET`. `OFFSET` degrades linearly —
page 5,000 of the audit log scans and discards five thousand pages of rows. Keyset
pagination on `(timestamp, id)` stays constant-time. Audit logs and telemetry make this
non-optional.

### 16.2 Indexing

19 `index=True` declarations exist, essentially all single-column primary keys and foreign
keys. Real query patterns are composite:

- Fines by vehicle **and** status **and** date
- Activity/audit logs by resource **and** timestamp (descending)
- Telemetry by vehicle **and** time window
- Matatus by sacco **and** status

**Recommendation:** add composite indexes matching actual `WHERE` + `ORDER BY` shapes,
ordered by selectivity. Verify with `EXPLAIN ANALYZE` against realistic data volumes rather
than assuming. For PostGIS, spatial predicates need **GiST** indexes; a B-tree does nothing
for them.

### 16.3 Caching

No caching layer exists today beyond Redis being present for pub/sub.

| Data | Volatility | Strategy |
|---|---|---|
| Routes, stages, corridor geometry | Near-static | Aggressive cache, long TTL, explicit invalidation on edit |
| Fare charts | Changes on licence renewal | Cache with event-driven invalidation |
| Operator / vehicle records | Low | Short TTL |
| Live positions | Sub-second | **Never cache** — Redis is the store of record |
| Dashboard aggregates | Minutes | Precompute on a schedule; do not aggregate per request |

The highest-value target is route geometry — expensive to produce (TomTom snapping, §9.2)
and almost never changes.

### 16.4 Connection pooling

Covered in §3 — PgBouncer in transaction mode. Restated here because it is the most common
failure point: async FastAPI across replicas exhausts Postgres connections quickly, and the
symptom (timeouts under load) rarely points at its cause.

### 16.5 Replication

Covered in §3 — a read replica for monitoring-centre dashboards and analytics. Application
code must then route reads deliberately and tolerate **replication lag**: a write followed
immediately by a read from the replica may not see itself. Keep read-your-writes paths on
the primary.

### 16.6 Sharding — not now, and probably not ever

Sharding is a large, mostly irreversible complexity increase and **is not warranted here**.
Nairobi County is a bounded geography with a bounded fleet.

The one table that could plausibly outgrow a single node is telemetry history, and
TimescaleDB (§3) already solves that with hypertable partitioning plus compression and
retention — partitioning within one database, which is far cheaper than sharding across
many. Revisit only if a specific measured limit is hit, never pre-emptively.

---

## 17. Scaling, concurrency and traffic

### 17.1 Vertical before horizontal

Vertical scaling is the cheaper first move — no distributed-systems tax, no code change.
Use it for the database, where the ceiling is highest and horizontal scaling is hardest.

Horizontal scaling is required for the stateless tiers (API, telemetry ingest, WS gateway)
but is **blocked today** by §5.1 (per-process secrets) and constrained by §16.4
(connection exhaustion). Fix both before adding replicas.

### 17.2 Distributed-systems consequences of the split

Once §2.2 and §2.3 are separate services, several properties stop being free:

- **Partial failure** becomes normal. Telemetry ingest being down must degrade the live map,
  not break licensing.
- **No cross-service transactions.** Consistency becomes eventual and must be designed for.
- **Idempotency becomes mandatory** wherever a message can be redelivered — Redis Streams
  guarantees at-least-once, not exactly-once. The NairobiPay callback especially must be
  idempotent, or a retried callback double-settles a fine.
- **Clock skew** matters once ordering is inferred across services. Prefer sequence numbers
  or server-assigned timestamps over device clocks — bus devices will have wrong clocks.

### 17.3 Concurrency and parallelism

FastAPI is async and single-threaded per worker: it gives **concurrency** (many waiting I/O
operations) but not **parallelism** (simultaneous CPU work).

- Any CPU-bound work — fare-chart PDF parsing, route geometry maths, report generation —
  **blocks the entire event loop** and stalls every concurrent request on that worker. This
  is precisely why such work belongs in the task queue (§4.2), not in a request handler.
- Scale parallelism with multiple uvicorn workers and multiple replicas, sized against
  PgBouncer limits (§16.4).
- Audit for accidental blocking calls (synchronous file I/O, `requests`, `time.sleep`) in
  async paths.

### 17.4 Polling versus push

WebSockets are already used for telemetry, notifications and dashboard events — the right
default. Two refinements:

- **Scope subscriptions.** One firehose broadcasting every vehicle to every client does not
  survive 3,500 vehicles. Subscribe by route corridor or map viewport tile, so a client
  receives only what it can display.
- **Keep an SSE or long-poll fallback** for restrictive networks. Corporate proxies and
  some mobile networks break WebSockets; the live map should degrade rather than go blank.

Polling remains correct for the **IRMS integration** (§9.1) — pull on a schedule into our
own store, never per user request.

### 17.5 Traffic, throughput and latency budgets

Set explicit budgets, then alert on them via the existing Prometheus setup:

| Path | Target | Note |
|---|---|---|
| Telemetry ingest | ~700 writes/sec sustained | Bounded queue + drop-oldest (§11.1) |
| Passenger map updates | Sub-second perceived | Bounded by IRMS refresh rate (§9.1) |
| Interactive API reads | p99 under ~300 ms | Requires pagination (§16.1) + indexes (§16.2) |
| Fare/report generation | Asynchronous | Task queue; never blocks a request (§17.3) |

Traffic is **strongly peaked** — the BRN plan sizes for 3,500 buses at *peak hour*. Capacity
must be provisioned for peak, not average, and autoscaling (§7) should react to queue depth
rather than CPU, which lags.

### 17.6 Egress

Two distinct concerns:

- **Cost/volume:** map tiles and live position streams dominate outbound bytes. Serve tiles
  via CDN, send position deltas rather than full objects, and consider binary framing if
  payload size becomes material.
- **Security:** the backend should have an **egress allowlist** — NairobiPay, NTSA IRMS,
  TomTom, Sentry. A compromised dependency in a government system should not be able to
  exfiltrate freely to arbitrary hosts. This pairs with §15.4.

---

## 18. Frontend architecture

### 18.1 Server-side rendering

Next.js App Router with React Server Components is already in use, and the established
pattern is sound: an async server `page.tsx` fetches role-scoped data and passes it to a
`"use client"` component that owns interaction state.

**Keep the security property that pattern provides.** Role scoping happens server-side, so
an operator's browser never receives another operator's records — the client-side instant
filters (Fleet Registry, Revenue & Fines) operate only over an already-scoped set. Any
future move toward client-side data fetching must preserve this.

**Constraint to watch:** server-rendered pages currently pass *entire* collections to the
client. That is fine at demo scale and breaks at 3,500 vehicles — the same problem as
§16.1, surfacing as payload size. Client-side instant filtering will need to become
server-backed search once collections exceed roughly a few hundred rows.

### 18.2 State management

No global state library is in use; state is local `useState` plus server components. **This
is the correct choice — do not add Redux/Zustand reflexively.** Server components already
own most data state.

The genuine exception is **live telemetry**, which is push-driven, shared across
components, and long-lived. When the live map, crew dashboard and notifications all need
the same stream, introduce a single subscription context that owns the WebSocket and
distributes updates — rather than each component opening its own connection. That is one
targeted context, not a state-management framework.

---

## 19. User profile management

Currently minimal: users have name, email, password, role, and sacco linkage, with
self-service password reset. Gaps worth closing before public launch:

- **Self-service profile editing** — name, phone, notification preferences, language
  (EN/SW is already supported in the UI).
- **Email change flow** with verification, which must respect the normalisation rule in
  §15.1.
- **Session management** — no way to view or revoke active sessions. JWTs are currently
  valid until expiry with no revocation path; a compromised token cannot be killed. A token
  denylist in Redis is the usual minimum.
- **Account lifecycle** — deactivation and offboarding, distinct from deletion, since audit
  records must survive the account (§10 retention rules apply).
- **Passenger identity is thin** — pickup requests will need a verified phone number, which
  is also the natural bridge to the USSD/SMS channel (§1.7).
- **MFA for privileged roles** — ADMIN, SUPERADMIN and enforcement officers can issue fines
  and alter licences. Password-only authentication is weak for those roles in a government
  system.

---

## 20. Operational readiness

### 20.1 Runbooks

Prometheus, Alertmanager and Grafana exist, so alerts will fire — but an alert without a
runbook is just noise at 3am. Each alert needs a linked runbook covering: what it means,
how to confirm, how to mitigate, and how to escalate.

Minimum set for this system:

| Scenario | Must cover |
|---|---|
| IRMS unavailable | Expected degradation, how to confirm upstream vs local, passenger messaging |
| Telemetry ingest lag / dropped pings | Reading the drop metric, shedding vs scaling |
| Database failover / replica lag | Read routing, when to fail back |
| NairobiPay callback failures | Reconciliation procedure for missed settlements |
| WebSocket gateway saturation | Draining, restarting without dropping the fleet |
| Deploy rollback | Colour switch procedure (§13.3) |

Runbooks belong in the repository beside `DEPLOYMENT.md`, reviewed like code.

### 20.2 Fallbacks and graceful degradation

Define what each dependency's failure *looks like to a user*, and make it a deliberate
product decision rather than a stack trace:

| Dependency down | Degraded behaviour |
|---|---|
| NTSA IRMS | Serve last known positions with a visible staleness indicator |
| TomTom | Fall back to stored route polylines; disable traffic-aware ETAs |
| NairobiPay | Queue the payment intent; never silently mark a fine paid or unpaid |
| Redis | Live features degrade; licensing, enforcement and revenue must keep working |
| WebSocket blocked | Fall back to SSE or polling (§17.4) |

The rule: **failure of a real-time convenience must never block a statutory function.**
Someone must still be able to pay a fine and renew a licence when the map is down.

### 20.3 Resiliency posture

`resilience.py` provides a circuit breaker and retry, but both are in-process (§4.3) — state
resets on restart and is not shared across replicas. Additions worth making:

- **Timeouts on every outbound call.** A missing timeout is how one slow upstream exhausts
  the whole connection pool.
- **Jittered backoff.** The current exponential retry has no jitter, so simultaneous
  failures retry in lockstep and produce a thundering herd.
- **Bulkheads** — separate connection pools per upstream, so a slow TomTom cannot consume
  the capacity IRMS needs.
- **Chaos and DR drills.** A restore from backup that has never been tested is a hypothesis,
  not a backup.

---

## 21. Data modelling corrections (confirmed in code)

Two schema-level problems in `backend/app/models.py`. Both are cheap to fix now and
expensive later, because both require data migration once real records exist.

### 21.1 Money is stored as `Float` — fix before financial go-live

**Confirmed.** Every monetary column is floating point:

| Column | Model | Line |
|---|---|---|
| `fare_kes` | Route | 90 |
| `fine_amount_kes` | CrimeRecord | 142 |
| `amount_kes` | Fine | 158 |
| `fare_kes` | Booking | 177 |
| `default_fine_kes` | OffenceType | 222 |
| `fine_amount_kes` | EnforcementCase | 241 |

IEEE-754 cannot represent common decimal values exactly. In a county **revenue** system
this produces:

- Rounding drift when summing many fines or fares — the revenue totals on the dashboard
  will not exactly equal the sum of their records.
- **Reconciliation mismatches against NairobiPay** at cent level, which are notoriously
  hard to trace because each individual record looks correct.
- Comparisons that fail counter-intuitively (`amount == 100.0` not matching a stored
  `100.00000000000001`).

**Fix:** `Numeric(12, 2)` (maps to Postgres `NUMERIC`, exact decimal), or store integer
cents. Do this **before** NairobiPay's real API is wired in and before there is production
financial data to migrate.

### 21.2 All timestamps are stored as `String` — this blocks TimescaleDB

**Confirmed.** There are **zero** `DateTime` columns in the schema. Roughly eighteen
temporal fields — `created_at`, `issued_at`, `due_date`, `timestamp`, `booked_at`,
`paid_at`, `released_at`, `reset_token_expires_at`, the verification decision timestamps —
are all `Column(String)`.

Writers currently use `datetime.utcnow().isoformat() + "Z"`, which is at least consistent,
so ordering and range queries happen to work. But:

- **Correctness is format-dependent.** Ordering is lexicographic on text. It holds only
  while *every* writer emits identical ISO-8601 with identical precision. One writer
  omitting microseconds or using a different offset breaks sorting silently, with no error.
- **No SQL date arithmetic.** Licence expiry windows, fine due-date ageing, night-service
  time windows (§1.3) and retention policies (§10) all need real interval maths. In string
  form that logic has to move into Python, which means loading rows to filter them.
- **Indexes are text indexes** — larger and slower than native timestamp indexes.
- **No timezone semantics.** Africa/Nairobi is UTC+3 with no DST, which masks the problem
  today; it will not survive inter-county scope or any client sending local time.

**The blocking consequence: TimescaleDB hypertables must partition on a real timestamp
column.** The time-series decision in §3 cannot be implemented against `String` timestamps.
This is a prerequisite, not a cleanup task.

**Fix:** `Column(DateTime(timezone=True))`, store UTC, convert at the presentation layer.
Migrate with an expand/contract pattern (§11.3): add the typed column, backfill, dual-write,
switch reads, drop the old column.

### 21.3 Also worth verifying

- **Webhook SSRF.** `WebhookSubscription` allows registering outbound delivery targets. If
  the target URL is operator-supplied and unvalidated, the backend can be induced to make
  requests to internal addresses (cloud metadata endpoints, internal services). Validate
  target URLs against a public-address allowlist — this is the inbound counterpart to the
  egress allowlist in §17.6.
- **API versioning.** Routes are unversioned (`/api/...`). Before there are external
  consumers — the USSD/SMS gateway (§1.7), a native mobile app, or NaMATA/NTSA integrations
  — adopt `/api/v1/` so breaking changes do not require synchronised releases across
  clients you do not control.
- **Backup and recovery targets.** No documented RPO/RTO. For a system holding statutory
  financial records, decide the acceptable data-loss window and recovery time explicitly,
  enable Postgres point-in-time recovery, and **test a restore** — an untested backup is a
  hypothesis (§20.3).
- **Accessibility (WCAG 2.1 AA).** This is a public government service with a
  passenger-facing surface, and the BRN report itself emphasises accessible transport for
  PWDs. Accessibility is typically a procurement and legal requirement for county systems,
  and is far cheaper to build in than to retrofit.

---

## 22. Enforcement officer allocation and monitoring

**Goal:** the Enforcement Commander assigns officers to route stretches for a shift ("you
cover Ngong Rd, Prestige → Junction today") and monitors coverage on the same map used for
the live fleet.

### 22.1 What already exists

The assignment half is largely built:

| Piece | Location |
|---|---|
| `Zone` model (`id, name, description`) | `models.py:210` |
| `User.assigned_zone_id`, `enforcement_duty`, `commander_title` | `models.py:71–73` |
| Commander/Admin assignment endpoint + audit log + event dispatch | `enforcement_cases.py:97–131` |
| `GET /officer-assignments` roster | `enforcement_cases.py:86–94` |
| Enforcement cases already carry `zone_id` | `enforcement_cases.py:253` |

So "Commander allocates officer → zone" works today, gated behind the
`manage_officer_assignments` permission. Three gaps remain.

### 22.2 Gap 1 — zones have no geometry

`Zone` is name-and-description only; there is no spatial shape, so "this stretch to this
stretch" cannot be represented. This is a direct payoff of PostGIS (§1.2):

- A **beat** becomes either a polygon or, better, a **route-segment** — an ordered slice of
  a route's polyline between two points. Once BRN route geometry is digitized (§1.3), a
  stretch is just two positions along one route's line.
- With geometry in place, PostGIS answers "is this officer's assigned stretch overlapping
  that corridor" and "which officer owns the segment nearest this incident" directly.

Decision: model an enforcement **beat/segment** as first-class geometry rather than
overloading the flat `Zone`. Keep `Zone` as a coarse administrative grouping if useful, but
the map-drawable unit is the segment.

### 22.3 Gap 2 — assignment must be time-boxed

`assigned_zone_id` is a single sticky field: one zone, no shift window, no history. The
"today" in the requirement needs a proper **assignment record**:

```
officer_id · segment_id · shift_start · shift_end · date · assigned_by
```

This yields a Commander roster view, a coverage timeline, and a history of who covered what
— none of which the single mutable field can provide. The existing
`OFFICER_ASSIGNMENT_UPDATED` event (`enforcement_cases.py:127`) extends naturally to carry
the segment and shift window.

### 22.4 Gap 3 — live officer monitoring hits the web-app positioning limit

Drawing the *assignment* on the map is easy and available now. Showing the Commander a
**live dot per officer** requires the officer's position, which runs into the exact
constraint in §5.2: browser geolocation stops when the phone is backgrounded or the screen
locks.

Critically, **officers have no NTSA IRMS fallback** — unlike buses, an officer's position
depends *entirely* on their phone. So on the current web app:

| View | Feasibility |
|---|---|
| Assignment + coverage (who owns which stretch, drawn on the map) | **Available now** (needs §22.2 + §22.3) |
| Live officer tracking | **Best-effort only** — works while the tab is foregrounded with a Screen Wake Lock; otherwise a native-app item |

Surface this as an explicit product decision: is a foreground-only "on patrol" screen good
enough, or is continuous officer tracking a hard requirement that pulls the enforcement
piece into the native-app phase?

### 22.5 Near-free wins once segments are geometry

- **Incident heat-mapping per stretch.** Cases already store `zone_id`; with segment
  geometry, cluster offences/fines by segment to see where enforcement pressure is needed.
- **Assignment-adherence check.** Auto-flag whether a case was logged inside the officer's
  assigned stretch — a light accountability signal, and the enforcement-side mirror of the
  vehicle route-adherence monitoring in §1.6.

### 22.6 Reuse, don't fork, the map

This is the same live map component as the fleet/passenger view with different layers:
route-segment polygons for beats, officer markers, and an incident heat layer. Build it as
configurable layers on one map, not a second map implementation — and it inherits the same
scoped-subscription requirement from §17.4.

---

## 23. Data representation and analytics

**Audience:** the primary daily users — executives, enforcement heads, county admins — are
**non-technical**. They must understand real-time and historical data without training.
Passengers are non-technical too. This reframes the whole surface: the goal is
*comprehension*, not density.

### 23.1 Two structural blockers in current code

| Blocker | Location | Consequence |
|---|---|---|
| Charts are hand-rolled (div/CSS) | `RevenueBarChart`, `dashboard/ComplianceDonut`, `dashboard/RevenueBars` | No time-series, no interactivity, no accessibility; every new chart is bespoke effort |
| Export builds from data already on the page | `lib/csvExport.ts` ("no backend round-trip") | Cannot export long timelines — would require loading a year of rows into the browser first (§16.1) |

What is being asked for is not "more charts" — it is a **reporting/analytics layer**, which
is a different architecture from what exists.

### 23.2 Adopt a charting library — Recharts

React/Next-native, declarative, components are `"use client"` (charts do not server-render).
Provides consistent, accessible, **interactive** axes / tooltips / legends out of the box.
Replaces the three hand-rolled components with one shared, county-branded chart kit so
effort goes into *what* to show, not redrawing SVG.

Interactive baseline every chart should have: hover tooltips, click-to-drill-down, series
toggle, and a date-range picker with presets (Today / 7d / 30d / YTD / Custom) plus
zoom/pan on time-series.

### 23.3 Aggregate on the server — the load-bearing piece

Non-technical users viewing a year of data cannot be served raw rows charted client-side.
Use **pre-aggregated rollups**: daily/weekly/monthly buckets computed server-side. This is
exactly **TimescaleDB continuous aggregates** (§3) — a "fines per day per corridor" rollup
makes a year-long trend ~365 pre-computed rows, not a scan of millions.

Chart endpoints take `(metric, date_range, grouping)` and return bucketed data. This is the
single most important piece: the difference between a 200ms dashboard and one that times
out. **Build this before the charts** — charts on top of raw per-request aggregation are
pretty widgets that cannot answer a year-long question.

### 23.4 Long-timeline export is an async server-side job

"Export a year or more" must be a **background job** (task queue, §4.2): pick range → job
builds the file → notify when ready → download. Not a synchronous click. Keep the existing
client-side export for the small current-view case; add server-side generation (formatted
PDF/Excel, not raw CSV) for anything spanning real time.

### 23.5 Real-time vs historical — separate them

- **Real-time widgets** (live vehicle count, today's fines) update via the existing
  WebSocket (`DashboardLiveRefresh`, `LiveIndicator`).
- **Historical trends** load on demand for a chosen range.
- Do not stream a year. Stream the present, query the past.

### 23.6 Embedded BI for ad-hoc exploration — evaluate before building

Two distinct needs, poorly served by one tool:

- **Curated, branded, real-time dashboards** → build in-app with Recharts.
- **"Slice the data any way I want and export it"** → evaluate **Metabase** (open-source,
  self-hostable, built for non-technical users) pointed at the **read replica** (§3), so
  heavy exploratory queries never touch production and execs build their own views with no
  SQL and no developer in the loop.

Recommendation: build the daily-driver curated dashboards in-app; seriously evaluate
Metabase for ad-hoc exploration and long-range export **before** committing to a custom
report-builder, which is a large effort to reproduce a mature free tool.

### 23.7 Sequencing

Aggregation layer (§23.3) → Recharts kit + curated dashboards → async export (§23.4) →
decide Metabase-vs-custom. The aggregation layer is the dependency; everything else is a
thin surface on top of it.

### 23.8 Branded / official document exports

Requirement: downloaded documents carry an official header — county logo, title, date,
authority. **Feasibility differs sharply by format**, and this is a good forcing function to
move export generation server-side.

Current state: all three exports are client-side (`lib/csvExport.ts`), built from data
already on the page.

| Format | How it's built now | Logo / header? |
|---|---|---|
| **CSV** | Plain text, `\r\n` rows | **No — impossible.** CSV is a text format with no styling or image capability. An image would corrupt the file. |
| **Excel** | HTML `<table>` saved as `.xls` (not a real workbook) | **Not reliably** — the HTML-as-`.xls` trick does not embed images dependably across Excel versions. |
| **PDF** | Real `jsPDF` + autotable | **Yes, easily** — `jsPDF.addImage()` with a data-URI logo. |

**Recommendations:**

1. **CSV — set expectations, don't fake it.** CSV cannot carry a logo. It *can* carry a few
   leading metadata text rows ("Nairobi City County — Fines Report — Generated 2026-08-13 —
   Official") before the header row. Offer CSV as the "raw data for spreadsheets" option and
   steer users to PDF/Excel for anything meant to look official.

2. **PDF — the official-document format.** Add a branded header band (crest + "Nairobi City
   County · Mobility & Works" + report title + generated-date + generating user), a footer
   with page numbers and an authenticity line, and county colours (already partly done —
   header fill is county-green). `jsPDF` already supports all of this client-side. Make PDF
   the default for anything presented or filed.

3. **Excel — move to real `.xlsx`, server-side.** For a genuinely branded workbook with an
   embedded logo, frozen header row, and proper column typing, generate real XLSX with
   **`openpyxl`** — which is **already a backend dependency** and embeds images natively.
   This aligns with §23.4 (long exports become server-side jobs regardless), so branded
   Excel and long-range export are the same move: shift Excel/PDF generation to a
   server-side reporting service that stamps every document with the county header from one
   template.

4. **One shared report template.** Define the header/footer/branding once server-side so
   every export — fines ledger, revenue report, enforcement summary, audit trail — looks
   identically official without each call site reimplementing it. This is the export
   counterpart to the shared chart kit (§23.2).

**Net:** logo on PDF now (client-side), logo on Excel via server-side `openpyxl`, logo on
CSV never (add a text metadata header instead). The branding requirement is itself a reason
to build the server-side reporting service that §23.4 already calls for.

---

## 24. Non-technical user experience (UI/UX)

The people in this system all day are not tech-savvy. These are deliberate design
requirements, not polish. Grouped by concern; treat as a working backlog.

### 24.1 Onboarding and first-run

1. **Role-based default landing page.** Each role opens straight to the view that answers
   its main question — executive to KPIs, enforcement head to today's coverage, operator to
   fleet status. No generic home screen to navigate away from.
2. **Guided first-run tour** — a short, skippable, one-time walkthrough of the primary
   screen per role.
3. **Teaching empty states.** Every empty table/chart explains what will appear here and the
   one action to populate it, instead of a blank panel (the `EmptyState` component already
   exists — apply it everywhere).
4. **Sensible defaults over configuration.** Non-technical users should almost never need to
   configure anything to get value; defaults must be useful on first load.

### 24.2 Navigation and information architecture

5. **Show only what the role needs.** Hide irrelevant nav per role rather than disabling it
   — fewer choices, less confusion.
6. **Shallow depth.** Key tasks reachable in ≤2–3 clicks.
7. **Global search** — one search box that finds a vehicle, operator, fine, or route by
   plate/name/number.
8. **Breadcrumbs and a persistent "you are here"** so users never feel lost.
9. **Recently viewed / pinned items** for the records a user returns to.
10. **Consistent layout skeleton** across every page — same header, nav, action placement
    (`AppShell` / `PageBanner` already push this; enforce it).

### 24.3 Making data understandable

11. **Plain language everywhere.** No jargon, no internal codes shown raw. "Uncollected
    fines" not "PENDING amount_kes sum".
12. **A one-line plain summary on every chart** — "what am I looking at" — often more useful
    than the chart itself.
13. **Narrative insight lines.** Auto-generated sentences: "Fine collection is down 12% this
    week, mainly on the Jogoo Rd corridor." Tell them the *so what*.
14. **Comparisons and targets.** Every number against a baseline — vs last period, vs target
    — with a trend arrow. A bare number means nothing to a non-analyst.
15. **RAG / traffic-light status** for at-a-glance health, never color alone (§24.7).
16. **Human number and date formatting** — thousands separators, "KES" prefix, "2 hours
    ago" / "Yesterday" alongside absolute timestamps.
17. **Info icons / tooltips** on any metric whose definition is non-obvious.
18. **Drill-down path:** headline number → chart → underlying rows. Progressive disclosure so
    the landing screen is calm and detail is one click away.
19. **Chart annotations** — mark known events ("licence fee change", "route relaunch") on
    time-series so spikes have context.

### 24.4 Real-time, made legible

20. **Explicit freshness.** "Live" badge when streaming; "Updated 3 min ago" when polled
    (§9.1 — IRMS staleness must be visible, not hidden).
21. **Gentle update animation** — values ease/flash softly on change, never jarring jumps or
    layout shifts.
22. **Threshold alerts in plain language** — "12 vehicles are off-route right now" surfaced
    proactively, not buried in a table.

### 24.5 Forms and data entry

23. **Inline, friendly validation** — explain what's wrong and how to fix it, at the field,
    as they type (mirrors the login-loop fixes already done).
24. **Smart defaults and autofill** — pre-fill everything the system already knows (the
    operator/sacco scoping work is an example to extend).
25. **Autosave / drafts** on multi-step flows (the onboarding wizard already persists;
    generalise it) so work is never lost.
26. **Clear multi-step progress** — where they are, what's left.
27. **Confirm destructive actions; prefer undo.** An "Undo" toast beats a confirm dialog for
    reversible actions.

### 24.6 Feedback and error handling

28. **No stack traces, ever.** Friendly, actionable error messages; log the technical detail
    server-side (Sentry is wired).
29. **Success confirmation** via toast for every meaningful action.
30. **Skeleton loaders**, not spinners — perceived speed and no layout jump.
31. **Optimistic UI** where safe, with rollback on failure.

### 24.7 Accessibility and inclusivity (mandatory, not optional)

32. **WCAG 2.1 AA** (§21.3) — legal/procurement expectation for a public service.
33. **Never rely on color alone** — pair the county green/red with icons, labels, or
    patterns (colorblind-safe and clearer for everyone).
34. **Full EN/SW parity.** The toggle exists (`LanguageToggle`); every new string, chart
    label, and export header must be translated, not just the chrome.
35. **Readable defaults** — generous font size, line-height, contrast; a user-controllable
    text-size option.
36. **Large touch/click targets** and full keyboard navigation.
37. **Low-bandwidth / low-end device tolerance** — many users are on modest Android phones on
    patchy networks; pages must stay usable, degrade gracefully, and not ship huge bundles.

### 24.8 Trust and transparency (government context)

38. **Visible provenance** — "Source: NTSA IRMS · updated 14:32" on data pulled from
    external systems, so users know what they're trusting.
39. **Human-readable audit trail** — "Grace Wambui marked this fine paid, 12 Aug 14:03" on
    the record, surfacing the audit data already captured.
40. **Timestamps on everything** — nothing dateless in a system of statutory record.

### 24.9 Reporting and sharing

41. **Scheduled reports** — "email me a weekly revenue summary" (task queue + notifications
    already exist to build on).
42. **Print-friendly / one-click PDF** of any dashboard for meetings and physical filing.
43. **Shareable saved views** — a link or saved filter set a colleague can open to the same
    state.

### 24.10 Personalisation (bounded)

44. **Saved filters and views** per user — recurring questions become one click.
45. **Notification preferences** — what each user is alerted about and how.
46. **Respect the theme** — the app is already theme-aware; keep light/dark correct
    everywhere rather than adding heavy dashboard customisation that can overwhelm
    non-technical users.

### 24.11 Passenger-facing specifics

47. **Fewest possible steps** to find a bus / request pickup / check a fare.
48. **Visual route representation** — a simple map/line view beats a text list of stages.
49. **Fare transparency up front** — show the price before any commitment.
50. **Feature parity with USSD/SMS** (§1.7) for the core passenger actions, since many
    riders are not on smartphones — the web app is one channel, not the only one.
51. **Responsive by default** — executives check dashboards on phones and passengers are
    mobile-first; every surface must work at mobile width.

### 24.12 Iconography

Icons are being incorporated heavily across the UI. Standards:

**Approved sources** (in order of preference for consistency):
- **icons8.com** · **streamlinehq.com** · **thenounproject.com** · **fontawesome.com**

**Rules:**

1. **One primary family for the app UI.** Pick a single set (e.g. Streamline or Font
   Awesome) as the default across the entire interface. Different sources have different
   stroke weights, corner radii, and grids; mixing them reads as incoherent. Reach into the
   other sources only for a specific icon the primary set genuinely lacks, and match its
   weight/style as closely as possible.
2. **Icons support labels, they do not replace them.** For non-technical users, an icon
   alone is ambiguous — pair it with text (or an accessible label at minimum). This also
   satisfies the "never rely on shape/colour alone" accessibility rule (§24.7).
3. **Consistent semantic meaning.** The same concept uses the same icon everywhere (one icon
   for "fine", one for "route", one for "operator") — the icon counterpart to the
   colour/naming consistency in §25.3.
4. **Licensing — mandatory for a government product.** The Noun Project, and some
   Streamline / Font Awesome / icons8 tiers, require attribution or a paid licence. Confirm
   each icon's licence permits use in a public county system before shipping, and keep
   required attributions. Prefer a single licensed set to keep compliance simple.
5. **Delivery:** inline SVG (crisp at any size, CSS-colourable to county palette,
   accessible) over icon fonts or raster. Keep the working set small — a bloated icon bundle
   works against the low-bandwidth requirement (§24.7).

### 24.13 Guiding principle

For this audience, **prevent errors rather than handle them, and default rather than
configure.** Every screen should answer a real question the user has, in their language, on
first load, without a manual. Measure success by whether a county officer who has never seen
the system can read the main dashboard unaided.

### 24.14 How to action this list

- **These are product/UX work items, not architecture.** §24 should be broken into
  individual design/build tickets rather than treated as one task. Prioritise the ★
  highest-leverage items (role-based landing, plain language, narrative insights, baselines
  with trend arrows, explicit freshness, no stack traces, colour-independent status,
  low-bandwidth tolerance, visible provenance, fewest-steps passenger flows) first.
- **Some items depend on §23.** Provenance labels, freshness indicators, and narrative
  insight lines are surfaces over the analytics/aggregation layer — they cannot be built
  before §23.3 exists. §23's sequencing gates them.
- **Use `/impeccable` to build the dashboards.** It is set up for exactly this kind of
  product-UI craft (curated dashboards, forms, empty states, onboarding flows) and can
  design against the county branding, rather than hand-building screens ad hoc.

---

## 25. Role-based dashboard templates and data-visualization design

The system serves many distinct non-technical personas. A single dashboard cannot serve
all of them — each role has **one primary question** it opens the system to answer.
This section defines a per-role template approach and the visualization discipline that
makes data legible to people who do not read charts for a living.

### 25.1 Build a widget library, compose dashboards from it — do not hand-build N pages

**Architecture decision:** a dashboard is a **grid of configurable widgets** (cards), not a
bespoke page per role. Build one library of typed widgets once — KPI tile, trend line,
comparison bar, status donut, ranked list, map layer, live counter, alert feed — each
taking `(metric, date_range, grouping, scope)` and fed by the aggregation layer (§23.3).

Then a role's dashboard is **configuration**: an ordered list of widgets with their
parameters. Benefits:

- New role view = new config, not new code.
- Consistent look and behaviour across every dashboard for free.
- Opens the door to per-user saved layouts (§24.10) later without rework.
- Each widget is independently cacheable and independently permission-scoped.

This is the dashboard counterpart to the shared chart kit (§23.2) and shared report template
(§23.8): build the primitive once, compose everywhere.

### 25.2 Per-role dashboard templates

Each opens to that role's primary question. Widgets listed are the default template; users
may later save variants.

**Executive** (CECM Mobility, Director of Mobility, Chief Officer) — *"Is the network
healthy and is revenue on track?"*
- KPI row: total daily ridership, revenue collected vs target, fleet in service, on-time /
  route-adherence rate — each with trend arrow vs last period.
- Revenue trend (selectable range up to multi-year) with target line and annotations.
- Corridor comparison — ranked performance across the arterial corridors.
- Compliance summary donut (licences current / due / expired).
- One narrative insight banner (§24.3): the single most important change since last view.
- Strategic, not operational. No row-level detail on the landing screen.

**County Admin** — *"Is the system running and who needs attention?"*
- Operational health: services up, ingest lag, active users, error rate (plain-language).
- Pending queue: operator verifications awaiting action, disputes, flagged vehicles.
- User & operator management shortcuts.
- Audit-activity feed (human-readable, §24.8).

**Enforcement Commander / Head** — *"Is every stretch covered and where are the problems?"*
- Live coverage map (§22): officers assigned per route-segment, gaps highlighted.
- Today's roster: who is on which beat, which shift.
- Incident hotspots — heat layer by segment (§22.5).
- Compliance/offence trend, and assignment-adherence flags.

**Enforcement Officer** (Arresting / Releasing) — *"What is my beat and my cases today?"*
- My assigned stretch on the map, my shift window.
- My open cases / actions.
- Quick-action to log an incident, scoped to my beat.
- Deliberately narrow — an officer's view is a worklist, not an analytics console.

**SACCO / Operator** — *"How is my fleet doing and is my licence in order?"*
- Fleet status: vehicles active / flagged / impounded.
- My revenue and fines trend (scoped server-side to my sacco — the security boundary in
  §18.1).
- Licence & renewal status with clear next-action.
- Compliance score vs county expectations.

**Crew (Driver / Conductor)** — *"What's my shift and my route?"*
- Today's assignment, route line, shift times.
- Simplest possible surface; largest touch targets (§24.7).

**Passenger** — *"Which bus, from my stage, and what does it cost?"*
- Stage-first: pick your stage, see approaching buses and fares.
- Visual route line, not a text list (§24.11).
- Minimal steps; USSD/SMS parity (§1.7).

**Viewer / Executive (read-only)** — the executive template without action controls.

### 25.3 Visualization discipline for non-technical readers

Chart choice is not decoration — the wrong chart actively misleads a non-analyst. Rules:

**Match the chart to the question:**

| Question shape | Use | Avoid |
|---|---|---|
| How is it changing over time? | Line / area | Bar for long series |
| How do a few categories compare? | Horizontal bar (ranked) | Vertical bar with long labels |
| Part-to-whole, 2–4 parts | Donut with centre total | Pie with many slices |
| Actual vs target | Bullet chart / gauge | Two bars the reader must compare |
| Where, geographically? | Map heat / choropleth | Table of place names |
| Row-level trend at a glance | Sparkline in the table | A separate chart |
| One number that matters now | Big KPI tile + trend arrow | A chart for a single value |

**Anti-patterns to ban outright:** pie charts with more than ~4 slices; dual y-axes;
3D anything; more than ~5 series on one chart; truncated axes that exaggerate change;
rainbow palettes; chart types chosen for novelty (radar, treemap) where a bar would answer
the question.

**Layout — inverted pyramid:** headline KPIs top, trends middle, detail on demand at the
bottom or one drill-down away (§24.3). The landing screen must be calm; depth is a click
away, never all at once.

**Consistency is comprehension:** the same metric is the same colour, same name, same
format everywhere. County green = good/collected, red = attention/overdue — applied
identically across every widget, and never by colour alone (§24.7).

**Always give a number its context:** a value with no baseline, target, or trend is
noise to a non-analyst. Pair every figure with vs-last-period, vs-target, or a direction.

**Label in plain language, annotate the "why":** titles are questions or plain statements
("Fines collected this month"), and known events are annotated on time-series so a spike is
explained, not mysterious.

### 25.4 Interactivity that helps rather than overwhelms

Interactive charts (confirmed direction) should stay guided, not open-ended:

- **Hover reveals detail** — exact values on demand, uncluttered by default.
- **Click drills down** — corridor → route → vehicle, following a clear hierarchy.
- **Date-range presets first, custom second** — Today / 7d / 30d / YTD / Custom, presets
  prominent because non-technical users rarely want a bespoke range.
- **Compare-to-previous toggle** — the most-wanted comparison, one click.
- **Cross-filtering with care** — clicking a segment filtering the whole dashboard is
  powerful but can disorient; make it reversible and obvious, with a visible "filtered by X
  — clear" state (the instant-filter pattern already established).
- **Export from the chart itself** (§23.8) — what they see is what they take away.

### 25.5 Sequencing

Widget library (§25.1) depends on the aggregation layer (§23.3). Role templates (§25.2) are
configuration over the widget library. Visualization rules (§25.3) and interactivity (§25.4)
are standards applied as the widgets are built — cheapest to set as conventions before the
first widget, not retrofitted. Use `/impeccable` to build the widget kit and role
templates against county branding.

---

## 26. Operator tenant isolation (hard invariant)

**Requirement:** an operator sees only their own sacco. If they are Umoinner, they see
Umoinner and nothing else — no other operators' data, and **no operator dropdown at all**.
Their entire experience is scoped to their own sacco and its related records. This is a
non-negotiable privacy/security boundary, not a preference.

### 26.1 Current state — already enforced at both layers (verified)

Audited in code; the isolation holds today:

**Backend (the real boundary):**

| Endpoint | Mechanism | Result for a `SACCO_OPERATOR` |
|---|---|---|
| `GET /api/saccos` | `sacco_scope_query(...)` (`abac.py:103`) | Returns **only their own sacco** — a one-element list |
| `GET /api/matatus` | `sacco_scope_query(...)` (`matatus.py:35`) | Only their own fleet |
| `GET /api/matatus/{id}` | `enforce_own_sacco(...)` (`matatus.py:390`) | **403** on another sacco's vehicle: "Forbidden: This vehicle belongs to another Sacco." |
| `GET /api/fines` | `sacco_scope_query(...)` (`fines.py:25`) | Only fines on their own vehicles |

`sacco_scope_query` scopes both `SACCO_OPERATOR` and `CREW` to `user.sacco_id`. An
operator's browser genuinely never receives another operator's records — the boundary does
not depend on the UI hiding anything.

**Frontend navigation:** the `SACCO_OPERATOR` sidebar exposes only `/sacco-portal`,
`/matatus`, `/revenue` (`Sidebar.tsx:58`). Cross-operator surfaces — `/dashboard`,
`/saccos/verify`, `/enforcement`, `/passengers`, `/users` — are not in their navigation.

**Frontend cross-operator UI is already suppressed for operators:**

| Surface | Guard |
|---|---|
| Fleet Registry operator filter + "Operator" column | `!isSacco` (`FleetFilterTable.tsx`) |
| Fines operator filter | `!isSacco` (`FinesFilterTable.tsx`) |
| Revenue per-operator lookup | `!isSacco` (`revenue/page.tsx`) |
| Register-vehicle operator select | hidden input when `isOperator` (`NewMatatuForm.tsx`) |

Because `getSaccos()` is scoped server-side, even a dropdown rendered by mistake would
contain only the operator's own sacco — one option, never a list of others.

### 26.2 The residual risk — the invariant is not yet enforced structurally

Isolation currently relies on **remembering two things on every new surface**:

1. Backend: apply `sacco_scope_query` / `enforce_own_sacco` to every new operator-reachable
   endpoint.
2. Frontend: gate every cross-operator control behind `!isSacco`.

The backend is the true boundary and is robust. The frontend gating is **per-component and
easy to forget** — a new page that naively renders `saccos.map()` would not leak data (the
list is pre-scoped to one), but it would show a pointless single-item operator dropdown,
which is exactly the UX the requirement forbids.

### 26.3 Hardening — make it structural, not remembered

1. **A single `isOperator` / tenant helper** used everywhere, so "is this a single-tenant
   operator" is one source of truth rather than an inline `role === "SACCO_OPERATOR"`
   scattered per component.
2. **Never render cross-tenant UI when scoped to one tenant** — treat operator-selection
   controls as structurally absent for operators, not conditionally hidden.
3. **An automated test asserting the boundary:** log in as an operator, hit every list
   endpoint, and assert every returned record carries the operator's own `sacco_id`. This
   converts the invariant from "we remembered" to "CI fails if we forget" — and pairs with
   the Postgres row-level security recommendation (§12), which enforces the same isolation at
   the database tier as defence-in-depth.
4. **A route guard for operator-forbidden pages** so a direct URL to `/dashboard` or
   `/saccos/verify` is redirected, not merely absent from the sidebar. (Data would still be
   scoped, but the pages should not render for operators at all.)

**Net:** the requirement is met today and the data boundary is solid. The work remaining is
to make it a *structurally guaranteed and tested* invariant rather than a convention each
new page must observe — so it cannot regress as the system grows.

---

## 27. Passenger experience and demand intelligence (Swvl-inspired)

Reference model: Swvl (fixed-route bus booking, operated in Nairobi) — "find a bus for your
trip, know the fare, watch it arrive." The three anchor features below define the passenger
dashboard; the demand data they generate is the payoff for the admin/planning side.

### 27.1 The three anchor passenger features

1. **Origin → destination route search.** Passenger enters "I'm at X, going to Y"; the
   system returns the route(s) serving it, with where to board and where to alight. This is
   the headline interaction. **Depends on:** digitized BRN routes and stages (§1.3) and
   PostGIS for stop-to-route matching and nearest-stage lookup (§1.2).

2. **Upfront, fixed fare shown before booking.** The single biggest trust unlock in the
   matatu context — riders currently never know the fare until they are on board. Show the
   price before any commitment. **Depends on:** structured fare-chart data (§1.4). This also
   makes the county's uniform-tariff policy visible and enforceable to the passenger.

3. **Live tracking + ETA countdown to your stop.** The same live map, pointed at the
   passenger: watch the assigned/approaching bus and a plain-language "arriving in ~4 min."
   **Depends on:** IRMS/telemetry positions (§1.5, §9.1) and internally-computed ETA along
   the stored route polyline, not per-passenger TomTom calls (§9.2). **Constraint:** on a
   web app, "bus arriving" alerts are unreliable when the tab is backgrounded (§5.2) — the
   SMS channel (§1.7) should carry arrival notifications.

The existing `Booking` model (`stage_name`, `seat_numbers`, `fare_kes`, status) already
supports reservation; these three features are the discovery, pricing, and tracking layers
around it.

### 27.2 Deliberately deferred — boarding verification code

Swvl's board-with-a-code (OTP/QR, conductor confirms) is **not being implemented** — too
much operational complexity for the crew workflow at this stage. Consequence to accept:
without a boarding-confirmation step, a reservation is not hard-tied to an actual board, so
occupancy truth and no-show data are weaker. Revisit only if occupancy accuracy becomes a
hard requirement.

### 27.3 Demand intelligence — the admin/planning payoff

**Passenger search and booking activity is itself the data source.** Every O→D search and
booking is a demand signal, and aggregating them gives the county exactly the data set the
2023 BRN plan was built from — except **continuous and live** instead of a one-time survey.

> The BRN report (§0) was built on a one-time survey of 3,991 passengers at 22 locations.
> This system reproduces that origin-destination data set **automatically and continuously**
> from real passenger activity — turning a static 2023 snapshot into a living feed.

Target admin datasets and views:

| Dataset | What it answers | Feeds |
|---|---|---|
| **Boarding/alighting counts per stage per time bucket** | "This stage has heavy boarding at 07:00–08:00" | Scheduling, stage-capacity planning (§17.5) |
| **Origin-destination matrix** | Where people actually travel from/to | Route planning, network adjustment |
| **Peak-demand heatmap over time + geography** | Where and when demand concentrates | Headway/frequency tuning |
| **Route load factor by time** | Which routes are over/under-served | Vehicle allocation, frequency |
| **Unmet-demand searches** | Searches with no good route/result | New-route planning — demand the network does not yet serve |
| **No-show / cancellation rates** | Reliability of demand signals | Forecasting |

Uses: **data collection** (a permanent, richer replacement for periodic OD surveys),
**scheduling** (adjust frequencies to observed peaks rather than assumptions), **route
planning** (evolve the BRN from unmet-demand evidence), and **stage capacity** (pre-empt the
saturation failure mode in §17.5).

### 27.4 What this depends on, and a privacy note

- **PostGIS** (§1.2) for the spatial aggregation (boarding density by location).
- **TimescaleDB continuous aggregates** (§23.3) for the time-bucketed rollups — boarding
  counts per stage per 15-minute bucket over months is precisely a hypertable rollup.
- **The aggregation layer and chart kit** (§23) to surface it as heatmaps and trend views on
  the admin/executive dashboards (§25.2), exportable over long ranges (§23.4).
- **Privacy (DPA 2019, §10):** demand intelligence must be built from **aggregated,
  anonymised** movement data. The aggregate ("120 people boarded at Kencom at 07:00") is the
  product; it is derived from individual trips, so aggregation and retention limits are a
  design requirement, not an afterthought. Do not expose individual passenger movement
  histories through the planning views.

### 27.5 Sequencing

These are surfaces over foundations already in the plan: route/stage digitization (§1.3),
PostGIS (§1.2), structured fares (§1.4), telemetry/ETA (§9), and the aggregation layer
(§23.3). Passenger O→D search and the admin demand views should be built together — the same
route/stage/PostGIS foundation powers both, and the passenger side generates the data the
admin side consumes.

---

## 28. Current gaps summary

| Gap | Status | Ref |
|---|---|---|
| Explicit `SECRET_KEY` / callback secret in deploy | **Blocks horizontal scaling** | §5.1 |
| Continuous positioning on locked phones | **Not achievable web-only** | §5.2 |
| Rate limiting | **None** — nothing in dependencies or code | §6 |
| Task queue / durable jobs | **None** — in-process `asyncio.create_task` only | §4 |
| PostGIS | **Not installed** — plain `postgres:16-alpine` | §1.2 |
| Time-series store | **None** | §3 |
| PgBouncer | **None** | §3 |
| Read replica | **None** | §3 |
| Distributed tracing | **None** | §8 |
| Backend replicas | **One** | §6 |
| Row-level security | **None** — app-tier ABAC only | §12 |
| Telemetry backpressure policy | **Undefined** | §11.1 |
| Load / soak testing | **None** | §11.2 |
| CD pipeline | **None** — CI only, no deploy | §14.1 |
| Postgres/PostGIS integration tests | **None** — CI tests on SQLite | §14.2 |
| Blue/green or canary capability | **None** — single-server upstreams | §13.1 |
| IRMS update frequency | **Unknown** — blocks honest ETA design | §9.1 |
| Data retention policy | **Undefined** — DPA 2019 exposure | §10 |
| Email normalisation | **Bug — inconsistent across paths** | §15.1 |
| Registration TOCTOU race | **Bug — 500 instead of 400** | §15.2 |
| Stored XSS via `reg_number` | **Bug — `innerHTML` in GisMap** | §15.3 |
| CSP / security headers | **None** | §15.4 |
| Pagination | **None** — full-table reads on all collections | §16.1 |
| Composite indexes | **None** — single-column FK/PK only | §16.2 |
| Caching layer | **None** | §16.3 |
| Session revocation | **None** — JWTs valid until expiry | §19 |
| MFA for privileged roles | **None** | §19 |
| Runbooks | **None** — alerts exist without response procedures | §20.1 |
| Documented fallback behaviour | **Undefined** per dependency | §20.2 |
| Timeouts / jitter / bulkheads | **Partial** — retry exists, no jitter or timeouts | §20.3 |
| Money stored as `Float` | **Bug — 6 columns, revenue correctness** | §21.1 |
| Timestamps stored as `String` | **Bug — blocks TimescaleDB entirely** | §21.2 |
| API versioning | **None** — unversioned `/api/...` | §21.3 |
| Documented RPO / RTO + tested restore | **None** | §21.3 |
| WCAG accessibility | **Unassessed** | §21.3 |
| Enforcement beat geometry | **None** — `Zone` has no spatial shape | §22.2 |
| Time-boxed officer assignments | **None** — single sticky `assigned_zone_id` | §22.3 |
| Live officer tracking | **Best-effort only** — no IRMS fallback for officers | §22.4 |
| Charting library | **None** — charts are hand-rolled div/CSS | §23.2 |
| Server-side aggregation / rollups | **None** — blocks long-timeline charts | §23.3 |
| Long-timeline export | **Client-side only** — cannot span a year | §23.4 |
| Non-technical UX programme | **Partial** — foundations exist, not systematised | §24 |
| Branded Excel export | **Not reliable** — HTML-as-`.xls` can't embed a logo; needs server `openpyxl` | §23.8 |
| Branded PDF export | **Buildable now** — jsPDF supports it, not yet done | §23.8 |
| Reusable dashboard widget library | **None** — dashboards are bespoke pages | §25.1 |
| Per-role dashboard templates | **None** — no persona-specific views | §25.2 |
| Visualization standards | **None** — charts hand-rolled ad hoc | §25.3 |
| Operator tenant isolation | **Enforced but not structural** — convention per page, no test | §26 |
| Passenger O→D route search | **None** — depends on route/stage digitization + PostGIS | §27.1 |
| Upfront fixed fare display | **None** — depends on structured fare charts | §27.1 |
| Passenger live tracking / ETA | **None** — depends on telemetry + internal ETA | §27.1 |
| Demand intelligence (OD / boarding heatmaps) | **None** — the planning-data payoff | §27.3 |

Already present: circuit breaker + retry, Redis, asyncpg, Alembic, Sentry, Prometheus +
Alertmanager + Grafana, JSON structured logging, ABAC policy layer, audit logging,
`pdfplumber`, CI (typecheck, build, boot-smoke).

---

## 29. Suggested sequencing

Ordered by dependency, not by appeal:

0. **Fix the confirmed bugs first** (§15) — email normalisation, the registration race, and
   the `innerHTML` XSS. These are live defects, not architecture, and the XSS is
   operator-triggerable today.
1. **Unblock scaling** — set `SECRET_KEY` and `NAIROBIPAY_CALLBACK_SECRET` explicitly
   (§5.1). Add rate limiting (§6). Cheap, and everything else assumes them.
1b. **Pagination and composite indexes** (§16.1–16.2) — the first hard performance wall,
   and cheaper to fix before the data grows.
1c. **Schema type corrections** (§21) — money to `Numeric`, timestamps to `DateTime`. Do
   these before real financial data exists, and note that §21.2 is a hard prerequisite for
   step 3's TimescaleDB work.
2. **Confirm the IRMS contract** (§9.1) — update frequency and availability determine what
   the tracking product can truthfully offer. Establish before building on it.
3. **Data layer** — PostGIS, then TimescaleDB, then PgBouncer (§3). Route extraction and
   adherence monitoring both depend on PostGIS.
4. **CI hardening** — Postgres/PostGIS integration job and migration checks (§14.2–14.3),
   before there is production data to endanger.
5. **Durable events + task queue** (§4) — closes the silent data-loss path.
6. **Module boundaries** inside the monolith (§2.1), then extract telemetry ingest (§2.2)
   and the WebSocket gateway (§2.3).
7. **Orchestrator + blue/green + CD** (§7, §13, §14.4) — meaningful only once there is more
   than one replica to route between.
8. **OpenTelemetry** (§8) — before the service split, not after.
