"""
Network-layer access restriction for the ops control plane
(Readiness List §4 — the highest-priority outstanding security item).

The problem this closes: the ops console can now put the system into
maintenance mode, engage kill switches and revoke every session. Before
this, the only thing standing in front of that was a SUPERADMIN session
check. That was an acceptable gap for a read-only status page. It stopped
being acceptable the moment the console gained destructive actions.

The proper control is infrastructure — a VPN, or the control plane having
no public ingress at all, which is how `infra/kubernetes/` deploys it. This
is the application-layer backstop for the period before that exists, and
for any deployment where it cannot: an IP allowlist enforced in the process
itself, so a misconfigured load balancer or an accidentally-public service
does not silently expose the console.

Deliberate properties:

  * **Unset means open, and says so loudly.** Failing closed on an unset
    allowlist would brick every existing deployment on upgrade, including
    the Render demo. Instead it logs a clear warning at startup, so the gap
    is visible rather than silent. Fail-closed is available via
    OPS_REQUIRE_ALLOWLIST for deployments that want it.

  * **Trusts the same proxy headers uvicorn does.** `--forwarded-allow-ips`
    is already set in docker-entrypoint.sh, so `request.client.host` is the
    real client rather than the load balancer. Re-parsing X-Forwarded-For
    here would risk trusting a header a client can forge.

  * **CIDR, not exact IPs.** Office networks and VPN pools are ranges, and
    an allowlist that only accepts single addresses gets abandoned the
    first time someone's IP changes.
"""
import ipaddress
import logging
import os
from typing import List, Optional

logger = logging.getLogger("app.network_gate")

ENV_ALLOWLIST = "OPS_IP_ALLOWLIST"
ENV_REQUIRE = "OPS_REQUIRE_ALLOWLIST"


def _parse_networks(raw: Optional[str]) -> List[ipaddress._BaseNetwork]:
    networks: List[ipaddress._BaseNetwork] = []
    for entry in (raw or "").split(","):
        entry = entry.strip()
        if not entry:
            continue
        try:
            # strict=False so "10.0.0.5/24" is accepted rather than rejected
            # on a technicality that would just get the entry deleted.
            networks.append(ipaddress.ip_network(entry, strict=False))
        except ValueError:
            # A typo must not silently widen access by being skipped and
            # leaving an empty (open) allowlist, so this is an error-level
            # log rather than a debug one.
            logger.error(
                "Ignoring malformed entry in %s: %r — expected an IP or CIDR "
                "such as 10.0.0.0/8 or 203.0.113.7/32",
                ENV_ALLOWLIST, entry,
            )
    return networks


ALLOWED_NETWORKS = _parse_networks(os.getenv(ENV_ALLOWLIST))
REQUIRE_ALLOWLIST = os.getenv(ENV_REQUIRE, "").strip().lower() in ("1", "true", "yes")


def is_configured() -> bool:
    return bool(ALLOWED_NETWORKS)


def invalid_networks(entries: List[str]) -> List[str]:
    """For validating a per-partner-client IP allowlist at creation time
    (ApiClient.ip_allowlist) — unlike _parse_networks above (which silently
    drops a malformed OPS_IP_ALLOWLIST entry and logs it), a client-supplied
    allowlist should reject loudly with a 400 rather than quietly narrowing
    to fewer entries than the operator typed. Returns the entries that
    failed to parse; an empty list means all entries were valid CIDRs/IPs."""
    bad: List[str] = []
    for entry in entries:
        try:
            ipaddress.ip_network(entry.strip(), strict=False)
        except ValueError:
            bad.append(entry)
    return bad


def client_ip_allowed(client_host: Optional[str], allowlist_json: Optional[str]) -> bool:
    """Same address-in-network check as is_allowed() above, but for one
    ApiClient's own ip_allowlist column (JSON array of CIDR strings) rather
    than the global OPS_IP_ALLOWLIST — a separate, per-partner control.
    No allowlist configured on the client means unrestricted, matching
    is_allowed()'s "unset means open" default."""
    import json as _json

    if not allowlist_json:
        return True
    try:
        entries = _json.loads(allowlist_json)
    except (ValueError, TypeError):
        return True
    networks = _parse_networks(",".join(entries))
    if not networks:
        return True
    if not client_host:
        return False
    try:
        address = ipaddress.ip_address(client_host)
    except ValueError:
        return False
    return any(address in network for network in networks)


def is_allowed(client_host: Optional[str]) -> bool:
    """Whether this client may reach the control plane."""
    if not ALLOWED_NETWORKS:
        # Nothing configured. Open unless explicitly told to fail closed —
        # see the module docstring on why the default is not fail-closed.
        return not REQUIRE_ALLOWLIST

    if not client_host:
        # No resolvable peer and an allowlist in force: refuse. This is the
        # one case where being permissive would defeat the entire control.
        return False

    try:
        address = ipaddress.ip_address(client_host)
    except ValueError:
        logger.warning("Could not parse client address %r; denying.", client_host)
        return False

    return any(address in network for network in ALLOWED_NETWORKS)


def startup_status() -> dict:
    """Logged at startup and surfaced on the console, so the state of this
    control is visible rather than assumed."""
    if ALLOWED_NETWORKS:
        return {
            "configured": True,
            "networks": [str(n) for n in ALLOWED_NETWORKS],
            "failClosed": REQUIRE_ALLOWLIST,
        }
    return {
        "configured": False,
        "networks": [],
        "failClosed": REQUIRE_ALLOWLIST,
        "warning": (
            f"No {ENV_ALLOWLIST} configured. The ops control plane is reachable from any "
            "address that can route to it. This console can enable maintenance mode, engage "
            "kill switches and revoke every session — put it behind a VPN, restrict ingress, "
            f"or set {ENV_ALLOWLIST} to a CIDR list."
        ),
    }


def log_startup_status() -> None:
    status = startup_status()
    if status["configured"]:
        logger.info(
            "Ops network gate active: %s (fail-closed=%s)",
            ", ".join(status["networks"]), status["failClosed"],
        )
    elif REQUIRE_ALLOWLIST:
        logger.error(
            "%s is set but %s is empty — the control plane will refuse every request.",
            ENV_REQUIRE, ENV_ALLOWLIST,
        )
    else:
        logger.warning(status["warning"])
