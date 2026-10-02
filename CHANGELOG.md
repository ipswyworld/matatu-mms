# Changelog

Notable changes to this system, most recent first. Rendered directly on the
ops console's Changelog page (`matatu-mms-ops/app/(console)/changelog`).

## Unreleased

### Added
- Partner API client management UI in the ops console — issue, list, and
  revoke credentials for third-party integrations, with sandbox/production
  environments, per-client IP allowlisting, and usage-history graphs.
- Developer documentation page for the partner API (`/api-clients/docs`).
- Webhook delivery signing (HMAC-SHA256, `X-Webhook-Signature`) and secret
  rotation — outgoing webhook deliveries were previously unsigned.
- Zones page in the staff app, with map-drawn boundary editing
  (`PolygonBoundaryEditor`, built on `terra-draw`).
- This changelog.
- Deploy/rollback control for the ops console's Infrastructure page — trigger
  a fresh deploy or roll back to a prior one, Critical-tier (reason, typed
  confirmation, re-auth), audited server-side.
- Filterable search over the Overview page's in-memory server-error and
  frontend-crash feeds.
- Synthetic uptime/latency checks: this backend now probes each app's own
  `/api/health` every 5 minutes and charts the result on Overview.
- Dependency/CVE scan status panel, reading CI's existing pip-audit/npm
  audit/Trivy job result via GitHub's Jobs API (no new scan runs from here).
- Manually-entered monthly infrastructure cost dashboard with a trend chart
  (Render's API has no billing endpoint to read this from automatically).
- Service dependency/topology graph, changelog viewer, on-call directory,
  and SMS/messaging health panel in the ops console.
- First real feature-flag consumer: the staff app's Role Matrix panel is now
  gated behind `staff_role_matrix_enabled` (seeded on).
- Config history timeline with one-click revert for rate limits, circuit
  breakers, and feature flags, in the ops console's Config page.
- Scheduled feature-flag enable/disable times, applied by a new per-minute
  ARQ cron.
- Git-diff-styled before/after preview (`ConfigDiff`) for rate-limit changes
  and config-history reverts.
- New Compliance page in the ops console: weekly data-retention review
  (review-only — never deletes), Kenya DPA data-subject-request intake and
  tracking, weekly orphaned-foreign-key data-quality checks, and a
  read-only DB browser embed slot (unconfigured by default).
- Weekly backup-restore verification: a new cron restores the latest backup
  into a dedicated scratch database (never production) and records
  pass/fail, with a manual "run now" trigger.

- Bulk user actions (deactivate/reactivate/revoke sessions) on the staff
  app's Users list — loops the existing per-user actions, one audit entry
  per account.
- Reset-MFA added to the staff app's per-account actions menu.
- Two-person sign-off for promoting an account into the Admin tier: the
  role change is held as a pending request until a *different* Super Admin
  approves it, reviewable from the ops console's Sessions page.
- Dedicated impersonation-session-log view on the ops console's Sessions
  page — a filtered read over already-captured audit events.

- Lightweight support-ticket triage in the staff app (`/support`) — status,
  priority, and assignee, not a full helpdesk system.
- Public, no-login system status page (`/status` in the passenger app) and
  a site-wide maintenance-window banner, backed by a new deliberately
  reduced `GET /api/status/public` endpoint (up/down per dependency only).
- Maintenance-window announcements, separate from actually enabling
  maintenance mode — set from the ops console's Config page, shown on the
  public status page and banner ahead of a planned window.

### Fixed
- Nightly database backups had run since first introduced but had never
  once been restored anywhere — there was no evidence they actually worked.
- MFA enforcement: admin-tier accounts that had never completed enrollment
  could sign into both the staff app and the ops console (the system's most
  privileged surface) with no MFA prompt at all. Both now redirect to
  enrollment until it's complete.
- API client issuance/revocation now genuinely requires re-authentication
  (`reauth_token`), matching the Critical-tier confirmation the console UI
  already displayed for these actions.

### Security
- API client credentials can now be scoped to an IP allowlist.
