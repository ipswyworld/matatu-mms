# Ops Console, CRUD Guardrails & User Activity — Combined Spec

**Context:** Combines two follow-ups to `ADMIN_DASHBOARD_AUDIT_AND_RECOMMENDATIONS.md` §4 (the port-3002 Super Admin/monitoring split): (1) the full feature scope for that ops console, including how far its CRUD/delete powers should go, and (2) a "user activity" feature for both the staff portal and the ops console, plus admin-dashboard UX research to inform the staff portal redesign. One doc going forward instead of two separate ones.

Confirmed before writing this: the widget kit (`StatusBreakdown`, `TrendChart`, `WorkQueueList`) is already wired into `app/(app)/dashboard/page.tsx` — this doc slots into that in-progress work, it doesn't restart it.

---

## Part A — Ops Console: full feature set, and how far CRUD should go

### A.1 Verdict on the original feature list

The originally sketched list (Deploys & infra, Observability, External integrations, Security & access, Compliance/housekeeping) is a solid **read-mostly control-plane** — status, config visibility, audit viewing. That's the right foundation and matches this project's existing `/system` page style.

What it under-specified: **how much *write* access this console has, and under what guardrails.** "Rotate secrets," "trigger deploys/rollbacks," "trigger backups/restore," "toggle feature flags" are each a destructive/high-blast-radius CRUD operation — none of them came with a confirmation/audit/permission model. Closing that gap is the main addition here.

### A.2 Give it real CRUD — but in three tiers, not one flat "admin can do anything"

Research on admin-panel and internal-platform design (Refine, Backstage, destructive-action UX guides — sources at the end) converges on separating **what kind of thing is being CRUD'd**, because the guardrails needed differ completely per tier.

**Tier 1 — Infrastructure & config CRUD (safe to build first).** Feature flags, IP allowlists, Alertmanager routing rules, redacted env-var values + rotation, scheduled-job definitions. Operational config, not customer/statutory data — mistakes are recoverable by redeploying/re-toggling. Full CRUD here with RBAC + audit logging (reuse the existing `audit.py` pattern).

**Tier 2 — Reference/business data CRUD (needs real guardrails).** Zones, offence types, route corridors, fare-policy overrides, Sacco/operator records. **A generic "edit any row" screen here would be actively dangerous** — every one of these tables already has bespoke business rules elsewhere (ABAC scoping, `stage_audit_log`, the two-stage operator-verification workflow). **This console must call the same backend API endpoints the staff app already uses, never a direct DB write path** — a different frontend onto the same governed backend, not a backdoor.

**Tier 3 — Statutory/financial records: view + soft-action only, no hard delete, ever.** Fines, payments, audit logs, enforcement cases. `BACKUP_RECOVERY_POLICY.md` already sets **7-year retention** on exactly these tables. What this tier legitimately needs: dispute/waive/void as a recorded state transition (reuse the existing enforcement-case workflow, don't add a second delete path), and restore-from-deactivation for users — never permanent purge. Make the constraint **visible in the UI** ("Statutory records cannot be deleted from this console — see retention policy"), not just silently enforced.

This tiering is the single most important addition to the original ask — "view/add/delete everything" as one flat permission would let Tier 3 deletion happen, which directly contradicts a decision already made elsewhere in this project.

### A.3 What's missing from the original list

- **Service/software catalog.** One screen — each service's owner, repo link, deployed SHA, dependency edges. Cheap win: derive it from the existing `graphify-out/` manifest + the Render API rather than hand-maintaining a list that drifts.
- **Self-service "golden path" wizards, not raw forms**, for multi-step business processes — e.g. "add a new Sacco/operator" should walk the same steps `OperatorOnboardingWizard.tsx` already enforces, not a flat form that could skip the document-completeness gate. Same principle as Tier 2 (call the real workflow), framed as UX.
- **A real database browser — read-only, pointed at the read replica** (or Metabase, already recommended in `ARCHITECTURE_DECISIONS.md` §23.6). If a raw query box is needed sooner, enforce read-only at the **DB-role level** (`SELECT`-only Postgres role), not just by hiding a save button.
- **"Login as" / impersonation for support**, with every impersonated session start/end written to the audit log and a persistent banner in the impersonated view. High value for a system with non-technical end users — support will need this the first time someone has to say "can you screen-share so I can see what you're seeing."
- **Background job/queue control made actionable, not just visible** — retry a failed ARQ job, dead-letter a stuck one, pause a queue. Low-risk (jobs are already designed idempotent/retryable per `ARCHITECTURE_DECISIONS.md` §17.2), high-value.
- **Versioned, revertible config** — every Tier-1 toggle recorded with who/when/previous-value, one-click revert.

### A.4 Guardrails to build in from day one

1. **Typed confirmation** for genuinely irreversible actions (secret rotation invalidating all sessions, a DB restore) — reserve this friction for those, don't apply it to routine toggles.
2. **Visually distinct destructive controls** — red, separated from primary actions, labeled with the specific action ("Restore Database," not "Confirm") — extend the existing `DeactivateUserButton` convention rather than inventing a new one.
3. **Every write in this console is `stage_audit_log`'d** — a superuser console with weaker audit coverage than the app it oversees would be a real regression.
4. **RBAC within the console itself**, not just "SUPERADMIN gets in" — separate "who can rotate a secret" from "who can view a redacted env var" once more than 1-2 people hold that role.
5. **No direct DB write path from the console** (restated from Tier 2) — every write goes through governed backend endpoints, never raw SQL from the UI layer.

### A.5 Build order

1. **Service health matrix + deploy/GitHub view** (Tier 1, read-heavy) — ship alongside the port-3002 split itself.
2. **Audit log viewer** (read-only) — also flagged in the earlier audit doc as currently "buried."
3. **Feature flags + IP allowlist + Alertmanager routing** (Tier 1 CRUD) — build the guardrail pattern from A.4 once here, reuse it after.
4. **Background job/queue control** — cheap once #3's pattern exists.
5. **Impersonation** — do after the audit-log pattern (#2) is solid; it's worthless without airtight audit coverage of itself.
6. **Golden-path wizards for Tier 2 entities** — largest effort, last. New-Sacco onboarding is the obvious first candidate since it already has a wizard to reuse.

Explicitly **not** in scope by default: raw CRUD on fines/payments/audit logs/enforcement cases (Tier 3 — view + governed state-transition only).

---

## Part B — User activity: what exists, what's missing, and where it should live

### B.1 "User activity" is really three things — and one doesn't exist yet

| Table / feature | What it actually tracks | Where it lives today |
|---|---|---|
| `ActivityLog` | Fleet operational events (crew incident report, stop, scene log) tied to a `matatu_id` — not really about the *user* | `backend/app/routes/activity.py`, `components/dashboard/ActivityFeed.tsx` |
| `AuditLog` | Data-change trail — who changed what field on what resource, before/after | `backend/app/routes/audit_logs.py`, `components/AuditLogTable.tsx` — flat global table only, **not filterable by user in the UI** even though `user_id` is a column |
| **True user activity** (logins, sessions, "what has this person been doing") | **Doesn't exist.** `SYSTEM_AUDIT.md` §2.1 already flagged this: *"auth.py writes no audit records... auth events especially must be audited."* Session revocation exists as a per-user "revoked-before" Redis timestamp (`SESSION_SECURITY_STATUS.md`), not a queryable session list — deliberately, since there's no per-token `jti` tracking. **There is currently no way to answer "when did this admin last sign in" or "show every active session for this account"** without new data capture, not just a new UI. | — |

**"Add a user activity feature" is two separate pieces of work**: a UI (mostly buildable now from existing data) and a data-capture gap (auth events aren't recorded at all yet — the actual dependency; don't let UI work quietly become the whole deliverable while this stays unbuilt).

### B.2 Recommended shape: build once, expose twice

**Backend prerequisite, do first (small):**
- Add `stage_audit_log` calls to `auth.py`'s login/logout/register/failed-login paths — closes the named gap using the same mechanism already used everywhere else.
- Capture minimal per-login metadata (`user_id`, `login_at`, `ip`, `user_agent`) as an append-only log row, **separate from** the JWT/revocation redesign — this does not require rebuilding session revocation to a per-token `jti` scheme (keep that a distinct, separately-sized item).

**Staff-portal surface** — a per-user "Activity" tab on the Users & Roles detail view: login history (once captured) + their `AuditLog` rows filtered by `user_id` (data already exists, just needs a `user_id`-scoped query) + the "Revoke all sessions" action placed next to the identity it affects, instead of only reachable as a standalone endpoint. This is the strongest pattern in the SaaS-dashboard research: an Activity tab on any detail page for the thing that has history, not one global flat log everyone filters. Extend the same pattern later to Sacco/operator and Matatu detail pages — `AuditLog.resource_type`/`resource_id` already supports it.

**Ops-console surface** — a cross-account "who's logged in right now" view scoped to SUPERADMIN/ADMIN accounts specifically (ties into the MFA-enrollment tracking already on the ops console's feature list), plus anomaly surfacing (new-IP login on a privileged account, failed-login bursts — pairs with the rate-limit dashboard already scoped for that console). Start Tier-1 read-only; don't build automated lockout on top of it yet. If impersonation (A.3) gets built, its audit trail belongs here too.

**What not to build:** a generic feed mixing fleet `ActivityLog` incidents with login events with `AuditLog` changes into one undifferentiated stream. Keep the three data sources separate in the model (they already are); compose them in the UI only where it's genuinely one audience's one question (per-user tab = login history + their audit rows, correctly two sources, one screen).

---

## Part C — Admin dashboard UX research, applied to the staff portal

- **Sidebar nav** — keep it (matches the Linear/Vercel/Stripe convention of scaling without restructuring), but **group the long admin sidebar into collapsible sections** (Fleet / Enforcement / Revenue / Administration) — `SYSTEM_AUDIT.md` §6 already flagged the length.
- **Progressive disclosure** — lead dashboard home with **one hero status/work-queue per persona** before the KPI grid, not KPI cards first. The `WorkQueueList` widget already exists for this; use it as the lead element, not a supporting one.
- **KPI cards: number + trend + sparkline**, not just a number (Stripe's card pattern). Pair the existing `KpiCard.tsx` with `TrendChart` for an inline sparkline — small addition on top of already-started work. `UX_BACKLOG_STATUS.md` already independently arrived at "narrative insight + trend arrow" for `FinesTrendChart`; extend that same treatment to KPI cards.
- **Dark mode — for the ops console, not the staff portal.** Developer/monitoring tools (Sentry, Supabase, Raycast-style) trend dark-first; non-technical operational staff tools stay light-first for readability. Recommend dark-first for port-3002 (technical audience, and visually reinforces it's a separate surface); keep the staff portal light-first.
- **Audit trail visibility** — `audit_logs.py`'s own code comment says the page was *"removed from admin nav as noise."* Research says the opposite works better long-term (*"audit trails should be exposed prominently... visibility builds trust"*) — but the fix is **scoped per-record/per-user Activity tabs** (Part B), not restoring the old flat global table to nav. Revisit that removal once the tabs exist: the global table becomes a fine power-user/compliance view off primary nav, while the *relevant slice* is visible exactly where each role would already be looking.

---

## Combined action list (additive to `ADMIN_DASHBOARD_AUDIT_AND_RECOMMENDATIONS.md` §7)

| # | Action | Depends on | Priority |
|---|---|---|---|
| 1 | Audit `auth.py` login/logout/failed-login events | — | 🟠 Start here — blocks most of Part B |
| 2 | Lightweight per-login metadata capture (ip/user-agent/timestamp) | #1 | 🟠 Pairs with #1 |
| 3 | Service health matrix + deploy/GitHub view on ops console | Port-3002 split | 🟠 Ship alongside the split itself |
| 4 | Audit log viewer (read-only) on ops console | — | 🟡 Medium |
| 5 | Per-user Activity tab on Users & Roles detail view | #1, #2 | 🟡 Medium |
| 6 | Tier-1 CRUD (feature flags, IP allowlist, Alertmanager routing) + guardrail pattern | #3 | 🟡 Medium — build the pattern once here |
| 7 | Group staff sidebar into collapsible sections | — | 🟡 Medium, small |
| 8 | Reorder dashboard home: hero status/work-queue first, KPI grid secondary | Existing widget kit | 🟡 Medium |
| 9 | Sparklines on existing KpiCard via TrendChart | Existing widget kit | 🟢 Small |
| 10 | Background job/queue control (retry/dead-letter/pause) | #6 | 🟢 Cheap once #6 lands |
| 11 | Cross-account "who's logged in" + anomaly view on ops console | #1, #2, port-3002 | 🟡 Medium |
| 12 | Impersonation ("login as") with mandatory audit | #4 solid | 🟢 After audit pattern is proven |
| 13 | Golden-path wizards for Tier 2 entities (new-Sacco onboarding first) | — | 🟢 Backlog, largest effort |
| 14 | Revisit audit-log nav visibility once #5 exists | #5 | 🟢 Backlog |

---

## Sources

- [What is an Admin Panel? The Complete Guide for 2026 — Refine](https://refine.dev/blog/what-is-an-admin-panel/)
- [Best Admin Panel Tools in 2026 — Flatlogic](https://flatlogic.com/blog/best-admin-panel-tools/)
- [Spotify's Backstage.io — Internal Developer Platform](https://internaldeveloperplatform.org/developer-portals/backstage/)
- [Architecting an IDP with Backstage and Kubernetes — Medium](https://medium.com/@naeemulhaq/architecting-an-internal-developer-platform-idp-with-backstage-and-kubernetes-9ec6311d866d)
- [Delete Button UI: Best Practices for Designing Destructive Actions](https://www.designmonks.co/blog/delete-button-ui)
- [How To Manage Dangerous Actions In User Interfaces — Smashing Magazine](https://www.smashingmagazine.com/2024/09/how-manage-dangerous-actions-user-interfaces/)
- [Project delete confirmation is insufficiently scary — GitLab issue](https://gitlab.com/gitlab-org/gitlab/-/issues/220243)
- [Soft Delete in EF Core – A Comprehensive Guide](https://wearecommunity.io/communities/AsdltxPyEV/articles/6515)
- [How to Track User Activity: 10 Best 2026 Analytics Tools](https://www.parallelhq.com/blog/how-to-track-user-activity-website)
- [Analyze user activity in Microsoft Entra External ID — Microsoft Learn](https://learn.microsoft.com/en-us/entra/external-id/customers/how-to-user-insights)
- [35 SaaS Dashboard Design Examples, Trends and Patterns (2026)](https://www.925studios.co/blog/saas-dashboard-design-examples-2026)
- [SaaS Dashboard Design: Examples, Patterns & Practical Tips — Eleken](https://www.eleken.co/blog-posts/saas-dashboard-design)
- [SaaS Dashboard UI: Design Principles, Examples, and Best Practices](https://www.saasfactor.co/blogs/saas-dashboard-ui)
- [A curated list of SaaS UI workflow patterns — GitHub Gist](https://gist.github.com/mpaiva-cc/d4ef3a652872cb5a91aa529db98d62dd)

*Cross-references: `ADMIN_DASHBOARD_AUDIT_AND_RECOMMENDATIONS.md` (port-3002 split this builds on), `BACKUP_RECOVERY_POLICY.md` (retention rules behind the Tier 3 no-delete rule), `SYSTEM_AUDIT.md` §2.1 (named the auth-audit gap first), `SESSION_SECURITY_STATUS.md` (why per-session listing isn't a small add-on), `ARCHITECTURE_DECISIONS.md` §17.2/§23.6 (idempotent jobs, Metabase recommendation).*

*This file supersedes `OPS_CONSOLE_FEATURE_SPEC.md` and `USER_ACTIVITY_AND_DASHBOARD_UX_RESEARCH.md` as the single reference going forward — those two remain on disk for history but this is the one to work from.*
