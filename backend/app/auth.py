import asyncio
import datetime
from typing import Optional
from fastapi import Depends, HTTPException, status, Request
from fastapi.security import OAuth2PasswordBearer
import jwt as pyjwt # Using pyjwt as listed in requirements.txt
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.config import SECRET_KEY, ALGORITHM, ACCESS_TOKEN_EXPIRE_MINUTES, SESSION_COOKIE_NAME
from app.database import get_db
from app.models import User

import bcrypt

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login", auto_error=False)

# Every token minted by this service is scoped to this one API audience.
# There is only one API today, so this closes a gap that doesn't bite yet
# rather than one that does — but it means a token minted for some future
# second service (an extracted microservice, a partner integration) can
# never be silently accepted here just because it shares the same signing
# key, and vice versa.
JWT_AUDIENCE = "matatu-mms-api"

def _verify_password_sync(plain_password: str, hashed_password: str) -> bool:
    try:
        return bcrypt.checkpw(plain_password.encode('utf-8'), hashed_password.encode('utf-8'))
    except Exception:
        # Malformed/non-bcrypt hash — fail closed. Never fall back to a
        # plaintext comparison (that was the old, insecure behavior).
        return False

def _hash_password_sync(password: str) -> str:
    salt = bcrypt.gensalt()
    return bcrypt.hashpw(password.encode('utf-8'), salt).decode('utf-8')

# bcrypt is deliberately slow (that's what makes it resistant to offline
# cracking) — checkpw/hashpw take ~100ms-1s+ of pure CPU time. Called
# directly from an `async def` route (as this used to be), that blocks the
# *entire* single-threaded event loop for the whole hash duration: every
# other in-flight request on this process — other users' API calls, GPS
# WebSocket fan-out, even /healthz — stalls until it's done. offloading to
# a worker thread via asyncio.to_thread keeps the event loop free to keep
# serving everyone else while the hash runs.
async def verify_password(plain_password: str, hashed_password: str) -> bool:
    return await asyncio.to_thread(_verify_password_sync, plain_password, hashed_password)

async def get_password_hash(password: str) -> str:
    return await asyncio.to_thread(_hash_password_sync, password)

def create_access_token(data: dict, expires_delta: Optional[datetime.timedelta] = None) -> str:
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.datetime.utcnow() + expires_delta
    else:
        expire = datetime.datetime.utcnow() + datetime.timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    # "iat" (issued-at) — the only addition session revocation (§19) needs:
    # a per-user "revoked before" timestamp in Redis can reject any token
    # issued before it, without a per-token denylist. Set explicitly rather
    # than relying on pyjwt to add it, since we need the exact same value
    # to compare against in get_current_user.
    issued_at = datetime.datetime.utcnow()
    to_encode.update({"exp": expire, "iat": issued_at, "aud": JWT_AUDIENCE})
    # pyjwt library
    encoded_jwt = pyjwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

async def get_current_user(
    request: Request,
    token: Optional[str] = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db)
) -> User:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    
    # Try getting token from authorization header first, then fallback to session cookie
    jwt_token = token
    if not jwt_token:
        jwt_token = request.cookies.get(SESSION_COOKIE_NAME)
        
    if not jwt_token:
        raise credentials_exception
        
    try:
        # Decode the token
        payload = pyjwt.decode(jwt_token, SECRET_KEY, algorithms=[ALGORITHM], audience=JWT_AUDIENCE)
        user_id: str = payload.get("userId") or payload.get("sub")
        issued_at = payload.get("iat")
        if user_id is None:
            raise credentials_exception
    except Exception:
        raise credentials_exception

    # Session revocation (§19, app/session_revocation.py) — a token issued
    # before the user's last "revoke all sessions" action is rejected here
    # even though it hasn't expired yet. issued_at is None for a token
    # minted before this claim existed (pre-deploy tokens) — those simply
    # can't be revoked this way, which is fine: they expire on their own
    # normal schedule regardless.
    if issued_at is not None:
        from app.session_revocation import is_token_revoked
        if await is_token_revoked(user_id, float(issued_at)):
            raise credentials_exception

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalars().first()
    if user is None:
        raise credentials_exception
    # Deactivated after this token was issued — reject immediately rather
    # than waiting for it to expire on its own (same reasoning as the
    # session-revocation check above).
    if user.is_active is False:
        raise credentials_exception
    return user

class PermissionChecker:
    def __init__(self, action: str):
        self.action = action

    def __call__(self, current_user: User = Depends(get_current_user)):
        from app.rbac import has_permission
        if not has_permission(current_user, self.action):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"You do not have permission to perform this action: {self.action}"
            )
        return current_user

def requires_permission(action: str):
    return PermissionChecker(action)
