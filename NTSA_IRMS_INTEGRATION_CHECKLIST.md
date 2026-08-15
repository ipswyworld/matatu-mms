# NTSA IRMS Integration — Blocked, Needs External Input

**Status: blocked on access, not yet requested/granted.** This can't be resolved from inside
this codebase — it needs someone to actually contact NTSA. Recording exactly what's needed
so the request can go out and the integration can start the moment access lands.

## What's needed from NTSA

1. **API base URL** (sandbox and production, if they differ).
2. **Authentication mechanism** — API key, OAuth2 client credentials, mutual TLS, IP
   allowlisting? Each implies different code in `backend/app/`.
3. **Update frequency** — this is the single most important number in the whole
   integration. It determines what "live" honestly means to a passenger (see
   `ARCHITECTURE_DECISIONS.md` §9.1). If IRMS refreshes every 30s, the map is 30s stale by
   definition — that needs to be surfaced in the UI (§24.4 item 20 — explicit freshness
   badges), not hidden.
4. **Data shape** — what fields does a vehicle-position record actually contain? At
   minimum need: vehicle identifier (does it key on registration number, or some internal
   NTSA ID we'd need to map to our `Matatu.reg_number`?), lat/lng, timestamp, and ideally
   speed/heading.
5. **Rate limits / quota** — polling frequency we're allowed, and whether there's a
   push/webhook option instead of polling.
6. **Sandbox/test environment availability** — so integration work and testing can happen
   before production credentials exist.
7. **Coverage** — does IRMS track all registered PSVs, or only some vehicle classes /
   opted-in operators? This affects whether IRMS can be the sole telemetry source or needs
   the phone-GPS fallback (§1.5) to be load-bearing for uncovered vehicles.

## What's already decided and ready, once access lands

- **Adapter pattern is the plan** (§9.1) — IRMS gets wrapped in an anti-corruption layer so
  its data model never leaks into our domain model. Build this layer against a mock/stub
  first so it's ready to point at the real API on day one.
- **Never in the request path** — poll IRMS into our own store; serve users from that
  store, not from a live IRMS call per request.
- **Circuit breaker ready** — `backend/app/resilience.py` already has one; the IRMS client
  should use it from the start.
- **PostGIS is the target store** for positions once §1.2/§8 land, so the ingest pipeline
  has somewhere real to write to.

## What to do right now, without IRMS access

Nothing on this specific integration — but everything downstream of "we have vehicle
positions" (PostGIS, route-deviation detection, ETA computation, demand intelligence) can
and should be built against the existing telemetry WebSocket / seed data in the meantime,
so the only remaining step once IRMS access arrives is swapping the data source, not
building the consuming features from scratch.
