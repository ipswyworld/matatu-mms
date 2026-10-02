# Docs index

> **Naming:** this system is now called **Mji-Move** (formerly "Matatu Management System" / "Matatu MMS"). The dated audit and decision documents below still use the old name on purpose: they record what the system was called when they were written. Repo folders, package names, Render service names and environment variables also keep the old `matatu-mms` identifiers until a separate infrastructure rename.

The root of this repo has accumulated a lot of standalone `.md` files from
past audit/design sessions. This is the map: what each one is, and whether
it's a living reference (kept current, safe to trust today) or a
point-in-time snapshot (accurate as of when it was written, not maintained
since — useful as history, not as a current source of truth).

Where a doc's own content doesn't say otherwise, "snapshot" status is a
best guess from its title and framing, not a line-by-line freshness check —
treat any snapshot doc's specifics as "true when written" and verify
against the actual code before relying on a detail from one.

## Living references (kept current)

- **[README.md](README.md)** — what the system is, how to run it.
- **[ARCHITECTURE_DECISIONS.md](ARCHITECTURE_DECISIONS.md)** — the decision
  record. Numbered sections (§N) are referenced by nearly every other doc
  here.
- **[RUNBOOKS.md](RUNBOOKS.md)** — dependency fallback matrix + incident
  runbooks (deploy failures, webhook outages, rollback steps).
- **[DEPLOYMENT.md](DEPLOYMENT.md)** — nginx/observability/Postgres,
  self-hosted stack setup.
- **[BACKUP_RECOVERY_POLICY.md](BACKUP_RECOVERY_POLICY.md)** — RPO/RTO,
  retention, DPA compliance decisions.

## Point-in-time audits and status reports (snapshots)

These were each written to answer a specific question at a specific
moment. Later work may have already addressed what they flag — check the
current code, not just the doc, before treating an open item as still
open.

- **[SYSTEM_AUDIT.md](SYSTEM_AUDIT.md)** — full-system audit at national
  scale.
- **[MULTI_STAKEHOLDER_REVIEW.md](MULTI_STAKEHOLDER_REVIEW.md)** — the
  40+-role review this session's Phase 2/Phase 3 work item came from.
- **[TENANT_ISOLATION_AUDIT.md](TENANT_ISOLATION_AUDIT.md)** — structural
  pass over every list endpoint for cross-tenant leakage.
- **[SESSION_SECURITY_STATUS.md](SESSION_SECURITY_STATUS.md)** — session
  revocation + MFA status as of Task 27.
- **[CD_PIPELINE_STATUS.md](CD_PIPELINE_STATUS.md)** — CI/CD pipeline
  status against the ARCHITECTURE_DECISIONS §13/§14.4 target shape.
- **[DATA_LAYER_SCALING_STATUS.md](DATA_LAYER_SCALING_STATUS.md)** —
  TimescaleDB / PgBouncer / read-replica status.
- **[SERVICE_EXTRACTION_READINESS.md](SERVICE_EXTRACTION_READINESS.md)** —
  readiness for splitting out telemetry ingest + the WebSocket gateway.
- **[NTSA_IRMS_INTEGRATION_CHECKLIST.md](NTSA_IRMS_INTEGRATION_CHECKLIST.md)**
  — blocked on external access; not started.
- **[UX_BACKLOG_STATUS.md](UX_BACKLOG_STATUS.md)** — non-technical UX
  backlog status (Task 21).
- **[ADMIN_DASHBOARD_AUDIT_AND_RECOMMENDATIONS.md](ADMIN_DASHBOARD_AUDIT_AND_RECOMMENDATIONS.md)**,
  **[OPS_CONSOLE_FEATURE_SPEC.md](OPS_CONSOLE_FEATURE_SPEC.md)**,
  **[OPS_CONSOLE_AND_USER_ACTIVITY_SPEC.md](OPS_CONSOLE_AND_USER_ACTIVITY_SPEC.md)**,
  **[USER_ACTIVITY_AND_DASHBOARD_UX_RESEARCH.md](USER_ACTIVITY_AND_DASHBOARD_UX_RESEARCH.md)**
  — one connected thread of follow-ups designing the ops/superuser console
  (matatu-mms-ops) and its user-activity feature; read in that order.
