from decimal import Decimal
from typing import Annotated
from pydantic import PlainSerializer

# Money on the wire (Readiness List §15).
#
# Decimal everywhere in Python — parsing, arithmetic, storage — because
# binary floating point cannot represent 0.10 and a system that adds up
# money in floats eventually disagrees with the bank by a few cents nobody
# can account for.
#
# Serialised to a JSON *number* rather than Pydantic v2's default string,
# because the three frontends already treat these as numbers and switching
# to strings would be a silent breaking change across every currency
# display in the product.
#
# That last step is safe, specifically: a two-decimal value below ~9x10^15
# is exactly representable in float64, and JSON numbers become IEEE754
# doubles in JavaScript no matter what we emit. The hazard of float is
# arithmetic, and by this point all arithmetic is done — this is the final
# render boundary, not a calculation.
MoneyKES = Annotated[
    Decimal,
    PlainSerializer(lambda v: float(v) if v is not None else None,
                    return_type=float, when_used="json"),
]


import datetime
import re
from typing import Optional, List
from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator
from pydantic.alias_generators import to_camel

# Kenyan plates are like "KDA 112B" — letters/digits/space/hyphen only, kept
# generous on length rather than modelling the exact format, since the point
# is blocking injection (angle brackets, quotes, script content) at the API
# boundary, not being the plate-format authority. GisMap.tsx renders this
# value via a DOM API that can't execute markup either way (defense in
# depth — see that file's comment on why innerHTML was removed there).
REG_NUMBER_PATTERN = re.compile(r"^[A-Z0-9\- ]{4,12}$")

def validate_reg_number(value: str) -> str:
    v = value.strip().upper()
    if not REG_NUMBER_PATTERN.match(v):
        raise ValueError("Registration number must be 4-12 characters: letters, digits, spaces, or hyphens only.")
    return v

class BaseModelCamel(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        from_attributes=True
    )

def _normalized_email_validator():
    """Shared 'before' validator: lowercase + strip email at the schema
    boundary, once, so no call site can forget. Postgres uniqueness on
    User.email is case-sensitive, so without this, "John@x.com" and
    "john@x.com" register as two different accounts, and login silently
    fails for anyone who signed up with one casing and later types another.
    """
    def _normalize(cls, v):
        return v.strip().lower() if isinstance(v, str) else v
    return field_validator("email", mode="before")(classmethod(_normalize))

# --- Sacco Schemas ---
class SaccoBase(BaseModelCamel):
    name: str

class SaccoCreate(SaccoBase):
    id: str

class SaccoOfficialContact(BaseModelCamel):
    chairperson_name: str
    chairperson_phone: str
    secretary_name: str
    secretary_phone: str
    treasurer_name: str
    treasurer_phone: str

class SaccoDocuments(BaseModelCamel):
    registration_certificate: str
    road_service_license: str
    county_permit: str
    single_business_permit: str
    bonafide_officials_contacts: SaccoOfficialContact

class SaccoPublicResponse(BaseModelCamel):
    """Minimal, non-sensitive Sacco fields safe to expose without authentication
    (e.g. populating the operator picker on the pre-login registration page)."""
    id: str
    name: str

class SaccoResponse(SaccoBase):
    id: str
    status: Optional[str] = "ACTIVE"
    license_status: Optional[str] = "ACTIVE"
    primary_route_id: Optional[str] = "route-1"
    secondary_route_ids: Optional[List[str]] = ["route-2", "route-3"]
    documents: Optional[SaccoDocuments] = None
    rejection_reason: Optional[str] = None
    sacco_type: Optional[str] = "EXISTING"
    created_at: Optional[datetime.datetime] = None
    application_submitted_at: Optional[datetime.datetime] = None
    doc_registration_cert: Optional[str] = None
    doc_road_service_license: Optional[str] = None
    doc_county_permit: Optional[str] = None
    doc_single_business_permit: Optional[str] = None
    doc_officials_contacts: Optional[str] = None
    doc_tax_compliance_cert: Optional[str] = None
    doc_fare_chart: Optional[str] = None
    doc_letter_no_objection: Optional[str] = None
    director_mobility_status: Optional[str] = "PENDING"
    director_mobility_reason: Optional[str] = None
    director_mobility_decided_by: Optional[str] = None
    director_mobility_decided_at: Optional[datetime.datetime] = None
    chief_officer_status: Optional[str] = "PENDING"
    chief_officer_reason: Optional[str] = None
    chief_officer_decided_by: Optional[str] = None
    chief_officer_decided_at: Optional[datetime.datetime] = None
    shadow_contact_name: Optional[str] = None
    shadow_contact_phone: Optional[str] = None
    shadow_source: Optional[str] = None
    compliance_deadline: Optional[datetime.datetime] = None
    invited_at: Optional[datetime.datetime] = None

class SaccoVerificationUpdate(BaseModelCamel):
    status: str  # ACTIVE or REJECTED
    reason: Optional[str] = None

class ShadowSaccoCreate(BaseModelCamel):
    name: str
    contact_name: Optional[str] = None
    contact_phone: str
    compliance_deadline: Optional[datetime.datetime] = None
    primary_route_id: Optional[str] = None

class ShadowSaccoBulkCreate(BaseModelCamel):
    entries: List[ShadowSaccoCreate]

class ComplianceFunnelEntry(BaseModelCamel):
    id: str
    name: str
    status: str
    contact_phone: Optional[str] = None
    compliance_deadline: Optional[datetime.datetime] = None
    days_remaining: Optional[int] = None
    invited_at: Optional[datetime.datetime] = None

class ComplianceFunnelResponse(BaseModelCamel):
    unregistered: int
    invited: int
    pending_verification: int
    active: int
    rejected_or_suspended: int
    entries: List[ComplianceFunnelEntry]

class LicenseRenewalDecision(BaseModelCamel):
    approve: bool

class OperatorOnboardingRegister(BaseModelCamel):
    """Self-service Sacco onboarding: creates a new Sacco (in PENDING
    verification) and the first SACCO_OPERATOR account for it, in one step.
    """
    sacco_name: str
    sacco_type: str  # NEW or EXISTING
    name: str  # applicant's full name
    email: EmailStr
    password: str
    terms_accepted: Optional[bool] = False
    terms_signature: Optional[str] = None

    _normalize_email = _normalized_email_validator()

class SaccoOfficialsUpdate(BaseModelCamel):
    chairperson_name: str
    chairperson_phone: str
    secretary_name: str
    secretary_phone: str
    treasurer_name: str
    treasurer_phone: str

class VerificationStageDecision(BaseModelCamel):
    status: str  # APPROVED or REJECTED
    reason: Optional[str] = None

# --- User Schemas ---
class UserBase(BaseModelCamel):
    name: str
    email: EmailStr
    role: str  # ADMIN, ENFORCEMENT, SACCO_OPERATOR, VIEWER, PASSENGER, CREW
    sacco_id: Optional[str] = None

    _normalize_email = _normalized_email_validator()

class UserCreate(UserBase):
    # Overrides UserBase.email (required) — passenger self-registration can
    # go phone-first and skip email; register() synthesizes a placeholder
    # so the DB's NOT NULL/unique constraint (shared with every other user
    # type) never sees the gap. Admin-provisioned staff accounts still send
    # a real email as before; this override only widens what's *accepted*.
    email: Optional[EmailStr] = None
    phone: Optional[str] = None
    password: str
    # Only required on self-registration (/api/auth/register), not when an
    # Admin provisions an account directly — see that endpoint's validation.
    terms_accepted: Optional[bool] = False
    terms_signature: Optional[str] = None
    # Minor/student self-registration only — register() validates these are
    # all present when is_minor is true and ignores them otherwise.
    is_minor: Optional[bool] = False
    # Same optional/inert-until-configured field as UserLogin — only
    # meaningful for the one caller that's actually a public, unauthenticated
    # self-registration (routes/auth.py's register()); create_user() (the
    # admin/commander-facing endpoint) never checks it.
    turnstile_token: Optional[str] = None
    guardian_name: Optional[str] = None
    guardian_phone: Optional[str] = None
    guardian_relationship: Optional[str] = None
    guardian_id_number: Optional[str] = None

class UserResponse(UserBase):
    id: str
    # Set (transiently, not a real column — see User model) only when a
    # PATCH's role field was deferred into a two-person-approval request
    # rather than applied, so the frontend can tell "nothing changed" apart
    # from "waiting on a second Super Admin."
    pending_role_grant_id: Optional[int] = None
    phone: Optional[str] = None
    terms_accepted: Optional[bool] = False
    terms_accepted_at: Optional[datetime.datetime] = None
    is_minor: Optional[bool] = False
    guardian_approved: Optional[bool] = False
    terms_signature: Optional[str] = None
    is_active: Optional[bool] = True
    favorite_sacco_id: Optional[str] = None
    # Raw JSON string (same pass-through convention as the Sacco doc-JSON
    # fields elsewhere in this file) — the frontend parses it. Empty/null
    # means "just the role's own permissions."
    extra_permissions: Optional[str] = None
    # Raw JSON string of additional predefined role names layered on top of
    # `role` (app/rbac.py's ROLE_MATRIX keys) — same pass-through convention
    # as extra_permissions above. Empty/null means "just the primary role."
    additional_roles: Optional[str] = None
    # Shared by exactly two accounts (one driver, one conductor) — see
    # models.py's User.crew_number. Null for every non-CREW account.
    crew_number: Optional[str] = None

class UserUpdate(BaseModelCamel):
    name: Optional[str] = None
    email: Optional[EmailStr] = None
    role: Optional[str] = None
    sacco_id: Optional[str] = None
    new_password: Optional[str] = None
    is_active: Optional[bool] = None
    # Individual permission grants on top of the role — Super Admin only
    # (routes/users.py). Omit the field entirely to leave unchanged; pass
    # an explicit list (including []) to replace it.
    extra_permissions: Optional[List[str]] = None
    # Additional predefined roles on top of the primary role — Super Admin
    # only (routes/users.py), same omit/replace semantics as
    # extra_permissions. Each entry must be a key in rbac.ROLE_MATRIX.
    additional_roles: Optional[List[str]] = None

class FavoriteSaccoRequest(BaseModelCamel):
    sacco_id: Optional[str] = None  # null clears the favorite

class RefreshTokenResponse(BaseModelCamel):
    access_token: str

class UserLogin(BaseModel):
    # Named "email" for wire-compatibility with every existing frontend
    # login form (staff, public, ops console all POST {email, password}) —
    # but it's really "identifier" now: login() tries it as an email, then
    # a phone number, then a crew_number (crew accounts can be reached by
    # any of the three). Plain str rather than EmailStr since a phone
    # number or crew number ("UMO001") would fail EmailStr validation
    # before the request body even reaches the endpoint.
    email: str
    password: str
    remember_me: bool = False
    # Optional — only meaningful once TURNSTILE_SECRET_KEY is configured
    # (app/turnstile.py); absent or ignored otherwise, so no existing
    # caller (including this suite's own tests) needs to send it.
    turnstile_token: Optional[str] = None

    @field_validator("email", mode="before")
    @classmethod
    def _normalize_identifier(cls, v):
        return v.strip() if isinstance(v, str) else v

# --- Crew Assignment Schemas ---
class CrewIssueRequest(BaseModelCamel):
    """Operator-issued crew login + vehicle assignment in one call
    (ARCHITECTURE_DECISIONS.md §29.1). No client-supplied password —
    the server generates one and returns it exactly once.

    Phone-first: phone is the crew member's real login identifier (they may
    never see or use the email at all), so it's required. Email is now
    optional — if omitted, a synthetic placeholder is generated the same
    way passenger phone-first registration does (see routes/auth.py's
    register()), purely so User.email stays NOT NULL/unique.
    """
    name: str
    email: Optional[EmailStr] = None
    phone: str
    license_number: Optional[str] = None
    matatu_id: str
    crew_role: str  # DRIVER, CONDUCTOR

    _normalize_email = _normalized_email_validator()

    @field_validator("crew_role")
    @classmethod
    def _validate_crew_role(cls, v: str) -> str:
        v = v.strip().upper()
        if v not in ("DRIVER", "CONDUCTOR"):
            raise ValueError("crew_role must be DRIVER or CONDUCTOR")
        return v

class CrewAssignmentResponse(BaseModelCamel):
    id: str
    user_id: str
    matatu_id: str
    crew_role: str
    assigned_at: datetime.datetime
    unassigned_at: Optional[datetime.datetime] = None
    user_name: str
    user_email: str
    user_phone: Optional[str] = None
    crew_number: Optional[str] = None
    matatu_reg_number: str

class CrewIssueResponse(BaseModelCamel):
    assignment: CrewAssignmentResponse
    generated_password: str
    # Surfaced at the top level too (not just inside `assignment`) since
    # it's the thing the operator most needs to hand the crew member,
    # alongside the password — same reasoning as generated_password.
    crew_number: str

class CrewAlertRequest(BaseModelCamel):
    message: str
    matatu_id: Optional[str] = None  # omit to alert every active crew member in the fleet

class ForgotPasswordRequest(BaseModelCamel):
    email: EmailStr
    turnstile_token: Optional[str] = None

    _normalize_email = _normalized_email_validator()

class PhoneForgotPasswordRequest(BaseModelCamel):
    phone: str

class PhoneResetPasswordRequest(BaseModelCamel):
    phone: str
    otp: str
    new_password: str

class ResetPasswordRequest(BaseModelCamel):
    token: str
    new_password: str

class GuardianApprovalInfo(BaseModelCamel):
    """What the guardian sees on the approval page before confirming —
    deliberately minimal (no password, no phone, no other account details)
    since this link requires no login and could be opened by anyone who
    has it."""
    minor_name: str
    guardian_name: str

class GuardianApproveRequest(BaseModelCamel):
    token: str

class Token(BaseModelCamel):
    access_token: str
    token_type: str
    user: UserResponse
    # True once, right after a successful login, when this account's role
    # requires MFA (ADMIN/SUPERADMIN) but hasn't enrolled yet. The frontend
    # forces a stop at /mfa/setup before anywhere else — this is the
    # "enforce, don't just offer" path from SESSION_SECURITY_STATUS.md
    # without locking anyone out of an account they haven't set MFA up on.
    mfa_setup_required: bool = False
    # Echoed back so a second-step client (the MFA verify page, which has
    # no other way to know what was chosen on the *first* step's login
    # form) can apply the same session-cookie maxAge the backend already
    # used for this token's own expiry — otherwise a remember-me user who
    # has MFA enabled gets a 30-day JWT wrapped in an 8-hour cookie, which
    # silently defeats "remember me" the moment the cookie expires first.
    remember_me: bool = False

class MfaRequiredResponse(BaseModelCamel):
    """Returned instead of Token when the account has MFA enabled — no
    access token is issued until /api/auth/verify-mfa succeeds."""
    mfa_required: bool = True
    mfa_token: str

class MfaEnrollResponse(BaseModelCamel):
    qr_code_data_uri: str
    manual_entry_key: str  # for "can't scan the code" — typed in by hand

class MfaConfirmRequest(BaseModelCamel):
    code: str

class MfaConfirmResponse(BaseModelCamel):
    backup_codes: List[str]  # shown exactly once — not retrievable again

class MfaDisableRequest(BaseModelCamel):
    password: str
    code: str  # a live TOTP code or an unused backup code

class MfaVerifyRequest(BaseModelCamel):
    mfa_token: str
    code: str

# --- Route Schemas ---
class RouteBase(BaseModelCamel):
    code: str
    name: str
    description: Optional[str] = None
    fare_kes: Optional[MoneyKES] = Decimal('100.00')

class RouteCreate(RouteBase):
    id: str

class RouteResponse(RouteBase):
    id: str
    vehicle_count: Optional[int] = 0

class RouteStageResponse(BaseModelCamel):
    stage_id: str
    name: str
    sequence: int

class RouteGeometryPoint(BaseModelCamel):
    lat: float
    lng: float

class RouteGeometryResponse(BaseModelCamel):
    """One route's drawable line for the network map (components/dashboard/
    RouteNetworkMap.tsx) — its geocoded OUTBOUND stage sequence, in order.
    `color` is assigned server-side so every client renders the same route
    in the same color without duplicating the palette logic."""
    id: str
    code: str
    name: str
    corridor: Optional[str] = None
    color: str
    points: List[RouteGeometryPoint]

# --- Trip Schemas ---
class TripActivateRequest(BaseModelCamel):
    matatu_id: str
    origin_stage_id: str
    destination_stage_id: str

class TripCompleteRequest(BaseModelCamel):
    # Optional, never forced — crew's own estimate of how many passengers
    # rode this trip. Omitted entirely (not zero) means "not logged," which
    # is exactly how it's stored and read back (see models.py's Trip.
    # passenger_count comment).
    passenger_count: Optional[int] = None

class TripResponse(BaseModelCamel):
    id: str
    matatu_id: str
    reg_number: str
    route_id: str
    route_name: str
    origin_stage_id: str
    origin_stage_name: str
    destination_stage_id: str
    destination_stage_name: str
    status: str
    started_at: datetime.datetime
    departed_at: Optional[datetime.datetime] = None
    ended_at: Optional[datetime.datetime] = None
    passenger_count: Optional[int] = None

class QueueStatusResponse(BaseModelCamel):
    my_trip_id: Optional[str] = None
    position: Optional[int] = None  # 1-indexed; vehicles ahead = position - 1
    vehicles_ahead: Optional[int] = None
    queued_at_stage: int  # total QUEUED vehicles at this stage+route (any Sacco)
    active_on_route: int  # total IN_PROGRESS vehicles anywhere on this route (any Sacco)

# --- Fare Stage Schemas ---
class FareStageCreate(BaseModelCamel):
    from_label: str
    to_label: str
    fare_kes: MoneyKES
    direction: Optional[str] = None
    from_stage_id: Optional[str] = None
    to_stage_id: Optional[str] = None

class FareStageResponse(BaseModelCamel):
    id: str
    route_id: str
    from_stage_id: Optional[str] = None
    to_stage_id: Optional[str] = None
    from_label: str
    to_label: str
    fare_kes: MoneyKES
    direction: Optional[str] = None
    source: str
    created_at: datetime.datetime

class FareStageUploadResult(BaseModelCamel):
    created: List[FareStageResponse]
    unmatched_rows: int
    total_rows: int

# --- Matatu Schemas ---
class MatatuBase(BaseModelCamel):
    reg_number: str
    sacco_id: str
    route_id: str
    terminal_segment: Optional[str] = "CBD Central Terminal: Main Stage"
    capacity: int
    driver_name: Optional[str] = None
    driver_license: Optional[str] = None
    driver_phone: Optional[str] = None
    conductor_name: Optional[str] = None
    conductor_license: Optional[str] = None
    conductor_phone: Optional[str] = None

class MatatuCreate(MatatuBase):
    status: Optional[str] = "ACTIVE"

    @field_validator("reg_number")
    @classmethod
    def _validate_reg_number(cls, v: str) -> str:
        return validate_reg_number(v)

class MatatuResponse(MatatuBase):
    id: str
    status: str
    last_inspection: Optional[str] = None
    created_at: datetime.datetime
    sacco: Optional[SaccoResponse] = None
    route: Optional[RouteResponse] = None

class BulkImportRowError(BaseModelCamel):
    row: int
    reg_number: Optional[str] = None
    missing_fields: List[str] = []
    message: str

class BulkImportResult(BaseModelCamel):
    created: List[MatatuResponse]
    errors: List[BulkImportRowError]
    total_rows: int

class MatatuStatusUpdate(BaseModelCamel):
    status: str

# --- Activity Log Schemas ---
class ActivityLogBase(BaseModelCamel):
    matatu_id: str
    type: str  # TRIP, INSPECTION, INCIDENT
    description: str
    location: str

class ActivityLogCreate(ActivityLogBase):
    pass

class ActivityLogResponse(ActivityLogBase):
    id: str
    officer_id: str
    timestamp: datetime.datetime

# --- Crime Record Schemas ---
class CrimeRecordBase(BaseModelCamel):
    offence_committed: str
    reg_number: str
    driver_name: str
    driver_license: str
    location: str
    fine_amount_kes: MoneyKES = Decimal('0.00')
    remarks: Optional[str] = None

class CrimeRecordResponse(CrimeRecordBase):
    id: str
    officer_id: str
    officer_name: Optional[str] = None
    timestamp: datetime.datetime
    status: str
    photo_path: Optional[str] = None

# --- Fine Schemas ---
class FineBase(BaseModelCamel):
    matatu_id: str
    reason: str
    amount_kes: MoneyKES
    due_date: datetime.date  # a calendar date — Pydantic parses "YYYY-MM-DD" from the frontend directly

class FineCreate(FineBase):
    # No override needed any more: FineBase.amount_kes is MoneyKES, so input
    # is exact Decimal and output is a JSON number. The float that used to
    # live on the base class was the actual corruption path — money was
    # already inexact before it reached the Numeric column or the ledger.
    pass

class FineResponse(FineBase):
    id: str
    officer_id: str
    status: str
    issued_at: datetime.datetime
    reg_number: Optional[str] = None
    sacco_id: Optional[str] = None

class FineStatusUpdate(BaseModelCamel):
    status: str

# --- Booking Schemas ---
class BookingCreate(BaseModelCamel):
    matatu_id: str
    route_id: str
    passenger_name: str
    phone: str
    stage_name: str
    seat_numbers: List[int]
    accessibility_flag: bool = False

class BookingStatusUpdate(BaseModelCamel):
    status: str  # CONFIRMED, USED, CANCELLED

class BookingResponse(BaseModelCamel):
    id: str
    matatu_id: str
    route_id: str
    passenger_name: str
    phone: str
    stage_name: str
    seat_numbers: List[int]
    fare_kes: MoneyKES
    status: str
    booked_at: datetime.datetime
    accessibility_flag: bool = False
    reg_number: Optional[str] = None
    route_name: Optional[str] = None

# --- Passenger Report Schemas ---
class PassengerReportStatusUpdate(BaseModelCamel):
    status: str  # PENDING, REVIEWED, ESCALATED, DISMISSED

class PassengerReportResponse(BaseModelCamel):
    id: str
    matatu_reg_number: Optional[str] = None
    category: str
    message: str
    reporter_name: Optional[str] = None
    reporter_phone: Optional[str] = None
    photo_path: Optional[str] = None
    status: str
    created_at: datetime.datetime

# --- Audit Log Schemas ---
class AuditLogResponse(BaseModelCamel):
    id: int
    resource_type: str
    resource_id: str
    action: str
    old_values: Optional[str] = None
    new_values: Optional[str] = None
    user_id: str
    timestamp: datetime.datetime

class LoginEventResponse(BaseModelCamel):
    id: int
    user_id: Optional[str] = None
    email: Optional[str] = None
    event_type: str
    reason: Optional[str] = None
    ip_address: Optional[str] = None
    user_agent: Optional[str] = None
    created_at: datetime.datetime

FEATURE_FLAG_KEY_PATTERN = r"^[a-z][a-z0-9_]{2,63}$"

class FeatureFlagResponse(BaseModelCamel):
    key: str
    description: Optional[str] = None
    enabled: bool
    updated_by: Optional[str] = None
    updated_at: datetime.datetime
    scheduled_enable_at: Optional[datetime.datetime] = None
    scheduled_disable_at: Optional[datetime.datetime] = None

class FeatureFlagCreate(BaseModelCamel):
    key: str
    description: Optional[str] = None
    enabled: bool = False

    @field_validator("key")
    @classmethod
    def _validate_key(cls, v: str) -> str:
        if not re.match(FEATURE_FLAG_KEY_PATTERN, v):
            raise ValueError("Key must be lowercase snake_case, 3-64 chars, starting with a letter (e.g. impersonation_enabled)")
        return v

class FeatureFlagUpdate(BaseModelCamel):
    description: Optional[str] = None
    enabled: Optional[bool] = None
    # Explicit null clears a pending schedule — only applied when the field
    # is present in the request body at all (see update_feature_flag's use
    # of model_dump(exclude_unset=True)), so a request that omits these
    # entirely never touches an existing schedule.
    scheduled_enable_at: Optional[datetime.datetime] = None
    scheduled_disable_at: Optional[datetime.datetime] = None

class JobSummaryResponse(BaseModelCamel):
    """One ARQ job (app/routes/jobs.py) — queued, in-progress, or complete
    (success or failure). start_time/finish_time/success/result_preview are
    only populated once a job has actually run."""
    job_id: str
    function: str
    status: str  # "queued" | "deferred" | "in_progress" | "complete" | "not_found"
    enqueue_time: datetime.datetime
    # None for a job that hasn't been picked up by the worker yet — arq
    # only sets job_try once a worker actually starts a run.
    job_try: Optional[int] = None
    start_time: Optional[datetime.datetime] = None
    finish_time: Optional[datetime.datetime] = None
    success: Optional[bool] = None
    result_preview: Optional[str] = None

class UserActivityResponse(BaseModelCamel):
    """Per-user Activity tab (OPS_CONSOLE_AND_USER_ACTIVITY_SPEC.md Part
    B.2) — login history (once captured, see LoginEvent) plus this
    account's own AuditLog rows, composed on one screen since that's the
    one audience/one question this pairing actually answers. Deliberately
    not a generic cross-source feed — see that doc's "what not to build."
    """
    login_events: List[LoginEventResponse]
    audit_logs: List[AuditLogResponse]

class PrivilegedLoginResponse(BaseModelCamel):
    id: int
    user_id: str
    user_name: str
    ip_address: Optional[str] = None
    created_at: datetime.datetime
    # True if this is the first time this IP has been seen for this user
    # across their whole LOGIN_SUCCESS history — a real, if simple, signal:
    # "this privileged account is signing in from somewhere new."
    is_new_ip: bool

class FailedLoginBurstResponse(BaseModelCamel):
    email: str
    count: int
    last_attempt_at: datetime.datetime

class ImpersonateStartResponse(BaseModelCamel):
    ticket: str

class ImpersonateConsumeRequest(BaseModelCamel):
    ticket: str

class ImpersonateSessionResponse(BaseModelCamel):
    """Returned by both /impersonate/consume (starting) and /impersonate/stop
    (ending) — impersonator_id/impersonator_name are only populated on the
    former, since after /stop the caller is back to being themselves."""
    access_token: str
    user: UserResponse
    impersonator_id: Optional[str] = None
    impersonator_name: Optional[str] = None

class LoginOverviewResponse(BaseModelCamel):
    """Cross-account "who's logged in"/anomaly view for the ops console
    (OPS_CONSOLE_AND_USER_ACTIVITY_SPEC.md A.3/B.2) — Tier-1 read-only.
    Two real signals, not a fabricated risk score: a privileged account
    logging in from an IP it's never used before, and an email with
    several failed attempts in a short window."""
    recent_privileged_logins: List[PrivilegedLoginResponse]
    failed_login_bursts: List[FailedLoginBurstResponse]

# --- Zones & Offence Catalog ---
class ZoneResponse(BaseModelCamel):
    id: str
    name: str
    description: Optional[str] = None
    # Added alongside the PTCU sector/zone hierarchy. All optional so every
    # existing caller of this schema (and the four legacy corridor zones,
    # which have no sector and no geography) keeps working unchanged.
    sector_id: Optional[str] = None
    sector_code: Optional[str] = None
    sector_name: Optional[str] = None
    code: Optional[str] = None
    center_lat: Optional[float] = None
    center_lng: Optional[float] = None
    boundary_geojson: Optional[str] = None
    display_order: int = 0
    is_active: bool = True
    officer_count: int = 0

class OffenceTypeResponse(BaseModelCamel):
    id: str
    name: str
    default_fine_kes: MoneyKES
    is_other: bool

class OfficerAssignmentUpdate(BaseModelCamel):
    enforcement_duty: Optional[str] = None  # ARRESTING, RELEASING, or null to clear
    assigned_zone_id: Optional[str] = None
    commander_title: Optional[str] = None

class OfficerAssignmentResponse(BaseModelCamel):
    id: str
    name: str
    email: str
    role: str
    enforcement_duty: Optional[str] = None
    assigned_zone_id: Optional[str] = None
    commander_title: Optional[str] = None

# --- Beats (ARCHITECTURE_DECISIONS.md §22) ---
class BeatCreate(BaseModelCamel):
    name: str
    route_id: str
    from_stage_id: str
    to_stage_id: str
    zone_id: Optional[str] = None

class BeatResponse(BaseModelCamel):
    id: str
    name: str
    route_id: str
    from_stage_id: str
    to_stage_id: str
    zone_id: Optional[str] = None
    created_at: datetime.datetime
    # Denormalized from the linked Stage rows so the enforcement live map
    # can draw a beat as a line without a second round-trip per beat. Null
    # when a stage hasn't been geocoded yet (Stage.geocoded=False) — the
    # same no-fabrication convention as everywhere else stage coordinates
    # are surfaced; the frontend just skips drawing that beat's line.
    from_lat: Optional[float] = None
    from_lng: Optional[float] = None
    to_lat: Optional[float] = None
    to_lng: Optional[float] = None

class BeatAssignmentCreate(BaseModelCamel):
    officer_id: str
    beat_id: str
    shift_date: datetime.date
    shift_start: datetime.datetime
    shift_end: datetime.datetime

class BeatAssignmentResponse(BaseModelCamel):
    id: str
    officer_id: str
    officer_name: str
    beat_id: str
    beat_name: str
    shift_date: datetime.date
    shift_start: datetime.datetime
    shift_end: datetime.datetime
    assigned_by: str
    created_at: datetime.datetime

# --- Route deviation (§1.6, §29.4) ---
class RouteDetourCreate(BaseModelCamel):
    route_id: str
    from_stage_id: str
    to_stage_id: str
    alternate_description: str

class RouteDetourResponse(BaseModelCamel):
    id: str
    route_id: str
    from_stage_id: str
    to_stage_id: str
    alternate_description: str
    active: bool
    created_at: datetime.datetime

class DeviationAlertResponse(BaseModelCamel):
    id: str
    matatu_id: str
    reg_number: str
    route_id: str
    lat: float
    lng: float
    distance_meters: float
    detected_at: datetime.datetime
    resolved: bool

# --- Enforcement Cases (Arrest -> Release workflow) ---
class EnforcementCaseCreate(BaseModelCamel):
    reg_number: str
    offence_type_id: str
    offence_description: Optional[str] = None
    action_taken: str  # IMPOUND, SELF_DRIVE_IMPOUND, TOLL

class EnforcementCaseDecision(BaseModelCamel):
    reason: Optional[str] = None
    authorized_by: Optional[str] = None  # for waivers

class CaseReviewNote(BaseModelCamel):
    author_id: str
    author_name: str
    note: str
    at: datetime.datetime

class EnforcementCaseResponse(BaseModelCamel):
    id: str
    case_reference: str
    reg_number: str
    offence_type_id: str
    offence_name: Optional[str] = None
    offence_description: Optional[str] = None
    fine_amount_kes: MoneyKES
    action_taken: str
    photo_paths: List[str] = []
    zone_id: Optional[str] = None
    zone_name: Optional[str] = None
    arresting_officer_id: str
    arresting_officer_name: Optional[str] = None
    created_at: datetime.datetime
    status: str
    payment_reference: Optional[str] = None
    paid_at: Optional[datetime.datetime] = None
    releasing_officer_id: Optional[str] = None
    releasing_officer_name: Optional[str] = None
    released_at: Optional[datetime.datetime] = None
    dispute_reason: Optional[str] = None
    disputed_at: Optional[datetime.datetime] = None
    reviewer_id: Optional[str] = None
    reviewer_name: Optional[str] = None
    review_notes: List[CaseReviewNote] = []
    resolution: Optional[str] = None
    resolution_reason: Optional[str] = None
    resolved_by_id: Optional[str] = None
    resolved_by_name: Optional[str] = None
    resolved_at: Optional[datetime.datetime] = None
    waived_reason: Optional[str] = None
    waived_authorized_by: Optional[str] = None

class PublicCaseResponse(BaseModelCamel):
    """Deliberately narrow — what an unauthenticated offender is allowed to see."""
    case_reference: str
    reg_number: str
    offence_name: Optional[str] = None
    fine_amount_kes: MoneyKES
    status: str
    created_at: datetime.datetime

class PublicDisputeCreate(BaseModelCamel):
    reason: str
    contact_phone: Optional[str] = None

class CaseAssignReviewer(BaseModelCamel):
    reviewer_id: str

class CaseNoteCreate(BaseModelCamel):
    note: str

class CaseResolve(BaseModelCamel):
    resolution: str  # UPHELD, OVERTURNED, PARTIAL
    reason: str

# --- Webhook Subscription Schemas ---
class WebhookSubscriptionCreate(BaseModelCamel):
    url: str
    sacco_id: str
    events: List[str]

class WebhookSubscriptionResponse(BaseModelCamel):
    id: int
    url: str
    sacco_id: str
    events: str
    active: bool

class WebhookSecretResponse(BaseModelCamel):
    """Returned only from create/rotate — WebhookSubscriptionResponse never
    includes the secret, even though (unlike ApiClient's hashed secret) it
    is stored in plaintext server-side, since signing every delivery needs
    the real value, not just something to hash-compare against."""
    id: int
    secret: str
    warning: str = "Copy this secret now — it will not be shown again on this screen."

class WebhookSubscriptionCreateResponse(WebhookSubscriptionResponse):
    secret: str
    warning: str = "Copy this secret now — it will not be shown again on this screen."

# --- Webhook Log Schemas ---
class WebhookLogResponse(BaseModelCamel):
    id: int
    subscription_id: int
    event_type: str
    payload: str
    status_code: Optional[int] = None
    error_message: Optional[str] = None
    attempt: int
    timestamp: datetime.datetime

class MatatuDetailResponse(MatatuResponse):
    activities: List[ActivityLogResponse] = []
    fines: List[FineResponse] = []

# --- Dashboard Stats Schemas ---
class DashboardStats(BaseModelCamel):
    total_fleet: int
    flagged_vehicles: int
    impounded_vehicles: int
    pending_fines_count: int
    pending_fines_value: float
    recent_activity: List[ActivityLogResponse]

# --- Analytics rollups (ARCHITECTURE_DECISIONS.md §23.3) ---
class TimeseriesPoint(BaseModelCamel):
    bucket: datetime.date
    count: int
    value: float

class TimeseriesResponse(BaseModelCamel):
    metric: str
    grouping: str
    points: List[TimeseriesPoint]

# --- PTCU duty allocation: sectors, postings, status, broadcasts ---
# Modelled on the county's real monthly "ALLOCATION OF DUTY" sheet — see
# app/models.py's Sector/DutyAllocation docstrings for why each of these
# exists rather than being folded into the older Beat/BeatAssignment pair.

class SectorUpsert(BaseModelCamel):
    code: str = Field(min_length=1, max_length=10)
    name: str = Field(min_length=2, max_length=200)
    description: Optional[str] = None
    commander_id: Optional[str] = None
    deputy_commander_id: Optional[str] = None
    contact_phone: Optional[str] = None
    center_lat: Optional[float] = None
    center_lng: Optional[float] = None
    boundary_geojson: Optional[str] = None
    display_order: int = 0

class SectorResponse(BaseModelCamel):
    id: str
    code: str
    name: str
    description: Optional[str] = None
    commander_id: Optional[str] = None
    commander_name: Optional[str] = None
    deputy_commander_id: Optional[str] = None
    deputy_commander_name: Optional[str] = None
    contact_phone: Optional[str] = None
    center_lat: Optional[float] = None
    center_lng: Optional[float] = None
    boundary_geojson: Optional[str] = None
    display_order: int = 0
    is_active: bool = True
    zone_count: int = 0
    # Officers posted to this sector or any zone under it, in whichever
    # allocation the caller asked about — the number a commander actually
    # wants when looking at a sector tile.
    officer_count: int = 0

class ZoneUpsert(BaseModelCamel):
    name: str = Field(min_length=2, max_length=200)
    description: Optional[str] = None
    sector_id: Optional[str] = None
    code: Optional[str] = None
    center_lat: Optional[float] = None
    center_lng: Optional[float] = None
    boundary_geojson: Optional[str] = None
    display_order: int = 0

class OfficerDutyStatusUpdate(BaseModelCamel):
    """The sheet's "ON DUTY (OFF DUTY & LEAVE SPECIFY DATES)" column."""
    duty_status: str  # ON_DUTY, OFF_DUTY, LEAVE, SICK, SUSPENDED, TRAINING
    duty_status_from: Optional[datetime.date] = None
    duty_status_until: Optional[datetime.date] = None
    duty_status_note: Optional[str] = None

class OfficerServiceUpdate(BaseModelCamel):
    """Service-record fields as printed: MAN. NO, RANK, GENDER."""
    manpower_no: Optional[str] = None
    rank: Optional[str] = None
    gender: Optional[str] = None
    can_release_cases: Optional[bool] = None

class OfficerRosterResponse(BaseModelCamel):
    """One officer as the roster shows them — service record, current duty
    status, and where they are posted in the allocation being viewed."""
    id: str
    name: str
    email: str
    phone: Optional[str] = None
    role: str
    manpower_no: Optional[str] = None
    rank: Optional[str] = None
    gender: Optional[str] = None
    duty_status: str = "ON_DUTY"
    duty_status_from: Optional[datetime.date] = None
    duty_status_until: Optional[datetime.date] = None
    duty_status_note: Optional[str] = None
    enforcement_duty: Optional[str] = None
    commander_title: Optional[str] = None
    can_release_cases: bool = False
    is_active: bool = True
    # Present only when the roster was queried within an allocation.
    assignment_id: Optional[str] = None
    sector_id: Optional[str] = None
    sector_code: Optional[str] = None
    zone_id: Optional[str] = None
    zone_name: Optional[str] = None
    work_station: Optional[str] = None
    shift: Optional[str] = None
    coverage: Optional[str] = None
    posting_role: Optional[str] = None

class DutyAllocationCreate(BaseModelCamel):
    year: int = Field(ge=2020, le=2100)
    month: int = Field(ge=1, le=12)
    reference_no: Optional[str] = None
    title: Optional[str] = None
    notes: Optional[str] = None
    # Copy every posting from the most recent published allocation. Month
    # to month a duty sheet changes in the margins, not wholesale — the
    # real workflow is "last month's sheet, amended", and starting from a
    # blank page for 153 officers is how a system gets abandoned for Word.
    copy_from_allocation_id: Optional[str] = None

class DutyAllocationResponse(BaseModelCamel):
    id: str
    year: int
    month: int
    reference_no: Optional[str] = None
    title: Optional[str] = None
    status: str
    notes: Optional[str] = None
    created_by: str
    created_by_name: Optional[str] = None
    created_at: datetime.datetime
    published_by: Optional[str] = None
    published_by_name: Optional[str] = None
    published_at: Optional[datetime.datetime] = None
    assignment_count: int = 0
    # The sheet's own footer: MALE ON DUTY / FEMALE ON DUTY / SECTION TOTAL.
    male_on_duty: int = 0
    female_on_duty: int = 0
    total_assigned: int = 0

class DutyAssignmentCreate(BaseModelCamel):
    officer_id: str
    work_station: str = Field(min_length=1, max_length=200)
    sector_id: Optional[str] = None
    zone_id: Optional[str] = None
    shift: str = "DAY"          # DAY, NOON, NIGHT
    coverage: str = "DAILY"     # DAILY, WEEKDAY, WEEKEND
    effective_from: Optional[datetime.date] = None
    effective_to: Optional[datetime.date] = None
    posting_role: Optional[str] = None
    notes: Optional[str] = None

class DutyAssignmentUpdate(BaseModelCamel):
    work_station: Optional[str] = None
    sector_id: Optional[str] = None
    zone_id: Optional[str] = None
    shift: Optional[str] = None
    coverage: Optional[str] = None
    effective_from: Optional[datetime.date] = None
    effective_to: Optional[datetime.date] = None
    posting_role: Optional[str] = None
    notes: Optional[str] = None

class DutyAssignmentResponse(BaseModelCamel):
    id: str
    allocation_id: str
    officer_id: str
    officer_name: str
    officer_rank: Optional[str] = None
    officer_manpower_no: Optional[str] = None
    officer_phone: Optional[str] = None
    officer_duty_status: str = "ON_DUTY"
    sector_id: Optional[str] = None
    sector_code: Optional[str] = None
    sector_name: Optional[str] = None
    zone_id: Optional[str] = None
    zone_name: Optional[str] = None
    work_station: str
    shift: str
    coverage: str
    effective_from: Optional[datetime.date] = None
    effective_to: Optional[datetime.date] = None
    posting_role: Optional[str] = None
    notes: Optional[str] = None
    created_at: datetime.datetime

class MyDutyResponse(BaseModelCamel):
    """What an officer sees on their own screen: today's posting, plus the
    month's, plus anything that stops them being expected on parade."""
    date: datetime.date
    on_duty_today: bool
    duty_status: str
    duty_status_until: Optional[datetime.date] = None
    duty_status_note: Optional[str] = None
    allocation_month: Optional[str] = None      # "September 2026"
    allocation_reference: Optional[str] = None
    today: List[DutyAssignmentResponse] = []
    month: List[DutyAssignmentResponse] = []
    unread_broadcasts: int = 0

class DutyCalendarDay(BaseModelCamel):
    date: datetime.date
    is_weekend: bool
    assignment_count: int
    shifts: List[str] = []

class DutyCalendarResponse(BaseModelCamel):
    year: int
    month: int
    allocation_id: Optional[str] = None
    allocation_status: Optional[str] = None
    days: List[DutyCalendarDay]

class BroadcastCreate(BaseModelCamel):
    subject: str = Field(min_length=2, max_length=200)
    body: str = Field(min_length=1, max_length=4000)
    priority: str = "NORMAL"    # NORMAL, URGENT
    audience: str               # ALL, SECTOR, ZONE, OFFICER
    sector_id: Optional[str] = None
    zone_id: Optional[str] = None
    officer_ids: Optional[List[str]] = None

class BroadcastResponse(BaseModelCamel):
    id: str
    subject: str
    body: str
    priority: str
    audience: str
    audience_sector_id: Optional[str] = None
    audience_zone_id: Optional[str] = None
    audience_label: Optional[str] = None
    sent_by: str
    sent_by_name: Optional[str] = None
    sent_at: datetime.datetime
    recipient_count: int = 0
    read_count: int = 0
    # Only meaningful on an officer's own feed.
    read_at: Optional[datetime.datetime] = None


class NotificationResponse(BaseModelCamel):
    id: str
    title: str
    message: str
    level: str
    created_at: datetime.datetime
    read_at: Optional[datetime.datetime] = None


class NotificationHistoryResponse(BaseModelCamel):
    """One roundtrip on page load: the recent list plus the unread count,
    rather than making every page compute the count from the list itself
    (a list capped at N items can't tell you the true unread count once
    the number of unread notifications exceeds N)."""
    items: List[NotificationResponse]


# --- Favorites / Recents ---
class FavoriteSaccoCreate(BaseModelCamel):
    sacco_id: str

class UserFavoriteResponse(BaseModelCamel):
    id: str
    sacco_id: str
    created_at: datetime.datetime

class RecentSaccoResponse(BaseModelCamel):
    sacco_id: str
    last_booked_at: datetime.datetime


# --- Operator Terminals ---
class OperatorTerminalCreate(BaseModelCamel):
    route_id: str
    label: str

class OperatorTerminalResponse(BaseModelCamel):
    id: str
    sacco_id: str
    route_id: str
    label: str
    stage_id: Optional[str] = None
    lat: Optional[float] = None
    lng: Optional[float] = None
    geocoded: bool
    match_status: str
    created_at: datetime.datetime

class OperatorTerminalResolveRequest(BaseModelCamel):
    """Either link to an existing Stage, or hand-set a coordinate (which
    creates a new Stage) — exactly one of the two, never both."""
    stage_id: Optional[str] = None
    lat: Optional[float] = None
    lng: Optional[float] = None


# --- Trip Ratings ---
class TripRatingCreate(BaseModelCamel):
    booking_id: str
    rating: int = Field(ge=1, le=5)
    comment: Optional[str] = None

class TripRatingResponse(BaseModelCamel):
    id: str
    booking_id: str
    matatu_id: str
    sacco_id: str
    driver_user_id: Optional[str] = None
    conductor_user_id: Optional[str] = None
    rating: int
    comment: Optional[str] = None
    created_at: datetime.datetime

class PendingRatingResponse(BaseModelCamel):
    """A USED booking with no rating yet — drives the passenger app's
    rating prompt."""
    booking_id: str
    reg_number: str
    route_name: str
    booked_at: datetime.datetime
    unread_count: int
