# User Activity Tracking + Admin Dashboard UX Research

**Context:** Third follow-up in this audit thread (after `ADMIN_DASHBOARD_AUDIT_AND_RECOMMENDATIONS.md` and `OPS_CONSOLE_FEATURE_SPEC.md`). Covers two asks: (1) a "user activity" feature for both the staff portal and the dev/ops console, and (2) research on how other admin dashboards look and work, to inform the staff portal redesign.

Note: I confirmed the widget kit from the first doc (`StatusBreakdown`, `TrendChart`, `WorkQueueList`) is already wired into `app/(app)/dashboard/page.tsx` — the other session has clearly started executing. This doc is written to slot into that same in-progress work, not to restart it.

---

## 1. What "user activity" already exists — and the real gap

This codebase has **three different things that all sound like "user activity"** and it's worth being precise about which is which, because the fix is different for each:

| Table / feature | What it actually tracks | Where it lives today |
|---|---|---|
| `ActivityLog` | **Fleet operational events** — a crew incident report, a stop, a scene log — tied to a `matatu_id`, not really about the *user* | `backend/app/routes/activity.py`, `components/dashboard/ActivityFeed.tsx` |
| `AuditLog` | **Data-change trail** — who changed what field on what resource, before/after values | `backend/app/routes/audit_logs.py`, `components/AuditLogTable.tsx` — global flat table only, filterable by action/resource, **not filterable by user in the UI today** even though `user_id` is a column |
| **True user activity (logins, sessions, "what has this person been doing")** | **Doesn't exist yet.** `SYSTEM_AUDIT.md` §2.1 already flagged this: *"auth.py writes no audit records... auth events especially must be audited."* Session revocation exists (`SESSION_SECURITY_STATUS.md`) but as a per-user "revoked-before" Redis timestamp, not a queryable session list — deliberately, since there's no `jti` per-token tracking. That means **there is currently no way to answer "show me everywhere this account is logged in" or "when did this admin last sign in"** without adding new tracking, not just a new UI. |

**So "add a user activity feature" is really two separate pieces of work:**
1. **A UI feature** — new pages/components (mostly buildable now from existing data).
2. **A data-capture gap** — auth events (login/logout/failed-login) aren't recorded at all yet, so the login-history part of "user activity" has no data to show until that's built. Don't let the UI work quietly become the whole deliverable while this stays unbuilt — it's the actual dependency.

---

## 2. Recommended feature: one "User Activity" concept, two surfaces

Same principle as the ops-console CRUD tiering from `OPS_CONSOLE_FEATURE_SPEC.md`: build it once, expose it twice, scoped differently per audience.

### 2.1 Backend prerequisite (do first, small)
- Add `stage_audit_log` calls to `auth.py`'s login, logout, and register/failed-login paths — closes the exact gap `SYSTEM_AUDIT.md` already named. This is the same pattern already used everywhere else, not a new mechanism.
- Minimal session metadata worth capturing at login time (separately from the JWT itself, since the JWT is stateless by design): `user_id`, `login_at`, `ip`, `user_agent`. This does **not** require the full per-token `jti` denylist redesign `SESSION_SECURITY_STATUS.md` deliberately deferred — it's an append-only log row per login, independent of how revocation works. Enough to answer "when/where did this account last sign in" even though "kill this one specific session" still isn't possible without the fuller redesign (keep that as a distinct, separately-sized backlog item — don't conflate the two).

### 2.2 Staff-portal surface — per-user Activity tab
On the Users & Roles page (`app/(app)/users/page.tsx`), add a click-through **user detail view** with an "Activity" tab:
- Login history (once §2.1 lands): last N logins with timestamp + IP + rough device/browser.
- Their `AuditLog` rows filtered by `user_id` (data already exists — this is a query change, not new capture) — "everything this person has created/changed," most recent first.
- A **"Revoke all sessions"** action right here, next to the identity it affects, instead of only reachable as a standalone admin endpoint — ties directly into the existing `POST /api/users/{id}/revoke-sessions`.

This is the single most requested pattern in the SaaS-dashboard research below: **an "Activity" tab on any detail page for the thing that has history**, not just one global flat log everyone has to filter. Apply the same pattern later to Sacco/operator detail pages and Matatu detail pages too — `AuditLog.resource_type`/`resource_id` already supports it structurally.

### 2.3 Ops-console surface — cross-account activity + control
On the port-3002 console (`OPS_CONSOLE_FEATURE_SPEC.md` §3), the same underlying data supports a different job:
- **A live "who's logged in right now" view** across all SUPERADMIN/ADMIN accounts specifically (the highest-privilege set) — directly useful for the MFA-enrollment tracking already on that doc's feature list.
- **Anomaly surfacing, not just a log** — e.g. a login from a new IP for a privileged account, or a burst of failed logins (ties into the rate-limit dashboard already scoped in `OPS_CONSOLE_FEATURE_SPEC.md` §Observability). This is Tier-1 read-only to start; don't build automated lockout on top of it yet — that's a distinct, higher-risk feature.
- If impersonation (`OPS_CONSOLE_FEATURE_SPEC.md` §3.4) gets built, its audit trail belongs in this same activity view — "who impersonated whom, when" is exactly the kind of event this surface exists for.

### 2.4 What not to build
Don't build a generic "activity feed" that mixes fleet `ActivityLog` incidents with user login events with `AuditLog` data changes into one undifferentiated stream — the research below is explicit that per-record/per-user activity tabs outperform one kitchen-sink feed. Keep the three data sources separate in the data model (they already are) and only compose them in the UI where it's genuinely one audience's one question ("what has this person done" = login history + their audit rows, correctly two sources, one tab).

---

## 3. Admin dashboard UX research — applied to the staff portal

Researched current (2026) admin/SaaS dashboard design practice, looking specifically for patterns transferable to this project's Tailwind/county-branded Next.js staff app, not generic advice.

### 3.1 Sidebar navigation — keep it, but watch the length
Current pattern (`Sidebar.tsx`) is already the right choice — flat sidebar nav is what Linear/Notion/Vercel/Stripe converge on because it scales without restructuring. `SYSTEM_AUDIT.md` §6 already flagged "the sidebar is long" for Admin. Applying the research: the fix isn't a different nav pattern, it's **grouping** — collapsible sections (Fleet / Enforcement / Revenue / Administration) rather than one flat 15-item list, which several of the researched examples use once an app passes ~10 top-level items. Worth doing alongside the Role Matrix work already planned, since both touch the same page.

### 3.2 Progressive disclosure — lead with one "is everything okay?" signal
The strongest recurring pattern across Stripe/Vercel/PostHog: **surface one metric that answers the top-of-mind question first**, bury supporting detail behind a click. Applied here: the dashboard home (`app/(app)/dashboard/page.tsx`) currently leads with several KPI cards side-by-side (fleet count, revenue, compliance, etc.) with no explicit hierarchy. Consider: **one hero status** per persona — for Enforcement Commander that's "coverage right now" (§22 in `ARCHITECTURE_DECISIONS.md`'s beat/segment work), for Executive it's the county-wide compliance/revenue trend, for Admin it's "anything needing my attention" (a `WorkQueueList` already exists for this — lead the page with it, not a KPI card grid). This is a layout-priority change more than a new build.

### 3.3 KPI cards: number + trend + sparkline, not just a number
Stripe's dashboard pattern (four cards: revenue/charges/payouts/disputes, each with number + trend arrow + sparkline) is directly applicable and mostly already-planned: the earlier widget-kit doc recommended `TrendChart`; pairing it with `KpiCard.tsx` (already exists) so every KPI card gets a small inline sparkline, not just a static number, is a small addition on top of work already started. `UX_BACKLOG_STATUS.md` already independently arrived at the "narrative insight + trend arrow" pattern for `FinesTrendChart` — extend that same treatment to the KPI cards, don't reinvent it.

### 3.4 Dark mode — relevant to the ops console specifically, not the staff app
Research is consistent: **developer/monitoring-facing tools (Sentry, Supabase, Raycast, Datadog-style dashboards) trend dark-mode-first**; consumer/operational staff tools (the county staff portal, used by non-technical Directors and enforcement officers per `ARCHITECTURE_DECISIONS.md` §23's own framing) stay light-first for readability and unfamiliarity with dark UI conventions. **Recommendation: don't dark-mode the staff portal** — it's not what this research supports for a non-technical government back-office audience. **Do consider dark-first for the port-3002 ops console** (§4 of the earlier doc) — its audience is exactly the technical/developer persona the research says benefits from it, and it visually reinforces that this is a different, technical surface from the staff app, which is useful given the whole point of the split is separating those audiences.

### 3.5 Audit trail visibility — surface it, don't bury it
Directly relevant to a finding already in this project: `audit_logs.py`'s own code comment says the audit page was **"removed from admin nav as noise."** The research says the opposite is the better long-term call: *"audit trails should be exposed prominently in your UI, not buried... visibility builds trust."* This doesn't mean reverting that call blindly — the earlier removal may have been correct if the flat global table really was noise — but it supports the §2.2 recommendation above: the fix for "the audit log is noise as one global table" is **per-record/per-user Activity tabs** (scoped, relevant, not noisy), not leaving audit data unreachable from the UI entirely. Worth revisiting the nav-removal decision once the scoped tabs exist, since at that point the global table becomes a power-user/compliance view (fine to keep off primary nav) while the *relevant slice* is visible exactly where each role would look for it (on the record/user they're already looking at).

---

## 4. Summary of new action items (additive to `ADMIN_DASHBOARD_AUDIT_AND_RECOMMENDATIONS.md` §7)

| # | Action | Depends on | Priority |
|---|---|---|---|
| 1 | Audit `auth.py` login/logout/failed-login events (closes named `SYSTEM_AUDIT.md` gap) | — | 🟠 Do first — everything else here needs this data |
| 2 | Add lightweight per-login metadata capture (ip/user-agent/timestamp), separate from the JWT/revocation redesign | #1 | 🟠 Pairs with #1 |
| 3 | Per-user "Activity" tab on Users & Roles detail view (login history + their AuditLog rows + revoke-sessions action) | #1, #2 | 🟡 Medium |
| 4 | Cross-account "who's logged in" + anomaly view on the ops console | #1, #2, port-3002 split | 🟡 Medium, pairs with ops console build-out |
| 5 | Group the staff sidebar into collapsible sections | — | 🟡 Medium, small |
| 6 | Reorder dashboard home to lead with one hero status/work-queue per persona, KPI grid secondary | Existing widget kit | 🟡 Medium |
| 7 | Add sparklines to existing `KpiCard` using `TrendChart` | Existing widget kit | 🟢 Small, do alongside #6 |
| 8 | Revisit audit-log nav visibility once scoped Activity tabs (#3) exist | #3 | 🟢 Backlog |

---

## Sources

- [How to Track User Activity: 10 Best 2026 Analytics Tools](https://www.parallelhq.com/blog/how-to-track-user-activity-website)
- [Analyze user activity in Microsoft Entra External ID — Microsoft Learn](https://learn.microsoft.com/en-us/entra/external-id/customers/how-to-user-insights)
- [35 SaaS Dashboard Design Examples, Trends and Patterns (2026)](https://www.925studios.co/blog/saas-dashboard-design-examples-2026)
- [SaaS Dashboard Design: Examples, Patterns & Practical Tips — Eleken](https://www.eleken.co/blog-posts/saas-dashboard-design)
- [SaaS Dashboard UI: Design Principles, Examples, and Best Practices](https://www.saasfactor.co/blogs/saas-dashboard-ui)
- [A curated list of SaaS UI workflow patterns — GitHub Gist](https://gist.github.com/mpaiva-cc/d4ef3a652872cb5a91aa529db98d62dd)

*Cross-references: `ADMIN_DASHBOARD_AUDIT_AND_RECOMMENDATIONS.md`, `OPS_CONSOLE_FEATURE_SPEC.md`, `SYSTEM_AUDIT.md` §2.1 (named the auth-audit gap first), `SESSION_SECURITY_STATUS.md` (why per-session listing isn't a small add-on to what exists).*
