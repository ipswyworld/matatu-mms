# Matatu MMS — Admin Dashboard Audit & Recommendations

**Scope:** Follow-up audit focused on (1) verifying/updating the standing audit docs against current code, (2) the admin dashboard's Users & Roles area and widget/template inventory, (3) separating the Super Admin / technical monitoring surface onto its own port, and (4) "if I were building this" recommendations.
**Date:** 2026-08-20
**Companion docs:** `SYSTEM_AUDIT.md` (2026-08-05), `ARCHITECTURE_DECISIONS.md` (2026-08-11), plus the eight `*_STATUS.md` / `*_CHECKLIST.md` / `*_POLICY.md` follow-ups. This file does not repeat their content — it verifies what's changed and adds what's new.

---

## 1. What's changed since the last audit (verified against current code)

| Item | `SYSTEM_AUDIT.md` said | Current state |
|---|---|---|
| Version control | 🔴 P0 — not a git repo | ✅ **Fixed.** Now on branch `deploy/render-demo`, tracking `origin`. |
| Two-frontend split | Single frontend | ✅ **Now two separate Next.js apps**: `matatu-mms/` (staff/admin, port 3000) and `matatu-mms-public/` (passengers/crew/operators, port 3001), each with its own Render service, Dockerfile, and session secret. This is good — it already gives passengers and staff separate blast radii. |
| SQLite → Postgres | 🟠 P1 | ✅ Postgres + PostGIS + TimescaleDB now the default (`docker-compose.yml`, `render.yaml`). PgBouncer/read-replica genuinely blocked on Render plan tier, not code (`DATA_LAYER_SCALING_STATUS.md`). |
| Event bus | in-process `asyncio.create_task` | ✅ Redis Streams now exists (`app/streams.py`, community `app/streams`). |
| Session revocation | none | ✅ Done (`SESSION_SECURITY_STATUS.md`) — Redis "revoked-before" stamp. MFA still not built (correctly deferred, not faked). |
| Tenant isolation | not audited | ✅ Systematic pass done (`TENANT_ISOLATION_AUDIT.md`) — 3 real cross-tenant leaks found and fixed. |
| CI/CD | none | ✅ Lint/typecheck/unit/Postgres-integration/image-build-scan all wired; canary scripts exist. Staging + orchestrator genuinely blocked on hosting plan, tracked honestly (`CD_PIPELINE_STATUS.md`). |

This project's documentation discipline is unusually good — status docs say "blocked on X, not code" instead of quietly marking things done. Keep that pattern; it's why this audit could move fast instead of re-discovering everything.

---

## 2. New finding this pass — port collision (🔴 fix before next `docker compose up`)

`docker-compose.yml` maps **two different services to the same host port, 3001**:

```yaml
frontend-public:
  ports:
    - "3001:3001"        # public passenger/crew/operator app
...
grafana:
  ports:
    - "127.0.0.1:3001:3000"   # Grafana UI
```

Grafana binds to `127.0.0.1` only, so today this only breaks if both are started on the same host — but it **will** break any local/self-hosted run that includes both, and it's exactly the kind of landmine that costs an afternoon during a demo. This is also directly relevant to your port-3002 ask below: fixing this and carving out the new monitoring port should happen in the same change.

**Fix:** move Grafana off 3001. Given the port-separation plan in §4, the natural home is a slot next to the new 3002 superuser service (e.g. `127.0.0.1:3003:3000` for Grafana, or put Grafana *behind* the new 3002 service entirely — see §4.3).

---

## 3. Admin Dashboard — Users & Roles audit

Read: `app/(app)/users/page.tsx`, `components/UsersTable.tsx`, `components/EditUserModal.tsx` (referenced), `app/(app)/system/page.tsx`.

### What's already good
- **Scope note is excellent UX**, not a gap: the page explicitly explains *why* Sacco operators/crew/passengers aren't listed here and links to where they actually live (Sacco verification hub). Most admin panels just silently omit rows and leave the user guessing. Keep this pattern — it's the "non-technical user" design principle from `ARCHITECTURE_DECISIONS.md` §24 done right.
- Role-gated edit affordances (`ADMIN_TIER_ROLES` + `canManageAdmins`) are enforced in the same component that renders the row, not just hidden with CSS.
- Search + role filter client-side is fine at current staff-account volume (dozens, not thousands).

### Gaps and recommendations

1. **No bulk actions.** Deactivating or role-changing multiple accounts (e.g. offboarding a whole shift of enforcement officers) is one-row-at-a-time today. Add row checkboxes + a bulk action bar (deactivate, reassign zone, export selected) once past ~2 similar requests — don't build speculatively before that.

2. **No activity/last-login column.** For a government staff roster, "when did this account last authenticate" is the single most useful column for spotting stale/compromised accounts — and you already have the data (`SESSION_SECURITY_STATUS.md`'s revocation work touches the same session data). Add a `Last active` column sourced from the JWT `iat`/login audit event once auth events are audited (currently a 🟡 P2 gap per `SYSTEM_AUDIT.md` §2.1).

3. **Role management is implicit, not a first-class screen.** Roles/permissions live in code (`rbac.py`'s permission matrix) and are only *visible* on the `/system` page's ABAC policy inspector — there is no UI to see "what can a DIRECTOR_OF_MOBILITY actually do" without reading source or opening System Console as Super Admin. Recommendation: add a **read-only "Role Matrix" tab** next to Users & Roles — role × permission grid, generated from the same `PERMISSIONS`/`ADMIN_TIER_ROLES` source of truth the backend already uses (don't hand-maintain a second copy). This is pure UI over existing data — no new backend logic needed. High leverage for a non-technical admin who needs to explain "why can't the Chief Officer do X" without asking an engineer.

4. **User creation form (`NewUserForm`) and edit modal are two different surfaces for overlapping fields.** Worth a quick pass to confirm field parity (e.g. does edit allow changing `sacco_id`/zone the same way create does) — didn't diverge as far as I checked, but this is the classic place two forms drift silently. Not urgent, just flag it for the next `/impeccable` pass on this page.

5. **Deactivation vs. deletion vs. session revocation are three separate concepts on this page and it's not visually obvious which does what.** `DeactivateUserButton` (soft-disable), `revoke-sessions` (kill active tokens, per `SESSION_SECURITY_STATUS.md`), and no hard-delete (correct, per §19's audit-survival requirement) are three different severities. Recommendation: group them under one "Account actions" menu per row with clear consequence text ("Deactivate: blocks new logins, keeps history" / "Revoke sessions: logs out immediately, they can log back in"), rather than separate buttons that look equally weighty.

---

## 4. Superuser / technical monitoring — its own port (3002)

### 4.1 Current state
There is **no separate superuser service today.** The `/system` "System Console" (`app/(app)/system/page.tsx`) is a page *inside* the staff app, on the same port (3000) as every other admin/enforcement/operator page, gated only by `role === SUPERADMIN` at render time (app-level check, backed by the real backend RBAC — not just hidden UI, which is good) but **not isolated at the network/deployment level.**

What it shows today: DB/Redis reachability, connection pool stats, process uptime, whether secrets are explicitly set (not their values — good), and the ABAC policy inspector. This is genuinely a "superuser monitoring" surface already — it just isn't separated.

Prometheus (`:9090`), Alertmanager (`:9093`), and Grafana (`:3000`, colliding per §2) already exist as **separate containers bound to `127.0.0.1` only** — i.e., today they're reachable only via SSH tunnel/VPN, not through nginx at all. That's actually a reasonable interim posture, but it means your county's technical staff currently have **two disconnected monitoring experiences**: the in-app `/system` page (pretty, RBAC-gated, no metrics history) and raw Grafana/Prometheus (powerful, but bare infrastructure UI, no RBAC tied to your app's roles).

### 4.2 Recommendation: yes, split it — here's the concrete shape

Give the Super Admin / technical console its own Next.js app (or, cheaper, a route group in the *existing* staff app served on a second port) bound to **port 3002**, separate from the staff app's 3000 and the public app's 3001. Reasons this is the right call, not just port-tidiness:

- **Blast radius.** The staff app (3000) is what Directors, Chief Officers, enforcement commanders, and Sacco-verification admins use daily — it should never be the same deploy/restart/incident surface as infrastructure monitoring. A bad deploy to the monitoring dashboard shouldn't be able to take down fine-issuance UI, and vice versa.
- **Different access model.** Everything else in this system is RBAC-scoped per business role. Superuser/monitoring access is closer to "who holds the pager," a much smaller set of people, and arguably deserves **network-level restriction** (VPN/IP allowlist, like Prometheus/Grafana already get) *in addition to* RBAC — easy to enforce for "everything on 3002" but awkward to bolt onto one route inside a page tree that's otherwise public-facing-adjacent.
- **It's already halfway there.** `/system` is already a self-contained page pulling from `getSystemHealth()` — extracting it is a move, not a rebuild.
- **It naturally becomes the home for Grafana/Prometheus/Alertmanager links**, resolving §2's port collision by design rather than by accident (see §4.3).

### 4.3 Two implementation options, in order of effort

**Option A — cheapest, ship this first: reverse-proxy consolidation, no new app.**
Add an nginx server block listening on `3002` (or route it through the existing 443 with a subdomain, `ops.<domain>`) that:
- Proxies `/` to the existing `/system` route inside the staff Next.js app (still gated by the same `SUPERADMIN` RBAC check — network restriction is additive, not a replacement for it).
- Proxies `/grafana/` → Grafana container, `/prometheus/` → Prometheus, `/alertmanager/` → Alertmanager (all currently `127.0.0.1`-only; this becomes their one, deliberate front door instead of an SSH tunnel).
- Add IP allowlist / basic-auth / VPN requirement at this nginx block specifically — the one place a network-level control makes sense given everything else is RBAC-only.

This resolves the port collision (§2), gives you the "own port" separation the ask is for, and requires **no frontend rewrite** — a few hours of nginx config plus moving Grafana's port mapping.

**Option B — the real split, once there's a second person to hand it to: extract `/system` into its own minimal Next.js (or even a static/SSR-light) app.**
- New `matatu-mms-ops/` app, same pattern as `matatu-mms-public/` (own Dockerfile, own session secret, own Render service or own docker-compose port `3002:3000`).
- Server-rendered pages fetch straight from `getSystemHealth()`-equivalent backend endpoints, same RBAC (`SUPERADMIN` only) enforced server-side.
- Embeds Grafana panels via iframe (Grafana supports this natively with API keys / anonymous-with-org-role) rather than reimplementing charts — don't rebuild what Grafana already does well; the in-app page's job is the *app-specific* health (RBAC policy inspector, secret-configured flags, ABAC rules) that Grafana has no concept of.
- This is the version worth building once you have real operational headcount using it daily; Option A is the right move for the current investor-demo/small-team stage.

**My recommendation:** ship **Option A now** (fixes the real port bug today, gives you the port-3002 separation you asked for, near-zero risk), and treat **Option B as a backlog item** gated on team growth — exactly the same honesty pattern this repo already uses for staging/PgBouncer/read-replicas ("infra-blocked, not skipped").

---

## 5. Templates & widgets — do you need more?

Inventory: `components/dashboard/` (8 files: `ActivityFeed`, `BookingsPanel`, `ComplianceDonut`, `CorridorHealth`, `FinesTrendChart`, `FleetLiveStatus`, `KpiCard`, `LiveConditions`, `RevenueBars`), plus `components/widgets/WidgetGrid.tsx` and general-purpose pieces (`StatCard`, `StatusPill`, `PageBanner`, `EmptyState`).

### Verdict: the *shape* is right, the *coverage* is thin — and this is the same gap `ARCHITECTURE_DECISIONS.md` §23 already diagnosed in detail (hand-rolled charts, no aggregation layer). Don't re-solve it here; execute §23's plan. Concretely, for the admin dashboard specifically:

1. **You have one KPI card, one donut, and two bar-chart variants. You need a small shared "widget kit," not more one-off components.** Every new persona dashboard (Director/Chief Officer work-queue, Executive briefing — both flagged as missing in `SYSTEM_AUDIT.md` §6) will otherwise spawn its own bespoke widget the way `RevenueBars`/`ComplianceDonut` were each built once, for one page. Before building those persona dashboards, extract:
   - A generic `<TrendChart>` (Recharts-backed, per §23.2 — replaces `RevenueBarChart`/`FinesTrendChart`'s hand-rolled SVG with one component taking `{metric, data, comparisonWindow}`).
   - A generic `<StatusBreakdown>` donut/bar (replaces `ComplianceDonut` as a one-off).
   - A `<WorkQueueList>` widget (count + oldest-item age + "view all" link) — this is the literal shape the Director/Chief Officer dashboard needs (§6: "applications awaiting *their* stage, average time-to-decision, SLA aging") and doesn't exist yet in any form.

2. **`WidgetGrid.tsx` exists but is used where?** Worth confirming it's actually the dashboard's layout primitive and not a leftover — if it's the intended "drop widgets into a responsive grid" container, the Director/Chief/Executive dashboards should be built as *configurations of `WidgetGrid` + the shared kit above*, not new page layouts each time. That's the fastest way to ship 3 missing personas without 3x the frontend work.

3. **The Users & Roles "Role Matrix" tab I recommended in §3.3** is itself a new, reusable widget shape (a permission grid) — worth building as a generic `<PermissionMatrix>` since the same shape is useful on the `/system` ABAC policy inspector too (currently a hand-rolled list, could be the same grid component).

4. **Templates for exports** (§23.8 already covers this precisely — one shared branded PDF/Excel report template server-side, not per-export reimplementation). No new recommendation from me beyond: do this before building more export buttons, since every new report screen currently means a new bespoke `jsPDF` call site.

**Net:** don't add more *bespoke* widgets. Add ~3 generic ones (trend chart, status breakdown, work-queue list) and build every future dashboard — the two missing personas, the ops/monitoring split in §4, the Role Matrix — as compositions of those, per the existing `WidgetGrid`. This is a half-day of extraction that pays for the next five dashboard requests.

---

## 6. If I were building this — where I'd diverge or add

Everything in `ARCHITECTURE_DECISIONS.md` is sound and I wouldn't relitigate the big calls (modular monolith, NairobiPay-only, PostGIS/TimescaleDB, no Kafka yet, no Rust rewrite). A few places I'd add or push differently:

1. **I'd build the Role Matrix and generic widget kit (§3.3, §5) *before* the two missing persona dashboards**, not alongside them — building Director/Chief/Executive dashboards first with today's one-off component style just creates three more things to refactor later. Sequence: widget kit → Role Matrix → persona dashboards, reusing the kit.

2. **I'd fast-track MFA for `SUPERADMIN`/`ADMIN` ahead of most 🟡 P2 items**, not because the existing writeup is wrong (it correctly refuses to ship a shallow, lockout-risk version), but because pairing it with the port-3002 split in §4 is a natural moment: the same small group of people who'd get network-restricted access to `:3002` are exactly the group MFA protects. Do the recovery-code design properly (as `SESSION_SECURITY_STATUS.md` already specs), but sequence it next to the monitoring split rather than treating them as unrelated backlog items.

3. **On monitoring specifically**, I'd resist the temptation to make the in-app `/system` page grow into a second Grafana. Its job should stay narrow — app-specific state Grafana can't see (RBAC/ABAC config, which secrets are set, DB pool from the app's own perspective) — while all time-series/metrics questions get answered by embedding or linking to Grafana (§4.3 Option B), not reimplemented as more custom charts. This is the same "don't hand-roll what a mature tool already does" principle §23.6 applies to Metabase for analytics — apply it here too.

4. **Given this is government infrastructure handling PII at country scale**, I'd move the **egress allowlist** (§17.6) and **CSP tightening** (§15.4, currently deliberately loose per `next.config.mjs`'s own comments) higher in priority than their current P2/unlabeled status — both are cheap, both are exactly the kind of control a security review before public launch will ask about first, and neither is blocked on external access (unlike NTSA/NairobiPay).

5. **One thing not yet decided anywhere I could find:** who is the actual owner of `/system`'s and the future `:3002` console's alerting loop? Alertmanager exists, but `CD_PIPELINE_STATUS.md`/runbook docs don't yet say *where alerts actually go* (Slack/SMS/PagerDuty receiver — `ARCHITECTURE_DECISIONS.md` §9 flags "real Alertmanager receiver" as still 🟡 P2/missing). Worth deciding this in the same pass as the port-3002 work, since a monitoring console nobody gets paged from is just a dashboard people forget to check.

---

## 7. Prioritized action list from this pass

| # | Action | Effort | Priority |
|---|---|---|---|
| 1 | Fix Grafana/frontend-public port collision on 3001 (§2) | Minutes | 🔴 Do before next full `docker compose up` |
| 2 | Ship monitoring port separation, Option A (nginx consolidation onto 3002, IP-restricted) (§4.3) | Hours | 🟠 High — directly answers the ask |
| 3 | Extract the 3-widget shared kit (`TrendChart`, `StatusBreakdown`, `WorkQueueList`) from existing one-offs (§5) | ~1 day | 🟠 High — unblocks the next 3+ dashboard requests |
| 4 | Add Role Matrix tab to Users & Roles, reusing the ABAC inspector's data (§3.3) | ~1 day | 🟡 Medium |
| 5 | Group per-row account actions (deactivate / revoke sessions) with consequence text (§3.5) | Small | 🟡 Medium |
| 6 | Decide and wire a real Alertmanager receiver (Slack/SMS/PagerDuty) (§6.5) | Small–Medium | 🟡 Medium, pair with #2 |
| 7 | MFA for ADMIN/SUPERADMIN, proper recovery-code design (already spec'd in `SESSION_SECURITY_STATUS.md`) | Medium | 🟠 Pair with #2 |
| 8 | Option B — fully separate `matatu-mms-ops` app on its own service/port | Large | 🟢 Backlog, gated on team growth |
| 9 | Director/Chief Officer + Executive persona dashboards, built on the widget kit from #3 | Medium | 🟡 Medium, sequence after #3 |

---

*This file is additive to the existing audit trail (`SYSTEM_AUDIT.md`, `ARCHITECTURE_DECISIONS.md`, and the `*_STATUS.md` set) — it does not replace them. Re-run `graphify update .` after any of the above lands so the knowledge graph stays current.*
