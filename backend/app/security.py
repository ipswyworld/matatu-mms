"""
Webhook SSRF guard (ARCHITECTURE_DECISIONS.md §21.3/§15.4) — the inbound
counterpart to the egress allowlist elsewhere in the doc. `WebhookSubscription.url`
is operator-supplied; without validation, the backend can be induced to make
requests to internal addresses (cloud metadata endpoints, internal
services, localhost) by registering them as a "webhook target."
"""
import ipaddress
import socket
from urllib.parse import urlparse


class UnsafeWebhookUrlError(ValueError):
    pass


def validate_public_webhook_url(url: str) -> None:
    """Raises UnsafeWebhookUrlError if the URL doesn't resolve to a public,
    routable address. Checks the scheme, then resolves the hostname and
    rejects private/loopback/link-local/reserved ranges — including
    169.254.169.254, the cloud-metadata address SSRF exploits specifically
    target. Best-effort against DNS rebinding (the resolved IP at
    validation time may differ from the IP actually connected to later) —
    a genuine gap, not something a single synchronous check can fully
    close; the real mitigation is that outbound webhook delivery
    (app/listeners.py) already goes through a circuit breaker with a short
    timeout, bounding the blast radius of a successful rebind.
    """
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise UnsafeWebhookUrlError("Webhook URL must be http or https.")
    if not parsed.hostname:
        raise UnsafeWebhookUrlError("Webhook URL must include a hostname.")

    hostname = parsed.hostname.lower()
    if hostname in ("localhost", "0.0.0.0"):
        raise UnsafeWebhookUrlError("Webhook URL cannot target localhost.")

    try:
        resolved_ips = {info[4][0] for info in socket.getaddrinfo(hostname, None)}
    except socket.gaierror:
        raise UnsafeWebhookUrlError(f"Could not resolve webhook hostname: {hostname}")

    for ip_str in resolved_ips:
        ip = ipaddress.ip_address(ip_str)
        if (
            ip.is_private
            or ip.is_loopback
            or ip.is_link_local  # covers 169.254.169.254 (cloud metadata)
            or ip.is_multicast
            or ip.is_reserved
            or ip.is_unspecified
        ):
            raise UnsafeWebhookUrlError(
                f"Webhook URL resolves to a non-public address ({ip_str}) — not allowed."
            )
