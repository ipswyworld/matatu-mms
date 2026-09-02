"""
Secrets loading with optional Infisical backing (Production Readiness List §4).

Environment variables in a hosting dashboard or a .env file do not rotate,
are not audited, and are readable by anyone with deploy access. Infisical
(free, open-source, self-hostable) provides rotation, per-environment
scoping, and access logging without a per-secret cost or lock-in to one
cloud's secret manager.

Design constraints this satisfies:

  * **Environment variables still win.** A value explicitly set in the
    environment overrides Infisical, so local development, CI, and
    break-glass overrides all keep working with no Infisical account and no
    network access.
  * **Failure is never fatal.** If Infisical is unreachable or
    misconfigured, the app logs loudly and falls back to the environment.
    A secrets provider outage must not become a total outage — and during
    an incident, "the app will not boot because it cannot reach the secret
    store" is the last thing anyone needs.
  * **Fetched once at import.** Secrets are read at startup into the
    existing module-level constants in app/config.py; nothing on the
    request path talks to Infisical.

Activate by setting INFISICAL_TOKEN (a machine-identity or service token)
and INFISICAL_PROJECT_ID. Unset, this module is a no-op passthrough to
os.getenv and costs nothing.
"""
import logging
import os
from typing import Dict, Optional

logger = logging.getLogger("app.secrets_provider")

INFISICAL_TOKEN = os.getenv("INFISICAL_TOKEN")
INFISICAL_PROJECT_ID = os.getenv("INFISICAL_PROJECT_ID")
INFISICAL_ENVIRONMENT = os.getenv("INFISICAL_ENVIRONMENT", "prod")
INFISICAL_SITE_URL = os.getenv("INFISICAL_SITE_URL", "https://app.infisical.com")
INFISICAL_SECRET_PATH = os.getenv("INFISICAL_SECRET_PATH", "/")

_cache: Dict[str, str] = {}
_enabled = False
_load_error: Optional[str] = None


def _load_from_infisical() -> None:
    """Best-effort fetch of every secret in the configured scope.

    Uses the REST API directly rather than the SDK: one HTTP call with the
    stdlib, no extra dependency, and nothing to keep in sync with an SDK's
    release cycle for what is a single GET.
    """
    global _enabled, _load_error

    if not (INFISICAL_TOKEN and INFISICAL_PROJECT_ID):
        return

    import json
    import urllib.error
    import urllib.parse
    import urllib.request

    query = urllib.parse.urlencode({
        "workspaceId": INFISICAL_PROJECT_ID,
        "environment": INFISICAL_ENVIRONMENT,
        "secretPath": INFISICAL_SECRET_PATH,
    })
    url = f"{INFISICAL_SITE_URL.rstrip('/')}/api/v3/secrets/raw?{query}"

    try:
        req = urllib.request.Request(url, headers={"Authorization": f"Bearer {INFISICAL_TOKEN}"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
        for secret in payload.get("secrets", []):
            key = secret.get("secretKey")
            value = secret.get("secretValue")
            if key and value is not None:
                _cache[key] = value
        _enabled = True
        logger.info("Loaded %d secrets from Infisical (env=%s).", len(_cache), INFISICAL_ENVIRONMENT)
    except Exception as e:
        # Deliberately not re-raised. See the module docstring: a secrets
        # provider outage must degrade to environment variables, not take
        # the whole system down.
        _load_error = str(e)[:200]
        logger.error(
            "Could not load secrets from Infisical (%s). Falling back to environment variables.",
            _load_error,
        )


_load_from_infisical()


def get(name: str, default: Optional[str] = None) -> Optional[str]:
    """Resolves one secret.

    Precedence is environment first, then Infisical, then the default —
    so an explicitly-set variable always wins and nothing that works today
    stops working when Infisical is introduced.
    """
    env_value = os.getenv(name)
    if env_value is not None:
        return env_value
    if name in _cache:
        return _cache[name]
    return default


def status() -> dict:
    """Surfaced on the ops console's Infrastructure tab — whether the
    provider is active, never any secret's value."""
    return {
        "configured": bool(INFISICAL_TOKEN and INFISICAL_PROJECT_ID),
        "active": _enabled,
        "environment": INFISICAL_ENVIRONMENT if _enabled else None,
        "secretCount": len(_cache),
        "error": _load_error,
    }
