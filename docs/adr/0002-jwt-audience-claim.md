# 0002. Every JWT carries an `aud` claim scoped to this API

Date: 2026-09-17
Status: accepted

## Context

MULTI_STAKEHOLDER_REVIEW.md's Phase 2 security checklist flagged the
absence of a token scope/audience claim: every token this system mints
(human session tokens, and machine `ApiClient` client-credentials tokens)
is signed with the same `SECRET_KEY` and carried no claim distinguishing
which service it's meant for. Not exploitable today — there is only one
API — but `SERVICE_EXTRACTION_READINESS.md` already plans splitting the
telemetry ingest and WebSocket gateway into separate processes, and any
of them sharing this signing key without an audience claim would let a
token minted for one silently work against another.

## Decision

`create_access_token()` (human tokens, `app/auth.py`) and `mint_token()`
(machine tokens, `app/api_clients.py`) both stamp `"aud": "matatu-mms-api"`.
Every `pyjwt.decode()` call site across the codebase (7 of them, spanning
`app/auth.py`, `app/principals.py`, and three WebSocket-auth call sites in
`app/routes/`) now passes `audience=JWT_AUDIENCE` — PyJWT rejects a token
carrying an `aud` claim if the decoder doesn't specify one to check
against, so this had to land as one atomic change across every decode
site, not incrementally.

## Alternatives considered

- **Do nothing until a second service actually exists.** Rejected: at
  that point every already-issued token in circulation is missing the
  claim a new service would need to check, forcing a dual-accept
  migration window instead of the audience simply already being there.
- **A per-service signing key instead of a shared key + audience claim.**
  More isolation, but a much larger change (key distribution/rotation
  across services) for a problem an audience claim already solves at
  today's single-service scale.

## Consequences

Easier: a future extracted service can mint its own `aud` and this API's
decoder will correctly refuse to accept it, with zero additional work at
extraction time. Harder: every currently-active session was invalidated
the moment this deployed (tokens minted before this change have no `aud`,
and PyJWT requires one once any consumer trusts the previous absence) —
acceptable for a token with a short natural expiry, but worth remembering
if this pattern is ever repeated on a system with long-lived tokens.
