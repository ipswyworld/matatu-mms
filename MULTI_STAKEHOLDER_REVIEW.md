# Multi-Stakeholder Review — Matatu Management System

**Purpose of this document.** Every role below reviews the system through
its own professional lens: what looks solid to *them* specifically, and
what they'd push for next. This is deliberately a working document, not a
finished report — every section is meant to be corrected, argued with, and
added to. Where a claim is made, it's grounded in something actually built
and verified (with a commit or a concrete test result), not a guess. Where
a recommendation appears, the "why" is the point — arguing with the why is
more useful than arguing with the ask.

**How to use it.** Each role gets: what they'd sign off on, what they'd
block on, and what they'd ask for next quarter. Cross-cutting issues that
several roles independently flag are pulled into their own section at the
end, because those are usually the ones that actually matter most.

**Companion documents.** This sits alongside `production_readiness_list`
(the feature-by-feature build checklist) and the Ops Console Rebuild Spec.
This document is organized by *who is looking*, not by *what was built* —
use it to find out who cares about a given piece of work and why, or to
sanity-check that every discipline has actually had a say.

---

## 1. Data Analyst

**Would sign off on:**
- Append-only, exportable audit log with before/after values on every
  mutation — the raw material for any report is already there, not
  reconstructed after the fact.
- Ledger trial balance and reconciliation endpoints (`/api/ledger/*`) —
  revenue numbers are queryable and provably self-consistent (sum of all
  postings verified at `0.00` against real Postgres).
- Messaging spend summary by category (`/api/messaging/spend`) — cost
  attribution exists from day one, not bolted on after a surprise invoice.
- Demand intelligence dashboard (OD matrix, boarding heatmap) blending
  crowdsourced condition reports with TomTom traffic data.

**Would ask for, and why:**
- **A real data warehouse or read replica for reporting**, separate from
  the OLTP primary. Every analytical query right now runs against the same
  Postgres instance serving live traffic — fine at demo volume, a genuine
  risk once dashboards get heavy at 500k users (§2, §18 of the readiness
  list already flag this; it's not built yet).
- **A metrics dictionary.** Field names like `fine_amount_kes` vs
  `amount_kes` vs `fine_amount_kes` (three different spellings across three
  schemas, confirmed while migrating money fields to `Decimal`) make
  cross-table analysis error-prone without someone who already knows the
  quirks.
- **Scheduled exports** (CSV/Sheets) for county finance and compliance
  reporting, so "give me last month's fine revenue by Sacco" isn't a
  bespoke query every time.
- **Cohort and retention analysis on ridership**, once real usage exists —
  the booking and trip tables support it structurally, nothing computes it
  yet.

---

## 2. Data Scientist

**Would sign off on:**
- Real signal ingestion already exists: crowdsourced condition reports
  blended with TomTom traffic, crew headcount logging for actual ridership
  (not estimated), demand signals table.
- The fraud/integrity module (`app/integrity.py`) is a legitimate starting
  feature set — void rates, repeat-vehicle targeting, separation-of-duties
  breaches — even though it's rule-based rather than learned.

**Would ask for, and why:**
- **Move integrity detection from fixed thresholds to a real model** once
  there's enough labelled history. `HIGH_VOLUME_FINES_PER_DAY = 40` and
  `HIGH_VOID_RATE = 0.25` are reasoned-about constants, not learned from
  data — they'll drift wrong as the system scales past Nairobi.
- **A feature store**, so fare-demand forecasting and fraud detection stop
  each re-deriving the same signals (time-of-day, route load, officer
  history) independently.
- **An experimentation framework** (A/B testing) before touching fare
  policy or route changes at scale — right now a policy change (like the
  commission rate in `app/revenue.py`) is a single constant, not a
  testable variable.
- **Access to anonymised historical data** for model training that doesn't
  require going through the same DPA erasure/export path built for
  individual subject requests (§9) — that path is correctly locked down
  for personal data access, which means it's the wrong door for bulk
  research use.

---

## 3. Big Data / Data Engineering

**Would sign off on:**
- TimescaleDB hypertable conversion for `vehicle_positions`, with a
  continuous-aggregate migration written and *tested against two license
  tiers* — the migration was caught failing in production against Render's
  Apache-licensed TimescaleDB (no Community features), fixed to degrade
  gracefully with per-statement savepoints, and re-verified against both
  license tiers before being called done.
- Redis Streams as the durable event bus — appropriately sized for current
  volume, not over-built.
- Postgres full-text search (GIN indexes, `websearch_to_tsquery` chosen
  specifically because it never raises on malformed input) replacing
  `ILIKE`, which would have degraded linearly and become unusable in the
  low hundreds of thousands of rows.

**Would ask for, and why:**
- **A Timescale-licensed Postgres** (self-hosted or Timescale Cloud), not
  Render's Apache build. Confirmed directly in production: continuous
  aggregates, compression, and retention are *all unavailable* on the
  current plan. Raw GPS telemetry will grow unbounded with no downsampling
  until this changes — fine at ~20-30k vehicles' worth of demo data, a real
  storage-cost problem at true fleet scale.
- **A proper analytical store** (warehouse or lakehouse) once telemetry and
  audit volume outgrow what a single Postgres instance should be asked to
  serve for both transactions and analytics simultaneously.
- **Kafka-API-compatible broker, but explicitly *not yet*** — Redis Streams
  should be kept until volume actually demands the switch; recommending a
  heavier broker now would be premature engineering. **When that day comes,
  prefer Redpanda over Kafka**: it speaks the Kafka wire protocol (so
  nothing downstream — client libraries, `librdkafka`, existing consumer
  code — needs to change), but ships as a single binary with no ZooKeeper/
  KRaft cluster to operate, which matters for a small platform team running
  three frontends and a backend already. Not needed today; worth deciding
  *now*, in writing, so the eventual migration is "swap the connection
  string" rather than a fresh six-way broker bake-off under pressure.
  **Clarification worth stating explicitly, since it's a natural
  question**: this is a *replacement* path, not an *add-both* path.
  Redpanda and Redis Streams solve the same problem (a durable, replayable
  event log with consumer groups) — they don't integrate with or enhance
  each other, and there's no version of "use both" that adds capability
  rather than just operating two separate broker systems for overlapping
  use cases. Running both before Redis Streams has actually hit a real
  limit would itself be the premature engineering this bullet argues
  against. If a specific future scenario ever justifies splitting
  workloads across two brokers (e.g., very high-volume telemetry on one,
  everything else on the other), that's worth its own dedicated review
  when it comes up — not a default "more is better" move today.
- **dbt or Airflow** once there's more than one scheduled transformation
  job, to avoid ad hoc cron scripts multiplying silently.

---

## 4. Platform Engineering

**Would sign off on:**
- Kubernetes manifests exist and parse (`infra/kubernetes/`): backend,
  control-plane, worker, and migrations correctly modeled as a `Job` (not
  an `initContainer`, which would run `alembic upgrade head` once per
  replica concurrently against the same database).
- The `APP_ROLE` pattern in `docker-entrypoint.sh` — one image, two
  runtime roles (`api` / `control-plane`) — means the ops control-plane
  split (Ops Console Rebuild Spec §3.1) is a deployment decision, not a
  second codebase to maintain.
- CI gates that are enforced, not advisory: the performance budget job
  fails a build over budget; the security-scan job is explicitly advisory
  by design (a transitive CVE shouldn't block an unrelated hotfix) and
  says so in its own comments.

**Would ask for, and why:**
- **Actually apply the Kubernetes manifests.** They're written and
  validated by parsing, never run against a real API server or
  `kubectl apply --dry-run=server`. "The YAML is correct" and "the cluster
  comes up clean" are different claims.
- **Per-service path filters in CI/CD.** Confirmed directly: a single
  commit touching only `matatu-mms-public/middleware.ts` triggered a full
  rebuild of all four Render services. Harmless today, wasteful and slower
  as build volume grows.
- **Terraform** for the cloud resources themselves (§1) — currently every
  environment is Render-dashboard-clicked, meaning "what's actually
  running in production" is knowledge that lives in one person's head.
- **A real staging environment** that mirrors production topology, so an
  infrastructure-shaped bug (not just a code bug) gets caught before a
  live deploy — the Apache-license migration failure would have been
  caught here instead of in production.
- **CD, not just CI.** Confirmed directly: the pipeline runs tests, security
  scans, and the performance budget, but nothing *deploys* — Render's
  autoDeploy-on-push is the entire release mechanism today, with no gate
  between "CI passed" and "live in production." **ArgoCD** is the right
  next step: it reconciles a Git-declared desired state into the cluster
  continuously, which both gives an actual audit trail for "what changed
  and when" (currently reconstructed after the fact from Render's deploy
  log) and is the natural control point for the next ask —
- **Blue-green deployment structure.** Today a bad deploy is caught by
  users, then rolled back by re-deploying the previous commit — there is no
  parallel "new" environment to validate against production traffic before
  cutting over, and no instant revert. This depends on the Kubernetes
  manifests actually being applied (first bullet above) before it's
  buildable at all; sequence it after that, not before.

---

## 5. Network Engineering

**Would sign off on:**
- The client-IP resolution fix (`app/client_ip.py`) — a real, diagnosed,
  and *proven* bug: the login rate limiter was keying on
  `request.client.host`, which uvicorn populates from the **last** entry
  of `X-Forwarded-For`. Behind Cloudflare → Render, that's an internal
  proxy address shared by every user routed through that hop — confirmed
  directly from live `login_events` data showing a mix of real client IPs
  and RFC1918 addresses. Fixed by preferring `CF-Connecting-IP` (trusted
  and unspoofable behind Cloudflare) over blind trust in XFF ordering.
- The ops console's network gate (`app/network_gate.py`) — CIDR allowlist
  enforced in the control-plane process itself, fails open with a loud
  warning rather than silently bricking existing deployments, and returns
  404 rather than 403 on a block (a 403 confirms there's something worth
  attacking there).
- A `/api/system/client-ip` diagnostic endpoint added specifically because
  this class of bug took three attempts to properly diagnose — it now
  takes one request.

**Would ask for, and why:**
- **Real network isolation for the ops control plane**, not just the
  application-layer CIDR gate. The gate is the correct backstop; it's not
  a substitute for the control plane having no public ingress at all
  (which is how the Kubernetes manifests deploy it, but that isn't live
  yet).
- **A real WAF**, not just Cloudflare's default free-tier behavior in
  front of a Render origin.
- **DDoS review** — a public government service at 500k users is a
  plausible target, and this hasn't been load-tested or attack-modeled at
  the network layer.
- **Confirmation of Render's `X-Forwarded-For` ordering going forward.**
  This was inferred from observed behavior, not from a guaranteed Render
  spec — worth a monitored assertion so a future infra change upstream
  doesn't silently reintroduce the exact bug just fixed.

---

## 6. Frontend Development

**Would sign off on:**
- PWA install path (manifest + service worker + offline fallback) for the
  public app — and specifically, the fact that a real bug in it
  (`/manifest.webmanifest` and `/offline` both 307-redirecting to sign-in,
  silently killing installability with zero visible error) was caught by
  *checking the deployed artifact*, not by assuming the deploy succeeding
  meant the feature worked.
- The service worker's caching policy is deliberately conservative: API
  responses, live tracking, and anything payment-related are **never**
  cached, and only `GET` is intercepted — a cached `POST` replay would
  re-book a seat or resubmit a payment.
- Bundle performance budget enforced in CI on gzip-measured size (not raw
  disk size — an earlier version of the check measured the wrong thing and
  would have failed every route on day one).
- The ops console rebuild: seven focused routes replacing one 1,045-line
  scrolling page, an action-safety framework (`<ActionButton>`) that makes
  confirmation and audit structural rather than a per-call-site habit.

**Would ask for, and why:**
- **A real accessibility audit (WCAG 2.1 AA).** Nothing in this session
  tested screen-reader behavior, color contrast, or keyboard-only
  navigation — and this is a government service with a real accessibility
  obligation.
- **A component library / design system**, formalized rather than
  duplicated. `PageBanner.tsx` and `NotificationBell.tsx` are kept
  byte-identical across two apps via a CI `diff` guard specifically
  *because* there's no shared package yet — a deliberate, reasoned
  tradeoff, but one worth revisiting once a third app needs the same
  component.
- **Real E2E tests** (Playwright/Cypress) — everything verified this
  session was manual browser-tool exploration, not a repeatable automated
  suite. The PWA middleware bug is exactly the kind of regression an E2E
  smoke test (visit `/manifest.webmanifest`, expect 200) would catch
  permanently.
- **A lint rule for the static-file exemption pattern.** The middleware
  regex missing `webmanifest` is a bug class, not a one-off — any future
  static asset type added to `/public` risks the identical silent failure.

---

## 7. Backend Development

**Would sign off on:**
- ABAC/RBAC reuse for machine principals: `ApiClientPrincipal` presents
  `.id`/`.sacco_id`/`.role` and is scoped by the *exact same*
  `sacco_scope_query` that confines a human Sacco operator — zero changes
  to the authorization engine were needed, verified live (a `sacco-1`
  client saw only `sacco-1` vehicles and fines against real Postgres).
- The double-entry ledger (`app/ledger.py`, `app/revenue.py`): balance
  enforced before write, amounts refuse `float` outright rather than
  silently converting, reversal via a pointing-back entry rather than
  mutation. Revenue recognition policy (fines at issue, not payment; fare
  commission split from the Sacco's share) is documented as policy, not
  buried in code.
- Idempotency (`app/idempotency.py`) verified to actually prevent a double
  booking — replay returns the *same* booking rather than creating a
  second one, and a key reused with a different body is refused with 409.
- Per-account login throttle *and* per-IP limiter as two independent,
  complementary controls — confirmed the per-account one has never
  actually fired in eight-plus months of demo traffic (checked directly
  against the full audit history).

**Would ask for, and why:**
- **Finish the `Decimal` migration on response shapes.** Nine money
  fields were migrated end-to-end this session using a `MoneyKES` type
  that stays a JSON number on the wire (no frontend break); worth
  auditing for any remaining `float` money fields missed.
- **OpenAPI as a published, versioned contract**, not just FastAPI's
  auto-generated schema — partner integrators (§14) need something they
  can diff between versions.
- **A self-cleaning regression suite.** Found directly: 
  `test_security_regressions.py` creates users with fixed phone numbers
  and fails on a second run against a persistent database — passes 9/9 on
  a fresh database, but this needs fixing before it runs in CI against a
  shared Postgres, where it would look like a false regression.
- **Background job observability.** ARQ jobs are visible in the ops
  console (queue depth, retry, cancel), but there's no historical view of
  job failure rates over time.

---

## 8. Full-Stack Development

**Would sign off on:**
- The ops console rebuild as a genuinely coherent full-stack feature:
  backend action endpoints, a live SSE feed (chosen over WebSocket
  specifically because the feed is one-directional and SSE brings its own
  reconnection semantics), and a frontend action-safety framework that
  enforces confirmation/reason/re-auth structurally — verified end to end
  including a real Critical-tier action (maintenance mode) that, when
  tested for real, revealed and then fixed a self-inflicted lockout bug
  (enabling maintenance mode blocked the console's own disable button).
- The control-plane process split: same codebase, different `APP_ROLE`,
  proven live by showing the split control plane correctly aggregating
  metrics it never directly served (`instanceCount=2` reported from a
  process with zero user traffic of its own).

**Would ask for, and why:**
- **Shared type generation between frontend and backend.** Types are
  currently hand-kept in sync (Pydantic schemas on one side, TypeScript
  interfaces on the other) — a generator (e.g., `openapi-typescript`)
  would remove an entire class of drift bug.
- **A single source of truth for the design tokens** used across the
  three separate Next.js apps, rather than three copies that happen to
  currently agree.

---

## 9. Database Management / DBA

**Would sign off on:**
- The full 34-plus-revision Alembic migration chain has actually been run
  against real Postgres 16 twice — once on a plain instance to exercise
  the graceful-degradation path, once on a Timescale-licensed instance to
  exercise the full path — not just against the SQLite dev fallback that
  every other test in this project runs on by default.
- Idempotency and uniqueness constraints verified as *database-enforced*,
  not just application-assumed: a duplicate `idempotency_key` insert was
  confirmed to fail at the Postgres level, not merely caught in Python.
- `Numeric(12,2)`/`Numeric(14,2)` used throughout for money, never
  `Float` — confirmed to round-trip exactly (`1234.57` stays `1234.57`
  through the column, both ledger postings, and the API response).

**Would ask for, and why:**
- **This is time-critical, not a suggestion:** the free-tier Postgres
  database (`matatu-mms-db`) expires and is **permanently deleted** on
  **2026-09-14** — four days out as of this review. Either upgrade the
  plan or take a verified backup before then; there is no undo once
  Render's automatic deletion runs.
- **Point-in-time recovery (PITR)** once off the free tier — currently
  there is no backup/restore capability at all beyond whatever Render's
  free plan happens to retain before deletion.
- **A read replica** for reporting, separating analytical load from
  transactional load (echoes the Data Analyst and Big Data asks above —
  three different disciplines converging on the same gap is a signal).
- **PgBouncer / connection pooling** before Kubernetes autoscaling
  multiplies backend pod count — more pods means more raw Postgres
  connections, and Postgres has a hard ceiling on those.

---

## 10. Security

**Would sign off on:**
- Layered rate limiting: per-IP (now correctly keyed on the real client,
  not a shared proxy address) plus an independent per-account throttle
  that survives even if the per-IP layer is somehow bypassed.
- Infisical wired as a secrets provider with environment-variable
  precedence (nothing breaks without it configured) and fail-open logging
  rather than fail-to-boot on a provider outage.
- DPA data-subject rights (export and erasure) — and specifically, that a
  **real PII leak was found and fixed** during this work: an early version
  of the erasure path looked up consent records by the wrong key and left
  a subject's actual phone number in the database after "successful"
  erasure. Found by actually running the erasure function once (it had
  never been executed before review), not by code inspection alone.
- CI vulnerability scanning (`pip-audit`, Trivy, `gitleaks`) wired as
  advisory rather than blocking, with the reasoning made explicit: a
  newly-disclosed transitive CVE shouldn't block a hotfix that might
  itself be the incident response.
- MFA, session revocation, and step-up re-authentication for Critical-tier
  ops actions (password + MFA re-check before maintenance mode or a
  system-wide session revoke).

**Would ask for, and why:**
- ~~Rotate the Render API key used during this review immediately.~~
  **Done (2026-09-12)** — revoked in the old account's dashboard, confirmed
  dead (returns `401 Unauthorized`). It had since been used for the
  account migration's teardown work, not just the original read/diagnostic
  calls, but by the time it was revoked the old account held nothing left
  to protect.
- **A real penetration test** before any countrywide launch — internal
  review, however thorough, is a different exercise from an external
  adversarial one.
- **The ops console's network gate needs real infrastructure backing it**
  (see Network Engineering) — the application-layer CIDR allowlist is
  correct as a backstop, not as the whole story.
- **A documented, drilled incident-response runbook.** Several real
  incidents this session (a failed production deploy from a licensing
  mismatch, a live PII leak, a proxy-IP misattribution bug) were each
  diagnosed live and ad hoc — worth turning the diagnostic steps used into
  a standing runbook so the next incident is faster.

---

## 11. Researchers (transit policy / academic / product research)

**Would sign off on:**
- Real instrumentation exists for the questions researchers actually ask:
  crowdsourced condition reports, demand signals, an OD (origin-destination)
  matrix, and crew-logged headcounts as a real ridership proxy rather than
  an estimated one.
- The retention and aggregation policy on GPS telemetry (once a
  Timescale-licensed instance is in place) is designed with a stated
  reason tied to the enforcement dispute window, not an arbitrary number —
  a defensible starting point for a longitudinal study design.

**Would ask for, and why:**
- **A distinct research-data API tier**, separate from both the personal
  data-subject-rights path (§9, correctly locked to the individual) and
  the commercial partner API (§14, correctly scoped to a single Sacco).
  Neither door is the right one for "give an approved researcher
  anonymised aggregate ridership data" — that's a third access pattern
  that doesn't exist yet.
- **Open, versioned aggregate exports** (route-level ridership, compliance
  funnel status) for public-interest and academic use, with clear
  aggregation thresholds so no export can be re-identified back to an
  individual passenger or vehicle.

---

## 12. UI/UX

**Would sign off on:**
- The login-page simplification: crew-number clutter removed from the
  identifier field on direct user feedback, `PageBanner` shrunk from a
  hero-scale banner (`py-8`/`text-[34px]`) to a compact header, measured
  live at 88px tall — a concrete, verified size reduction, not just an
  intention.
- The offline page for the public PWA states plainly what still works and
  what doesn't ("booking and payment need a connection; nothing you
  submitted while offline was sent") rather than a generic apology — the
  right instinct for a transit app used on unreliable mobile connections.
- Google Sans was tried, found not to fit, and **cleanly reverted** via
  `git revert` rather than left half-migrated — a healthy sign for design
  iteration discipline.

**Would ask for, and why:**
- **Usability testing with real matatu passengers and crew**, specifically
  on lower-end Android devices over real Kenyan mobile data — nothing in
  this build has been tested with an actual target user yet, only
  simulated via a desktop browser tool.
- **An accessibility pass** (this is the same ask as Frontend Dev, from a
  different angle: UX cares about the human outcome, Frontend cares about
  the implementation — both need it and neither has done it yet).
- **A first-run onboarding flow.** The apps assume a user already knows
  what a "stage," a "Sacco," or a "BRN route" is — real for county staff,
  not necessarily real for a first-time passenger.
- **Empty-state design** for the many list views (fines, bookings,
  vehicles) — currently mostly a plain "no records" line rather than a
  designed state that guides the next action.

---

## 13. The Public (passengers, crew, Sacco operators, citizens)

**Would value:**
- Being able to book a seat, track a vehicle, and pay a fine from a phone,
  installable as an app without going through an app store.
- The fine dispute process, and the fact that overturned or waived fines
  are handled distinctly in the revenue ledger (an overturned *paid* fine
  correctly creates a refund liability rather than pretending the payment
  never happened).
- Multi-language support (English/Swahili) built in from the start rather
  than retrofitted.

**Would ask for, and why:**
- **Reliability, plainly.** During this review, the public app returned a
  503 on a completely ordinary first login attempt — a real user
  encountering that with no context would reasonably assume the whole
  system is broken, not "the free hosting tier's container was asleep."
  This is the single most important ask from this stakeholder group:
  fix the perception problem even before (or alongside) the underlying
  infrastructure fix.
- **An SMS-based fallback** for feature-phone users or anyone without a
  reliable data connection — the system currently assumes a smartphone
  and a working PWA.
- **Plain-language fare and fine explanations** — "why is this fine
  KES 3,500" and "why does my fare have a Sacco share and a county share"
  are reasonable citizen questions the UI doesn't yet answer directly.
- **A public status page**, so "is the system down or is it just me"
  has a real answer during an outage instead of a guess.

---

## 14. Private Investors / Funders

**Would view favorably:**
- **Real, auditable accounting.** The double-entry ledger is the kind of
  financial infrastructure due diligence looks for specifically — every
  shilling traceable to a posting, self-balancing, reversible without
  mutation. This is not a common feature in an early-stage civic tech
  system and is worth highlighting.
- **A demonstrated, monetizable partner API** (§14) with tiered quotas,
  scoped credentials, and OAuth2 — the technical foundation for a Sacco
  integration or countrywide-federation revenue model already exists,
  not just as an idea.
- **Genuine engineering discipline under scrutiny.** Multiple real bugs
  (a production deploy failure, a live PII leak, a proxy-misattribution
  rate-limit bug) were found and fixed *by actually testing against
  production and real Postgres*, not merely asserted fixed. That's a
  signal about how the team operates under pressure, which matters more
  to a serious investor than a clean-looking backlog.

**Would ask for, and why:**
- **A clear unit-economics view**: cost per active user, infrastructure
  cost trajectory from demo to 500k users, and the SMS cost-tracking work
  already built (`app/messaging.py`) extended into an actual budget
  dashboard rather than just a spend log.
- **A concrete compliance roadmap** (DPA formalization, eventual SOC2-
  style posture) with dates, not just the technical building blocks
  already in place.
- **A clearly articulated revenue model**: the fare-commission split and
  licensing-fee flows exist in the ledger, but the pitch-deck-level
  explanation of "this is how the county and the platform both make
  money" is a business document, not a code artifact, and doesn't exist
  yet.
- **A named path to countrywide expansion** — the system is deliberately
  Nairobi-only in its data model right now (a conscious, reasoned
  deferral, not an oversight), and investors will want to know when and
  how that changes.

---

## 15. QA / Test Engineering

**Would sign off on:**
- A permanent pytest regression suite exists and covers real
  concurrency-race scenarios (last-Super-Admin lockout race, impersonation
  ticket reuse, crew-number collision) — not just happy-path checks.
- A dedicated Postgres verification harness (`verify_postgres.py`) that
  correctly reports unavailable features as **SKIPPED**, never as a false
  PASS — this matters because an earlier version of the same harness had
  exactly that blind spot (reporting TimescaleDB Community features as
  failed rather than unlicensed) before being corrected.
- A k6 load-testing scenario modeled on real traffic shape (bimodal
  commute peaks, reads far outnumbering writes) rather than a flat
  request flood, with 429 and 409 responses correctly treated as *passing*
  behavior, not failures.

**Would ask for, and why:**
- **Actually run the k6 scenarios once**, even locally — they're written
  and never executed, so their own correctness is unverified.
- **CI-integrated Postgres testing** — currently only possible manually
  against a hand-started container; the regression suite's
  non-idempotency against a persistent database (see Backend Dev, Database
  Management) needs fixing before this is safe to automate.
- **Visual regression testing** for the three frontends, given how much
  UI work has happened iteratively (PageBanner, fonts, login form) with
  only manual before/after screenshots as the record.

---

**A note on sourcing for the sections below.** The system already carries
several standalone audit documents from earlier work —
`ARCHITECTURE_DECISIONS.md`, `CD_PIPELINE_STATUS.md`,
`TENANT_ISOLATION_AUDIT.md`, `RUNBOOKS.md`, `SERVICE_EXTRACTION_READINESS.md`,
`NTSA_IRMS_INTEGRATION_CHECKLIST.md`, and an early-stage `SYSTEM_AUDIT.md`.
Where a role below draws on one of those, it's cited by name rather than
repeated wholesale. **`SYSTEM_AUDIT.md` is historical**: it was written
against an earlier version of this codebase (SQLite as the default,
M-Pesa, no git repo) and its three P0 findings — the unauthenticated
payment callback, the unauthenticated crew GPS WebSocket, and a plaintext
password fallback — were checked directly against the current code for
this review and are **all three already fixed** (HMAC-verified NairobiPay
callback in `routes/payments.py`; JWT-authenticated, ownership-checked
crew WebSocket in `routes/telemetry.py`; `_verify_password_sync` fails
closed on a malformed hash, no plaintext path). Treat that document as a
snapshot of where the project started, not its current state.

## 16. Software Architect

**Would sign off on:**
- The modular-monolith call in `ARCHITECTURE_DECISIONS.md` §2 — explicit
  module boundaries (licensing, fleet, enforcement, revenue, routing,
  bookings) inside one deployable, with two carve-outs already identified
  by their actual differentiating trait (telemetry's write-heavy/lossy
  profile vs. the business app's request-driven/lossless one) rather than
  a generic "let's do microservices" instinct. This is the right call at
  current team size, made for the right reason, and written down instead
  of assumed.
- The ABAC/RBAC engine's reuse for machine principals (§7 above) as a
  concrete example of the architecture actually paying off: a new
  principal type slotted in with zero changes to the authorization core.

**Would ask for, and why:**
- **Follow through on the two named carve-outs** (telemetry ingest,
  real-time WebSocket gateway) — `SERVICE_EXTRACTION_READINESS.md` has
  already mapped the module boundaries an extraction would use; the
  document exists, the extraction doesn't yet. Worth a date, not just a
  plan.
- **A living architecture decision record (ADR) practice**, not one large
  document. `ARCHITECTURE_DECISIONS.md` is thorough but monolithic;
  splitting future decisions into one-ADR-per-decision makes it possible
  to see when a call was made and revisit it without re-reading the whole
  file.

---

## 17. DevOps Engineer

**Would sign off on:**
- `CD_PIPELINE_STATUS.md`'s honest built-vs-blocked split: image build/
  scan/push to `ghcr.io` with git-SHA tags is real and running in CI;
  blue/green mechanics (`docker-compose.canary.yml`, `nginx.canary.conf`,
  `scripts/canary-promote.sh`) are genuinely runnable today, including a
  health-gated weight shift and zero-downtime WebSocket handling — not
  aspirational YAML.
- The document says plainly what's blocked and why (no second Render
  environment to call "staging," no orchestrator yet) rather than papering
  over the gap by pointing "staging" at the same service production uses.

**Would ask for, and why:**
- **This is the same ArgoCD/blue-green ask already in §4 (Platform
  Engineering), from the operating side of it**: the canary scripts exist
  but currently target a self-hosted `docker-compose` stack, not the
  Render deployment actually running production. Either stand up the
  Kubernetes path the manifests describe (unblocking real blue/green) or
  explicitly scope canary promotion to the self-hosted target and say so.
- **A staging environment**, called out in `CD_PIPELINE_STATUS.md` itself
  as blocked on a billing decision (a second Render service/environment),
  not a code change — worth escalating as exactly that: a decision to
  make, not an engineering task waiting on someone.

---

## 18. Site Reliability Engineer (SRE)

**Would sign off on:**
- `RUNBOOKS.md`'s dependency fallback matrix and four incident runbooks
  (backend won't start after a deploy, webhook deliveries failing for one
  Sacco, DB pool exhausted, live map stopped updating) — written from
  actual failure modes this project has hit, not generic templates.
- The circuit-breaker registry (`app/ops_breakers.py`) built on top of
  `app/resilience.py`, with manual operator overrides (force-open,
  force-closed) surfaced in the ops console rather than only visible in
  logs.

**Would ask for, and why:**
- **The circuit breaker's own caveat, taken seriously**:
  `ARCHITECTURE_DECISIONS.md` §4.3 already flags that breaker state is
  per-process and resets on restart, meaning it will not mean what it
  appears to mean once running multi-replica. This is a known, written-down
  limitation, not a surprise — worth prioritizing before replica count
  goes above one for real.
- **SLOs with actual error budgets**, not just alerting rules
  (`alertmanager/alertmanager.yml` exists — worth confirming it's wired to
  a defined SLO, not just raw thresholds).
- **A disaster-recovery drill**, not just a runbook read-through — the
  Postgres-expiry deadline (Cross-Cutting Theme #1) is exactly the kind of
  event a runbook should have already been rehearsed against.

---

## 19. Cloud Infrastructure Engineer

**Would sign off on:**
- Multi-cloud-agnostic Kubernetes manifests already exist
  (`infra/kubernetes/`) alongside the current Render-based deployment,
  meaning a future move off Render isn't a rewrite.
- `docker-compose.yml` / `docker-compose.canary.yml` giving a fully local,
  runnable stack for development that mirrors production's container
  boundaries.

**Would ask for, and why:**
- **Same ask as Platform Engineering (§4) and DBA (§9), from the
  infrastructure-cost angle**: Terraform for what's currently
  Render-dashboard-clicked, and moving off free-tier Postgres before
  2026-09-14. Three roles converging here independently (see Cross-Cutting
  Theme #5) is the signal, not the repetition.
- **A named cloud-cost owner.** Nothing in this review currently traces
  infrastructure spend to a person or a budget line — worth deciding who
  answers "why did the bill change" before it's asked under pressure.

---

## 20. Distributed Systems Engineer

**Would sign off on:**
- The event-backbone fix already designed in `ARCHITECTURE_DECISIONS.md`
  §4: Redis Streams (not pub/sub, specifically for persistence/consumer-
  groups/replay) plus a real task queue (ARQ) with retries and a
  dead-letter path, replacing the original fire-and-forget
  `asyncio.create_task` dispatcher that silently lost events on a process
  restart.
- The idempotency layer (`app/idempotency.py`) and database-enforced
  uniqueness constraints (§9) as the two correct primitives for a system
  that will eventually run multiple replicas — verified, not assumed,
  that a duplicate insert fails at the Postgres level.

**Would ask for, and why:**
- **The WebSocket gateway carve-out** (`ARCHITECTURE_DECISIONS.md` §2.3)
  is the single most consequential distributed-systems gap on file today:
  live connections are held in-process, so *every deploy currently drops
  every passenger's live map*. This is written down and understood, not
  hidden — worth being the very next carve-out attempted, ahead of
  telemetry ingest, since it affects every deploy today rather than only
  at higher fleet volume.
- **Explicit consistency documentation** for what's eventually consistent
  (breaker overrides, rate-limit overrides — both already documented as
  bounded-lag-via-Redis-polling in their own docstrings) versus what's
  strongly consistent (ledger postings, booking seat assignment) so a
  future engineer doesn't assume uniform guarantees across the system.

---

## 21. API / Integration Engineer

**Would sign off on:**
- The OAuth2 client-credentials pattern for partner integrations
  (`app/api_clients.py`, `app/routes/oauth.py`) reusing the human ABAC
  engine unmodified via `ApiClientPrincipal` — a real integration surface,
  not a stub.
- Idempotency-Key support on write endpoints, which is exactly what a
  serious API integrator needs to safely retry.

**Would ask for, and why:**
- **A published, versioned OpenAPI contract** — this is the same ask
  already on file under Backend Development (§7) and Full-Stack (§8);
  worth this role's endorsement specifically because partner integrators
  are the audience who actually consumes it, and a hand-diffed contract
  breaks trust the moment a field silently changes shape.
- **`NTSA_IRMS_INTEGRATION_CHECKLIST.md` is honest about being blocked on
  an external party** (NTSA access, not yet granted) — worth keeping that
  framing explicit to investors/stakeholders so "vehicle positioning" isn't
  read as a code gap when it's actually an access gap.
- **Webhook delivery guarantees documented for partners**, not just
  internally — `RUNBOOKS.md`'s "webhook deliveries failing for one Sacco"
  runbook exists for internal ops; a partner-facing version of "what
  happens if your endpoint is down" (retry count, backoff, replay window)
  doesn't yet.

---

## 22. Mobile Engineer

Deferred with the platform, per the dedicated section below. This role's
one addition: **browser geolocation cannot reliably track a backgrounded
web app** (`ARCHITECTURE_DECISIONS.md` §5.2) — this is the concrete,
named reason the crew app's offline/background-tracking need is deferred
to a native phase rather than stretched further inside the current PWA.
Worth stating plainly so "why not just improve the PWA further" has a
documented answer instead of an implied one.

---

## 23. Security Engineer

**Would sign off on:**
- Everything already verified in the dedicated Security Checklist above,
  plus the specific, hands-on confirmation this session that the three
  historical P0s in `SYSTEM_AUDIT.md` are fixed in current code (see the
  sourcing note above) — a security engineer's job is exactly this kind
  of "prove it against the live code, not the last audit" discipline.
- The circuit breaker's manual-override design (`app/resilience.py`) using
  a separate `override` field rather than mutating `state` directly — an
  operator forcing a breaker open doesn't silently erase its failure
  history, which matters when reconstructing an incident afterward.

**Would ask for, and why:**
- The five concrete gaps already flagged in the checklist (#12, #16/#27,
  #23, #24, #31) are this role's actual backlog — repeating them here
  would just be noise; see that table for specifics and owners.

---

## 24. DevSecOps Engineer

**Would sign off on:**
- Security scanning wired into CI as a real, running gate
  (`pip-audit`, Trivy, `gitleaks`), deliberately advisory rather than
  blocking, with the reasoning stated in the pipeline's own comments — a
  DevSecOps program that documents *why* a control is shaped the way it is
  tends to survive the next person touching it.
- Trivy image scanning on the same build that pushes to `ghcr.io`
  (`CD_PIPELINE_STATUS.md`) — the scan runs where the artifact is actually
  produced, not as a separate disconnected job.

**Would ask for, and why:**
- **A path from advisory to blocking for at least critical/high CVEs**,
  once the team has enough throughput to triage findings same-day — today
  every scan result is informational only, with no floor.
- **Secrets scanning coverage for the git-secrets near-miss class of bug**
  found and fixed this session (the missing `matatu-mms-ops` `.gitignore`
  section) — `gitleaks` in CI catches a secret that gets committed; it
  doesn't catch a `.gitignore` gap that makes committing one likely. Worth
  a periodic `.gitignore`-completeness check per app as a small, cheap
  addition.

---

## 25. Identity & Access Management Engineer

**Would sign off on:**
- A single, centralized authorization engine (`app/rbac.py`) that every
  principal type — human staff, Sacco operators, and now API clients — is
  checked against identically, with no parallel or bolted-on permission
  path.
- MFA, session revocation, and step-up re-authentication already gating
  Critical-tier ops actions (§10) — a real step-up model, not just a login
  MFA checkbox.
- JWT-based auth used consistently for both the HTTP API and the
  WebSocket layer (the crew telemetry socket decodes the same JWT via
  `pyjwt.decode`, not a separate scheme) — one token format, one place it's
  verified.

**Would ask for, and why:**
- **Session revocation on password change** — already identified as a
  confirmed gap in the Security Checklist (#24) — is exactly this role's
  responsibility to close: a password reset should invalidate every
  session issued under the old credential, and today it doesn't.
- **Token scope/audience claims for API clients**, so a compromised
  partner credential is provably limited to what that partner was actually
  granted, visible in the token itself rather than only enforced at
  request time.

---

## 26. Privacy Engineer

**Would sign off on:**
- The DPA data-subject rights implementation (`app/data_rights.py`) —
  export and erasure via stable one-way pseudonymization rather than hard
  deletion, so cross-referenced records still correlate after erasure —
  and the fact that a **real PII leak in this exact path was found and
  fixed** this session (a wrong-key consent lookup left a subject's actual
  phone number behind after "successful" erasure), found by actually
  running the function, not by reading the code.

**Would ask for, and why:**
- **A data inventory / data map**: what personal data is collected, where
  it's stored, how long it's retained, and who can access it — the
  erasure mechanism is solid, but nothing in this review enumerates what
  it needs to reach across every table.
- **Retention policy tied to actual purpose**, not just the 90-day GPS
  retention window already decided for evidentiary reasons
  (`a3d6e9b7c284` migration) — other PII-bearing tables don't yet have a
  stated retention rationale.

---

## 27. GIS / Geospatial Engineer

**Would sign off on:**
- PostGIS adopted deliberately (`ARCHITECTURE_DECISIONS.md` §1.2) with a
  clean division of labor already specified: PostGIS for server-side
  storage/query (nearest-stage lookup, route-corridor containment),
  TomTom/MapLibre for client-side rendering, connected only through
  GeoJSON — no tooling lock-in between the two.
- Route variants and direction modeled as first-class data (not naming
  convention) directly from the Bus Route Network report's own evidence
  (the "Routing on Return Journey Thro CBD" column proving inbound/outbound
  asymmetry) — the data model follows the source document's actual
  structure rather than a simplifying assumption.
- Route-adherence monitoring designed as a buffered-polygon containment
  test with a GiST index (§1.6) — cheap at scale, and the right primitive
  for the problem rather than a manual distance calculation.

**Would ask for, and why:**
- **Confirm the PostGIS migration and adherence buffers are actually
  applied against production**, not just decided — `alembic/versions/
  311917b90975_enable_postgis_extension.py` exists; worth the same
  verify-against-real-Postgres discipline already applied to TimescaleDB
  (§9) rather than assuming it ran cleanly.
- **A stated data-freshness policy for the BRN route geometry itself** —
  §1.3 already flags that displayed route numbers are provisional pending
  a permanent NMA-wide scheme; worth a mechanism for updating geometry
  when that scheme lands, rather than a one-time import.

---

## 28. Real-Time Systems Engineer

**Would sign off on:**
- The crew GPS WebSocket is authenticated and ownership-checked
  end-to-end (`routes/telemetry.py`: JWT decode, role check, Sacco-
  ownership check on the target matatu) — verified directly this session,
  and a real fix from the state `SYSTEM_AUDIT.md` originally found it in
  (unauthenticated, spoofable).
- SSE (not WebSocket) deliberately chosen for the ops console's live feed
  specifically because that feed is one-directional (§ Ops Console
  Rebuild, referenced in §6/§8 above) — the right protocol for the actual
  data flow, not a default reach.

**Would ask for, and why:**
- **This is the same WebSocket-gateway carve-out already flagged by
  Distributed Systems (§20) and named directly in
  `ARCHITECTURE_DECISIONS.md` §2.3**: live connections are held in-process
  today, so every deploy drops every passenger's live map. Worth this
  role's explicit sign-off that it's the top real-time priority, ranked
  above telemetry-ingest extraction, because it degrades the live product
  on every single deploy rather than only at higher fleet volume.
- **Redis-backed fan-out for the gateway once split out**, per the same
  section's proposed fix — business logic can then ship continuously
  without interrupting anyone's live map.

---

## 29. Performance Engineer

**Would sign off on:**
- Bundle performance budgets enforced in CI on gzip-measured size, with a
  documented correction (an earlier version measured raw disk size and
  would have failed every route on day one) — a performance gate that was
  actually validated to measure the right thing, not assumed to.
- Postgres full-text search (GIN indexes) replacing `ILIKE` specifically
  because the latter degrades linearly and would become unusable in the
  low hundreds of thousands of rows — a performance decision made ahead of
  the pain, not after.

**Would ask for, and why:**
- **PgBouncer / connection pooling**, already flagged by DBA (§9) — worth
  this role's addition that it's a performance ceiling, not just a
  connection-count housekeeping item: async FastAPI across replicas
  exhausts raw Postgres connections well before CPU or memory become the
  bottleneck.
- **A load test against the actual telemetry write path** (3,500 buses at
  a 5-second ping ≈ 700 writes/sec, per `ARCHITECTURE_DECISIONS.md` §2.2)
  — the number is calculated, not yet measured against a running system.

---

## 30. Resilience Engineer

**Would sign off on:**
- A real circuit breaker with CLOSED/OPEN/HALF-OPEN states and a manual
  operator override, now given cross-process *visibility* via Redis
  (`app/ops_breakers.py`) even though the breaker state itself correctly
  stays per-process (§4.3's own reasoning: a shared tripped state would
  let one replica's bad luck block every healthy replica).
- `RUNBOOKS.md`'s dependency fallback matrix — what happens when each
  external dependency (Postgres, Redis, TomTom, NairobiPay, NTSA) is
  unavailable is written down per-dependency, not left to be improvised
  during an actual incident.

**Would ask for, and why:**
- **The same multi-replica caveat SRE (§18) and Distributed Systems (§20)
  already flagged**: today's resilience primitives (breaker, retry) are
  correct for a single process and will silently under-protect once
  replica count goes above one. This role's specific ask: prioritize
  making breaker *state* (not just overrides) cross-process-aware before
  scaling replicas, rather than discovering the gap during an incident.
- **Chaos-testing the documented runbooks** — a runbook that has never
  been executed against a deliberately broken dependency is a hypothesis,
  not a verified procedure.

---

## 31. Release / Build Engineer

**Would sign off on:**
- Immutable, git-SHA-tagged image builds pushed to `ghcr.io` using the
  repo's built-in `GITHUB_TOKEN` — no separate registry secret to manage,
  one less credential to rotate or leak.
- The canary-promotion script (`scripts/canary-promote.sh`) is genuinely
  runnable today, not aspirational: health-gated weight shifts, instant
  rollback to 0%, and explicitly verified to handle WebSockets without
  dropping connections during a shift.

**Would ask for, and why:**
- **A manual-approval gate before production**, which `CD_PIPELINE_STATUS.md`
  itself notes is "genuinely just a repo-settings toggle" (GitHub
  Environments with required reviewers) once there's a real production
  deploy job to gate — currently blocked on the staging/orchestrator
  decision, not on effort.
- **A rollback runbook tied to the release process itself**, not just the
  general incident runbooks — "which git SHA was last known-good, and how
  do we get back to it in one command" should be answerable without
  reconstructing it live.

---

## 32. Developer Experience Engineer

**Would sign off on:**
- A working `docker-compose.yml` that stands up the full local stack, and
  a documented Postgres verification harness (`backend/README-VERIFY.md`
  + `verify_postgres.py`) with a clear one-line invocation for exercising
  Postgres-only code paths locally.
- The `APP_ROLE` pattern meaning a developer runs one codebase locally and
  gets both the API and control-plane behavior by env var, rather than
  needing two checkouts.

**Would ask for, and why:**
- **A single onboarding doc** — `README.md` exists, but the review turned
  up a dozen standalone root-level audit/decision documents
  (`ARCHITECTURE_DECISIONS.md`, `SYSTEM_AUDIT.md`, `RUNBOOKS.md`,
  `TENANT_ISOLATION_AUDIT.md`, `CD_PIPELINE_STATUS.md`,
  `SERVICE_EXTRACTION_READINESS.md`,
  `NTSA_IRMS_INTEGRATION_CHECKLIST.md`, this one) with no index pointing a
  new engineer at which one to read first, or which are current versus
  historical (`SYSTEM_AUDIT.md` specifically, per the sourcing note
  above). A short `DOCS.md` index costs little and prevents someone
  treating a historical audit as current status.
- **Seed data that exercises every role** for local testing — worth
  confirming `seed.py` covers the full role matrix, not just enough to
  boot.

---

## 33. ML Engineer

**Not applicable today — stated plainly rather than left silent.** Grepped
the backend for the usual footprint of a shipped ML system (`tensorflow`,
`torch`, `sklearn`, a serialized model file) — none exists. Nothing in
this system currently makes a prediction; it records, scores against
fixed rules (fines, fares), and reports. That's a legitimate current
state, not a gap, but worth stating explicitly so "why isn't there an ML
roadmap" has an honest answer: there's no ML system yet to have an
engineer for.

**Would ask for, if this becomes relevant:** the demand-intelligence
dashboard (OD matrix, boarding heatmap, crowdsourced condition reports —
§1 Data Analyst) is the most plausible first real ML use case (demand
forecasting, route optimization) once enough historical volume exists to
train against.

---

## 34. MLOps Engineer

**Not applicable today**, for the same reason as §33 — there is no model
to version, deploy, or monitor for drift. Worth naming what MLOps
infrastructure *would* reuse when the day comes: the existing ARQ task
queue (§4.2) for batch scoring jobs, the ops console's action-safety
framework for gating a model rollout the same way a Critical-tier system
action is gated today, and the CI pipeline's image-build/scan/push chain
for packaging a model-serving container. Nothing new needs inventing at
that point except the model itself.

---

## 35. Computer Vision Engineer

**Not applicable today.** No image or video pipeline exists in this
system beyond ordinary file uploads (Sacco documents, per §16 of the
Security Checklist) — no license-plate recognition, no crowd counting, no
CCTV integration. If this becomes a future want (e.g., automated plate
recognition for enforcement), the upload-validation gaps already
identified in the Security Checklist (#16/#27 — no size limit, no type
whitelist) would need closing *before* that pipeline exists, not after,
since a CV pipeline is a much higher-value target for a malicious upload
than a document store is.

---

## 36. Data Architect

**Would sign off on:**
- The data-layer decisions already made deliberately in
  `ARCHITECTURE_DECISIONS.md` §3 — PostGIS and TimescaleDB coexisting in
  one Postgres engine (rather than two separate specialized stores),
  chosen specifically because they're both Postgres extensions and avoid
  a second system to operate.
- Money modeled as `Numeric`, never `Float`, end-to-end from column type
  through the ledger to the API response (§9 DBA) — a schema-level
  decision that prevents an entire class of downstream bug rather than
  catching it in application code.

**Would ask for, and why:**
- **The read-replica-for-reporting decision** (already converged on
  independently by Data Analyst, Big Data, and DBA — Cross-Cutting Theme
  #2) is fundamentally a data-architecture decision about workload
  separation; worth this role owning the actual schema/replication design
  rather than it staying a recurring ask with no owner.
- **A documented logical data model** (entities, ownership, module
  boundaries) matching the module boundaries already named in
  `ARCHITECTURE_DECISIONS.md` §2.1 — the boundaries are decided in prose;
  an actual ER-level diagram per module doesn't yet exist.

---

## 37. Data Governance Lead

**Would sign off on:**
- Audit logging with before/after values already covers 10+ route files
  (§10), giving governance a real, queryable record of who changed what —
  the raw material governance needs already exists rather than needing to
  be retrofitted.
- DPA data-subject rights (export/erasure) as a concrete, working
  governance control, not a policy document with no implementation behind
  it.

**Would ask for, and why:**
- **A data classification scheme** (public / internal / restricted / PII)
  applied consistently across tables — nothing in this review currently
  labels which columns are sensitive in a way tooling could enforce
  automatically, rather than relying on every engineer remembering by
  hand.
- **This is the same data-inventory ask as Privacy Engineering (§26)**,
  from the governance-ownership side: someone needs to be accountable for
  the inventory existing and staying current, not just for it being
  produced once.

---

## 38. Data Quality Engineer

**Would sign off on:**
- The ledger's trial balance is a genuine, automatic data-quality check —
  confirmed to sum to exactly `0.00` against real Postgres, not just
  assumed consistent (§7, §9).
- Database-enforced uniqueness (idempotency keys, duplicate-insert
  rejection verified at the Postgres level, not just in application code)
  as a real data-integrity backstop rather than a convention that could
  silently be bypassed.

**Would ask for, and why:**
- **Data quality checks beyond the ledger** — the trial-balance invariant
  is excellent but narrow; nothing currently checks for orphaned records
  (a booking referencing a deleted matatu), out-of-range values, or
  referential drift across the wider schema on an ongoing basis.
- **Automated data quality monitoring**, not just constraints enforced at
  write time — a scheduled job that reports anomalies (e.g., a fine with
  a negative amount that somehow got past validation) catches the class of
  bug that slips past both `Numeric` typing and Pydantic validation.

---

## 39. BI Developer

**Would sign off on:**
- Structured, queryable data already exists for the reports a BI tool
  would build against: the ledger, the audit log, the messaging spend
  summary (§1), and the demand-intelligence dashboard's underlying OD
  matrix — none of it locked inside a report-only view with no
  underlying table.

**Would ask for, and why:**
- **This is the same read-replica ask as Data Analyst/Big Data/DBA/Data
  Architect (Cross-Cutting Theme #2)**, from the tooling side: a BI tool
  (Metabase, Superset, or similar) needs a connection target that isn't
  the transactional primary, and none exists yet.
- **A documented semantic layer** (what "active user," "on-time," and
  "revenue" mean precisely) before multiple dashboards each define these
  terms slightly differently and start disagreeing with each other.

---

## 40. Analytics Engineer

**Would sign off on:**
- Full-text search, the OD matrix, and the messaging spend log are all
  already modeled as queryable structured data rather than raw logs
  needing parsing at query time — the right shape for building
  transformation layers on top of.

**Would ask for, and why:**
- **dbt**, already named as a future want by Big Data (§3) once there's
  more than one scheduled transformation job — this role's specific
  addition: start the dbt project structure *now*, even with a single
  model, so the practice (version-controlled SQL transformations, tested
  assumptions) exists before the ad hoc cron scripts multiply, rather than
  retrofitting it after they have.

---

## 41. Data Steward

**Would sign off on:**
- A clear technical owner already exists for the most sensitive data path
  in the system (DPA erasure/export, `app/data_rights.py`) — and that
  path has already been exercised for real, catching a real leak (§26),
  which is exactly the kind of stewardship a document alone can't provide.

**Would ask for, and why:**
- **Named per-table ownership**, not just a technical implementation.
  Stewardship is an accountability role as much as a technical one:
  someone should be the named point of contact for "who do I ask about
  what's in the `users` table," independent of who wrote the migration.
  Nothing in this review currently assigns that.

---

## 42. Statistician

**Would sign off on:**
- Crew-logged headcounts as a real ridership proxy rather than an
  estimated one (§11 Researchers) — a statistician would call this out
  specifically as a rare case of a transit system having ground-truth
  ridership data from day one instead of needing to infer it from ticket
  sales or fare-gate counts.

**Would ask for, and why:**
- **Confidence intervals and sampling bias documented on every derived
  metric that comes from crowdsourced input** (condition reports, demand
  signals) — a crowdsourced signal is not a census, and nothing in the
  demand-intelligence dashboard currently states its own margin of error
  or who is systematically over/under-represented in who reports.
- **A stated methodology for the OD matrix's construction** (how origin-
  destination pairs are inferred from the underlying booking/GPS data)
  reviewable independent of the dashboard that presents it.

---

## 43. Operations Research Specialist

**Would sign off on:**
- Route-adherence monitoring modeled as a geometric containment problem
  with a defined tolerance window (§27 GIS) — the right formal framing for
  an optimization/OR discipline to eventually build scheduling or
  dispatch logic on top of.

**Would ask for, and why:**
- **This system currently has no optimization layer at all** — routing,
  dispatch, and fare-stage assignment are all operator-declared, not
  computed. That's an appropriate scope boundary today (§1.3's provisional
  route numbers imply the underlying network itself is still stabilizing,
  and optimizing against a moving target is premature) but worth naming as
  a deliberately deferred discipline rather than an oversight, with the
  BRN route network's eventual stabilization as the trigger to revisit.

---

## 44. Customer Support Operations

**Would sign off on:**
- The technical prerequisite for real support work already exists:
  impersonation ("login as") with mandatory audit is built
  (`ImpersonationPanel` in the ops console, §Ops Centre Rebuild above) —
  the single highest-value tool a support team needs for "can you see what
  I'm seeing" is already there, not still a request.
- Generic, non-enumerating error responses (§Security Checklist #26) mean
  support can safely ask "what's your registered phone number" without
  that becoming an account-enumeration risk on the support side either.

**Would ask for, and why:**
- **There is no support ticketing or workflow at all.** Grepped the whole
  repo for a helpdesk/ticketing pattern — nothing exists beyond a static
  "Contact Us" link in the footer. Impersonation without a ticketing
  system around it means "screen-share to see what you're seeing" has no
  record of why it happened, no queue, and no resolution tracking — the
  audit log captures *that* an impersonation happened, not *why* a citizen
  called in the first place.
- **A defined escalation path for payment and enforcement disputes**
  specifically — these are the two categories most likely to generate a
  support contact for a system that both takes money and issues fines,
  and neither currently has a stated resolution SLA or an owner outside
  engineering.
- **A support-facing view of common failure modes already known to
  engineering** — the free-tier cold-start "can't connect" error (this
  session's own trigger for investigating it) is exactly the kind of thing
  a support agent should have a canned, accurate answer for instead of
  escalating every occurrence as a fresh incident.

---

## 45. Localization / Translation QA

**Would sign off on:**
- Real English/Swahili translation exists and is intentionally scoped,
  not superficial — `matatu-mms-public/lib/i18n.ts`'s own comment states
  it covers "shared app chrome (sidebar, header, footer) and the
  highest-traffic public pages (login)... rather than every string in the
  app," which is an honest, deliberate scoping decision rather than an
  abandoned attempt at full coverage.
- The language toggle and persistence (`LanguageProvider.tsx`,
  `LanguageToggle.tsx`, `nccg_lang` storage key) is a real, working
  mechanism, not a cosmetic switch with no effect.

**Would ask for, and why:**
- **No native Swahili speaker's review is evidenced anywhere in this
  project.** The 57-line dictionary's translations may be linguistically
  correct, but nothing in the repo indicates they were checked by a fluent
  reviewer rather than machine-translated — worth a real QA pass before
  this is a citizen's first impression of a government service in their
  own language.
- **The staff app maintains a *separate* copy of this dictionary**
  (`i18n.ts`'s own comment: "county staff strings live in the separate
  staff app's own copy of this file") — the exact same duplication risk
  already flagged for `PageBanner.tsx`/`NotificationBell.tsx` (§6 Frontend
  Development), just not yet caught drifting. Worth the same CI `diff`
  guard, or consolidating both into one shared dictionary.
- **Coverage stops well short of the app**: the dictionary explicitly
  excludes booking flows, fine details, enforcement forms, and anything
  past login/chrome. For citizens who read Swahili more comfortably than
  English, the parts of the app with the most legal/financial consequence
  (a fine, a booking confirmation) are exactly the parts currently
  English-only. Worth prioritizing translation coverage by *consequence*,
  not by page-traffic alone.
- **No language selection for SMS/USSD** — `ARCHITECTURE_DECISIONS.md`
  §1.7 already commits to USSD/SMS as a first-class access channel
  specifically for riders without a smartphone; nothing in this review
  found a language preference carried through to that channel, and a
  USSD-only user is also the user least likely to be comfortable toggling
  a web UI language switch in the first place.

---

## 46. Field Operations & Enablement

Distinct from "The Public" (§13, passengers/citizens as external users):
this is the internal field workforce — crew, drivers, and enforcement
officers — whose devices, connectivity, and training this system depends
on operationally, not just technically.

**Would sign off on:**
- The "On Patrol" toggle (`OnPatrolToggle.tsx`) is a deliberately
  opt-in, foreground GPS broadcast for enforcement officers, with a
  documented reasoning comment for *why* it's opt-in rather than
  continuous background tracking, and a real product-safety choice
  embedded in the code: no simulated-fallback position. If the device GPS
  fix isn't available, it shows "GPS unavailable" and broadcasts nothing,
  specifically because a faked officer location could actively mislead a
  commander about where someone actually is — the crew app's demo-vehicle
  GPS is allowed a simulated fallback; an officer's real safety-relevant
  position is not, and the code treats those two cases differently on
  purpose.
- The crew and enforcement portals are real, working surfaces
  (`CrewPortalClient.tsx`, `EnforcementSceneForm.tsx`), not stubs standing
  in for a future native app.

**Would ask for, and why:**
- **Offline-tolerant operation is a named, accepted gap, not an
  oversight** — `ARCHITECTURE_DECISIONS.md` §1.8 explicitly defers it to
  the native mobile phase, because "connectivity along these corridors is
  unreliable" and a browser tab can't queue-and-sync the way a native app
  can. This is the single biggest field-usability risk in the system
  today: an officer or crew member losing connectivity mid-shift currently
  has no documented fallback beyond "wait for signal," and that gap has an
  owner (native mobile, deferred per §Mobile Apps above) but no interim
  mitigation.
- **Device provisioning is undecided.** Nothing in this review states
  whether officers/crew use personal phones (BYOD) or county-issued
  devices — this materially changes the security posture (§Security
  Checklist), battery/GPS reliability assumptions behind `OnPatrolToggle`,
  and who's responsible when a device is lost with an active session on
  it.
- **No field training or change-management plan is referenced anywhere**
  in this project's documents. A digital enforcement and crew-tracking
  system is a real workflow change for officers used to paper citations —
  worth a named rollout/training owner before wider deployment, not an
  assumption that the UI is self-explanatory.
- **Browser geolocation's hard limits** (`ARCHITECTURE_DECISIONS.md` §5.2
  — cannot reliably track a backgrounded web app) apply identically to
  `OnPatrolToggle`: an officer who backgrounds the browser to answer a
  call or check a map app elsewhere loses tracking silently. Worth a
  visible on-screen warning when this happens, not just a known
  architectural limitation.

---

## Ops Centre Rebuild — Cross-Team Discussion

Triggered by the decision to move the deployment to a new free Render
account. Before assuming this means designing the ops console from zero,
it's worth being honest about where it actually stands: **most of the
previously-written `OPS_CONSOLE_AND_USER_ACTIVITY_SPEC.md` is already
built**, not still on a backlog. Checked directly against the running
`matatu-mms-ops` app for this review, not assumed from the spec document
alone.

### Migration completed — 2026-09-12

The move to the new Render account happened during this review, not just
planned. Final live URLs:

| App | URL |
|---|---|
| Staff app | `https://matatu-mms.onrender.com` |
| Public app | `https://matatu-mms-public-r8lk.onrender.com` |
| Ops console | `https://matatu-mms-ops-pdop.onrender.com` |
| Backend | `https://matatu-mms-backend-77ox.onrender.com` |

All data verified matching the old database exactly (row-for-row cross-check
against a full backup taken before migration), all secrets issued fresh
(none copied from the old, previously-flagged-compromised account), old
account fully decommissioned.

**On the URL suffixes — settled, not still open.** Four independent
delete-and-recreate attempts across this review (backend twice, public
app once, ops console once, each separated by real time — tens of
minutes to over an hour apart) **never once** recovered the clean
subdomain; every attempt landed a different random suffix instead.
That's strong enough evidence to treat this as a **permanent** Render
behavior — once a subdomain has been used and the service deleted, it
does not become available again — rather than a temporary cooldown worth
retrying later. Each attempt also caused a brief real outage on the
service being renamed (env vars had to be restored and every
cross-referencing service updated and redeployed before service was
fully back). Recommendation: stop attempting this. The suffix is
cosmetic — verified via full login + dashboard + data checks after every
single attempt — and further tries trade a real, if brief, production
disruption for a change that the evidence says will not happen.

**Two real bugs found and fixed during post-migration verification**
(both confirmed live via actual browser login, not just API checks):

1. **Redis unreachable on the new account.** The *internal* connection
   string Render's own API returned wasn't actually reachable (TCP
   connection refused) — this broke every rate-limited endpoint,
   including login itself, with a 500. Switched to the external TLS
   connection string and opened that Redis instance's own IP allowlist
   (same empty-by-default pattern already seen on the new Postgres
   instance). Root cause of the "system is starting up" message reported
   after the migration — genuinely was Redis, not just free-tier cold
   start.
2. **`NEXT_PUBLIC_API_URL` vs `NEXT_PUBLIC_BACKEND_URL` — a pre-existing
   bug, not caused by the migration.** `LiveConditions.tsx`,
   `guardian-approve/page.tsx`, and `LiveUpdatesModal.tsx` all read a
   variable name that `render.yaml` and every other component never
   actually set, silently falling back to `http://127.0.0.1:8000` in
   production — blocked by CSP, so these three live-data widgets never
   showed real data even on the old account. Renamed all three to the
   variable name used everywhere else.
3. **CSP blocked the TomTom Maps SDK's own forced CSS load.** Confirmed
   directly once a real TomTom key was set: `TomTomMap`'s constructor
   calls a private `ensureMapLibreCSSLoaded()` with no public opt-out,
   unconditionally injecting `maplibre-gl.css` from `unpkg.com` even
   though `layout.tsx` already imports that identical stylesheet locally.
   Not something app code triggers or can prevent — added a scoped
   `style-src https://unpkg.com` CSP allowance as the only available fix.
   Verified after: live TomTom traffic feed (real Nairobi road incidents,
   not placeholder data) renders with zero console errors.
4. **The ops console couldn't render at all after login — blank page,
   every time.** Its production CSP omitted `'unsafe-inline'` from
   `script-src` entirely (unlike the staff and public apps, which both
   already include it), blocking Next.js's own required inline hydration
   scripts. The comment justifying the stricter policy assumed nginx
   network-layer isolation that doesn't exist on the actual Render
   deployment — this app is reachable at its own public URL there,
   protected only by its own SUPERADMIN session check (§Network
   Engineering, Cross-Cutting Theme #3). Never caught until this session's
   first real browser login to the console — prior verification of this
   app was entirely code-inspection-based (§Ops Centre Rebuild's own
   table above). Fixed by matching the other two apps' `script-src`.
5. **A separate, secondary hydration-mismatch bug surfaced once #4 was
   fixed and the page could render at all**:
   `useOpsStream`'s `lastEventAt` state was seeded with
   `useState(initial ? Date.now() : null)` — calling `Date.now()` as a
   `useState` initializer runs it once during the server render and again
   during client hydration, producing two different timestamps and
   React errors #418/#423/#425 on every load. Fixed by seeding `null`
   (matching what the server actually renders) and setting the real
   timestamp only inside `useEffect`, which never runs during SSR.
   Verified after: zero console errors, live "updated HH:MM:SS" badge
   updates correctly.
6. **A real self-inflicted security regression, found and fixed during
   this same final verification pass.** During the rename attempts
   (§ above), a bulk `PUT /env-vars` call with only 3 keys was used on
   the staff and public apps — this endpoint **replaces the entire env
   var set**, not merges into it, silently wiping `SESSION_SECRET` (both
   apps) and `NEXT_PUBLIC_TOMTOM_API_KEY` (public app). For a window of
   time, both frontends ran with no session-signing secret set, which
   `lib/sessionSign.ts`'s own comments say falls back to a hardcoded
   dev-only default — every session cookie issued in that window was
   signed with a key checked into git. Found by systematically re-checking
   every service's env vars against the known-good list after the rename
   attempts, not by a symptom surfacing on its own. Fixed by restoring
   both values via single-key `PUT` calls (the safe form of this API) and
   redeploying — which correctly invalidated every session signed with the
   fallback key, forcing re-login rather than leaving them valid.
   **Lesson for next time operating this API**: never use the bulk
   `PUT /env-vars` endpoint with a partial key list; always use the
   single-key `PUT /env-vars/{key}` endpoint, or fetch and resend the
   complete existing set.

### Production meta-assets added — 2026-09-12

Raised directly: none of the three apps had favicons, app icons, a
PWA manifest (staff/ops), OG images, `robots.txt`, or a sitemap. Checked
directly before assuming — confirmed all missing except the public app's
existing (but broken) manifest. Implemented across all three, per-app
rather than one-size-fits-all:

- **Real icon assets** (`favicon.ico`, `icon.png`, `apple-icon.png`, 192/512
  manifest icons) generated from the actual Nairobi City County crest via
  PIL, not placeholder art.
- **A genuine pre-existing bug fixed along the way**: the public app's
  manifest declared its `nairobi-crest.jpg` (actually 224×225) as both a
  192×192 and 512×512 icon — Chrome's install-ability checks very likely
  silently rejected this, meaning the PWA install prompt this project
  already built has probably been quietly non-functional since it shipped.
- **Staff app + ops console**: new `manifest.webmanifest` for a proper
  home-screen icon/theme-color (no service worker — that stays
  public-app-only, matching the existing intentional PWA design), `noindex`
  robots metadata + `robots.ts` disallowing all crawlers (the ops console
  especially, given it's reachable at a public URL with no network
  isolation on this deployment — Cross-Cutting Theme #3), a dynamic OG
  image for the staff app (skipped for ops, which should never be
  link-shared).
- **Public app**: permissive `robots.ts` (excludes `/api/` and the two
  token-carrying pages, `reset-password` and `guardian-approve`),
  `sitemap.ts` covering the genuinely public content pages, a dynamic OG
  image for link previews (fine payment links, booking confirmations).

**Three more real bugs found via live verification, not assumed working
once the code was written:**
1. Both the staff and ops middleware blocked their own new
   `manifest.webmanifest` (and ops's `robots.txt`) — the static-file
   extension allowlist was missing `webmanifest` (both) and `txt` (ops).
   Same bug class as the public app's earlier PWA-install break, just not
   yet found in these two apps because nothing had tried to fetch these
   paths before.
2. `/opengraph-image` (Next's generated metadata-file route) has no file
   extension, so the same extension-based middleware exemption couldn't
   match it — it 307-redirected to the sign-in page in both apps until an
   explicit path exemption was added.
3. `NEXT_PUBLIC_SITE_URL` was set correctly as a Render env var but never
   reached the actual build: neither Dockerfile declared it as a build
   `ARG`, so `robots.txt` and `sitemap.xml` kept emitting
   `http://localhost:3000` even after a forced fresh redeploy. Same
   ARG-vs-runtime-env gap already documented in both Dockerfiles for
   `NEXT_PUBLIC_BACKEND_URL`/`WS_URL`/`TOMTOM_API_KEY` — this variable
   simply predates those comments and was never added alongside them.

All verified live end-to-end after each fix: favicon/icon/manifest/OG
image return correct content types on all three apps, `robots.txt` and
`sitemap.xml` resolve to the real deployed domain, and a full login +
health sweep across all four services confirmed nothing regressed.

### What already exists (verified against the actual routes and components)

| Spec item | Status | Where |
|---|---|---|
| Service health matrix + deploy/GitHub view | **Built** | `infrastructure/page.tsx` — `ServiceHealthMatrix`, `getRenderServiceMatrix` |
| Audit log viewer (read-only) | **Built** | `audit/page.tsx` — `AuditLogViewer` |
| Tier-1 CRUD: feature flags, rate limits, incident/system controls | **Built** | `config/page.tsx` — `FeatureFlagsPanel`, `RateLimitsPanel`, `SystemControlsPanel` |
| Circuit breaker visibility + manual override | **Built** | `integrations/page.tsx` — `CircuitBreakerPanel`, backed by `app/ops_breakers.py` |
| Webhook delivery visibility | **Built** | `integrations/page.tsx` — `WebhookDeliveriesPanel` |
| Background job/queue control (retry, dead-letter, pause) | **Built** | `jobs/page.tsx` — `JobQueuePanel` confirmed to include retry/dead-letter/pause, not just a visibility list |
| Auth-event audit + login metadata capture | **Built** | `sessions/page.tsx` — `PrivilegedActivityPanel`, `getLoginOverview` — closes the exact gap `SYSTEM_AUDIT.md` §2.1 originally flagged |
| Cross-account "who's logged in" + privileged-activity view | **Built** | `sessions/page.tsx` |
| Impersonation ("login as") with mandatory audit | **Built** | `sessions/page.tsx` — `ImpersonationPanel`, backed by impersonation fields in `auth.py`/`models.py`/`schemas.py` |
| Per-user Activity tab (staff portal, not ops) | **Built** | `matatu-mms/app/(app)/users/page.tsx`, `EditUserModal.tsx` |
| Golden-path wizard for Tier-2 entities (new-Sacco onboarding) | **Built** | `infrastructure/page.tsx` — `OperatorOnboardingLauncher` |
| IP allowlist visibility | **Partial** | Render's own per-service `ipAllowList` is surfaced in `ServiceHealthMatrix`/`lib/render.ts` — this reads Render's config, it isn't yet an editable Tier-1 CRUD screen for the app's own access rules |
| Service/software catalog (owner, repo, deployed SHA, dependencies) | **Not built** | Named in the spec (§A.3) as a cheap win derivable from the Render API — genuinely still missing |
| Read-only database browser (pointed at a read replica, DB-role-enforced `SELECT`-only) | **Not built** | Named in the spec (§A.3) — depends on the read-replica ask already converged on independently by four roles (Cross-Cutting Theme #2), so sequencing this after that lands is reasonable, not neglect |

**The honest framing for "what should be rebuilt": this isn't a rebuild
from zero — it's closing two named, still-open gaps (service catalog,
read-only DB browser), plus everything below that the Render-account
migration itself surfaces as new work.**

### What the move to a new Render account specifically requires — per team

- **Platform Engineering / DevOps:** this is the moment to fix the exact
  class of mistake found and fixed earlier in this review — provision the
  new account's secrets fresh through Infisical, never by copy-pasting
  the old account's `.env.local` files across. Re-verify every app's
  `.gitignore` coverage on the new account's first commit cycle rather
  than assuming the fix already made (the `**/.env*.local` backstop) is
  the only thing standing between a fresh mistake and a repeat leak.
- **Security / IAM:** treat this migration as the forcing function to
  finally rotate the Render API key already flagged for rotation earlier
  in this review (§10) — a new account is a clean point to issue an
  entirely new key rather than carrying the compromised one over. Same
  logic for the NairobiPay callback secret and the JWT signing key: issue
  new values on the new account, don't migrate the old ones.
- **Network Engineering:** every app's public URL changes
  (`*.onrender.com` subdomains are account-scoped). This touches CORS
  allowlists, the three frontends' redirect/callback URLs, any hardcoded
  URL in `render.yaml` / `nginx/nginx.conf`, and Cloudflare DNS if a
  custom domain sits in front — audit these explicitly rather than
  discovering a broken redirect after cutover the way the current session
  started (a "can't connect" report on the *old* account was the trigger
  for this whole conversation).
- **Database Management / DBA:** a new account almost certainly means a
  new free-tier Postgres instance, which means a **new 30-day expiry
  clock** — write the new date down the moment the database is created,
  don't let Cross-Cutting Theme #1 quietly repeat itself on the new
  account. Re-run `verify_postgres.py` against it before calling the
  migration done — the same discipline that caught the TimescaleDB
  Apache-license issue the first time applies again to an instance that
  hasn't been touched yet.
- **SRE / Resilience Engineering:** circuit breaker and rate-limit state
  (both already documented as in-process/Redis-backed, not durable) reset
  clean on the new account — correct behavior, but worth confirming
  nothing in the ops console assumes historical breaker/incident state
  survives the move.
- **Release / Build Engineer:** CI's image push target (`ghcr.io`) is
  unaffected by the Render account change, but Render's own deploy hooks
  and any account-scoped API tokens used by automation need updating —
  audit `.github/workflows/ci.yml` and `render.yaml` for anything
  referencing the old account's service IDs.
- **Developer Experience Engineer:** update `README.md`, `DEPLOYMENT.md`,
  and the dashboard URLs already listed by name in this document (they
  will silently go stale for anyone who bookmarked the old ones) once the
  new account's services are live.
- **Frontend / Backend:** confirm the free-tier cold-start behavior
  (Cross-Cutting Theme #5, and the direct trigger for this section) is
  understood to persist on the new account too — a new account does not
  remove the free-tier ceiling, only resets the deadline clock on the
  database. If a keep-warm ping or a paid-tier upgrade is planned, decide
  it as part of this migration rather than as a follow-up after the same
  "can't connect" report recurs.

### The two remaining real feature gaps, worth closing during this migration window

1. **Service/software catalog** — cheap, and a natural fit for exactly
   this moment: the migration already requires re-auditing every service's
   Render configuration, repo link, and current deployed SHA by hand: capture
   that audit as the catalog screen instead of doing the work once and
   losing it.
2. **Read-only database browser** — sequence after the read-replica
   decision (Cross-Cutting Theme #2), but worth deciding *now*, while a
   fresh database is being provisioned anyway, whether the replica gets
   stood up at the same time rather than as a separate later migration.

---

## Mobile Apps — Deferred for Now, With a Plug-and-Play Path

Native mobile apps are explicitly **off the table for now**. Not because
they aren't wanted — because building them before the three web apps and
the backend they share are settled would mean building against a moving
target twice. What follows is what makes picking this up later cheap
instead of a from-scratch integration project.

**What already exists that a future mobile app plugs into, unchanged:**
- **`/api/v1`, already versioned.** A mobile client is just another API
  consumer; nothing about mobile requires a new backend surface, only new
  clients of the existing one.
- **The OAuth2 client-credentials pattern built for the partner API**
  (`app/api_clients.py`, `app/routes/oauth.py`) is the same shape a native
  app needs for machine-to-machine or long-lived-session auth — token
  issuance, scoped permissions via the same `ApiClientPrincipal` that
  already reuses the human ABAC/RBAC engine unmodified (§7 above). A mobile
  app does not need its own authorization model designed from zero.
- **The PWA** (manifest, service worker, offline fallback, install prompt)
  is a real interim mobile experience today for the public/passenger app —
  installable from a browser, works offline for cached routes, and is
  already live rather than hypothetical. This buys time without leaving
  passengers with nothing on a phone in the meantime.

**What "plug and play" means concretely, when the day comes:** a native
app talks to `/api/v1` the same way the partner integrators already do —
same auth pattern, same versioned contract, same ABAC scoping — rather
than requiring a parallel mobile-specific backend. The main *new* work at
that point is genuinely mobile-shaped (push notifications, offline-first
local storage/sync, app-store review cycles), not re-litigating auth or
API design. The one thing worth doing **now**, cheaply, to keep that path
open: treat any future backend change as a breaking-change decision against
`/api/v1` (new fields additive, nothing silently removed or repurposed) —
the existing OpenAPI-as-published-contract ask in §7 covers this directly
and should be prioritized with mobile in mind, not just partner
integrators.

---

## Security Checklist — Full Review

Requested directly: every item below discussed and verified against the
actual code (not assumed), each with current status and the team who owns
closing the gap. **Done** means verified working in the code as of this
review; **Gap** means verified absent; **Partial** means a real but
incomplete mitigation exists. Nothing here is a guess — see the note after
each item for how it was checked.

| # | Item | Status | Owner | Notes |
|---|------|--------|-------|-------|
| 1 | Hide API keys | **Done** | Security / Platform | Infisical wired as secrets provider, env-var precedence, fail-open logging (§10). |
| 2 | Purge git secrets | **Done (fixed this session)** | Security / Platform | `matatu-mms-ops/.env.local` (real secret) was already covered by a nested per-app `.gitignore`, but the root `.gitignore` had no ops-app section at all — the only one of three frontend apps missing one. Added a `**/.env*.local` global backstop plus the missing section. The Render API key shared earlier in this review is a *separate*, still-open item — rotate it (already flagged in §10). |
| 3 | Public DB key / DB never exposed to clients | **Done by architecture** | Backend / DBA | Only the FastAPI backend ever holds a Postgres connection; no frontend, mobile, or partner client is ever issued a database credential of any kind. |
| 4 | Row-level security (RLS) | **Not used — deliberate** | Security / DBA | No `CREATE POLICY` / RLS anywhere in the schema. Scoping is enforced entirely at the application layer (`sacco_scope_query`, ABAC). This is a real architectural choice, not an oversight — worth Security/DBA explicitly signing off that app-layer scoping is the accepted model rather than leaving it ambiguous. |
| 5 | Encryption of sensitive data at rest | **Partial** | Security / DBA | MFA/TOTP secrets are Fernet-encrypted (`app/mfa.py`). Other PII (phone, email, national ID) is not column-level encrypted; rests on Render's disk-level encryption plus the DPA anonymization-based erasure path (§10) rather than encryption. |
| 6 | Server-side auth | **Done** | Backend | Every authorization decision is enforced server-side via `requires_permission` dependencies; any client-side role check is UX convenience only, never the boundary. |
| 7 | Lock record access (per-record) | **Done** | Backend | `sacco_scope_query` / `enforce_own_sacco_operator_only` and equivalents scope every query and mutation to what the caller actually owns. |
| 8 | Block field tampering (mass assignment) | **Done** | Backend | Grepped for `**payload.dict()` / `**request.dict()` patterns repo-wide — none found. Pydantic schemas declare explicit fields only, so an unexpected field in a request body is silently dropped, not applied. |
| 9 | Secure session cookies | **Done, one item to confirm** | Frontend (all 3 apps) / Backend | All three Next.js apps' own session cookies are `httpOnly`, `secure`, `sameSite: lax`. The backend's separate `mms_session` cookie (`auth.py`) sets `httponly=False` — traced and confirmed it carries only non-sensitive display data (`{userId, name, role, saccoId}`, base64 JSON), never the JWT — but Security should explicitly confirm no code path ever treats it as a bearer credential rather than leaving that implicit. |
| 10 | Hash passwords | **Done** | Backend | bcrypt via `get_password_hash`, confirmed earlier this session. |
| 11 | Rate limit logins | **Done** | Backend / Network | Per-IP and per-account limiters, independent of each other. A real bug in this area was found and fixed this session — the per-IP limiter was keying on a shared proxy address behind Cloudflare→Render (§5) — and is now fixed and verified. |
| 12 | Bot protection (CAPTCHA) | **Gap** | Frontend / Backend | Grepped the whole repo for `recaptcha`/`turnstile`/`hcaptcha` — matches exist only inside `package-lock.json` transitive dependencies, unused in any actual code path. No bot protection exists on login, registration, or password reset. |
| 13 | Parametrized queries | **Done** | Backend / DBA | SQLAlchemy ORM/parameter binding used throughout. Grepped for f-string- or `.format()`-interpolated raw SQL — zero matches. |
| 14 | Validate all inputs | **Done** | Backend | Pydantic schemas validate every route's request body at the boundary. |
| 15 | Escape user context (XSS) | **Done** | Frontend | React's default auto-escaping is the mechanism. Grepped for `dangerouslySetInnerHTML` — only static, server-generated JSON-LD usages found, no user-controlled content passed through unescaped. |
| 16 | Restrict certain file uploads | **Gap** | Backend | Traced the real upload path (`routes/saccos.py:upload_sacco_document` → `storage.py:save_upload`). Path traversal *is* mitigated (`os.path.basename()`), but there is no file size limit and no content-type/extension whitelist anywhere in the chain — a real DoS/storage-cost risk given `STORAGE_BACKEND=db` stores raw bytes directly in Postgres. |
| 17 | Trim API responses | **Done** | Backend | Checked `UserResponse` and related schemas directly — password hashes and MFA secrets are never included in any response model. |
| 18 | Security headers | **Done** (confirmed earlier this session) | Backend | `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, HSTS all set in `main.py`. |
| 19 | Force HTTPS | **Done** | Platform / Network | Enforced at the Render/Cloudflare TLS-termination layer; the HSTS header (#22) backs this rather than duplicating it in application code. |
| 20 | Scan dependencies | **Done** (confirmed earlier this session) | Security / Platform | CI runs `pip-audit`, Trivy, and `gitleaks`, deliberately advisory rather than blocking (§10 explains why). |
| 21 | First-time user experience | **Not a security item — routed** | UI/UX | Onboarding flow itself hasn't been reviewed this session; flagged to UI/UX rather than Security, since it's a usability question, not a control. |
| 22 | Add HSTS | **Done** | Backend | Same header set as #18 — already live. |
| 23 | Add CSRF token | **Gap** | Frontend / Backend | No CSRF token mechanism exists anywhere in the codebase (same grep as #12 covered `csrf` — zero real hits). Partially mitigated in practice by `sameSite: lax` on all three apps' session cookies, which blocks most cross-site POST vectors, but that is incidental protection, not a designed one. |
| 24 | Reset session on password change | **Gap** | Backend | Confirmed directly in `reset_password` (`auth.py`): it never calls `session_revocation.revoke_all_sessions(user.id)`. An attacker holding a valid session before a legitimate password reset keeps that session after. |
| 25 | Expire reset links | **Done** | Backend | `RESET_TOKEN_TTL_MINUTES` enforced; an expired token is rejected and cleared from the user record rather than left reusable. |
| 26 | Prevent user enumeration | **Done** | Backend | `forgot_password` returns an identical generic message whether or not the account exists — confirmed by reading the function in full. |
| 27 | Whitelist upload types | **Gap** | Backend | Same finding as #16 — no extension/content-type whitelist exists; `content_type` is guessed from the filename only, never verified against actual bytes. |
| 28 | Rate limit password resets | **Done** | Backend | `forgot_password` carries its own `@limiter.limit(...)` decorator, confirmed in the route code. |
| 29 | Sanitize before storing | **Partial — deliberate** | Backend / Frontend | No explicit server-side stripping/sanitization of stored strings; relies on Pydantic validation at input plus React's escaping at render time. A defensible defense-in-depth choice, but worth Security explicitly signing off rather than it being implicit. |
| 30 | Log security events | **Done** (built earlier this session) | Backend / Security | Audit log plus `login_events` plus `REAUTH_SUCCESS`/`REAUTH_FAILED` events cover the security-relevant surface. |
| 31 | Restrict database permissions | **Gap** | DBA / Platform | Grepped for `GRANT`/`CREATE ROLE`/least-privilege role names anywhere in the backend — no hits. The app almost certainly connects via Render's single default Postgres role rather than a scoped, least-privilege application role. |
| 32 | Breadcrumbs | **Not a security item — routed** | UI/UX | A navigation affordance, not a control; not reviewed this session, flagged to UI/UX. |
| 33 | Error monitoring | **Done, one item to confirm** | Backend / Platform | Sentry wiring confirmed present earlier this session — inert until `SENTRY_DSN` is actually set in each environment. Worth Platform confirming the DSN is set in the live Render env vars, not just in code. |

**Net read:** the clear-cut gaps worth prioritizing are #12 (bot
protection), #16/#27 (upload size + type restrictions), #23 (CSRF), #24
(session revocation on password change), and #31 (least-privilege DB
role) — all concrete, all independent of each other, none requiring
architecture changes to fix.

---

## Cross-Cutting Themes

*Issues independently raised by three or more roles above — these are
usually where the real priority is.*

1. **The Postgres database expires 2026-09-14.** Raised by Database
   Management as time-critical, and implicitly blocks every other
   recommendation in this document that assumes production data survives
   past this week. **This is the one item in this whole document with a
   hard deadline.**

2. **Reporting load needs to come off the transactional primary.** Raised
   independently by Data Analyst, Big Data/Data Engineering, and Database
   Management. Three different disciplines arriving at the same
   architectural gap from three different angles is a strong signal, not
   a coincidence.

3. **The ops console's network isolation is application-layer only.**
   Raised by both Network Engineering and Security — the CIDR gate is
   correct as a backstop but isn't a substitute for real infrastructure
   isolation (no public ingress), which exists in the Kubernetes manifests
   but isn't deployed.

4. **Accessibility has not been tested at all.** Raised by both Frontend
   Development and UI/UX independently — this is a real obligation for a
   government service, not just a nice-to-have.

5. **Free-tier infrastructure limitations are now compounding.** The
   Postgres 30-day expiry, the Apache-license TimescaleDB restriction, and
   the observed cold-start 503 are three separate free-tier ceilings hit
   within the same review — raised by Database Management, Big Data, The
   Public, and Private Investors from four different motivations
   (data loss, feature loss, user trust, and cost/reliability signal to
   funders respectively). Worth treating as one decision — move key
   services off free tiers — rather than four separate tickets.

6. **Verification discipline paid off, repeatedly, this session.** Every
   role that reviewed a security- or correctness-sensitive area
   independently noted that the real bugs found (the PII leak, the
   production deploy failure, the proxy-IP misattribution, the PWA
   middleware gap) were each caught by *actually running the thing*
   against production or real Postgres, not by code review alone. Worth
   preserving as a stated practice rather than losing it under time
   pressure later.

7. **Every deploy currently drops every passenger's live map.** Raised
   independently by Software Architect, Distributed Systems Engineer, and
   Real-Time Systems Engineer, all pointing at the same named, undone
   architecture decision (`ARCHITECTURE_DECISIONS.md` §2.3: the WebSocket
   gateway holds live connections in-process instead of being split out
   with Redis-backed fan-out). Unlike most items in this document, this
   one degrades the live product on *every single deploy today*, not only
   at higher fleet volume — three engineering disciplines converging on
   "do this one first, ahead of the telemetry carve-out" is worth treating
   as a priority signal, not a coincidence.

---

## Phased Roadmap — Turning This Review Into an Order of Work

This document is 46 roles' worth of findings and asks, which is
deliberately organized by *who is looking*, not by *when to do it*. That
makes it easy to argue with any one finding and hard to answer "what do
we actually do Monday morning." **This section is comprehensive, not a
highlights reel**: every "Would ask for, and why" item from every section
above (plus the Security Checklist, Ops Centre Rebuild, and Mobile Apps
sections) is placed in exactly one phase below, citing back to its
source rather than re-arguing it. Where multiple roles asked for the same
thing, every citing section is listed once, at the phase where it's
sequenced. Phases are ordered by **urgency and dependency**, not by role
or by document order.

### Phase 0 — This week (hard deadline: 3 days as of 2026-09-11)

1. **DONE (2026-09-12).** The Postgres expiry is moot — the account
   migration completed with data verified matching exactly, and the old
   database is now deleted entirely rather than left to expire.
2. **DONE (2026-09-12).** The Render API key flagged compromised (§10) is
   revoked — confirmed directly, the key now returns `401 Unauthorized`
   against the Render API. Revocation had to be done manually in the old
   account's dashboard; no API endpoint exists for a key to manage or
   revoke itself (a reasonable design — a leaked key shouldn't be usable
   to mint or revoke keys).

### Phase 1 — DONE (2026-09-12): the Render account migration

Completed during this review — see §Ops Centre Rebuild for the live
URLs. What actually happened, against the original plan: fresh secrets
were issued directly as Render environment variables (not through
Infisical — confirmed during the original security review that
production was never actually wired to Infisical despite the code
supporting it, so this matches existing practice rather than a new gap);
new NairobiPay callback secret and JWT signing key generated fresh, not
carried over; every cross-service URL/CORS entry updated for the new
account. Schema correctness was verified directly against
`information_schema` and row-count cross-checks against a full pre-migration
backup, rather than by running `verify_postgres.py` specifically — worth
actually running that harness against the new database as a follow-up,
since it checks things (full-text search path, TimescaleDB licensing)
the migration verification didn't.

### Phase 2 — Independent fixes, no architecture change needed

Nothing here depends on anything else in this list — split across
whoever has capacity rather than sequencing:

- Bot/CAPTCHA protection on login, registration, password reset (Security
  Checklist #12)
- File upload size limit + content-type/extension whitelist (Security
  Checklist #16, #27)
- CSRF token mechanism (Security Checklist #23)
- Session revocation on password change (Security Checklist #24, §25 IAM
  Engineer independently asks for the same fix)
- Least-privilege Postgres role instead of the default broad one
  (Security Checklist #31)
- Token scope/audience claims for API clients, so a compromised partner
  credential is provably limited to what it was granted (§25)
- A periodic `.gitignore`-completeness check per app — `gitleaks` catches
  a committed secret, not the gap that made committing one likely (§24)
- A lint rule for the static-file exemption pattern that already caused
  the `webmanifest`/`/offline` redirect bug once (§6)
- Fix the regression suite's non-idempotency against a persistent
  database before it's safe to run in CI against shared Postgres (§7,
  also blocks §15's CI-integrated Postgres testing ask)
- A rollback runbook tied to the release process itself — "which git SHA
  was last known-good, one command back" (§31)
- A single onboarding doc / `DOCS.md` index across the dozen standalone
  root-level audit documents, distinguishing current from historical
  (§32)
- Seed data confirmed to exercise the full role matrix, not just enough
  to boot (§32)

### Phase 3 — Top real-time and data-infrastructure priorities

1. **The WebSocket gateway carve-out** (Cross-Cutting Theme #7) — ranked
   first because it degrades the live product on *every deploy today*.
   Three independent roles converged on this (§16, §20, §28), including
   the Redis-backed fan-out design for the split-out gateway (§20, §28).
2. **A read replica for reporting** (Cross-Cutting Theme #2) — raised
   independently by six roles (§1, §3, §9, §19, §36, §39); unblocks the
   read-only DB browser (§Ops Centre Rebuild) and a BI tool connection
   target (§39, §40).
3. **PgBouncer / connection pooling** (§9, §29) — before Kubernetes
   autoscaling multiplies backend pod count along with raw Postgres
   connections.
4. **The telemetry ingest carve-out** (§16, mapped in
   `SERVICE_EXTRACTION_READINESS.md`) — sequenced after the WebSocket
   gateway per §16/§20/§28's explicit ranking.
5. **A Timescale-licensed Postgres** (self-hosted or Timescale Cloud),
   replacing Render's Apache build once telemetry volume justifies it
   (§3).
6. **Multi-replica-aware circuit breaker state** — today's breaker/retry
   primitives are correct for one process and will silently under-protect
   above replica count 1; prioritize before scaling replicas, not after
   an incident reveals the gap (§18, §20, §30).
7. **Explicit consistency documentation** — which parts of the system are
   eventually consistent (breaker/rate-limit overrides) versus strongly
   consistent (ledger postings, seat assignment), so a future engineer
   doesn't assume uniform guarantees (§20).
8. **SLOs with real error budgets**, confirming `alertmanager.yml` is
   wired to defined SLOs rather than raw thresholds (§18).
9. **A disaster-recovery drill** rehearsing the runbooks against the
   Postgres-expiry-shaped scenario, not just a read-through (§18); pair
   with **chaos-testing the runbooks** against a deliberately broken
   dependency (§30).
10. **A documented, drilled incident-response runbook** synthesizing the
    ad hoc diagnostic steps already used this session (a failed deploy, a
    PII leak, a proxy-IP bug) into a standing procedure (§10).
11. **A living ADR practice** — one-ADR-per-decision going forward,
    rather than the single monolithic `ARCHITECTURE_DECISIONS.md` (§16).

### Phase 4 — Ops console: the two remaining named gaps (§Ops Centre Rebuild)

1. Service/software catalog — a natural byproduct of the account-migration
   audit work in Phase 1; capture that audit as this screen.
2. Read-only database browser — sequence after Phase 3's read replica,
   since it's meant to point at that replica, not the primary.

### Phase 5 — CD and infrastructure maturity, once Phase 3 creates something to deploy independently

1. Decide the staging/orchestrator question (§4, §17, §31) — named in
   `CD_PIPELINE_STATUS.md` as a blocked *decision*, not blocked
   engineering work.
2. Actually apply the Kubernetes manifests against a real API server —
   "the YAML is correct" and "the cluster comes up clean" are different
   claims (§4).
3. ArgoCD + blue-green (§4, §17) once the above lands — the canary
   mechanics already exist and are runnable (`scripts/canary-promote.sh`)
   against the self-hosted docker-compose target; wiring them to a real
   orchestrator is the remaining step.
4. A manual-approval gate before production — a GitHub Environments
   repo-settings toggle once there's a real deploy job to gate (§31).
5. Terraform for infrastructure-as-code (§4, §19), so "what's running in
   production" stops living in one person's head.
6. Per-service path filters in CI/CD — a single-file commit currently
   triggers a full rebuild of all four services (§4).
7. A named cloud-cost owner, so "why did the bill change" has an answer
   before it's asked under pressure (§19).
8. Real network isolation for the ops control plane (no public ingress),
   not just the application-layer CIDR gate (§5, Cross-Cutting Theme #3).
9. A real WAF beyond Cloudflare's free-tier default, and a DDoS
   review/load-test at the network layer (§5).
10. A monitored assertion confirming Render's `X-Forwarded-For` ordering
    going forward, so a future upstream change can't silently reintroduce
    the proxy-IP bug already fixed (§5).
11. A load test against the actual telemetry write path (~700 writes/sec
    calculated, never measured against a running system) (§29).

### Phase 6 — API contracts and cross-cutting developer-facing work

- A published, versioned OpenAPI contract, not just FastAPI's
  auto-generated schema — asked independently by Backend (§7),
  Full-Stack (§8), and API/Integration Engineering (§21), which is also
  the audience most affected by an undocumented breaking change.
- Shared type generation between frontend and backend (e.g.
  `openapi-typescript`) to remove hand-kept-in-sync drift (§8).
- A single source of truth for design tokens across the three Next.js
  apps (§8).
- Finish auditing the `Decimal` migration for any remaining `float` money
  fields (§7).
- Background job observability — a historical view of ARQ failure rates
  over time, not just current queue state (§7).
- Webhook delivery guarantees documented for partners specifically (retry
  count, backoff, replay window), not just the internal runbook (§21).
- Keep `NTSA_IRMS_INTEGRATION_CHECKLIST.md`'s framing explicit to
  stakeholders — vehicle positioning is blocked on external access, not a
  code gap (§21).

### Phase 7 — Frontend, UX, and accessibility

- WCAG 2.1 AA accessibility audit (§6, §12, Cross-Cutting Theme #4) —
  raised independently from the implementation side and the human-outcome
  side.
- A component library / design system, formalized once a third app needs
  a currently-duplicated component (§6).
- Real E2E tests (Playwright/Cypress) — the PWA middleware bug is exactly
  what a permanent smoke test would have caught (§6).
- Usability testing with real passengers and crew on real lower-end
  Android devices over real Kenyan mobile data — nothing has been tested
  with an actual target user yet (§12).
- A first-run onboarding flow — the apps assume familiarity with "stage,"
  "Sacco," "BRN route" that a first-time passenger doesn't have (§12).
- Empty-state design for list views, beyond a plain "no records" line
  (§12).
- A public status page, so "is it down or just me" has a real answer
  during an outage (§13) — directly relevant to this session's own
  cold-start investigation.
- Plain-language fare/fine explanations answering "why is this fine
  KES 3,500" directly in the UI (§13).
- An SMS-based fallback for feature-phone users or unreliable data
  connections (§13; §45 additionally flags this channel currently carries
  no language preference).
- Fix the reliability *perception* problem alongside the infrastructure
  fix — a citizen hitting a cold-start error reasonably assumes the whole
  system is broken (§13).

### Phase 8 — Data and analytics maturity

- A data classification scheme (public/internal/restricted/PII) applied
  consistently across tables (§37).
- A data inventory/map — what's collected, where, retention, who can
  access it (§26, §37 — same ask from Privacy Engineering and Data
  Governance independently).
- A retention policy tied to actual purpose for PII-bearing tables beyond
  the already-justified 90-day GPS window (§26).
- Data quality checks beyond the ledger's trial balance — orphaned
  records, out-of-range values, referential drift — plus automated,
  ongoing monitoring rather than write-time-only constraints (§38).
- A documented logical data model / ER diagram per module, matching the
  boundaries already named in prose (§36).
- Named per-table data stewardship — an accountable point of contact
  independent of who wrote the migration (§41).
- A metrics dictionary resolving field-name drift (`fine_amount_kes` vs
  `amount_kes`) and a documented semantic layer so multiple dashboards
  don't quietly disagree on what "active user" or "on-time" means (§1,
  §39).
- Scheduled exports (CSV/Sheets) for county finance and compliance
  reporting (§1).
- Start the dbt project structure now, with a single model, rather than
  waiting for ad hoc transformation scripts to multiply (§3, §40).
- Confidence intervals and a stated methodology documented on every
  metric derived from crowdsourced input, including the OD matrix's own
  construction (§42).

### Phase 9 — Business and organizational documentation (not code)

- A clear unit-economics view and an actual budget dashboard extending
  the existing SMS spend-tracking (§14).
- A concrete compliance roadmap (DPA formalization, eventual SOC2-style
  posture) with dates (§14).
- A clearly articulated revenue model document — the ledger has the
  mechanics; the business explanation doesn't exist yet (§14).
- A named path to countrywide expansion, given the data model is
  deliberately Nairobi-only today (§14).
- Actually run the k6 load-test scenarios at least once locally — written
  and never executed (§15).
- Visual regression testing for the three frontends, given how much UI
  work has happened with only manual before/after screenshots as the
  record (§15).

### Phase 10 — Organizational owners to name (not engineering work)

- Legal/Compliance review of enforcement liability and evidentiary
  chain-of-custody (raised in conversation, adjacent to §44).
- The Oregon hosting-region data-residency question under Kenya's Data
  Protection Act (raised in conversation) — worth a Legal/Compliance
  answer before treating it as settled either way.
- Support ticketing/workflow ownership, plus a defined escalation path
  for payment and enforcement disputes specifically, plus a support-facing
  known-issues doc (starting with the free-tier cold-start error) (§44).
- A native Swahili speaker's translation review; syncing the staff and
  public apps' currently-separate i18n dictionaries the same way
  `PageBanner`/`NotificationBell` are synced; prioritizing translation
  coverage by consequence (fines, bookings) rather than page-traffic
  alone (§45).
- Field device provisioning (BYOD vs. county-issued) and a field
  training/change-management plan for officers and crew — a real
  workflow change from paper citations, with no named owner today (§46).
- An interim mitigation (even just a visible on-screen warning) for
  `OnPatrolToggle`'s silent tracking loss when an officer backgrounds the
  browser, ahead of the native-mobile fix for offline tolerance generally
  (§46).

### Phase 11 — Deferred by design, gated on volume or a future decision, not forgotten

Each of these has a stated trigger for when to revisit — not a "someday":

- **Redpanda** — only once Redis Streams actually hits a real limit
  (§3); a replacement path, not something to run alongside Redis Streams.
- **Native mobile apps** — deferred with a documented plug-and-play path
  (§Mobile Apps); revisit once the three web apps and backend are settled
  enough to build against without a moving target.
- **ML/MLOps/Computer Vision** (§33-35) — no system exists yet to justify
  these disciplines; the demand-intelligence dashboard is the most
  plausible first real use case once enough historical volume exists.
- **A real penetration test** (§10) — explicitly "before any countrywide
  launch," not before the current demo stage.
- **Move integrity detection from fixed thresholds to a learned model**
  (§2) — once enough labelled history exists; the current constants are
  reasoned-about, not broken.
- **A feature store** (§2) — once fare-demand forecasting and fraud
  detection exist as more than one-off signal derivations.
- **An experimentation framework (A/B testing)** (§2) — before touching
  fare policy or route changes at scale, not before there's a policy to
  test variants of.
- **A distinct research-data API tier and open, versioned aggregate
  exports** for approved researchers (§11) — a real, named gap, but one
  that needs an access-policy decision (aggregation thresholds,
  re-identification review) before it's an engineering task.
- **Anonymized historical data access for model training**, separate from
  the individual-subject DPA erasure/export path (§2) — same dependency
  as the research-data tier above.
- **Cohort and retention analysis on ridership** (§1) — the tables
  support it structurally; nothing computes it yet because real usage
  volume doesn't exist yet to analyze.
- **A data-freshness mechanism for BRN route geometry** (§27) — triggered
  by the permanent NMA-wide route-numbering scheme landing, not before.
- **Confirm the PostGIS migration and adherence buffers are actually
  applied against production** (§27) — worth doing opportunistically
  alongside Phase 1's `verify_postgres.py` re-run on the new database,
  rather than as a separately scheduled task.

---

*Corrections, disagreements, and additions welcome directly in this file —
it's meant to be edited, not treated as a finished report.*
