import datetime
import logging
import secrets
from fastapi import APIRouter, Depends, HTTPException, status, Response, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
import base64
import json

from app.database import get_db
from app.models import User
from app.schemas import UserLogin, Token, UserResponse, UserCreate, ForgotPasswordRequest, ResetPasswordRequest
from app.auth import verify_password, create_access_token, get_current_user, get_password_hash
from app.config import SESSION_COOKIE_NAME, TERMS_VERSION

logger = logging.getLogger(__name__)
RESET_TOKEN_TTL_MINUTES = 30

router = APIRouter(prefix="/api/auth", tags=["Authentication"])

@router.post("/login", response_model=Token)
async def login(response: Response, credentials: UserLogin, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.email == credentials.email))
    user = result.scalars().first()
    
    if not user or not verify_password(credentials.password, user.password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
        
    # Generate JWT token
    token_data = {
        "userId": user.id,
        "name": user.name,
        "role": user.role,
        "saccoId": user.sacco_id
    }
    access_token = create_access_token(data=token_data)
    
    session_json = json.dumps({
        "userId": user.id,
        "name": user.name,
        "role": user.role,
        "saccoId": user.sacco_id
    })
    encoded_cookie = base64.b64encode(session_json.encode('utf-8')).decode('utf-8')
    
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=encoded_cookie,
        path="/",
        httponly=False,
        samesite="lax"
    )
    
    user_resp = UserResponse.model_validate(user)
    return Token(
        access_token=access_token,
        token_type="bearer",
        user=user_resp
    )

@router.post("/register", response_model=Token)
async def register(credentials: UserCreate, response: Response, db: AsyncSession = Depends(get_db)):
    # Self-registration requires genuine, recorded consent: the checkbox
    # alone isn't enough — a typed signature must also be present. This is
    # server-side enforcement, not just a disabled submit button in the UI.
    if not credentials.terms_accepted:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You must agree to the Terms & Conditions to register."
        )
    signature = (credentials.terms_signature or "").strip()
    if not signature:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You must type your name to sign the Terms & Conditions."
        )
    if signature.lower() != credentials.name.strip().lower():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Your signature must match the full name entered above."
        )

    # Check if user with email already exists
    existing = await db.execute(select(User).where(User.email == credentials.email))
    if existing.scalars().first():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User email already registered"
        )

    import uuid
    new_id = f"u-{uuid.uuid4().hex[:8]}"

    hashed_pwd = get_password_hash(credentials.password)

    user = User(
        id=new_id,
        name=credentials.name,
        email=credentials.email,
        password=hashed_pwd,
        role=credentials.role,
        sacco_id=credentials.sacco_id,
        terms_accepted=True,
        terms_accepted_at=datetime.datetime.utcnow().isoformat() + "Z",
        terms_signature=signature,
        terms_version=TERMS_VERSION,
    )

    db.add(user)
    await db.commit()
    await db.refresh(user)

    token_data = {
        "userId": user.id,
        "name": user.name,
        "role": user.role,
        "saccoId": user.sacco_id
    }
    access_token = create_access_token(data=token_data)

    session_json = json.dumps({
        "userId": user.id,
        "name": user.name,
        "role": user.role,
        "saccoId": user.sacco_id
    })
    encoded_cookie = base64.b64encode(session_json.encode('utf-8')).decode('utf-8')

    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=encoded_cookie,
        path="/",
        httponly=False,
        samesite="lax"
    )

    user_resp = UserResponse.model_validate(user)
    return Token(
        access_token=access_token,
        token_type="bearer",
        user=user_resp
    )

@router.post("/forgot-password")
async def forgot_password(payload: ForgotPasswordRequest, db: AsyncSession = Depends(get_db)):
    # Always returns the same generic message regardless of whether the email
    # exists, so this endpoint can't be used to enumerate registered accounts.
    result = await db.execute(select(User).where(User.email == payload.email.lower().strip()))
    user = result.scalars().first()

    if user:
        token = secrets.token_urlsafe(32)
        expires_at = (datetime.datetime.utcnow() + datetime.timedelta(minutes=RESET_TOKEN_TTL_MINUTES)).isoformat() + "Z"
        user.reset_token = token
        user.reset_token_expires_at = expires_at
        await db.commit()
        # No email/SMS provider is configured for this deployment yet, so the
        # reset link is logged server-side rather than silently dropped.
        logger.warning(
            "Password reset requested for %s. Reset link: /reset-password?token=%s (expires in %d min)",
            user.email, token, RESET_TOKEN_TTL_MINUTES,
        )

    return {"message": "If that email is registered, a password reset link has been sent."}

@router.post("/reset-password")
async def reset_password(payload: ResetPasswordRequest, db: AsyncSession = Depends(get_db)):
    if len(payload.new_password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")

    result = await db.execute(select(User).where(User.reset_token == payload.token))
    user = result.scalars().first()
    if not user or not user.reset_token_expires_at:
        raise HTTPException(status_code=400, detail="Invalid or expired reset link")

    expires_at = datetime.datetime.fromisoformat(user.reset_token_expires_at.replace("Z", ""))
    if datetime.datetime.utcnow() > expires_at:
        user.reset_token = None
        user.reset_token_expires_at = None
        await db.commit()
        raise HTTPException(status_code=400, detail="This reset link has expired. Please request a new one.")

    user.password = get_password_hash(payload.new_password)
    user.reset_token = None
    user.reset_token_expires_at = None
    await db.commit()

    return {"message": "Password updated. You can now sign in with your new password."}

@router.post("/logout")
async def logout(response: Response):
    response.delete_cookie(key=SESSION_COOKIE_NAME, path="/")
    return {"message": "Logged out successfully"}

@router.get("/me", response_model=UserResponse)
async def get_me(current_user: User = Depends(get_current_user)):
    return current_user
