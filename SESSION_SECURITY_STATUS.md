# Session Revocation + MFA Status (Task 27)

## Session revocation — done, verified

ARCHITECTURE_DECISIONS.md §19: *"JWTs are currently valid until expiry with no
revocation path... a token denylist in Redis is the usual minimum."*

Implemented as a per-user "revoked before" timestamp in Redis (`app/session_revocation.py`)
rather than a per-token denylist — no `jti` claim existed on these JWTs, and tracking
every issued token is more machinery than "log this account out everywhere" needs. Every
token carries a new `iat` claim (`app/auth.py`); `get_current_user` rejects any token
whose `iat` predates the user's last revocation stamp, regardless of the token's own
`exp`. Fails open on a Redis error (matches every other Redis usage in this codebase) —
an outage degrades revocation, never blocks login.

Two endpoints:
- `POST /api/auth/revoke-sessions` — self-service "log out everywhere," for a user who
  suspects their own account is compromised.
- `POST /api/users/{id}/revoke-sessions` — admin-triggered, for a discovered-compromised
  account; gated the same way admin-tier account edits already are (`manage_admins`
  required to revoke another Admin/Superadmin's sessions).

Verified end-to-end: token valid before revocation, rejected (401) immediately after,
fresh login works normally afterward.

## MFA for privileged roles — not built, genuinely a separate feature

§19: *"ADMIN, SUPERADMIN and enforcement officers can issue fines and alter licences.
Password-only authentication is weak for those roles."*

Not attempted in this pass — TOTP-based MFA is a real, separately-sized feature (secret
generation, QR-code enrollment UI, backup/recovery codes, a second verification step in
the login flow, and a decision on whether it's mandatory or user-opt-in per role), not a
config flag to flip. Attempting a shallow version (e.g. a TOTP check with no backup-code
recovery path) would ship a feature that **locks privileged accounts out permanently** on
a lost authenticator app — worse than not having MFA at all for a small-admin-team
government system where "call IT to reset your MFA" isn't a real support path yet.

**Recommended shape for the real implementation** (not built):
1. `pyotp` for TOTP generation/verification (standard, well-tested Python library).
2. `User.totp_secret` (encrypted at rest, not plaintext) + `User.mfa_enabled`.
3. Enrollment flow: generate secret → show QR code (an `otpauth://` URI rendered as a QR,
   e.g. via `qrcode`) → user confirms with one valid code → generate and display N
   one-time backup codes (hashed at rest, same pattern as password hashing).
4. Login flow: password check succeeds → if `mfa_enabled`, require a second `POST
   /api/auth/verify-mfa` step before issuing the JWT, rather than issuing it immediately.
5. Enforce, don't just offer, for `ADMIN`/`SUPERADMIN` — the doc names them specifically as
   the roles where password-only is the real gap; enforcement-officer MFA is a reasonable
   fast-follow, not necessarily day-one.

This is a real backlog item, sized like Task 21's UX backlog — a ticket to build with the
same rigor as everything else in this pass, not something to fake-complete here.
