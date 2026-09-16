# RPO/RTO, Data Retention, and DPA Compliance Decisions (Task 28)

Explicit decisions per ARCHITECTURE_DECISIONS.md §10 and §21.3's "no documented RPO/RTO"
gap — "decide these explicitly rather than inheriting whatever the database happens to
keep."

## RPO / RTO

**Recovery Point Objective: 24 hours — now a real, automated number, not an aspiration
(updated 2026-09-16).** `app/backup.py` + `app/worker.py`'s ARQ `cron_jobs` run a full
row-data dump every night at 03:00 UTC, uploaded as a gzipped JSON asset on a GitHub
Release (see that module's docstring for why GitHub rather than the still-unconfigured S3
path — no object-storage account with billing exists yet, and GitHub is infrastructure
this project already trusts). Old backups beyond `BACKUP_RETENTION_DAYS` (default 30) are
pruned automatically on each run. Render's free-tier Postgres still has no *built-in*
point-in-time recovery (that remains a paid-plan feature — see
`DATA_LAYER_SCALING_STATUS.md`), but this system is no longer relying on that: the backup
now exists independent of the Postgres plan tier.

**This closes the previous "no automated backup at all" gap** — the RPO is now genuinely
bounded by the nightly schedule, not by whenever someone last happened to run a manual
export. Requires `GITHUB_BACKUP_TOKEN` (a PAT with `contents:write` on the target repo)
and `GITHUB_BACKUP_REPO` to actually be set — until they are, `run_scheduled_backup` logs
a loud warning and skips every night rather than silently doing nothing. **Confirm these
two env vars are actually set on the live Render backend service** — writing the
automation is not the same claim as it running in production.

**Recovery Time Objective: still not yet meaningful to set**, since no restore from one of
these backups has been tested end-to-end yet (§20.3's own framing: "an untested backup is
a hypothesis" — that's just as true of an automated backup as a manual one).

**Required before production launch (not done in this pass — tracked honestly rather than
faked):**
1. **Test an actual restore** from a real nightly backup asset onto a scratch database and
   verify the app boots against it, using `db-backups/restore_db.py`'s approach (same JSON
   row-data shape) as the starting point. This is the step most backup setups skip, and
   it's the one that actually earns the RTO number below.
2. Set a real RTO once step 1 has been timed for real, not estimated.
3. Revisit whether GitHub Releases remain the right storage target once backup size or
   restore frequency grows past what makes sense for this stopgap — a paid object-storage
   account (S3/R2/B2, `app/storage.py` is already wired for it) is the natural next step,
   deliberately deferred rather than adding a second paid account before a first one was
   needed for anything else.

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
