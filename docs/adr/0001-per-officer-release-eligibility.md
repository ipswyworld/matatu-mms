# 0001. Case-release eligibility is a per-officer grant, not a role

Date: 2026-09-17
Status: accepted

## Context

The county's instruction was explicit: any officer can be posted as an
arresting officer, but not every officer is trusted to release a case.
The existing model gated both actions purely on account role
(`ARRESTING_OFFICER` files, `RELEASING_OFFICER`/`ENFORCEMENT_COMMANDER`
release) — rigid in exactly the way the county's own allocation sheet
isn't: the sheet assigns trust to a named officer for a posting period,
not to an account type permanently.

## Decision

Filing a case is now open to any `ENFORCEMENT_ROLES` account (`ENFORCEMENT`
gained `file_enforcement_case`). Release eligibility is a new boolean,
`User.can_release_cases`, layered on top of the existing role-based grant
(`RELEASING_OFFICER`/`ENFORCEMENT_COMMANDER` still work as before) —
`has_permission()` checks the flag as an additional OR-condition for
`decide_enforcement_case`, not a replacement for the role check.

## Alternatives considered

- **A new `TRUSTED_ARRESTING_OFFICER` role.** Rejected: multiplies the
  role enum for what is really a single boolean fact about one officer,
  and doesn't compose with someone who is `ARRESTING_OFFICER` most
  months and gets trusted for release only during a specific posting.
- **Scoping trust to a posting/allocation, not the officer account.**
  More accurate to how the sheet actually varies month to month, but a
  real scope increase not asked for; a flat per-officer flag was the
  county's own framing ("not all can be releasing officers" — about the
  officer, not about a specific month).

## Consequences

Easier: an admin/commander grants or revokes release trust with the same
one PATCH endpoint already used for rank/manpower-number edits — no new
endpoint, no role reassignment ceremony. Harder: the release-eligibility
fact now lives in two places conceptually (role OR flag) — any future
reviewer checking "can this officer release a case" must check both, not
just `role`. Left for later: if this flag needs to expire (e.g. trust
granted only for a specific posting period), it currently doesn't — it's
a flat on/off, matching what was actually asked for.
