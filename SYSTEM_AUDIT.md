# Matatu MMS — Full System Audit

**Scope:** Nairobi City County Matatu Management System — FastAPI backend + Next.js 14 frontend, intended for public/county use at national scale (millions of Nairobians).
**Audit date:** 2026-08-05
**Method:** Folder-by-folder read of source, data-flow tracing (arrest→pay→release, operator onboarding, passenger booking), security review, concurrency/real-time review, and infra review. File:line references are given so every finding is checkable.

> **Headline verdict:** The system is **feature-rich and functionally coherent at prototype scale**, but it is **not yet production-grade for millions of users**. The blockers are architectural, not cosmetic: SQLite, an in-process event bus, in-memory WebSocket state, and several unauthenticated endpoints. None of this is a criticism of the build so far — it's exactly the right shape for moving fast — but the gap to "self-regulated, 24/7, concurrent, millions of users" is real and is mapped below with a prioritized path to close it.

---

## 0. Severity legend

| Tag | Meaning |
|---|---|
| 🔴 **P0** | Security hole or correctness/data-integrity risk. Fix before any public exposure. |
| 🟠 **P1** | Scale/concurrency blocker or broken UX flow. Fix before real load / go-live. |
| 🟡 **P2** | Quality, maintainability, or polish. Schedule, don't rush. |
| 🟢 **OK** | Already done well — noted so it's not accidentally regressed. |

---

## 1. Executive summary — the 12 things that matter most

| # | Finding | Sev |
|---|---|---|
| 1 | **M-Pesa payment callback has zero authentication** — anyone can mark any fine PAID by POSTing JSON. | 🔴 P0 |
| 2 | **Crew GPS WebSocket has no auth** — anyone can inject fake positions for any matatu. | 🔴 P0 |
| 3 | **No version control** — the project folder is not a git repo. No history, no rollback, no CI. | 🔴 P0 |
| 4 | **Plaintext password fallback** in `verify_password` still present. | 🔴 P0 |
| 5 | **SQLite** — single-writer, file-locked. Hard concurrency ceiling; cannot serve millions. | 🟠 P1 |
| 6 | **In-process event dispatcher** (`asyncio.create_task`) — dies with the process, no persistence/retry, breaks across multiple instances. | 🟠 P1 |
| 7 | **In-memory WebSocket/telemetry state** — real-time GPS breaks the moment you run >1 backend instance. | 🟠 P1 |
| 8 | **Onboarding has 3 overlapping surfaces** and a redirect mismatch — a pending operator lands on the *old* piecemeal screen, not the new wizard. This is the "onboarding seems broken" you flagged. | 🟠 P1 |
| 9 | **No automated test suite / CI** — one stale 208-line script; no frontend tests. | 🟠 P1 |
| 10 | **NairobiPay + NTSA still stubbed** — the arrest→pay→release loop has no real money movement or driver lookup. | 🟠 P1 |
| 11 | **Per-persona dashboards are uneven** — Director/Chief Officer see a generic fleet dashboard irrelevant to their job. | 🟡 P2 |
| 12 | **No secrets management / DR / backups** — secrets in env-with-fallbacks, no backup or restore story. | 🟠 P1 |

---

## 2. Folder-by-folder findings

### 2.1 `backend/app/` — core

🟢 **Good:** Clean router-per-domain layout, consistent async SQLAlchemy, Pydantic camelCase aliasing, RBAC centralized in `rbac.py`, dependency-injected permission checks (`requires_permission`).

- 🔴 **P0 — `routes/payments.py` (M-Pesa callback, lines 25–90):** `POST /api/payments/mpesa-callback` accepts an unauthenticated JSON body and, if `bill_ref_number` matches a fine and the amount matches, flips it to `PAID`. **No signature, no shared secret, no Safaricom IP allowlist.** Anyone on the internet can clear any fine. The identical risk will land on the NairobiPay integration if built the same way. *Fix: verify a provider signature/HMAC, pin source IPs at nginx, and treat the callback as untrusted until verified.*
- 🔴 **P0 — `routes/telemetry.py` (crew socket, lines 89–101):** `crew_telemetry_ws` calls `websocket.accept()` with **no `get_current_user`** and trusts `matatu_id` from the path plus arbitrary JSON positions. Anyone can spoof GPS for any vehicle, poisoning the passenger map and any analytics built on it. *Fix: authenticate the crew socket (JWT in query/subprotocol), and verify the crew member owns that matatu.*
- 🔴 **P0 — `auth.py` (`verify_password`, lines 17–24):** Falls back to plaintext comparison for short/non-bcrypt hashes (a seed-data convenience). If any real account ever gets a short/plaintext secret, it's compared in the clear. *Fix: remove the fallback before production; migrate seed users to hashed only.*
- 🟠 **P1 — `events.py` (lines 18–38):** `dispatcher.dispatch` fires listeners via `asyncio.create_task` — fire-and-forget, in-process, no durability, no retry, no back-pressure. Audit writes were correctly moved *inline* (`audit.py`, good call), but notifications and webhooks still ride this bus. Across 2+ instances, an event raised on instance A never reaches a listener on instance B. *Fix: replace with Redis Streams / a broker (see §6).*
- 🟠 **P1 — `database.py` / `config.py`:** `DATABASE_URL` defaults to SQLite. `create_all` on startup, no migration tool. Every schema change this project has required deleting `mms.db`. *Fix: Postgres + Alembic (see §7).*
- 🟡 **P2 — audit coverage:** `stage_audit_log` (`audit.py`) is a solid transaction-scoped pattern and is now used in 10 route files. **Gaps:** `activity.py`, `webhooks.py`, and `auth.py` (login/logout/register) write **no** audit records. For a system whose Terms cite the Data Protection Act, *auth events especially must be audited* (who logged in, when, from where). *Fix: audit auth + activity + webhook-config changes.*
- 🟡 **P2 — `resilience.py`:** Circuit breaker + retry exist for webhooks (nice), but breaker state is per-process in-memory — same multi-instance caveat.

### 2.2 `backend/app/routes/` — endpoint surface

🟢 RBAC is enforced server-side (not just UI), and ownership checks (`sacco_id`, `passenger_user_id`) are consistent in bookings/matatus/saccos.

- 🟠 **P1 — ID generation:** Several routes build IDs from `random.randint` / timestamps (`matatus.py` create, `bookings.py` line 180, `crimes.py`). At high concurrency these can **collide**. *Fix: UUIDs everywhere (already done for enforcement cases/saccos — apply uniformly).*
- 🟡 **P2 — N+1 and full-table scans:** `create_matatu` counts all matatus with `select(Matatu)` then `len(...)` just to build an ID (`matatus.py`); bulk-import re-queries per row. Fine at prototype size, wasteful at scale. *Fix: DB sequences/UUIDs; batch existence checks.*
- 🟡 **P2 — booking seat concurrency:** `create_booking` checks taken seats then inserts (`bookings.py` 169–195) — a classic **check-then-act race**; two passengers can grab the same seat between the check and the commit. *Fix: unique constraint on (matatu_id, seat) for active bookings, or `SELECT … FOR UPDATE` under Postgres.*

### 2.3 `matatu-mms/app/` + `components/` — frontend

🟢 App-Router server components, server actions, signed session cookie, Leaflet GIS map with real WebSocket telemetry and reconnect/backoff (`GisMap.tsx`), consistent county theming.

- 🟠 **P1 — onboarding surface sprawl (the "broken" feeling):** There are **three** operator-onboarding experiences:
  1. `app/operator-onboarding/page.tsx` — initial signup (creates the account).
  2. `app/operator-onboarding/continue/page.tsx` → `OperatorOnboardingWizard.tsx` — the **new** 3-step wizard (documents → officials → review/submit).
  3. `app/(app)/sacco-portal/page.tsx` locked view → `OperatorVerificationStatus.tsx` — the **older** piecemeal upload screen.
  **The bug:** `loginAction` redirects a `SACCO_OPERATOR` to `/sacco-portal`, so a pending operator who logs back in lands on **(3), the old screen**, never the wizard **(2)**. Two different "pending" UIs depending on how you arrive = confusion. *Fix: one canonical pending experience. Redirect pending operators to the wizard (or inline the wizard into the sacco-portal locked view) and delete the redundant one.*
- 🟡 **P2 — `lib/session.ts readSession()` (lines 22–36):** Reads the cookie **without verifying the HMAC signature** (only a structural parse), by design — it trusts middleware to have verified at the edge. Real authz is the backend JWT, so this isn't exploitable for data access, but it's a defense-in-depth soft spot: any server component trusting `readSession().role` for *rendering* decisions trusts unverified bytes. *Fix: verify in `readSession` (cache the async result) or document the trust boundary loudly.*
- 🟡 **P2 — hardcoded fetch/WS fallbacks:** Now env-driven (good), but browser-facing document links still need `NEXT_PUBLIC_BACKEND_URL` set correctly per environment or they 404 behind nginx.
- 🟡 **P2 — no loading/skeleton states** on most server-component pages; a slow backend shows a blank screen, not a spinner.

### 2.4 `backend/test_backend.py`

- 🟠 **P1:** A single 208-line script, almost certainly **predating** operator verification, enforcement cases, bulk import, and the whole enforcement workflow. Effectively **zero meaningful coverage** of current behavior. No frontend tests. No CI to run anything. *Fix: pytest suite for the money/enforcement/onboarding flows; Playwright smoke test for the critical UI paths; GitHub Actions (or self-hosted runner) on every push.*

### 2.5 Root / infra (`nginx/`, `prometheus/`, `docker-compose.yml`, Dockerfiles)

🟢 Reverse proxy with TLS, rate-limit tiers, security headers, WebSocket upgrade; Prometheus + Alertmanager + Grafana wired; health/readiness/metrics endpoints on the backend; structured JSON logging. Solid foundation laid.

- 🔴 **P0 — not under version control:** `git status` → *not a git repository*. There is **no history, no branching, no rollback, no code review gate, no CI trigger point**. For a system this size and this sensitive, this is the single most urgent process fix. *Fix: `git init`, commit, push to a private remote today. The `.gitignore` is already written.*
- 🟠 **P1 — self-signed TLS only; secrets have insecure fallbacks** (`sessionSign.ts` line 11–13 default secret; backend `SECRET_KEY` default). *Fix: real cert (Let's Encrypt), secrets from a manager/vault, no fallbacks in prod.*
- 🟠 **P1 — compose stack never run end-to-end** (Docker engine unavailable in the build environment). YAML validates and nginx braces balance, but `docker compose up` / `nginx -t` must be run on a real host before trusting it (documented in `DEPLOYMENT.md`).

---

## 3. Data-flow analysis (order & connectedness)

### 3.1 Enforcement: arrest → pay → release ✅ (logic) / ⚠️ (money)

```
Arresting Officer (scene)                 Public / Offender              Releasing Officer
─────────────────────────                 ─────────────────              ──────────────────
file case  ─┐                                                            
 • plate    │  offence → FINE LOCKED       looks up case ref            sees PAID case
 • offence  │  (county-fixed amount)  ───►  MMS-xxxxxKDYxxxL   ───►      ├─ Release (only if PAID)
 • action   │  photo(s) REQUIRED            pays via NairobiPay          ├─ Dispute (+reason)
 • photos  ─┘  IMPOUND/SELF_DRIVE flags     [STUBBED — no real money]    └─ Waive (+reason +authorizer)
               the vehicle; TOLL doesn't                                 
               status: ARRESTED  ──────────► PAID ──────────────────────► RELEASED
```

**Verdict:** The *workflow logic and RBAC are correct and verified* (arresting officer can't release; release blocked until paid; Toll doesn't impound). **The gap is the money:** `publicPayCaseAction` just flips status to PAID — no real NairobiPay call, no receipt, no reconciliation. **And the existing M-Pesa callback that *does* touch fines is unauthenticated (🔴 P0).**

**Recommendations for the pay loop:**
- Treat every payment provider callback as hostile input: verify signature/HMAC, pin IPs, make it idempotent (a repeat callback must not double-process — the M-Pesa handler already guards `already PAID`, keep that discipline).
- Give the offender a **real receipt** (SMS + reference) once NairobiPay confirms — the data model already has `payment_reference`.
- The releasing officer should see the **payment proof** (channel, ref, timestamp), not just a PAID badge, before releasing.
- NTSA integration: when live, auto-populate driver name/phone from the plate so the offender gets an SMS with their case ref automatically — closes the loop without the officer hand-copying a code.

### 3.2 Operator onboarding — ⚠️ coherence bug (see §2.3)

```
signup (creates acct, resumable) ──► [SHOULD] wizard: docs → officials → review → submit
                                      [ACTUALLY] login sends pending op to OLD sacco-portal screen
                                                  ▼
                                      Director of Mobility approves (stage 1, docs complete gate) 
                                                  ▼
                                      Chief Officer approves (stage 2, final) 
                                                  ▼
                                      status=ACTIVE ──► full Operator Portal unlocks
```
The two-stage county approval and the document-completeness gate are **correct and verified**. The **entry-point routing is inconsistent** — fix the redirect and collapse to one pending UI.

### 3.3 Passenger booking — ✅ with a race

Book → seat-conflict check → CONFIRMED → crew marks USED / passenger cancels. Works, but the seat check is a check-then-act race (§2.2) that will bite under concurrency.

---

## 4. Concurrency & real-time at scale (millions of users)

This is where "prototype" and "millions of Nairobians" diverge hardest. Three things **must** change:

1. **Database → Postgres.** SQLite serializes writes behind a single file lock. Under real concurrent traffic it will simply stall. *(Already agreed as next step.)* Add PgBouncer for pooling; read replicas for reporting.
2. **Event bus → out of process.** The in-process `asyncio.create_task` dispatcher cannot fan out across instances and loses events on restart. Move to **Redis Streams** (light) now; consider Kafka later (see §9). Run webhooks/notifications/analytics as **separate workers** (Celery/Arq) off the request path.
3. **Real-time state → shared backbone.** `TelemetryConnectionManager` holds live vehicles and passenger sockets **in one process's memory**. With 2+ backends behind nginx, a passenger on instance A can't see a matatu streaming to instance B. *Fix: Redis Pub/Sub (or a dedicated socket layer) as the shared bus; sticky sessions are a band-aid, not a fix.* At national scale, GPS ingestion from tens of thousands of matatus is its own firehose — see the Rust/Go note in §9.

**Also needed for "always-on 24/7":** horizontal scaling (already structured for it via env-driven URLs), health/readiness probes (done ✅), automated Postgres backups + point-in-time recovery, a staging environment mirroring prod, and a documented DR runbook.

---

## 5. Security review (consolidated)

| Finding | Sev | Location |
|---|---|---|
| Unauthenticated M-Pesa callback marks fines paid | 🔴 P0 | `routes/payments.py:25` |
| Unauthenticated crew GPS socket — spoofable telemetry | 🔴 P0 | `routes/telemetry.py:89` |
| Plaintext password fallback | 🔴 P0 | `auth.py:17` |
| No version control / no code-review gate | 🔴 P0 | repo root |
| Insecure default secrets with silent fallback | 🟠 P1 | `sessionSign.ts:11`, backend `config.py` |
| `readSession` trusts unverified cookie payload for render | 🟡 P2 | `lib/session.ts:22` |
| No rate limit on WebSocket connection count (DoS vector) | 🟡 P2 | `telemetry.py` |
| Auth events not audited | 🟡 P2 | `auth.py` |
| PII (phones, licenses, GPS, photos) has no retention/deletion policy | 🟠 P1 | data model + Terms |
| Uploads served from local disk, no virus/type scanning beyond extension | 🟡 P2 | `saccos.py`, `enforcement_cases.py` |

**Cross-cutting:** encryption at rest for PII, a WAF in front of nginx, and DPA-2019 compliance work (retention schedule, subject-access/deletion, lawful-basis records) are all still outstanding and matter a lot for a government system handling millions of citizens' data.

---

## 6. Frontend UX/UX by persona

| Persona | State | Key gaps / recommendations |
|---|---|---|
| **Passenger** | Functional (book, seat map, live GPS map, report) | Add booking history + live "where's my matatu" tracking tied to the ticket; SMS ticket; offline-tolerant PWA (many users on low-end Android / patchy data). |
| **Executive / Viewer** | Sees generic admin overview | Needs a *read-only executive briefing*: county-wide KPIs, revenue trend, compliance %, corridor heatmap — not operational controls. |
| **Admin** | Rich, but broad | Split "system admin" (users, audit, config) from "operations oversight"; the sidebar is long. Merge the two Enforcement links (**already done** ✅ via tabs + redirect). |
| **Director of Mobility / Chief Officer** | ❌ land on generic fleet dashboard | Give them a **work-queue dashboard**: applications awaiting *their* stage, approved/rejected counts, average time-to-decision, SLA aging. Their current landing page is about the fleet, not their job. |
| **Sacco Operator** | Good once active; onboarding sprawl before | Collapse to one onboarding surface (§2.3); add fleet health, revenue, fine status at a glance. |
| **Enforcement (all tiers)** | Strong after the rebuild | Commander needs a live map of who's on duty in which zone; releasing officer needs payment proof, not just status. |

**System-wide UX:** loading skeletons, optimistic UI on mutations, consistent empty states, mobile-first passes (officers and passengers are on phones), and accessibility (contrast, keyboard nav, screen-reader labels) — none are consistently in place yet.

---

## 7. Database

- **Now:** SQLite, `create_all`, no migrations.
- **Target:** **PostgreSQL** + **Alembic** migrations + **PgBouncer** pooling + read replica for analytics. Add proper indexes (plate, case_reference, sacco_id, status columns), foreign-key constraints with `ON DELETE` semantics, and unique constraints (active seat per matatu; case_reference already unique ✅).
- **Analytics access:** never let data scientists/analysts hit the OLTP primary. Give them a **read replica** or a nightly ETL into a separate warehouse, behind a scoped read-only `DATA_ANALYST` role — not ADMIN. This directly serves your "data teams" requirement and keeps citizen PII access auditable and least-privilege.

---

## 8. Maps — TomTom vs Google vs current

**Current:** Leaflet (open-source renderer) + CARTO/OSM raster tiles (free). Good, no lock-in, but OSM road data in parts of Nairobi is thinner than commercial providers, and no built-in traffic/routing.

| Option | Pros | Cons | Fit here |
|---|---|---|---|
| **Keep Leaflet renderer** | No lock-in, already integrated, swap tile source freely | — | ✅ keep as the rendering layer regardless of tile choice |
| **Google Maps** | Best Nairobi data, traffic, Places, StreetView | Costly at millions of map loads, ToS restricts caching/storing tiles & coords, vendor lock-in | Only if you need Places/StreetView specifically |
| **TomTom** | Strong routing + live traffic, fleet-oriented pricing, more permissive on storing/telemetry use | Slightly less POI depth than Google | **Recommended** for a transit/fleet system at scale — better cost predictability + traffic/routing for corridor ETAs |
| **Self-hosted OSM tiles** | Cheapest at scale, full control | You run the tile server; no traffic layer | Good cost hedge; pair with TomTom routing |

**Recommendation:** Keep **Leaflet** as the map library. For a system with millions of map loads and heavy live-vehicle rendering, choose **TomTom** for tiles + traffic + routing (better cost model and telemetry-friendly ToS than Google), with **self-hosted OSM** as a cost-control fallback for base tiles. Reserve Google Maps for a later, narrowly-scoped need (Places/StreetView) if it ever arises.

---

## 9. Tech-stack questions you raised

### Kafka — **not yet.**
Redis Streams (or Celery/Arq on Redis) covers your near-term needs — event fan-out, webhook delivery, background jobs — with far less to operate. Kafka's real value (durable, replayable, multi-consumer log at high throughput) becomes worth its operational weight **once** you have the data-science pipeline + audit + notifications all consuming the same event stream at scale. Adopt it **after** Postgres + Redis are in and you have real volume to size against. Self-hosting Kafka is a meaningful ops burden — don't take it on speculatively.

### Rust backend — **no full rewrite.**
Python/FastAPI is **not** your bottleneck; SQLite + in-process events + single-instance are. A rewrite would burn months and discard working, correct code. **However:** the one legitimate future candidate for Rust (or Go) is a **dedicated GPS-telemetry ingestion service** — if tens of thousands of matatus stream positions continuously, that single high-frequency firehose is worth a `tokio`/`axum` (Rust) or Go microservice, kept **separate** from the business API. Decision: keep FastAPI for the CRUD/business/RBAC API; revisit a standalone telemetry-ingestion service in Rust/Go **only when telemetry volume proves it**.

### Sentry / error tracking — **yes, add soon (self-hosted-friendly variant).**
Prometheus gives you metrics; you still lack per-error stack traces with user/request context and automatic alerting. Self-hosted Sentry is heavy (it itself needs Kafka/ClickHouse/Snuba). Use **GlitchTip** (Sentry-SDK-compatible, runs on just Postgres + Redis) for self-hosting, or Sentry's hosted free tier if one external dependency for error tracking is acceptable.

---

## 10. What's missing (net-new, not yet built anywhere)

- Git repository + CI/CD pipeline (🔴 P0).
- Real payment integration (NairobiPay) with signed, idempotent, IP-pinned callbacks (🟠 P1).
- NTSA integration for driver/plate lookup (🟠 P1, blocked on API access).
- Postgres + Alembic + pooling (🟠 P1, agreed next).
- Redis (queue/pub-sub/cache) + background workers (🟠 P1).
- Shared real-time backbone for WebSockets (🟠 P1).
- Automated tests + CI (🟠 P1).
- Secrets manager, real TLS, WAF, backups, DR runbook, staging env (🟠 P1).
- DPA-2019 compliance: retention/deletion policy, data-subject rights, PII encryption at rest (🟠 P1).
- Grafana dashboards + Alertmanager real receiver (Slack/PagerDuty/SMS) (🟡 P2).
- Error tracking (GlitchTip/Sentry) (🟡 P2).
- Per-persona dashboards for Director/Chief/Executive (🟡 P2).
- SMS/notification gateway (currently simulated in `listeners.py`) (🟡 P2).

---

## 11. Prioritized roadmap

**P0 — before *any* public exposure (days):**
1. `git init` + private remote + branch protection. *(30 min, unblocks everything.)*
2. Authenticate the M-Pesa/payment callback (signature + IP pin + idempotency).
3. Authenticate the crew GPS WebSocket + ownership check.
4. Remove the plaintext password fallback; hash all seed users.
5. Real secrets (no fallback defaults) + real TLS cert.

**P1 — before real load / go-live (weeks):**
6. Postgres + Alembic + PgBouncer (agreed next).
7. Redis: event bus (Streams) + cache + shared WebSocket pub/sub + background workers.
8. Fix onboarding routing → one canonical pending/wizard surface.
9. NairobiPay integration on the hardened callback pattern; issue real receipts.
10. Test suite (pytest for money/enforcement/onboarding flows) + CI.
11. Backups + PITR + staging + DR runbook; audit auth events; PII retention policy.
12. Seat-booking race fix (unique constraint / row lock); UUID IDs everywhere.

**P2 — quality & scale-readiness (ongoing):**
13. Per-persona dashboards (Director, Chief, Executive).
14. Map provider decision (TomTom + Leaflet) + corridor ETAs.
15. GlitchTip/Sentry; Grafana dashboards; real Alertmanager receiver.
16. Mobile-first + accessibility + loading states pass.
17. Analytics read replica + scoped `DATA_ANALYST` role + ETL.
18. Evaluate Kafka and a Rust/Go telemetry-ingestion service **only when volume justifies**.

---

## 12. What's genuinely already strong (don't regress)

- Independent, RBAC-correct role dashboards; server-side permission enforcement.
- Two-stage operator verification with a document-completeness gate.
- Enforcement arrest→release workflow with locked fines and strict duty separation.
- Transaction-scoped audit logging pattern (`audit.py`) — the *right* design.
- Signed session cookies; backend JWT as the true authz boundary.
- Health/readiness/metrics endpoints + structured JSON logging + nginx edge with rate limiting.
- Real (non-simulated) WebSocket telemetry with reconnect/backoff on the client.

---

*End of audit. Every 🔴/🟠 item above is actionable and most reference an exact file:line. Recommend working top-down: P0 this week, then the agreed Postgres migration kicks off P1.*
