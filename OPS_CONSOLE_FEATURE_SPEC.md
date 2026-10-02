# Ops / Superuser Console — Full Feature Spec

**Context:** Follow-up to `ADMIN_DASHBOARD_AUDIT_AND_RECOMMENDATIONS.md` §4 (the port-3002 monitoring/superuser split). The other session sketched a control-plane + observability feature list for that console. This answers: **is that list enough**, and **should it have full CRUD (view/add/edit/delete)**.

**Short answer: no, that list is the *observability half* of a good ops console — it's missing the *self-service/catalog* half that internal-platform tooling (Backstage-style "internal developer platforms") treats as equally core. And yes, it should have CRUD — but CRUD on infrastructure/config, not raw CRUD on business data, and every destructive action needs guardrails this system doesn't have anywhere else today.** Details below, with what's new from research marked distinctly from what extends the earlier list.

---

## 1. Verdict on the pasted list

The six categories (Deploys & infra, Observability, External integrations, Security & access, Compliance/housekeeping) are a solid **read-mostly control-plane** — status, config visibility, audit viewing. That's the right foundation and matches this project's own existing patterns (`/system` already does DB/Redis health + secret-configured flags in this style).

What it under-specifies: **how much *write* access this console has, and under what guardrails.** "Rotate secrets," "trigger deploys/rollbacks," "trigger backups/restore," "toggle feature flags" are all listed as actions — each of those *is* a destructive/high-blast-radius CRUD operation, but none of them come with the confirmation/audit/permission model a console with that power needs. That gap is the main thing to close before scoping a build.

---

## 2. Yes — give it real CRUD, but scope it to three tiers, not one flat "admin can do anything"

Research on admin-panel and internal-platform design (Refine, Backstage docs, destructive-action UX guides — sources below) converges on the same shape: separate **what kind of thing is being CRUD'd**, because the guardrails needed are completely different per tier.

### Tier 1 — Infrastructure & config CRUD (safe to build first)
Feature flags, IP allowlists, Alertmanager routing rules, environment variable values (redacted-view + rotate, not raw display), scheduled-job definitions. These are **operational config, not customer/statutory data** — mistakes here are recoverable by redeploying or re-toggling. Build full CRUD here without much ceremony beyond RBAC + audit logging (which this project already has a pattern for via `audit.py`).

### Tier 2 — Reference/business data CRUD (needs real guardrails)
Zones, offence types, route corridors, fare-policy overrides, Sacco/operator records — the entities Tier-1 admin screens usually creep into touching "just this once." This is where a **generic admin-panel CRUD generator would be actively dangerous** for this system, because every one of these tables already has bespoke business rules elsewhere (ABAC scoping, `stage_audit_log`, the two-stage operator-verification workflow documented in `ARCHITECTURE_DECISIONS.md` §1.2). A raw "edit any row" screen would let a Super Admin bypass those rules by going around the API's own route handlers straight to the DB. **Recommendation: this console must call the same backend API endpoints the staff app already uses (`enforce_own_sacco`, `stage_audit_log`, the verification-stage state machine), never a direct DB write path** — it's a different *frontend* onto the same governed backend, not a backdoor.

### Tier 3 — Statutory/financial records: view + soft-action only, **no hard delete, ever**
Fines, payments, audit logs, enforcement cases. `BACKUP_RECOVERY_POLICY.md` already sets **7-year retention** on exactly these tables for statutory reasons. A superuser console that adds a "Delete" button on a fine record directly contradicts a decision already made elsewhere in this project. What this tier legitimately needs instead:
- **Dispute/waive/void as a recorded state transition** (already exists in the enforcement-case workflow — reuse it, don't add a second delete path).
- **Restore from soft-delete** for accidental deactivations (users), not permanent purge.
- A visible, load-bearing rule in the console's own UI: *"Statutory records cannot be deleted from this console — see retention policy."* Make the constraint visible, not just enforced silently, so nobody spends an hour looking for a delete button that was deliberately never built.

**This tiering is the single most important addition to the original list** — without it, "add the ability to view/add/delete everything" reads as one flat permission, and for Tier 3 that's a compliance violation waiting to happen.

---

## 3. What's missing from the original list — new from research

### 3.1 Service/software catalog (Backstage's core idea, right-sized for 3 services)
Even at your current scale (backend, staff frontend, public frontend, soon an ops app), a **one-screen catalog** — each service's owner, repo link, current deployed SHA, dependency edges (frontend → backend → Postgres/Redis) — is worth having before you scale to more services. You already have this data implicitly in `graphify-out/` (the knowledge graph literally maps these dependencies) and in `render.yaml`. Cheap win: **render this console's landing page from the existing graphify manifest + Render API**, rather than hand-maintaining a service list that drifts.

### 3.2 Self-service "golden path" actions, not raw forms
Backstage's actual differentiator over a generic admin panel isn't CRUD — it's **guided templates for common multi-step operations**: "provision a new service," "onboard a new environment." Your equivalent, given this system's domain: a guided flow for "add a new Sacco/operator" or "define a new enforcement zone with geometry" that walks through the same steps the real onboarding wizard enforces (`OperatorOnboardingWizard.tsx`), rather than a flat form that could skip the document-completeness gate. This reuses Tier 2's principle (call the real workflow, don't bypass it) but frames it as UX: **wizards for anything with a multi-step business process, plain CRUD only for genuinely flat config.**

### 3.3 A real database browser — but read-only, and point at the read replica
You're going to want to run ad-hoc queries eventually ("how many fines were disputed last week by zone"). Don't build a query box that writes to production. Two options, in order of preference:
- Point a proper tool (Metabase — already recommended in `ARCHITECTURE_DECISIONS.md` §23.6 for analytics) at the **read replica** once it's provisioned, and iframe/link it from the ops console rather than reimplementing a SQL editor.
- If a raw query box is genuinely needed sooner, make it **read-only at the DB-role level** (a Postgres role with `SELECT` only), not just "the UI doesn't show a save button" — the guardrail must be enforced where a bug can't bypass it.

### 3.4 "Login as" / impersonation, for support — with mandatory audit
Not in the original list at all, and it's one of the highest-value ops-console features for a system with non-technical end users: a Super Admin needs to see exactly what a confused Sacco Operator or Enforcement Officer sees, to debug "why can't I approve this." Standard pattern: a scoped, time-limited impersonation token, **every impersonated session start/end written to the audit log** (reuse `audit.py`), and a persistent banner in the impersonated view so it's never ambiguous whose session is active. This is a real feature request waiting to happen the first time support has to say "can you screen-share so I can see what you're seeing."

### 3.5 Background job / queue control, made actionable (not just visible)
The original list has "queue monitor" under observability. Make it Tier-1 CRUD: **retry a failed ARQ job, dead-letter a stuck one, pause a queue** — not just a dashboard of numbers nobody can act on. This is exactly the kind of console-native action that's low-risk (jobs are already designed to be retryable/idempotent per `ARCHITECTURE_DECISIONS.md` §17.2) and high-value.

### 3.6 Config/rollback history for feature flags and Tier-1 settings
Whatever feature-flag system you pick, make sure **every toggle is versioned with who/when/previous-value**, and there's a one-click revert — the same discipline your git history already gives code changes shouldn't stop at config that lives only in a database row.

---

## 4. Guardrails to build in from day one (the part the original list didn't cover at all)

Sourced from destructive-action UX research (Smashing Magazine, GitLab's own postmortems on this exact problem) plus this project's own existing patterns:

1. **Typed confirmation for irreversible Tier-1/2 actions** — "type the service name to confirm rollback," not a plain OK/Cancel modal. Reserve this friction for genuinely irreversible actions (secret rotation that invalidates all sessions, a DB restore); don't apply it to routine toggles or it trains admins to click through without reading.
2. **Visually distinct destructive controls** — red, separated from primary actions, labeled with the specific action ("Restore Database," not "Confirm") — this project's existing `DeactivateUserButton` pattern already gets this half-right; extend the convention rather than inventing a new one for the ops console.
3. **Every write in this console is `stage_audit_log`'d** — reuse the exact pattern already proven in the main app (`ARCHITECTURE_DECISIONS.md`'s audit-log praise), including before/after values. A superuser console with *weaker* audit coverage than the staff app it's overseeing would be a real regression.
4. **RBAC within the console itself, not just "SUPERADMIN gets in."** Once this console has Tier-1 write actions, "who can rotate a secret" and "who can view a redacted env var" are different permissions worth separating — don't flatten every SUPERADMIN into having every capability by default, especially once more than 1-2 people hold that role.
5. **No direct DB write path from the console** (restated from §2's Tier 2) — every write goes through the existing backend's governed endpoints or a narrowly-scoped new one that itself calls the same service-layer functions, never raw SQL from the UI layer.

---

## 5. Revised build order (supersedes the "pick 2-3" suggestion in the pasted list)

The pasted list's own instinct — "pick 2-3 based on what's caused pain" — is right, but sequence it through the tiering above so early wins don't paint you into a corner:

1. **Service health matrix + deploy/GitHub view** (Tier 1, read-heavy, matches the original list's own guess about what's already causing manual-CLI pain). Ship alongside the port-3002 split from the earlier audit doc — same piece of work.
2. **Audit log viewer** (read-only, Tier 3 data but read-only so no new guardrail work needed) — also already flagged in the earlier audit doc as underused (`/audit-logs` "buried" in the staff app).
3. **Feature flags + IP allowlist + Alertmanager routing** (Tier 1 CRUD) — this is where you actually build the guardrail pattern from §4 once, then reuse it for everything after.
4. **Background job/queue control** (Tier 1 actionable) — cheap once #3's guardrail pattern exists.
5. **Impersonation** (§3.4) — high value, but do it after the audit-log pattern (#2) is solid, since impersonation is worthless without airtight audit coverage of it.
6. **Golden-path wizards for Tier 2 entities** (§3.2) — largest effort, do last, and only for the specific multi-step flows that are actually painful today (new-Sacco onboarding is the obvious first candidate since it already has a wizard to reuse).

Explicitly **not** in scope by default: raw CRUD on fines/payments/audit logs/enforcement cases (Tier 3 — view + governed state-transition only, per §2).

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

*Cross-references: `ADMIN_DASHBOARD_AUDIT_AND_RECOMMENDATIONS.md` §4 (port-3002 split this console builds on), `BACKUP_RECOVERY_POLICY.md` (retention rules behind the Tier 3 no-delete rule), `ARCHITECTURE_DECISIONS.md` §17.2/§23.6 (idempotent jobs, Metabase recommendation).*
