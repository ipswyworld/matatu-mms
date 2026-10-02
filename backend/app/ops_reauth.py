"""
Step-up re-authentication for Critical ops actions (Ops Console Rebuild
Spec §21.5).

The ops console is internal, and everyone with access is trusted — so the
two-person approval originally sketched for Critical actions would mostly
mean nobody is reachable at 3am. What re-auth defends against is different
and still real: a session left open on an unlocked laptop, or a stolen
session cookie. Proving possession of the password (and MFA, when enrolled)
at the moment of the action closes that gap without needing a second human.

The re-auth token is a short-lived JWT, separate from the session token and
useless for anything else: it carries a distinct claim, is bound to the
user who minted it, and expires in minutes rather than hours.
"""
import datetime
import logging
from typing import Optional

import jwt as pyjwt_lib

from app.config import ALGORITHM, SECRET_KEY

logger = logging.getLogger("app.ops_reauth")

REAUTH_TTL_MINUTES = 5
_CLAIM = "opsReauth"


def mint(user_id: str) -> dict:
    """Issues a re-auth token for one operator."""
    expires = datetime.datetime.utcnow() + datetime.timedelta(minutes=REAUTH_TTL_MINUTES)
    token = pyjwt_lib.encode(
        {_CLAIM: True, "userId": user_id, "exp": expires, "iat": datetime.datetime.utcnow()},
        SECRET_KEY,
        algorithm=ALGORITHM,
    )
    return {
        "reauthToken": token,
        "expiresAt": expires.replace(tzinfo=datetime.timezone.utc).isoformat(),
        "ttlSeconds": REAUTH_TTL_MINUTES * 60,
    }


def verify(token: Optional[str], user_id: str) -> bool:
    """True only for an unexpired re-auth token minted for this same user.

    The user binding matters: without it, any valid re-auth token from any
    operator would satisfy the check, which would make the whole step
    decorative.
    """
    if not token:
        return False
    try:
        payload = pyjwt_lib.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except Exception:
        return False
    if not payload.get(_CLAIM):
        return False
    return payload.get("userId") == user_id
