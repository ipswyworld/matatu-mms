import datetime
import logging
import re
import secrets
from fastapi import APIRouter, Depends, HTTPException, status, Response, Request
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
import base64
import json

from app.database import get_db
from app.models import User
from app.schemas import (
    UserLogin, Token, UserResponse, UserCreate, ForgotPasswordRequest, ResetPasswordRequest,
    PhoneForgotPasswordRequest, PhoneResetPasswordRequest,
    MfaRequiredResponse, MfaEnrollResponse, MfaConfirmRequest, MfaConfirmResponse,
    MfaDisableRequest, MfaVerifyRequest,
)
from app.auth import verify_password, create_access_token, get_current_user, get_password_hash
from app.config import SESSION_COOKIE_NAME, TERMS_VERSION, PUBLIC_FRONTEND_URL, REMEMBER_ME_EXPIRE_DAYS, SECRET_KEY, ALGORITHM
from app.rate_limit import limiter
from app.sms import send_sms
from app.rbac import ADMIN_TIER_ROLES
from app import mfa as mfa_lib
import jwt as pyjwt_lib

logger = logging.getLogger(__name__)
RESET_TOKEN_TTL_MINUTES = 30
PHONE_OTP_TTL_MINUTES = 10


def _as_aware_utc(dt: datetime.datetime) -> datetime.datetime:
    """SQLite doesn't persist tzinfo on DateTime(timezone=True) columns —
    a value written as UTC-aware comes back naive after a round trip
    through a fresh SELECT (a new DB session, not the same in-memory
    object that wrote it), which crashes the naive/aware comparison below.
    Postgres (prod) doesn't have this problem; this is a no-op there since
    the value already carries tzinfo."""
    return dt if dt.tzinfo else dt.replace(tzinfo=datetime.timezone.utc)

router = APIRouter(prefix="/api/auth", tags=["Authentication"])

def _issue_token_response(response: Response, user: User, remember_me: bool, mfa_setup_required: bool = False) -> Token:
    """Shared by the normal login path and /verify-mfa — the part that
    actually mints a session, run only once MFA (if required) is satisfied."""
    token_data = {
        "userId": user.id,
        "name": user.name,
        "role": user.role,
        "saccoId": user.sacco_id
    }
    remember_me_delta = datetime.timedelta(days=REMEMBER_ME_EXPIRE_DAYS) if remember_me else None
    access_token = create_access_token(data=token_data, expires_delta=remember_me_delta)

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
        samesite="lax",
        max_age=REMEMBER_ME_EXPIRE_DAYS * 24 * 3600 if remember_me else None,
    )

    return Token(
        access_token=access_token,
        token_type="bearer",
        user=UserResponse.model_validate(user),
        mfa_setup_required=mfa_setup_required,
    )


@router.post("/login", response_model=None)
@limiter.limit("10/minute")
async def login(request: Request, response: Response, credentials: UserLogin, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.email == credentials.email))
    user = result.scalars().first()

    if not user or not await verify_password(credentials.password, user.password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if user.is_active is False:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This account has been deactivated. Contact your administrator.",
        )

    # Password is correct, but a minor's account is unusable until their
    # guardian approves — checked here (not just hidden in the UI) so
    # there's no way to sign in by hitting this endpoint directly. 403, not
    # 401: the credentials are right, the account just isn't cleared yet.
    if user.is_minor and not user.guardian_approved:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This account is awaiting guardian approval. Ask your guardian to check their SMS for the approval link.",
        )

    # MFA (§19 / SESSION_SECURITY_STATUS.md) — password is correct, but if
    # this account has MFA enabled, no access token is issued yet. A
    # short-lived pending token (5 min, distinguishable from a real session
    # token by carrying "mfaPendingUserId" instead of "userId") is the only
    # thing returned; /api/auth/verify-mfa exchanges it for the real one.
    if user.mfa_enabled:
        mfa_token = create_access_token(
            data={"mfaPendingUserId": user.id, "rememberMe": credentials.remember_me},
            expires_delta=datetime.timedelta(minutes=5),
        )
        return MfaRequiredResponse(mfa_token=mfa_token)

    # Enforce, don't just offer, for ADMIN/SUPERADMIN (SESSION_SECURITY_STATUS.md's
    # own recommendation) — an admin-tier account that hasn't enrolled yet
    # still gets a normal session (never locked out of an account they
    # haven't set MFA up on), but mfa_setup_required tells the frontend to
    # force a stop at /mfa/setup before anywhere else.
    mfa_setup_required = user.role in ADMIN_TIER_ROLES and not user.mfa_enabled
    return _issue_token_response(response, user, credentials.remember_me, mfa_setup_required)


@router.post("/verify-mfa", response_model=Token)
@limiter.limit("10/minute")
async def verify_mfa(request: Request, response: Response, payload: MfaVerifyRequest, db: AsyncSession = Depends(get_db)):
    try:
        pending = pyjwt_lib.decode(payload.mfa_token, SECRET_KEY, algorithms=[ALGORITHM])
    except Exception:
        raise HTTPException(status_code=401, detail="This sign-in attempt has expired. Please sign in again.")

    user_id = pending.get("mfaPendingUserId")
    if not user_id:
        raise HTTPException(status_code=401, detail="This sign-in attempt has expired. Please sign in again.")

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalars().first()
    if not user or not user.mfa_enabled or not user.totp_secret:
        raise HTTPException(status_code=401, detail="This sign-in attempt has expired. Please sign in again.")

    code_ok = mfa_lib.verify_totp_code(mfa_lib.decrypt_secret(user.totp_secret), payload.code)
    if not code_ok:
        # Not a valid TOTP code — try it as a backup code instead. Each
        # backup code is single-use: found and verified, it's removed from
        # the stored (hashed) list so it can never be replayed.
        codes = json.loads(user.mfa_backup_codes) if user.mfa_backup_codes else []
        matched_index = None
        for i, hashed in enumerate(codes):
            if await verify_password(payload.code.strip(), hashed):
                matched_index = i
                break
        if matched_index is None:
            raise HTTPException(status_code=401, detail="Invalid code.")
        del codes[matched_index]
        user.mfa_backup_codes = json.dumps(codes)
        await db.commit()

    return _issue_token_response(response, user, remember_me=bool(pending.get("rememberMe")))


@router.post("/mfa/enroll", response_model=MfaEnrollResponse)
async def enroll_mfa(current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Step 1 of enrollment — generates a secret and its QR code, but does
    NOT enable MFA yet (that only happens once /mfa/confirm proves the user
    actually has it working, so no one can lock themselves out with a typo'd
    scan)."""
    if current_user.mfa_enabled:
        raise HTTPException(status_code=400, detail="MFA is already enabled on this account.")
    secret = mfa_lib.generate_totp_secret()
    current_user.totp_secret = mfa_lib.encrypt_secret(secret)
    # Not committed to mfa_enabled yet — a fresh secret is fine to
    # regenerate on a repeat call to this endpoint (e.g. user re-scans),
    # it just overwrites the not-yet-confirmed one.
    await db.commit()
    uri = mfa_lib.totp_provisioning_uri(secret, current_user.email)
    return MfaEnrollResponse(qr_code_data_uri=mfa_lib.qr_code_data_uri(uri), manual_entry_key=secret)


@router.post("/mfa/confirm", response_model=MfaConfirmResponse)
async def confirm_mfa(
    payload: MfaConfirmRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if current_user.mfa_enabled:
        raise HTTPException(status_code=400, detail="MFA is already enabled on this account.")
    if not current_user.totp_secret:
        raise HTTPException(status_code=400, detail="Start enrollment first — no secret to confirm.")

    secret = mfa_lib.decrypt_secret(current_user.totp_secret)
    if not mfa_lib.verify_totp_code(secret, payload.code):
        raise HTTPException(status_code=400, detail="That code didn't match. Check your authenticator app and try again.")

    backup_codes = mfa_lib.generate_backup_codes()
    hashed_codes = [await get_password_hash(c) for c in backup_codes]
    current_user.mfa_enabled = True
    current_user.mfa_backup_codes = json.dumps(hashed_codes)
    await db.commit()

    return MfaConfirmResponse(backup_codes=backup_codes)


@router.post("/mfa/disable", status_code=status.HTTP_204_NO_CONTENT)
async def disable_mfa(
    payload: MfaDisableRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not current_user.mfa_enabled:
        raise HTTPException(status_code=400, detail="MFA is not enabled on this account.")
    if not await verify_password(payload.password, current_user.password):
        raise HTTPException(status_code=401, detail="Incorrect password.")

    code_ok = current_user.totp_secret and mfa_lib.verify_totp_code(mfa_lib.decrypt_secret(current_user.totp_secret), payload.code)
    if not code_ok:
        codes = json.loads(current_user.mfa_backup_codes) if current_user.mfa_backup_codes else []
        code_ok = any([await verify_password(payload.code.strip(), h) for h in codes])
    if not code_ok:
        raise HTTPException(status_code=401, detail="Invalid code.")

    current_user.mfa_enabled = False
    current_user.totp_secret = None
    current_user.mfa_backup_codes = None
    await db.commit()

SELF_REGISTRATION_ALLOWED_ROLES = {"PASSENGER"}

GUARDIAN_APPROVAL_TOKEN_TTL_MINUTES = 60 * 24 * 7  # a week — a guardian may not see the text right away

@router.post("/register", response_model=None)
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

    # Passengers can go phone-first: a phone number is required (it's the
    # reset channel — see forgot_password_phone below), a real email is
    # optional. Staff/admin-provisioned accounts (never hit this endpoint,
    # see the role check above) are untouched.
    normalized_phone = credentials.phone.strip() if credentials.phone else None
    if credentials.role == "PASSENGER" and not normalized_phone:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A phone number is required to register.",
        )

    # Minor/student self-registration requires a guardian on record before
    # the account can be used at all — see login()'s gate below. All four
    # fields are required (not just guardian_name + phone) per the consent
    # record this is meant to be, not just a contact for notifications.
    is_minor = bool(credentials.is_minor)
    guardian_name = (credentials.guardian_name or "").strip()
    guardian_phone = (credentials.guardian_phone or "").strip()
    guardian_relationship = (credentials.guardian_relationship or "").strip()
    guardian_id_number = (credentials.guardian_id_number or "").strip()
    if is_minor and not (guardian_name and guardian_phone and guardian_relationship and guardian_id_number):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Guardian name, phone, relationship, and ID number are all required for a student/minor account.",
        )

    email = credentials.email
    if not email:
        # Synthetic, internal-only placeholder — never used to actually
        # email anyone (no email-sending capability exists in this
        # deployment) — it only exists so User.email stays NOT NULL/unique
        # for every other consumer without a schema-wide change.
        digits = re.sub(r"[^0-9]", "", normalized_phone or "")
        email = f"{digits}@phone.matatu-mms.internal"

    # Check if user with email or phone already exists
    existing = await db.execute(select(User).where(User.email == email))
    if existing.scalars().first():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User email already registered"
        )
    if normalized_phone:
        existing_phone = await db.execute(select(User).where(User.phone == normalized_phone))
        if existing_phone.scalars().first():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="That phone number is already registered"
            )

    import uuid
    new_id = f"u-{uuid.uuid4().hex[:8]}"

    hashed_pwd = await get_password_hash(credentials.password)

    guardian_approval_token = None
    guardian_approval_token_expires_at = None
    if is_minor:
        guardian_approval_token = secrets.token_urlsafe(32)
        guardian_approval_token_expires_at = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(
            minutes=GUARDIAN_APPROVAL_TOKEN_TTL_MINUTES
        )

    user = User(
        id=new_id,
        name=credentials.name,
        email=email,
        phone=normalized_phone,
        password=hashed_pwd,
        role=credentials.role,
        sacco_id=credentials.sacco_id,
        terms_accepted=True,
        terms_accepted_at=datetime.datetime.now(datetime.timezone.utc),
        terms_signature=signature,
        terms_version=TERMS_VERSION,
        is_minor=is_minor,
        guardian_name=guardian_name or None,
        guardian_phone=guardian_phone or None,
        guardian_relationship=guardian_relationship or None,
        guardian_id_number=guardian_id_number or None,
        guardian_approved=False,
        guardian_approval_token=guardian_approval_token,
        guardian_approval_token_expires_at=guardian_approval_token_expires_at,
    )

    db.add(user)
    try:
        await db.commit()
    except IntegrityError:
        # The pre-check above (line ~88) is a friendly-message convenience,
        # not the real guard — two concurrent registrations for the same
        # email/phone can both pass it. The unique constraint is the actual
        # source of truth; without this, a race here surfaces as an
        # unhandled 500 instead of the intended 400.
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User email or phone number already registered"
        )
    await db.refresh(user)

    if is_minor:
        # No token, no session cookie — a minor's account cannot sign in at
        # all until the guardian approves (enforced again in login() below,
        # not just by omitting the auto-login here). The link is logged
        # server-side and also texted via send_sms; no real SMS provider is
        # configured for this deployment yet, so the log line is the actual
        # delivery channel today (see app/sms.py).
        approval_link = f"{PUBLIC_FRONTEND_URL}/guardian-approve?token={guardian_approval_token}"
        message = (
            f"{user.name} used your phone number to register a Matatu MMS account. "
            f"If you approve, confirm here: {approval_link} "
            f"(link expires in 7 days)"
        )
        logger.warning("Guardian approval requested for minor %s. Link: %s", user.id, approval_link)
        await send_sms(guardian_phone, message)
        return {
            "pendingGuardianApproval": True,
            "message": "Account created. A guardian approval request has been sent by SMS — you can sign in once your guardian approves.",
        }

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

    expires_at = _as_aware_utc(user.reset_token_expires_at)
    if datetime.datetime.now(datetime.timezone.utc) > expires_at:
        user.reset_token = None
        user.reset_token_expires_at = None
        await db.commit()
        raise HTTPException(status_code=400, detail="This reset link has expired. Please request a new one.")

    user.password = await get_password_hash(payload.new_password)
    user.reset_token = None
    user.reset_token_expires_at = None
    await db.commit()

    return {"message": "Password updated. You can now sign in with your new password."}

@router.post("/forgot-password-phone")
@limiter.limit("5/minute")
async def forgot_password_phone(request: Request, payload: PhoneForgotPasswordRequest, db: AsyncSession = Depends(get_db)):
    """
    Phone-based counterpart to /forgot-password — a short numeric OTP sent
    by SMS instead of a link sent by email. Same enumeration-safe generic
    response regardless of whether the phone number is registered.
    """
    phone = payload.phone.strip()
    result = await db.execute(select(User).where(User.phone == phone))
    user = result.scalars().first()

    if user:
        otp = f"{secrets.randbelow(1_000_000):06d}"
        expires_at = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(minutes=PHONE_OTP_TTL_MINUTES)
        user.phone_otp_code = otp
        user.phone_otp_expires_at = expires_at
        await db.commit()
        await send_sms(phone, f"Your Matatu MMS password reset code is {otp}. It expires in {PHONE_OTP_TTL_MINUTES} minutes.")

    return {"message": "If that phone number is registered, a reset code has been sent."}

@router.post("/reset-password-phone")
@limiter.limit("10/minute")
async def reset_password_phone(request: Request, payload: PhoneResetPasswordRequest, db: AsyncSession = Depends(get_db)):
    if len(payload.new_password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")

    phone = payload.phone.strip()
    otp = payload.otp.strip()
    result = await db.execute(select(User).where(User.phone == phone, User.phone_otp_code == otp))
    user = result.scalars().first()
    if not user or not user.phone_otp_expires_at:
        raise HTTPException(status_code=400, detail="Invalid or incorrect code")

    expires_at = _as_aware_utc(user.phone_otp_expires_at)
    if datetime.datetime.now(datetime.timezone.utc) > expires_at:
        user.phone_otp_code = None
        user.phone_otp_expires_at = None
        await db.commit()
        raise HTTPException(status_code=400, detail="This code has expired. Please request a new one.")

    user.password = await get_password_hash(payload.new_password)
    user.phone_otp_code = None
    user.phone_otp_expires_at = None
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
