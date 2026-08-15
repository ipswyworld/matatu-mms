# RPO/RTO, Data Retention, and DPA Compliance Decisions (Task 28)

Explicit decisions per ARCHITECTURE_DECISIONS.md §10 and §21.3's "no documented RPO/RTO"
gap — "decide these explicitly rather than inheriting whatever the database happens to
keep."

## RPO / RTO

**Recovery Point Objective (acceptable data loss window): 24 hours for the current
investor-demo deployment tier.** Render's free-tier Postgres does not include automated
point-in-time recovery or scheduled backups (that's a paid-plan feature, same category as
PgBouncer/read-replica — see `DATA_LAYER_SCALING_STATUS.md`). Until the plan is upgraded,
this system has **no automated backup at all** — RPO is whatever the last manual export
happened to be, which is not an acceptable posture for statutory financial records (fines,
payments) beyond the demo stage.

**Recovery Time Objective: not yet meaningful to set**, since there's no restore
procedure to time. Setting an RTO number before a restore has been tested even once would
be a guess dressed as a commitment (§20.3's own framing: "an untested backup is a
hypothesis").

**Required before production launch (not done in this pass — infra-blocked, tracked
honestly rather than faked):**
1. Upgrade the Render Postgres plan to one with automated backups + point-in-time
   recovery, or provision an external backup mechanism (`pg_dump` on a schedule to
   object storage, at minimum).
2. Pick real RPO/RTO numbers once a plan is chosen — Render's paid tiers document their
   own PITR window, which becomes the RPO ceiling.
3. **Test an actual restore** onto a scratch database and verify the app boots against
   it before trusting the number. This is the step most backup setups skip.

## Data retention policy (DPA 2019)

Kenya's Data Protection Act 2019 applies — continuous GPS traces of named drivers plus
passenger pickup data are personal data, and this system sits in DPIA territory per §10.

| Data category | Table(s) | Retention decision | Enforcement mechanism |
|---|---|---|---|
| **Live GPS history** | `vehicle_positions` | **90 days.** Long enough for a month-over-month demand/coverage trend and an incident investigation window; short enough that a driver's full movement history isn't kept indefinitely by default. | TimescaleDB retention policy once the extension is confirmed available (it is — see Task 11's deploy log) — `add_retention_policy('vehicle_positions', INTERVAL '90 days')`. **Not yet added as a migration** — this is the policy decision; wiring the actual retention policy call is a one-line follow-up now that the number is decided. |
| **Demand signals** (O-D searches/bookings) | `demand_signals` | **1 year.** This is aggregated planning data (§27.3's whole point is reproducing the BRN survey continuously), not a live trace of an individual — the retention pressure is lower, and a year of history is what makes the OD-matrix/heatmap actually useful for seasonal planning. | No automated enforcement yet — a scheduled cleanup job (via the ARQ worker, Task 13) is the natural mechanism once needed; not urgent at current data volume. |
| **Audit logs** | `audit_logs` | **7 years.** This is the statutory-record category (§10's "purpose limitation" concern doesn't apply the same way — audit trail retention is itself often a legal requirement for government financial systems). No automatic deletion. | Manual/none — matches "records of statutory record" framing already used elsewhere in this doc for why audit data isn't touched by other cleanup. |
| **Fines, bookings, payment records** | `fines`, `bookings` | **7 years**, same statutory-record reasoning as audit logs — these are financial records, not operational telemetry. | None automated; explicit policy so a future cleanup job doesn't accidentally sweep these up alongside `vehicle_positions`. |
| **Crew assignment / crew account data** | `crew_assignments`, `User` (CREW role) | **Retained for the duration of the account plus 1 year after deactivation** (no hard account-deletion flow exists yet — see §19's "account lifecycle" gap, not built in this pass). | None automated. |

**Purpose limitation (§10):** location data collected for live tracking / route-adherence
monitoring must not be repurposed beyond that and the demand-intelligence aggregation it
directly enables. Concretely: `vehicle_positions` rows are never joined to identify an
individual driver's off-duty movements, and the demand-intelligence endpoints
(`app/routes/demand.py`) only ever return aggregated counts, never a raw trip trace.

**Access controls on trace history (§10):** `GET /api/telemetry/matatus` (live positions)
already requires authentication; historical `vehicle_positions` queries aren't exposed via
any API yet (Task 11 added the table, not a query endpoint) — so today, access is
implicitly restricted to direct database access, which is itself audited at the
infrastructure level (Render's own access logs), not at the application level. **A real
gap once a "driver movement history" query endpoint is built**: that endpoint must itself
be `stage_audit_log`'d (who looked up which driver's history, when) — noted here so it's
not forgotten when that endpoint gets built, not deferred silently.

## What's genuinely decided vs. what's still open

**Decided:** the retention periods above, and that purpose limitation already holds
structurally (aggregation-only demand endpoints).

**Still open, honestly:** the RPO/RTO numbers depend on a Render plan upgrade decision
that hasn't been made (a cost/business decision, not an engineering one); the TimescaleDB
retention policy itself hasn't been added as a migration yet (the number is decided, the
one-line `add_retention_policy` call implementing it is real follow-up work); and a full
DPIA (Data Protection Impact Assessment) document — the formal artifact Kenya's DPA 2019
would expect for a system in this category — has not been written. This file records the
underlying decisions a DPIA would need; it is not itself that document.
