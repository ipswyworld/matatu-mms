"""
Client IP resolution for rate limiting (Readiness List §4).

This is the third attempt at the same bug, so the reasoning is written down
properly rather than left implicit.

The symptom: users on the live deployment kept seeing "Too many sign-in
attempts" with no plausible volume behind it. Raising the limit from 30 to
100/minute did not fix it, which was the clue that the limit was never the
problem.

The cause: `slowapi.util.get_remote_address` returns `request.client.host`,
which uvicorn populates from `X-Forwarded-For` when `--proxy-headers` is
set. Uvicorn takes the **last** entry of that header. Behind
Cloudflare → Render, the chain is roughly:

    X-Forwarded-For: <real client>, <cloudflare edge>, <render proxy>

so the last entry is an internal address, identical for everyone routed
through that hop. Every user then shares one rate-limit bucket, and the
limit trips at a fraction of its nominal value with no single user doing
anything unusual.

This was confirmed on the live system rather than reasoned about: the
`login_events` table showed sign-ins recorded from a mix of real client
addresses (41.90.141.43, a Kenyan mobile range) and RFC1918 addresses
(10.26.131.47, 10.31.99.14). Every request recorded as 10.x was sharing a
bucket.

Resolution order, and why:

  1. **CF-Connecting-IP** — set by Cloudflare, which overwrites whatever the
     client sent. Behind Cloudflare it is both authoritative and
     unspoofable, which no other header here is.
  2. **The leftmost public entry of X-Forwarded-For** — the original client
     in the standard reading. Spoofable by a client that sends its own
     X-Forwarded-For when no trusted proxy overwrites it, so it is a
     fallback rather than the primary.
  3. **request.client.host** — direct connections and local development.

Private and loopback addresses are never accepted as an identity from a
proxy header: resolving to 10.x means we are looking at infrastructure, not
a user, and keying a rate limit on it is precisely the bug above.
"""
import ipaddress
import logging
import os
from typing import Optional

logger = logging.getLogger("app.client_ip")

# Cloudflare's header. Trustworthy here specifically because Render fronts
# every *.onrender.com service with Cloudflare, which replaces any
# client-supplied value.
CF_HEADER = "cf-connecting-ip"
XFF_HEADER = "x-forwarded-for"
REAL_IP_HEADER = "x-real-ip"

# Set TRUST_FORWARDED_HEADERS=false for a deployment with no trusted proxy
# in front, where an attacker could otherwise evade rate limiting simply by
# sending their own X-Forwarded-For.
TRUST_FORWARDED = os.getenv("TRUST_FORWARDED_HEADERS", "true").strip().lower() not in (
    "0", "false", "no",
)


def _is_usable_public(value: str) -> bool:
    """Whether an address can identify a distinct client.

    Private, loopback and link-local addresses are infrastructure. Accepting
    one as a client identity is what collapsed every user into a single
    rate-limit bucket.
    """
    try:
        addr = ipaddress.ip_address(value.strip())
    except ValueError:
        return False
    return not (addr.is_private or addr.is_loopback or addr.is_link_local
                or addr.is_reserved or addr.is_unspecified)


def resolve(request) -> str:
    """Best available identity for the client behind this request.

    Never raises, and always returns something: a rate limiter that throws
    would take down the endpoint it is protecting.
    """
    headers = request.headers

    if TRUST_FORWARDED:
        cf = headers.get(CF_HEADER)
        if cf and _is_usable_public(cf):
            return cf.strip()

        forwarded = headers.get(XFF_HEADER)
        if forwarded:
            # Leftmost public entry: the original client under the standard
            # reading of the header. Uvicorn takes the rightmost, which is
            # the proxy — the bug this module exists to fix.
            for part in forwarded.split(","):
                candidate = part.strip()
                if _is_usable_public(candidate):
                    return candidate

        real_ip = headers.get(REAL_IP_HEADER)
        if real_ip and _is_usable_public(real_ip):
            return real_ip.strip()

    peer = request.client.host if request.client else None
    if peer:
        return peer

    # No resolvable identity at all. A fixed string rather than None so
    # callers get a valid key; it groups such requests together, which is
    # the conservative choice for anything unidentifiable.
    return "unknown"


def rate_limit_key(request) -> str:
    """Key function for slowapi, replacing get_remote_address."""
    return resolve(request)


def debug_info(request) -> dict:
    """What each candidate header says, for diagnosing this class of bug
    without shipping another guess."""
    headers = request.headers
    forwarded = headers.get(XFF_HEADER)
    return {
        "resolved": resolve(request),
        "trustForwardedHeaders": TRUST_FORWARDED,
        "cfConnectingIp": headers.get(CF_HEADER),
        "xForwardedFor": forwarded,
        "xForwardedForParts": [p.strip() for p in forwarded.split(",")] if forwarded else [],
        "xRealIp": headers.get(REAL_IP_HEADER),
        "peer": request.client.host if request.client else None,
        "note": (
            "resolved is what rate limiting keys on. If it is an RFC1918 address "
            "(10.x, 172.16-31.x, 192.168.x) then every user behind that proxy hop "
            "shares one bucket, which is the bug this module fixes."
        ),
    }
