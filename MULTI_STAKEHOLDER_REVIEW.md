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
- **Rotate the Render API key used during this review immediately.** It
  was shared in-session for diagnostic purposes and is now part of this
  conversation's history — treat it as compromised on principle even
  though it was only used for read/diagnostic calls.
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

---

*Corrections, disagreements, and additions welcome directly in this file —
it's meant to be edited, not treated as a finished report.*
