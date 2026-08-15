import datetime
import logging
import secrets
from fastapi import APIRouter, Depends, HTTPException, status, Response, Request
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
import base64
import json

from app.database import get_db
from app.models import User
from app.schemas import UserLogin, Token, UserResponse, UserCreate, ForgotPasswordRequest, ResetPasswordRequest
from app.auth import verify_password, create_access_token, get_current_user, get_password_hash
from app.config import SESSION_COOKIE_NAME, TERMS_VERSION
from app.rate_limit import limiter

logger = logging.getLogger(__name__)
RESET_TOKEN_TTL_MINUTES = 30

router = APIRouter(prefix="/api/auth", tags=["Authentication"])

@router.post("/login", response_model=Token)
@limiter.limit("10/minute")
async def login(request: Request, response: Response, credentials: UserLogin, db: AsyncSession = Depends(get_db)):
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

SELF_REGISTRATION_ALLOWED_ROLES = {"PASSENGER"}

@router.post("/register", response_model=Token)
@limiter.limit("5/minute")
async def register(request: Request, credentials: UserCreate, response: Response, db: AsyncSession = Depends(get_db)):
    # Only Passengers self-register here. Crew accounts are issued by the
    # operator when they onboard a vehicle (see saccos.py's crew-assignment
    # endpoint) — a driver/conductor never creates their own login. Staff
    # and admin roles are never self-service. This must be enforced here,
    # not just by which tabs the /register UI happens to show, since this
    # endpoint accepts `role` directly from the request body.
    if credentials.role not in SELF_REGISTRATION_ALLOWED_ROLES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Self-registration is only available for passengers. Crew accounts are issued by your operator; staff accounts are issued by the county.",
        )

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
        terms_accepted_at=datetime.datetime.now(datetime.timezone.utc),
        terms_signature=signature,
        terms_version=TERMS_VERSION,
    )

    db.add(user)
    try:
        await db.commit()
    except IntegrityError:
        # The pre-check above (line ~88) is a friendly-message convenience,
        # not the real guard — two concurrent registrations for the same
        # email can both pass it. The unique constraint is the actual
        # source of truth; without this, a race here surfaces as an
        # unhandled 500 instead of the intended 400.
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User email already registered"
        )
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
@limiter.limit("5/minute")
async def forgot_password(request: Request, payload: ForgotPasswordRequest, db: AsyncSession = Depends(get_db)):
    # Always returns the same generic message regardless of whether the email
    # exists, so this endpoint can't be used to enumerate registered accounts.
    result = await db.execute(select(User).where(User.email == payload.email.lower().strip()))
    user = result.scalars().first()

    if user:
        token = secrets.token_urlsafe(32)
        expires_at = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(minutes=RESET_TOKEN_TTL_MINUTES)
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
@limiter.limit("10/minute")
async def reset_password(request: Request, payload: ResetPasswordRequest, db: AsyncSession = Depends(get_db)):
    if len(payload.new_password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")

    result = await db.execute(select(User).where(User.reset_token == payload.token))
    user = result.scalars().first()
    if not user or not user.reset_token_expires_at:
        raise HTTPException(status_code=400, detail="Invalid or expired reset link")

    expires_at = user.reset_token_expires_at  # already a real tz-aware datetime now, not a string to parse
    if datetime.datetime.now(datetime.timezone.utc) > expires_at:
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

@router.post("/revoke-sessions")
async def revoke_my_sessions(response: Response, current_user: User = Depends(get_current_user)):
    """"Log out everywhere" (§19) — for a user who suspects their account is
    compromised, distinct from a normal single-device logout above. Every
    token issued before this call is rejected on its next use, regardless
    of its own expiry."""
    from app.session_revocation import revoke_all_sessions
    await revoke_all_sessions(current_user.id)
    response.delete_cookie(key=SESSION_COOKIE_NAME, path="/")
    return {"message": "All sessions revoked. You've been signed out everywhere, including this device."}

@router.get("/me", response_model=UserResponse)
async def get_me(current_user: User = Depends(get_current_user)):
    return current_user
