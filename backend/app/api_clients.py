"""
Machine principals for the partner API (Readiness List §14).

A Sacco integrating its own system, or the future ops-side system, must not
be modelled as a fake user account. That is the classic mistake and it costs
twice: every action lands in the audit trail attributed to a person who did
not perform it, and the integration inherits a human's entire role instead of
a narrow, purpose-built scope.

So `ApiClient` is a first-class principal with its own identity, scopes,
quota tier and audit attribution — never a row in `users`.

What it deliberately reuses:

  * **The existing ABAC engine, unchanged.** app/abac.py duck-types on
    `.id`, `.sacco_id` and `.role`, so a Sacco-owned client presenting
    `role = "SACCO_OPERATOR"` is scoped to its own Sacco by exactly the
    same `sacco_scoped_fleet_access` rules that govern human operators.
    Writing a second authorization path for machine callers would
    guarantee the two drift apart, and the divergence would be a
    security hole rather than a cosmetic inconsistency.

  * **The existing RBAC permission vocabulary.** A scope resolves to a set
    of the same action strings `has_permission` already checks, so there is
    one answer to "may this caller do X", not two.

Scopes are the partner-facing vocabulary (`fleet:read`) rather than raw
internal permission names, because they are a published contract: partners
build against them and they should not shift every time an internal
permission is renamed.
"""
import datetime
import hashlib
import logging
import secrets
from typing import Dict, List, Optional, Set

logger = logging.getLogger("app.api_clients")

CLIENT_ID_PREFIX = "mms_client_"
SECRET_PREFIX = "mms_secret_"
TOKEN_TTL_SECONDS = 3600

# Partner-facing scope -> internal permission actions.
#
# Read and write are separated for every resource: the overwhelmingly common
# integration only needs to read, and handing out write access by default is
# how a partner's bug becomes county data loss.
SCOPES: Dict[str, Dict[str, object]] = {
    "fleet:read": {
        "description": "Read vehicles belonging to your Sacco.",
        "permissions": {"view_matatus", "view_routes"},
    },
    "fleet:write": {
        "description": "Register and update vehicles belonging to your Sacco.",
        "permissions": {"view_matatus", "add_matatu", "remove_matatu"},
    },
    "crew:read": {
        "description": "Read crew assigned to your Sacco.",
        "permissions": {"view_crew"},
    },
    "crew:write": {
        "description": "Manage crew for your Sacco.",
        "permissions": {"view_crew", "manage_crew"},
    },
    "trips:read": {
        "description": "Read trip and activity records for your Sacco.",
        "permissions": {"view_activity"},
    },
    "telemetry:read": {
        "description": "Read live and historical vehicle positions for your Sacco.",
        "permissions": {"view_matatus", "view_activity"},
    },
    "fines:read": {
        "description": "Read fines issued against your Sacco's vehicles.",
        "permissions": {"view_fines"},
    },
    "webhooks:manage": {
        "description": "Create and manage webhook subscriptions for your Sacco.",
        "permissions": {"manage_webhooks"},
    },
    "reports:read": {
        "description": "Read compliance and revenue reports for your Sacco.",
        "permissions": {"view_reports"},
    },
}

# Quota tiers. An internal first-party system and an unknown third-party
# integrator should not share one limit (Readiness List §14).
QUOTA_TIERS: Dict[str, str] = {
    "internal": "6000/minute",   # first-party systems we operate
    "partner": "600/minute",     # established Sacco integrations
    "sandbox": "60/minute",      # new or untrusted integrations
}
DEFAULT_TIER = "partner"


def all_scopes() -> List[dict]:
    return [
        {"scope": name, "description": meta["description"], "permissions": sorted(meta["permissions"])}
        for name, meta in sorted(SCOPES.items())
    ]


def permissions_for(scopes: List[str]) -> Set[str]:
    """Union of internal permissions granted by a set of scopes. Unknown
    scopes contribute nothing rather than raising, so a scope removed from
    the catalogue degrades a client's access instead of breaking every one
    of its requests at once."""
    granted: Set[str] = set()
    for scope in scopes or []:
        meta = SCOPES.get(scope)
        if meta:
            granted |= set(meta["permissions"])  # type: ignore[arg-type]
    return granted


def validate_scopes(scopes: List[str]) -> List[str]:
    """Raises ValueError naming any scope that is not in the catalogue."""
    unknown = [s for s in scopes if s not in SCOPES]
    if unknown:
        raise ValueError(
            f"Unknown scope(s): {', '.join(unknown)}. Valid scopes: {', '.join(sorted(SCOPES))}"
        )
    return scopes


def generate_credentials() -> tuple[str, str]:
    """Returns (client_id, client_secret). The secret is shown to the
    operator exactly once and only its hash is stored."""
    return (
        f"{CLIENT_ID_PREFIX}{secrets.token_hex(12)}",
        f"{SECRET_PREFIX}{secrets.token_urlsafe(32)}",
    )


def hash_secret(secret: str) -> str:
    """SHA-256 rather than bcrypt, deliberately.

    Client secrets are 256 bits of machine-generated randomness, not
    human-chosen passwords: there is no dictionary to attack and no
    plausible brute force, so bcrypt's work factor buys nothing here while
    costing real latency on every single API request. bcrypt remains
    correct for user passwords, which are low-entropy and guessable.
    """
    return hashlib.sha256(secret.encode("utf-8")).hexdigest()


def verify_secret(secret: str, stored_hash: str) -> bool:
    return secrets.compare_digest(hash_secret(secret), stored_hash)


class ApiClientPrincipal:
    """Adapter presenting an ApiClient row with the attributes app/abac.py
    duck-types on, so the existing scoping rules apply to machine callers
    with no change to the ABAC engine.

    `role` is what makes that work: a Sacco-owned client presents as
    SACCO_OPERATOR, so `sacco_scope_query` filters it to its own Sacco
    automatically. A client with no Sacco (a first-party internal system)
    presents as its configured role instead.
    """

    def __init__(self, record):
        self._record = record
        self.id = record.id
        self.client_id = record.client_id
        self.name = record.name
        self.sacco_id = record.sacco_id
        self.role = record.effective_role
        self.tier = record.quota_tier or DEFAULT_TIER
        self.scopes = record.scope_list()
        self.permissions = permissions_for(self.scopes)
        # Present so code written against User objects does not blow up on
        # an attribute check; a machine principal is never "inactive but
        # authenticated" — a revoked client fails authentication outright.
        self.is_active = record.revoked_at is None
        self.kind = "api_client"

    def has(self, action: str) -> bool:
        return action in self.permissions

    @property
    def audit_id(self) -> str:
        """What lands in the audit trail. Prefixed so a machine actor is
        never mistaken for a user id when reading the log."""
        return f"client:{self.client_id}"

    def __repr__(self) -> str:
        return f"<ApiClientPrincipal {self.client_id} sacco={self.sacco_id} scopes={self.scopes}>"


def mint_token(principal: ApiClientPrincipal) -> dict:
    """Issues a bearer token for the client-credentials flow.

    Carries `clientId`, never `userId`: the token type is distinguishable
    at decode time, so a machine token can never be mistaken for a human
    session by code that reads `userId`.
    """
    import jwt as pyjwt_lib
    from app.auth import JWT_AUDIENCE
    from app.config import ALGORITHM, SECRET_KEY

    now = datetime.datetime.utcnow()
    payload = {
        "clientId": principal.client_id,
        "name": principal.name,
        "saccoId": principal.sacco_id,
        "scopes": principal.scopes,
        "tier": principal.tier,
        "iat": now,
        "exp": now + datetime.timedelta(seconds=TOKEN_TTL_SECONDS),
        "aud": JWT_AUDIENCE,
    }
    return {
        "access_token": pyjwt_lib.encode(payload, SECRET_KEY, algorithm=ALGORITHM),
        "token_type": "bearer",
        "expires_in": TOKEN_TTL_SECONDS,
        "scope": " ".join(principal.scopes),
    }
