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

def verify_password(plain_password: str, hashed_password: str) -> bool:
    try:
        return bcrypt.checkpw(plain_password.encode('utf-8'), hashed_password.encode('utf-8'))
    except Exception:
        # Malformed/non-bcrypt hash — fail closed. Never fall back to a
        # plaintext comparison (that was the old, insecure behavior).
        return False

def get_password_hash(password: str) -> str:
    salt = bcrypt.gensalt()
    return bcrypt.hashpw(password.encode('utf-8'), salt).decode('utf-8')

def create_access_token(data: dict, expires_delta: Optional[datetime.timedelta] = None) -> str:
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.datetime.utcnow() + expires_delta
    else:
        expire = datetime.datetime.utcnow() + datetime.timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
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
        payload = pyjwt.decode(jwt_token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id: str = payload.get("userId") or payload.get("sub")
        if user_id is None:
            raise credentials_exception
    except Exception:
        raise credentials_exception
        
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalars().first()
    if user is None:
        raise credentials_exception
    return user

class PermissionChecker:
    def __init__(self, action: str):
        self.action = action

    def __call__(self, current_user: User = Depends(get_current_user)):
        from app.rbac import can
        if not can(current_user.role, self.action):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"You do not have permission to perform this action: {self.action}"
            )
        return current_user

def requires_permission(action: str):
    return PermissionChecker(action)
