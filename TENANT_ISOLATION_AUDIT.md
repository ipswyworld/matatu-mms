# Tenant Isolation Audit (Task 17)

Structural pass over every `GET` list endpoint across `backend/app/routes/*.py`, checking
whether a `SACCO_OPERATOR`/`CREW` account (or, in one case, any authenticated account at
all) can read data outside their own Sacco/fleet. Continues the pattern from the
`/passengers` fix made earlier in this project (§29 background) — this is the same class
of bug, audited systematically rather than found one at a time.

## Real bugs found and fixed

1. **`GET /api/users` (`users.py`) — unscoped, PII leak across every tenant.** Any account
   with `view_users` (which includes `SACCO_OPERATOR`) got back *every* user in the
   system — every other Sacco's operator and crew accounts, every admin account, emails
   included. Fixed: scoped via `sacco_scope_query(current_user, query, User.sacco_id)`,
   same helper used everywhere else. Staff/admin roles (not `SACCO_OPERATOR`/`CREW`) are
   unaffected — they still see everyone, which is correct for user management.

2. **`GET /api/enforcement/crimes` (`crimes.py`) — no permission check at all.** Used
   `Depends(get_current_user)` instead of a permission dependency, so *any* authenticated
   account — including `PASSENGER` — could read every crime/enforcement record
   county-wide. Fixed: gated on `view_reports` (already the correct role set — staff/
   enforcement unscoped, `SACCO_OPERATOR`/`CREW` now scoped to their own fleet via a
   `Matatu.reg_number` subquery, matching the pattern below since `CrimeRecord` links by
   plain string `reg_number`, not a `Matatu` FK).

3. **`GET /api/reports` (`reports.py`) — `SACCO_OPERATOR` had no access at all, despite
   the frontend already expecting it.** The `/passengers` page (fixed earlier this
   project) client-side-filters `getReports()` results for an operator, but the backend
   endpoint required `view_reports`, which `SACCO_OPERATOR` didn't have — meaning that
   page's complaint list was silently empty for every operator account, not actually
   scoped-and-working. Fixed two things together: granted `SACCO_OPERATOR` the
   `view_reports` permission, and scoped the query itself (`PassengerReport
   .matatu_reg_number` subquery against the operator's own fleet's reg numbers) — granting
   the permission alone would have re-introduced bug #2's shape (unscoped county-wide
   read) for this endpoint.

## Checked and confirmed already correct

`activity.py`, `dashboard.py` (inline `if role == "SACCO_OPERATOR"` scoping, not the
helper, but equivalent), `bookings.py` (list + single-record ownership checks both
correct), `webhooks.py`, `saccos.py`, `fines.py`, `matatus.py` (scoped in earlier work
this project).

## Checked and confirmed unscoped-is-correct (not bugs)

- `routes.py` `GET /api/routes` — routes are global/county-wide entities, not
  Sacco-owned (confirmed design, see `fare_stages.py`'s access-control rationale) —
  every operator legitimately sees every route.
- `enforcement_cases.py` `GET /zones`, `/offence-types` — global reference data.
- `enforcement_cases.py` `GET /cases` — gated on `view_enforcement_cases`, which
  `SACCO_OPERATOR` doesn't hold at all; staff-only, arresting officers see only their own
  filed cases, others see the full queue by design (internal staff visibility, not a
  tenant boundary).
- `audit_logs.py` — gated on `view_audit_logs`, admin-tier only; `SACCO_OPERATOR` can't
  reach it, so no scoping question arises.
- `telemetry.py` `GET /matatus` (live positions) — deliberately public-ish: the
  passenger live map already broadcasts every active vehicle's position to any
  connected client via WebSocket, so this REST fallback matching that same visibility is
  consistent, not a leak.

## Not done in this pass

A single-record `GET /{id}` audit (as opposed to list endpoints) was spot-checked
(`bookings.py`'s `get_booking` confirmed correct) but not exhaustively re-walked for
every route file — the list-endpoint sweep above is the higher-value pass since a list
endpoint leaks an entire table's worth of cross-tenant data per request, where a
single-record endpoint leaks one record per guessed/enumerated ID. A follow-up pass
specifically enumerating every `GET /{id}` endpoint for a missing `enforce_own_sacco` /
`enforce_own_record` call would close that gap with the same rigor.
