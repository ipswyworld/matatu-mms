import datetime
import re
from typing import Optional, List
from pydantic import BaseModel, ConfigDict, EmailStr, field_validator
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
    doc_letter_no_objection: Optional[str] = None
    director_mobility_status: Optional[str] = "PENDING"
    director_mobility_reason: Optional[str] = None
    director_mobility_decided_by: Optional[str] = None
    director_mobility_decided_at: Optional[datetime.datetime] = None
    chief_officer_status: Optional[str] = "PENDING"
    chief_officer_reason: Optional[str] = None
    chief_officer_decided_by: Optional[str] = None
    chief_officer_decided_at: Optional[datetime.datetime] = None

class SaccoVerificationUpdate(BaseModelCamel):
    status: str  # ACTIVE or REJECTED
    reason: Optional[str] = None

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
    password: str
    # Only required on self-registration (/api/auth/register), not when an
    # Admin provisions an account directly — see that endpoint's validation.
    terms_accepted: Optional[bool] = False
    terms_signature: Optional[str] = None

class UserResponse(UserBase):
    id: str
    terms_accepted: Optional[bool] = False
    terms_accepted_at: Optional[datetime.datetime] = None
    terms_signature: Optional[str] = None

class UserUpdate(BaseModelCamel):
    name: Optional[str] = None
    email: Optional[EmailStr] = None
    role: Optional[str] = None
    sacco_id: Optional[str] = None
    new_password: Optional[str] = None

    _normalize_email = _normalized_email_validator()

class UserLogin(BaseModel):
    email: EmailStr
    password: str

    _normalize_email = _normalized_email_validator()

# --- Crew Assignment Schemas ---
class CrewIssueRequest(BaseModelCamel):
    """Operator-issued crew login + vehicle assignment in one call
    (ARCHITECTURE_DECISIONS.md §29.1). No client-supplied password —
    the server generates one and returns it exactly once."""
    name: str
    email: EmailStr
    phone: Optional[str] = None
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
    matatu_reg_number: str

class CrewIssueResponse(BaseModelCamel):
    assignment: CrewAssignmentResponse
    generated_password: str

class ForgotPasswordRequest(BaseModelCamel):
    email: EmailStr

    _normalize_email = _normalized_email_validator()

class ResetPasswordRequest(BaseModelCamel):
    token: str
    new_password: str

class Token(BaseModelCamel):
    access_token: str
    token_type: str
    user: UserResponse

# --- Route Schemas ---
class RouteBase(BaseModelCamel):
    code: str
    name: str
    description: Optional[str] = None
    fare_kes: Optional[float] = 100.0

class RouteCreate(RouteBase):
    id: str

class RouteResponse(RouteBase):
    id: str
    vehicle_count: Optional[int] = 0

# --- Fare Stage Schemas ---
class FareStageCreate(BaseModelCamel):
    from_label: str
    to_label: str
    fare_kes: float
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
    fare_kes: float
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
    fine_amount_kes: float = 0.0
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
    amount_kes: float
    due_date: datetime.date  # a calendar date — Pydantic parses "YYYY-MM-DD" from the frontend directly

class FineCreate(FineBase):
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
    fare_kes: float
    status: str
    booked_at: datetime.datetime
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

# --- Zones & Offence Catalog ---
class ZoneResponse(BaseModelCamel):
    id: str
    name: str
    description: Optional[str] = None

class OffenceTypeResponse(BaseModelCamel):
    id: str
    name: str
    default_fine_kes: float
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

class EnforcementCaseResponse(BaseModelCamel):
    id: str
    case_reference: str
    reg_number: str
    offence_type_id: str
    offence_name: Optional[str] = None
    offence_description: Optional[str] = None
    fine_amount_kes: float
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
    waived_reason: Optional[str] = None
    waived_authorized_by: Optional[str] = None

class PublicCaseResponse(BaseModelCamel):
    """Deliberately narrow — what an unauthenticated offender is allowed to see."""
    case_reference: str
    reg_number: str
    offence_name: Optional[str] = None
    fine_amount_kes: float
    status: str
    created_at: datetime.datetime

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
