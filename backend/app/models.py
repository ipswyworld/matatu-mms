import datetime
from sqlalchemy import Column, String, Integer, Float, Numeric, Date, ForeignKey, DateTime, Boolean, Text, LargeBinary, UniqueConstraint
from sqlalchemy.orm import relationship
from app.database import Base

class Sacco(Base):
    __tablename__ = "saccos"

    id = Column(String, primary_key=True, index=True)
    name = Column(String, nullable=False)
    # UNREGISTERED, INVITED, PENDING_VERIFICATION, ACTIVE, REJECTED, SUSPENDED.
    # UNREGISTERED/INVITED are "shadow registry" rows the county seeds from
    # its own route-permit records for operators who have never touched the
    # system — see shadow_* fields below. They're not real accounts and
    # never get docs/verification stages; a county rep marks the shadow row
    # gone once the operator has actually self-registered for real through
    # the normal onboarding wizard (which always creates its own fresh Sacco
    # row — there's no automatic name-matching/merge between the two).
    status = Column(String, default="ACTIVE")
    license_status = Column(String, default="ACTIVE")  # ACTIVE, RENEWAL_DUE, EXPIRED
    primary_route_id = Column(String, nullable=True)
    secondary_route_ids = Column(String, nullable=True)  # Comma separated route IDs

    # Shadow registry (compliance funnel) fields — only meaningful while
    # status is UNREGISTERED or INVITED.
    shadow_contact_name = Column(String, nullable=True)
    shadow_contact_phone = Column(String, nullable=True)
    shadow_source = Column(String, nullable=True)  # MANUAL, BULK_IMPORT
    compliance_deadline = Column(DateTime(timezone=True), nullable=True)
    invited_at = Column(DateTime(timezone=True), nullable=True)

    # NEW Saccos (never operated in Nairobi before) require a Letter of No
    # Objection before their Road Service License is accepted; EXISTING
    # Saccos already hold county history and skip that requirement.
    sacco_type = Column(String, default="EXISTING")  # NEW, EXISTING
    created_at = Column(DateTime(timezone=True), nullable=True)
    application_submitted_at = Column(DateTime(timezone=True), nullable=True)  # set once the operator finishes the onboarding wizard

    # Mandatory Onboarding Verification Documents (file paths under /uploads,
    # served statically — see main.py's StaticFiles mount)
    doc_registration_cert = Column(String, nullable=True)
    doc_road_service_license = Column(String, nullable=True)
    doc_county_permit = Column(String, nullable=True)
    doc_single_business_permit = Column(String, nullable=True)
    doc_tax_compliance_cert = Column(String, nullable=True)
    doc_fare_chart = Column(String, nullable=True)  # published fare chart for the operator's routes
    doc_letter_no_objection = Column(String, nullable=True)  # NEW Saccos only
    doc_officials_contacts = Column(Text, nullable=True)  # JSON String of Chairperson, Secretary, Treasurer contacts
    rejection_reason = Column(Text, nullable=True)

    # Two-stage county verification: Director of Mobility decides first,
    # then the Chief Officer. Both must approve before `status` flips to
    # ACTIVE and the operator dashboard fully unlocks.
    director_mobility_status = Column(String, default="PENDING")  # PENDING, APPROVED, REJECTED
    director_mobility_reason = Column(Text, nullable=True)
    director_mobility_decided_by = Column(String, nullable=True)
    director_mobility_decided_at = Column(DateTime(timezone=True), nullable=True)
    chief_officer_status = Column(String, default="PENDING")  # PENDING, APPROVED, REJECTED
    chief_officer_reason = Column(Text, nullable=True)
    chief_officer_decided_by = Column(String, nullable=True)
    chief_officer_decided_at = Column(DateTime(timezone=True), nullable=True)

    users = relationship("User", back_populates="sacco", foreign_keys="User.sacco_id")
    matatus = relationship("Matatu", back_populates="sacco")

class User(Base):
    __tablename__ = "users"

    id = Column(String, primary_key=True, index=True)
    name = Column(String, nullable=False)
    email = Column(String, unique=True, index=True, nullable=False)
    # Phone-first passenger self-registration (§ forgot-password-by-phone):
    # a synthetic placeholder email is generated when a passenger signs up
    # without a real one (see register() in routes/auth.py), so `email`
    # itself stays NOT NULL/unique everywhere else in the system (admin
    # user management, staff login, CrewIssueRequest, ...) unaffected.
    # `phone` is the actual optional-vs-required split for passengers.
    phone = Column(String, unique=True, index=True, nullable=True)
    password = Column(String, nullable=False)
    role = Column(String, nullable=False)  # ADMIN, ENFORCEMENT, SACCO_OPERATOR, VIEWER, PASSENGER, CREW
    sacco_id = Column(String, ForeignKey("saccos.id"), nullable=True)

    # Terms & Conditions consent — recorded at self-registration. The typed
    # signature is a lightweight e-signature attestation, not a cryptographic
    # one; it exists so there's a persisted record of exactly what name the
    # person typed to agree, alongside when.
    terms_accepted = Column(Boolean, default=False)
    terms_accepted_at = Column(DateTime(timezone=True), nullable=True)
    terms_signature = Column(String, nullable=True)
    terms_version = Column(String, nullable=True)

    # Enforcement duty roster — a lightweight "who's on what today" toggle
    # rather than a full shift-calendar, set by an Enforcement Commander (or
    # Admin). ARRESTING and RELEASING duties never mix on the same officer.
    enforcement_duty = Column(String, nullable=True)  # ARRESTING, RELEASING, or null
    assigned_zone_id = Column(String, ForeignKey("zones.id"), nullable=True)
    commander_title = Column(String, nullable=True)  # e.g. "Commander of Public Transport Compliance"

    # --- Officer service record (PTCU duty-allocation sheet parity) ---
    # The county's real monthly allocation sheet identifies an officer by
    # NAME + MAN. NO + RANK, not by email — so a roster built without these
    # cannot be reconciled against the paper document it replaces.
    #
    # Manpower number: the officer's service number as printed on the sheet
    # (e.g. "72899"). Unique where present, but nullable — every non-officer
    # account (passenger, crew, Sacco operator) legitimately has none, and a
    # unique constraint tolerates many NULLs.
    manpower_no = Column(String, nullable=True, unique=True, index=True)
    # Rank as printed: SUPT, SCI, INSP, ACC III, S/SGT, SGT, CPL, CC. Kept
    # as free-ish text rather than an enum — county rank vocabulary is set
    # by the service, not by this system, and a new rank appearing on next
    # month's sheet must not require a migration to record.
    rank = Column(String, nullable=True)
    # Duty status is what the sheet's "ON DUTY (OFF DUTY & LEAVE SPECIFY
    # DATES)" column encodes. Distinct from is_active, which is account
    # deactivation: an officer on leave still has a working login, and a
    # deactivated account is not "off duty", it is gone.
    duty_status = Column(String, nullable=False, default="ON_DUTY")  # ON_DUTY, OFF_DUTY, LEAVE, SICK, SUSPENDED, TRAINING
    # "SPECIFY DATES" — the window the non-ON_DUTY status covers. Both null
    # for an open-ended status; duty_status_until is what lets the roster
    # show "back on Monday" instead of just "away".
    duty_status_from = Column(Date, nullable=True)
    duty_status_until = Column(Date, nullable=True)
    duty_status_note = Column(String, nullable=True)
    # The sheet totals male/female on duty separately and the county reports
    # on that split, so it is operational data here, not demographic
    # decoration. Nullable: never inferred, only recorded when known.
    gender = Column(String, nullable=True)  # M, F, or null
    # Release eligibility is granted per officer, not implied by account
    # type: any enforcement officer can file a case, but only specific,
    # individually-trusted officers may release one. Defaults False so
    # existing RELEASING_OFFICER/ENFORCEMENT_COMMANDER accounts (already
    # gated by role) are unaffected; this is an additional grant on top of
    # those roles, not a replacement for them.
    can_release_cases = Column(Boolean, nullable=False, default=False)

    # Self-service password reset — token is single-use and time-boxed;
    # cleared after a successful reset or once expired.
    reset_token = Column(String, nullable=True, index=True)
    reset_token_expires_at = Column(DateTime(timezone=True), nullable=True)

    # Phone-based reset (OTP), parallel to the token above but a short
    # numeric code instead of a URL token — same single-use/time-boxed
    # lifecycle, cleared after a successful reset or once expired.
    phone_otp_code = Column(String, nullable=True)
    phone_otp_expires_at = Column(DateTime(timezone=True), nullable=True)

    # Minor/student self-registration (the public login page's "Register as
    # a Student / Minor" path). A minor's account is created immediately
    # but cannot sign in at all until their guardian approves — the
    # approval gate is checked in login(), not just hidden in the UI, so
    # there's no way to bypass it by hitting the API directly. Guardian
    # fields are only ever populated when is_minor is true; left null for
    # every adult/citizen/staff/crew account, which is the overwhelming
    # majority of rows.
    is_minor = Column(Boolean, default=False)
    guardian_name = Column(String, nullable=True)
    guardian_phone = Column(String, nullable=True)
    guardian_relationship = Column(String, nullable=True)  # e.g. Parent, Guardian, Sibling
    guardian_id_number = Column(String, nullable=True)  # guardian's national ID, for the consent record
    guardian_approved = Column(Boolean, default=False)
    guardian_approved_at = Column(DateTime(timezone=True), nullable=True)
    # Single-use link token texted to the guardian, same lifecycle pattern
    # as reset_token above (set on registration, cleared once consumed).
    guardian_approval_token = Column(String, nullable=True, index=True)
    guardian_approval_token_expires_at = Column(DateTime(timezone=True), nullable=True)

    # Soft-delete for "remove this user" (admin/operator side, §24 roadmap)
    # — a hard DELETE would orphan every FK referencing this user (bookings,
    # fines, audit logs, crew assignments...); deactivating instead blocks
    # login (checked in both login() and get_current_user, so an
    # already-issued token stops working immediately too) while keeping
    # every historical record intact.
    is_active = Column(Boolean, default=True)

    # TOTP-based MFA (§19, SESSION_SECURITY_STATUS.md's spec'd-but-not-built
    # section, ADMIN_DASHBOARD_AUDIT §6.2) — enforced for ADMIN/SUPERADMIN,
    # opt-in for everyone else. totp_secret is Fernet-encrypted at rest
    # (see app/mfa.py), never stored or returned in plaintext.
    # mfa_backup_codes is a JSON list of bcrypt-hashed single-use codes —
    # same hashing helper as the password itself, consumed one at a time.
    totp_secret = Column(String, nullable=True)
    mfa_enabled = Column(Boolean, default=False, nullable=False)
    mfa_backup_codes = Column(Text, nullable=True)

    # Individual permission grants layered on top of the role's own bundle
    # (app/rbac.py's ROLE_MATRIX) — e.g. giving one specific Viewer
    # `manage_crew` without promoting their whole account to Admin. JSON
    # list of action strings; empty/null means "just the role's own
    # permissions," the default for every account. Only a Super Admin can
    # set this (routes/users.py), since it's otherwise a privilege-
    # escalation path around the ADMIN_TIER_ROLES-editing restriction.
    extra_permissions = Column(Text, nullable=True)

    # Additional predefined roles (app/rbac.py's ROLE_MATRIX keys) layered on
    # top of the account's primary `role` — e.g. an ARRESTING_OFFICER who
    # should also get ENFORCEMENT_COMMANDER's permission bundle without
    # their account *type* changing. Not custom role creation: only role
    # names that already exist in ROLE_MATRIX can be granted here. JSON list
    # of role-name strings; empty/null means "just the primary role," the
    # default for every account. Only a Super Admin can set this
    # (routes/users.py), same privilege-escalation guard as extra_permissions.
    additional_roles = Column(Text, nullable=True)

    # Passenger's preferred operator (roadmap: "passenger side they can
    # pick a favorite sacco/operator they prefer") — self-service only, set
    # via PATCH /api/users/me/favorite-sacco, never by an admin/operator
    # editing someone else's account.
    favorite_sacco_id = Column(String, ForeignKey("saccos.id"), nullable=True)

    # A crew is one driver + one conductor working the same vehicle, sharing
    # one human-readable identifier (e.g. "UMO001" — Sacco prefix + sequence)
    # — set when the operator issues the second person's credentials on a
    # vehicle that already has an active crew member of the other role (see
    # app/routes/crew.py). Deliberately NOT unique: exactly two User rows
    # are expected to carry the same value. Login accepts this alongside
    # phone/email (routes/auth.py's login()); when it resolves to two
    # accounts, the submitted password is checked against each in turn.
    crew_number = Column(String, nullable=True, index=True)

    crew_assignments = relationship("CrewAssignment", back_populates="user")

    sacco = relationship("Sacco", back_populates="users", foreign_keys=[sacco_id])
    favorite_sacco = relationship("Sacco", foreign_keys=[favorite_sacco_id])
    assigned_zone = relationship("Zone")

class Route(Base):
    __tablename__ = "routes"

    id = Column(String, primary_key=True, index=True)
    code = Column(String, nullable=False, unique=True)
    name = Column(String, nullable=False)
    description = Column(String, nullable=True)
    fare_kes = Column(Numeric(12, 2), default=100.0)

    # BRN digitization fields (ARCHITECTURE_DECISIONS.md §1.3, §8). `code`
    # above is the pre-existing simple route identifier used throughout the
    # app (route-1..4, used by Matatu.route_id) — these are additive, not a
    # replacement, and default to NULL/false for all pre-existing routes.
    #
    # brn_serial: the report's own serial number (e.g. "2A") — explicitly
    # provisional per report §5.3.4, so it's metadata, never a join key.
    # base_route_id: for a variant like "2A", points at the parent route
    # "2" — variants are first-class rows, not a naming convention.
    # corridor: the arterial road grouping from the report's colour legend
    # (Ngong Rd, Jogoo Rd, Thika Rd...) — grouping metadata, not identity.
    brn_serial = Column(String, nullable=True, index=True)
    base_route_id = Column(String, ForeignKey("routes.id"), nullable=True)
    corridor = Column(String, nullable=True)
    start_point = Column(String, nullable=True)
    end_point = Column(String, nullable=True)

    matatus = relationship("Matatu", back_populates="route")
    stage_links = relationship("RouteStage", back_populates="route", order_by="RouteStage.sequence")
    fare_stages = relationship("FareStage", back_populates="route")


class FareStage(Base):
    """One fare between a boarding/alighting stage pair within a route —
    the structured replacement for `Route.fare_kes` as a single flat number
    (ARCHITECTURE_DECISIONS.md §29.2). Real matatu fares vary by distance/
    stage, not by route alone.

    from_stage_id/to_stage_id link to real `Stage` rows when the chart's
    text matches a known stage name; from_label/to_label always hold the
    raw text as parsed, so an unmatched stage name is never silently
    dropped — it's just unresolved until stage data or a manual fix links
    it. direction mirrors RouteStage's OUTBOUND/RETURN asymmetry.
    """
    __tablename__ = "fare_stages"

    id = Column(String, primary_key=True, index=True)
    route_id = Column(String, ForeignKey("routes.id"), nullable=False)
    from_stage_id = Column(String, ForeignKey("stages.id"), nullable=True)
    to_stage_id = Column(String, ForeignKey("stages.id"), nullable=True)
    from_label = Column(String, nullable=False)
    to_label = Column(String, nullable=False)
    fare_kes = Column(Numeric(12, 2), nullable=False)
    direction = Column(String, nullable=True)  # OUTBOUND, RETURN, or null (both)
    source = Column(String, default="MANUAL")  # MANUAL, PDF_UPLOAD
    created_at = Column(DateTime(timezone=True), nullable=False)

    route = relationship("Route", back_populates="fare_stages")
    from_stage = relationship("Stage", foreign_keys=[from_stage_id])
    to_stage = relationship("Stage", foreign_keys=[to_stage_id])


class Stage(Base):
    """A boarding point along the BRN network — a stage or a terminus.
    Replaces the frontend-only NAIROBI_STAGES constant (GisMap.tsx) with
    real, queryable data. lat/lng are plain floats rather than a PostGIS
    geography type deliberately — PostGIS availability on the deployed
    Postgres plan is unconfirmed (see the enable-postgis migration), and
    stage data + map rendering must not hard-depend on that resolving.
    `geocoded` distinguishes a real surveyed/confirmed coordinate from a
    placeholder — never fabricate false-precision GPS for a name we're not
    confident about; leave lat/lng null and geocoded false instead.
    """
    __tablename__ = "stages"

    id = Column(String, primary_key=True, index=True)
    name = Column(String, nullable=False)
    code = Column(String, nullable=True)
    stage_type = Column(String, default="STAGE")  # STAGE, TERMINUS
    zone = Column(String, nullable=True)
    lat = Column(Float, nullable=True)
    lng = Column(Float, nullable=True)
    geocoded = Column(Boolean, default=False)

    route_links = relationship("RouteStage", back_populates="stage")


class RouteStage(Base):
    """One stage's position in one route's sequence, in one direction.
    Directions are asymmetric in the BRN report (Table 5's separate
    "Routing on Return Journey Thro CBD" column proves inbound != outbound)
    — modelled explicitly rather than assuming a route mirrors itself.
    """
    __tablename__ = "route_stages"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    route_id = Column(String, ForeignKey("routes.id"), nullable=False)
    stage_id = Column(String, ForeignKey("stages.id"), nullable=False)
    sequence = Column(Integer, nullable=False)
    direction = Column(String, nullable=False)  # OUTBOUND, RETURN

    route = relationship("Route", back_populates="stage_links", foreign_keys=[route_id])
    stage = relationship("Stage", back_populates="route_links")

class Matatu(Base):
    __tablename__ = "matatus"

    id = Column(String, primary_key=True, index=True)
    reg_number = Column(String, unique=True, index=True, nullable=False)
    sacco_id = Column(String, ForeignKey("saccos.id"), nullable=False)
    route_id = Column(String, ForeignKey("routes.id"), nullable=False)
    terminal_segment = Column(String, default="CBD Central Terminal: Main Stage")
    capacity = Column(Integer, nullable=False)
    status = Column(String, default="ACTIVE")  # REGISTRATION_PENDING, ACTIVE, FLAGGED, IMPOUNDED, DECOMMISSIONED
    last_inspection = Column(String, nullable=True)  # Legacy string
    created_at = Column(DateTime(timezone=True), nullable=False)

    driver_name = Column(String, nullable=True)
    driver_license = Column(String, nullable=True)
    driver_phone = Column(String, nullable=True)
    conductor_name = Column(String, nullable=True)
    conductor_license = Column(String, nullable=True)
    conductor_phone = Column(String, nullable=True)

    sacco = relationship("Sacco", back_populates="matatus")
    route = relationship("Route", back_populates="matatus")
    activities = relationship("ActivityLog", back_populates="matatu")
    fines = relationship("Fine", back_populates="matatu")
    crew_assignments = relationship("CrewAssignment", back_populates="matatu")


class CrewAssignment(Base):
    """Links a real CREW `User` login to a `Matatu`. The pre-existing
    Matatu.driver_name/conductor_name fields are plain free-text (kept for
    display) and were never tied to a login — this is the real link.
    A join table rather than a single FK on User, because a crew member
    plausibly moves between vehicles over time and a single FK can't
    represent that history; unassigned_at = NULL means currently active.
    (ARCHITECTURE_DECISIONS.md §29.1.)
    """
    __tablename__ = "crew_assignments"

    id = Column(String, primary_key=True, index=True)
    user_id = Column(String, ForeignKey("users.id"), nullable=False)
    matatu_id = Column(String, ForeignKey("matatus.id"), nullable=False)
    crew_role = Column(String, nullable=False)  # DRIVER, CONDUCTOR
    assigned_at = Column(DateTime(timezone=True), nullable=False)
    unassigned_at = Column(DateTime(timezone=True), nullable=True)

    user = relationship("User", back_populates="crew_assignments")
    matatu = relationship("Matatu", back_populates="crew_assignments")


class Trip(Base):
    """One crew-declared trip: a vehicle committing to a direction (origin →
    destination stage) for a stretch of time. This is the primitive several
    roadmap features share — "Activate Trip" (crew declares direction so
    they only pick passengers headed the right way), the terminal queue
    system (QUEUED trips at a stage, oldest-first), and passenger distance/
    ETA (an IN_PROGRESS trip is the thing a passenger is tracking).

    QUEUED means the vehicle is waiting at origin_stage_id for a full load
    before departing — the crew's own "n vehicles before you" position is
    computed from other QUEUED trips at the same stage+route, ordered by
    started_at (FIFO), not from anything more elaborate.
    """
    __tablename__ = "trips"

    id = Column(String, primary_key=True, index=True)
    matatu_id = Column(String, ForeignKey("matatus.id"), nullable=False)
    route_id = Column(String, ForeignKey("routes.id"), nullable=False)
    origin_stage_id = Column(String, ForeignKey("stages.id"), nullable=False)
    destination_stage_id = Column(String, ForeignKey("stages.id"), nullable=False)
    started_by = Column(String, ForeignKey("users.id"), nullable=False)
    status = Column(String, default="QUEUED")  # QUEUED, IN_PROGRESS, COMPLETED, CANCELLED
    started_at = Column(DateTime(timezone=True), nullable=False)
    departed_at = Column(DateTime(timezone=True), nullable=True)
    ended_at = Column(DateTime(timezone=True), nullable=True)
    # Crew's own estimate of passengers carried this trip, logged (optionally
    # — never forced) when they mark it COMPLETED. This is the real-ridership
    # counterpart to demand_signals (which only ever sees app-based searches/
    # bookings, a small fraction of actual cash-at-boarding riders). Null
    # means "crew didn't log it," not "zero passengers" — every aggregate
    # reading this column must treat it as missing data, not a real zero.
    passenger_count = Column(Integer, nullable=True)

    matatu = relationship("Matatu")
    route = relationship("Route")
    origin_stage = relationship("Stage", foreign_keys=[origin_stage_id])
    destination_stage = relationship("Stage", foreign_keys=[destination_stage_id])
    started_by_user = relationship("User")


class VehiclePosition(Base):
    """GPS history — durable counterpart to the Redis-only "live position"
    key in app/routes/telemetry.py (which expires after STALE_AFTER_SECONDS
    and was never persisted anywhere). Plain indexed Postgres table for now;
    ARCHITECTURE_DECISIONS.md §3 calls for converting this to a TimescaleDB
    hypertable (see the enable_timescaledb migration) once volume actually
    requires it — a flat table works fine at current/demo scale and the
    hypertable conversion is additive, not a rewrite.
    """
    __tablename__ = "vehicle_positions"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    matatu_id = Column(String, ForeignKey("matatus.id"), nullable=False)
    lat = Column(Float, nullable=False)
    lng = Column(Float, nullable=False)
    speed = Column(Float, nullable=True)
    heading = Column(Float, nullable=True)
    source = Column(String, default="CREW_GPS")  # CREW_GPS, IRMS (once §1.5 lands)
    recorded_at = Column(DateTime(timezone=True), nullable=False)

    matatu = relationship("Matatu")


class OfficerPosition(Base):
    """GPS history for enforcement officers on patrol — durable counterpart
    to the Redis-only "live position" key in app/routes/telemetry.py, same
    pattern as VehiclePosition above. Deliberately opt-in per officer (the
    "On Patrol" toggle in the frontend, not silent background tracking):
    beats.py's own docstring already flagged that continuous officer
    tracking is a real product/consent decision, not something to bolt on
    quietly. No simulated-fallback position either — unlike the demo
    vehicle GPS, a fake officer location would actively mislead a
    commander about where someone actually is, so this table only ever
    holds a real device fix.
    """
    __tablename__ = "officer_positions"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    officer_id = Column(String, ForeignKey("users.id"), nullable=False)
    lat = Column(Float, nullable=False)
    lng = Column(Float, nullable=False)
    speed = Column(Float, nullable=True)
    heading = Column(Float, nullable=True)
    recorded_at = Column(DateTime(timezone=True), nullable=False)

    officer = relationship("User")


class RouteDetour(Base):
    """A pre-approved alternate road segment for a known incident-prone
    stretch of one route (ARCHITECTURE_DECISIONS.md §29.4). Deliberately
    NOT a route variant — routes 2, 2A, 18A etc. are separate, permanently
    numbered official routes (§1.3); this is a temporary detour within one
    route's identity, activated only when an incident actually intersects
    the stretch it covers. Conflating the two would corrupt the official
    route registry with ad-hoc detour noise, per the doc's explicit
    warning — hence a wholly separate table rather than another Route row.
    """
    __tablename__ = "route_detours"

    id = Column(String, primary_key=True, index=True)
    route_id = Column(String, ForeignKey("routes.id"), nullable=False)
    from_stage_id = Column(String, ForeignKey("stages.id"), nullable=False)
    to_stage_id = Column(String, ForeignKey("stages.id"), nullable=False)
    alternate_description = Column(Text, nullable=False)
    active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), nullable=False)

    route = relationship("Route")
    from_stage = relationship("Stage", foreign_keys=[from_stage_id])
    to_stage = relationship("Stage", foreign_keys=[to_stage_id])


class DeviationAlert(Base):
    """A vehicle position that fell outside its route's expected corridor
    past a tolerance (§1.6's "buffered polygon, alert if straying" —
    implemented here as a plain lat/lng distance-to-route-segment check
    rather than a true PostGIS buffered polygon, since precise route
    polylines beyond stage waypoints don't exist yet; same honest-
    approximation posture as Stage.geocoded — see §29.4's own note that
    detection was "already scoped in §1.6," this is that scoping realized
    with the geometry actually available today).
    """
    __tablename__ = "deviation_alerts"

    id = Column(String, primary_key=True, index=True)
    matatu_id = Column(String, ForeignKey("matatus.id"), nullable=False)
    route_id = Column(String, ForeignKey("routes.id"), nullable=False)
    lat = Column(Float, nullable=False)
    lng = Column(Float, nullable=False)
    distance_meters = Column(Float, nullable=False)
    detected_at = Column(DateTime(timezone=True), nullable=False)
    resolved = Column(Boolean, default=False)

    matatu = relationship("Matatu")
    route = relationship("Route")


class ActivityLog(Base):
    __tablename__ = "activity_logs"

    id = Column(String, primary_key=True, index=True)
    matatu_id = Column(String, ForeignKey("matatus.id"), nullable=False)
    type = Column(String, nullable=False)
    description = Column(Text, nullable=False)
    location = Column(String, nullable=False)
    officer_id = Column(String, ForeignKey("users.id"), nullable=False)
    timestamp = Column(DateTime(timezone=True), nullable=False)

    matatu = relationship("Matatu", back_populates="activities")
    officer = relationship("User")

class CrimeRecord(Base):
    __tablename__ = "crime_records"

    id = Column(String, primary_key=True, index=True)
    offence_committed = Column(String, nullable=False)
    reg_number = Column(String, nullable=False)
    driver_name = Column(String, nullable=False)
    driver_license = Column(String, nullable=False)
    location = Column(String, nullable=False)
    fine_amount_kes = Column(Numeric(12, 2), default=0.0)
    remarks = Column(Text, nullable=True)
    officer_id = Column(String, ForeignKey("users.id"), nullable=False)
    timestamp = Column(DateTime(timezone=True), nullable=False)
    status = Column(String, default="PENDING")  # PENDING, PROCESSED, PAID, DISPUTED
    photo_path = Column(String, nullable=True)

    officer = relationship("User")

class Fine(Base):
    __tablename__ = "fines"

    id = Column(String, primary_key=True, index=True)
    matatu_id = Column(String, ForeignKey("matatus.id"), nullable=False)
    officer_id = Column(String, ForeignKey("users.id"), nullable=False)
    reason = Column(String, nullable=False)
    amount_kes = Column(Numeric(12, 2), nullable=False)
    status = Column(String, default="PENDING")
    issued_at = Column(DateTime(timezone=True), nullable=False)
    due_date = Column(Date, nullable=False)  # a calendar date, not a specific moment — no time-of-day meaning

    matatu = relationship("Matatu", back_populates="fines")
    officer = relationship("User")

class Booking(Base):
    __tablename__ = "bookings"

    id = Column(String, primary_key=True, index=True)
    matatu_id = Column(String, ForeignKey("matatus.id"), nullable=False)
    route_id = Column(String, ForeignKey("routes.id"), nullable=False)
    passenger_user_id = Column(String, ForeignKey("users.id"), nullable=True)
    passenger_name = Column(String, nullable=False)
    phone = Column(String, nullable=False)
    stage_name = Column(String, nullable=False)
    seat_numbers = Column(String, nullable=False)  # comma separated seat ids
    fare_kes = Column(Numeric(12, 2), nullable=False)
    status = Column(String, default="CONFIRMED")  # CONFIRMED, USED, CANCELLED
    booked_at = Column(DateTime(timezone=True), nullable=False)

    matatu = relationship("Matatu")
    route = relationship("Route")

class PassengerReport(Base):
    __tablename__ = "passenger_reports"

    id = Column(String, primary_key=True, index=True)
    matatu_reg_number = Column(String, nullable=True)
    category = Column(String, nullable=False)
    message = Column(Text, nullable=False)
    reporter_user_id = Column(String, ForeignKey("users.id"), nullable=True)
    reporter_name = Column(String, nullable=True)
    reporter_phone = Column(String, nullable=True)
    photo_path = Column(String, nullable=True)  # optional evidence photo, /uploads path
    status = Column(String, default="PENDING")  # PENDING, REVIEWED, ESCALATED, DISMISSED
    created_at = Column(DateTime(timezone=True), nullable=False)


class ConditionReport(Base):
    """Crowdsourced road-condition signal ("it's raining", "jam on Waiyaki
    Way") — deliberately separate from PassengerReport, which is a
    permanent complaint record reviewed by staff. This is ephemeral:
    read-side queries (routes/public_updates.py) only look at the last ~90
    minutes, so nothing needs to be expired or cleaned up here, and no
    review workflow applies. No auth required to submit — the whole point
    is zero-friction "tell the system what you're seeing right now".
    """
    __tablename__ = "condition_reports"

    id = Column(String, primary_key=True, index=True)
    category = Column(String, nullable=False)  # RAIN, TRAFFIC_JAM, ACCIDENT, ROAD_BLOCKED, POLICE_CHECK, OTHER
    location_label = Column(String, nullable=False)
    message = Column(String, nullable=True)
    reporter_user_id = Column(String, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False)


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    resource_type = Column(String, nullable=False)
    resource_id = Column(String, nullable=False)
    action = Column(String, nullable=False)
    old_values = Column(Text, nullable=True)
    new_values = Column(Text, nullable=True)
    user_id = Column(String, nullable=False)
    timestamp = Column(DateTime(timezone=True), nullable=False)


class LoginEvent(Base):
    """Append-only auth trail (SYSTEM_AUDIT.md §2.1's named gap — auth.py
    previously wrote nothing on login/logout/failed-login at all). A
    dedicated table rather than folding into AuditLog: ip_address/
    user_agent need to be individually queryable for the per-user Activity
    tab and the ops console's cross-account "who's logged in"/anomaly view
    (new-IP-on-privileged-account, failed-login bursts), which AuditLog's
    old_values/new_values JSON blob isn't a good fit for. Deliberately NOT
    a per-token/jti session list — that's the separately-scoped redesign
    SESSION_SECURITY_STATUS.md already deferred; this is just "when did
    this happen and from where."
    """
    __tablename__ = "login_events"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    # Nullable — a failed attempt against an email with no matching account
    # has no user to attach to, but the attempt itself is still worth
    # recording (failed-login-burst detection needs it even without a user).
    user_id = Column(String, ForeignKey("users.id"), nullable=True, index=True)
    email = Column(String, nullable=True)
    # LOGIN_SUCCESS, LOGIN_FAILED, LOGOUT, REGISTER
    event_type = Column(String, nullable=False)
    # e.g. "invalid_credentials", "account_inactive", "invalid_mfa_code" —
    # only set for LOGIN_FAILED, null otherwise.
    reason = Column(String, nullable=True)
    ip_address = Column(String, nullable=True)
    user_agent = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, index=True)


class FeatureFlag(Base):
    """Ops console Tier-1 config CRUD (OPS_CONSOLE_AND_USER_ACTIVITY_SPEC.md
    A.2/A.4) — this is the first real use case for a flag system in this
    codebase, so nothing yet branches on a flag's value. The store, CRUD,
    RBAC gate, and audit trail are the actual deliverable; a call site
    checking is_feature_enabled() is a separate, later change per flag.
    Recoverable-by-toggle, unlike Tier 2/3 data — no soft-delete needed."""
    __tablename__ = "feature_flags"

    # Slug-style key (e.g. "impersonation_enabled"), not a surrogate id —
    # this is what code call sites reference, so it needs to be stable and
    # human-chosen, not autoincrement.
    key = Column(String, primary_key=True)
    description = Column(String, nullable=True)
    enabled = Column(Boolean, nullable=False, default=False)
    updated_by = Column(String, ForeignKey("users.id"), nullable=True)
    updated_at = Column(DateTime(timezone=True), nullable=False)


class RateLimitOverride(Base):
    """Live-adjustable rate limits (Ops Console Rebuild Spec §6.1).

    Postgres is the source of truth so an override survives a Redis flush
    and is audited like any other config write; app/ops_limits.py mirrors
    it to Redis and caches it in-process, because slowapi's limit callable
    runs synchronously on every request and cannot await a lookup.

    Only scopes present in ops_limits.DEFAULTS are accepted — an unknown
    scope here would be dead config that silently governs nothing.
    """
    __tablename__ = "rate_limit_overrides"

    # Stable scope identifier (e.g. "auth_login"), matching a key in
    # ops_limits.DEFAULTS. Primary key rather than a surrogate id for the
    # same reason FeatureFlag.key is: this is what code and operators
    # reference, so it must be stable and human-chosen.
    scope = Column(String, primary_key=True)
    # slowapi's "<count>/<period>" form, validated at the API boundary by
    # ops_limits.parse_limit before it ever reaches this table.
    limit_value = Column(String, nullable=False)
    reason = Column(String, nullable=True)
    updated_by = Column(String, ForeignKey("users.id"), nullable=True)
    updated_at = Column(DateTime(timezone=True), nullable=False)


class MessageLog(Base):
    """One outbound message, with cost and outcome (Readiness List §19).

    SMS is both the primary reach channel for this user base and the largest
    recurring operational cost, and some messages (fine notices, hearing
    dates) are legal communications where "we sent it" and "it was
    delivered" are different claims.

    The message body is deliberately NOT stored — only a short preview.
    These carry names, fine amounts and hearing dates; retaining every
    message indefinitely would create a large pool of personal data with no
    operational use the metadata here does not already serve.
    """
    __tablename__ = "message_logs"

    id = Column(String, primary_key=True)
    phone = Column(String, nullable=False, index=True)
    user_id = Column(String, ForeignKey("users.id"), nullable=True)
    # otp, fine_notice, hearing_notice, booking_confirmation, ...
    category = Column(String, nullable=False, index=True)
    channel = Column(String, nullable=False, default="sms")

    # Billing is per segment, not per message. A stray curly quote switches
    # the encoding to UCS-2 and more than halves segment capacity, so both
    # are recorded rather than inferred later.
    segments = Column(Integer, nullable=False, default=1)
    is_unicode = Column(Boolean, nullable=False, default=False)
    cost_kes = Column(Numeric(12, 4), nullable=False, default=0)

    # SENT, FAILED, SUPPRESSED_OPT_OUT, DELIVERED, UNDELIVERED
    status = Column(String, nullable=False, index=True)
    error = Column(String, nullable=True)
    # Set from the provider's delivery receipt, which arrives after the send.
    delivered_at = Column(DateTime(timezone=True), nullable=True)
    provider_message_id = Column(String, nullable=True, index=True)

    reference_type = Column(String, nullable=True)
    reference_id = Column(String, nullable=True)
    body_preview = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, index=True)


class MessagingOptOut(Base):
    """Consent record for one phone number (Readiness List §19, §9).

    Keyed on the normalised international form, because the same person
    arrives as 0712…, +254712… and 254712… — an opt-out stored against one
    form that silently fails to match another is worse than none, since it
    looks compliant.
    """
    __tablename__ = "messaging_opt_outs"

    phone = Column(String, primary_key=True)
    opted_out_at = Column(DateTime(timezone=True), nullable=True)
    opted_in_at = Column(DateTime(timezone=True), nullable=True)
    source = Column(String, nullable=True)  # sms_reply, user_action, admin


class JournalEntry(Base):
    """One balanced accounting transaction (Readiness List §15).

    Immutable by contract: nothing updates or deletes a row here. A mistake
    is corrected by posting a reversing entry that points back via
    `reverses_entry_id`, so the trail records both what was believed at the
    time and what corrected it — which is precisely what an audit asks for.

    See app/ledger.py; postings are written only through post_entry(), which
    refuses to write an entry whose lines do not sum to zero.
    """
    __tablename__ = "journal_entries"

    id = Column(String, primary_key=True)
    description = Column(String, nullable=False)

    # What in the business domain caused this entry — "fine", "booking",
    # "licence_renewal" — and its id, so a row in the ledger can always be
    # traced back to the event that produced it.
    reference_type = Column(String, nullable=True, index=True)
    reference_id = Column(String, nullable=True, index=True)

    # Makes replay safe: a redelivered payment callback reusing this key
    # posts nothing rather than crediting the county twice.
    idempotency_key = Column(String, nullable=True, unique=True, index=True)

    actor_id = Column(String, nullable=True)
    reverses_entry_id = Column(String, ForeignKey("journal_entries.id"), nullable=True, index=True)

    # When the money actually moved, versus when we recorded it. These differ
    # whenever a callback arrives late, and reports must use the former.
    occurred_at = Column(DateTime(timezone=True), nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), nullable=False)

    postings = relationship("LedgerPosting", back_populates="entry")


class LedgerPosting(Base):
    """One line of a journal entry.

    `amount` is signed: positive is a debit, negative is a credit. One signed
    column rather than two makes "does this entry balance" a single SUM
    instead of a comparison between columns that could each be individually
    plausible.

    Numeric, never Float — binary floating point cannot represent 0.10, and a
    ledger that adds up money in floats eventually disagrees with the bank by
    a few cents that nobody can account for.
    """
    __tablename__ = "ledger_postings"

    id = Column(String, primary_key=True)
    entry_id = Column(String, ForeignKey("journal_entries.id"), nullable=False, index=True)
    line_number = Column(Integer, nullable=False)
    account = Column(String, nullable=False, index=True)
    amount = Column(Numeric(14, 2), nullable=False)
    memo = Column(String, nullable=True)

    entry = relationship("JournalEntry", back_populates="postings")


class ApiClient(Base):
    """A machine principal for the partner API (Readiness List §14).

    Deliberately NOT a row in `users`. Modelling an integration as a fake
    user account wrecks the audit trail (every action attributed to a person
    who did not perform it) and grants it a human's whole role instead of a
    narrow scope. See app/api_clients.py.
    """
    __tablename__ = "api_clients"

    id = Column(String, primary_key=True)
    name = Column(String, nullable=False)
    # Public identifier, safe to log and to show in the console.
    client_id = Column(String, unique=True, nullable=False, index=True)
    # SHA-256 of the secret — see api_clients.hash_secret for why not bcrypt.
    # The plaintext secret is shown once at creation and never stored.
    client_secret_hash = Column(String, nullable=False)

    # Owning Sacco. Populated for partner integrations, null for a
    # first-party internal system. This is what the existing ABAC rules
    # scope against, via effective_role below.
    sacco_id = Column(String, ForeignKey("saccos.id"), nullable=True)
    # What this client presents as to app/abac.py. A Sacco integration is
    # SACCO_OPERATOR, so it is confined to its own Sacco by exactly the
    # rules that govern human operators.
    effective_role = Column(String, nullable=False, default="SACCO_OPERATOR")

    # JSON list of scope strings from api_clients.SCOPES.
    scopes = Column(Text, nullable=False, default="[]")
    quota_tier = Column(String, nullable=False, default="partner")

    created_by = Column(String, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False)
    last_used_at = Column(DateTime(timezone=True), nullable=True)
    # Revocation is a timestamp rather than a delete, so a compromised
    # client's history stays auditable after its access is cut.
    revoked_at = Column(DateTime(timezone=True), nullable=True)
    revoked_reason = Column(String, nullable=True)

    def scope_list(self) -> list:
        import json
        try:
            value = json.loads(self.scopes or "[]")
            return value if isinstance(value, list) else []
        except (TypeError, ValueError):
            return []


class IdempotencyRecord(Base):
    """Recorded responses for replayed requests (app/idempotency.py).

    Exists because Kenyan mobile networks retry constantly and clients
    retry on their own: without this, one tap becomes two bookings and a
    redelivered payment callback credits a fine twice.

    Only successful responses are stored — replaying a key after a failure
    must genuinely retry, or a transient 500 would poison that key forever.
    Rows are purged after app/idempotency.py's retention window.
    """
    __tablename__ = "idempotency_records"

    # The client-supplied key. Primary key, so a concurrent duplicate insert
    # fails at the database rather than racing to two executions.
    key = Column(String, primary_key=True)
    # Who supplied it, best-effort, for debugging and abuse investigation.
    actor_id = Column(String, nullable=True)
    endpoint = Column(String, nullable=False)
    # SHA-256 of the request body: lets a replay be checked for being the
    # same operation without retaining the original payload.
    request_fingerprint = Column(String, nullable=False)
    response_body = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, index=True)


class SystemControl(Base):
    """Maintenance mode and feature kill switches (Ops Console Rebuild Spec
    §21.3, Critical tier).

    Separate from FeatureFlag deliberately: a feature flag is a product
    decision about whether a capability is on, while these are incident
    levers for shedding load or taking the system out of service. They are
    Critical-classified and require re-authentication to change, which a
    feature flag does not.

    See app/ops_controls.py for the key namespace ("maintenance_mode",
    "killswitch:<feature>") and the read path.
    """
    __tablename__ = "system_controls"

    key = Column(String, primary_key=True)
    enabled = Column(Boolean, nullable=False, default=False)
    # JSON blob for anything the control needs beyond on/off — the
    # maintenance scope and operator message live here.
    value = Column(Text, nullable=True)
    reason = Column(String, nullable=True)
    updated_by = Column(String, ForeignKey("users.id"), nullable=True)
    updated_at = Column(DateTime(timezone=True), nullable=False)


class Sector(Base):
    """A PTCU sector — the top level of the county's real enforcement
    geography, above Zone. Taken from the Public Transport Control Unit's
    own monthly allocation sheet, which is organised Section -> Sector
    (1-11, plus 5B) -> Zone (1-13) -> officer.

    Each sector has a named commander and a deputy, and that is a real
    operational fact rather than an org-chart nicety: the sheet prints the
    commander's mobile number beside the sector because that is who you
    call about that stretch of road. Modelled as FKs to User so the roster
    resolves a live account, not a string that goes stale when someone
    transfers.
    """
    __tablename__ = "sectors"

    id = Column(String, primary_key=True, index=True)
    # "1", "5B", "11" — as printed. String, not int, precisely because of
    # 5B: the county splits a sector without renumbering the rest.
    code = Column(String, nullable=False, unique=True)
    name = Column(String, nullable=False)  # "TOM MBOYA FROM KHOJA ROUNDABOUT - LATEMA"
    description = Column(String, nullable=True)
    # use_alter on both: users -> zones (assigned_zone_id) -> sectors
    # (zones.sector_id) -> users (here) is a genuine circular FK dependency.
    # Without use_alter, SQLAlchemy's create_all cannot topologically sort
    # the tables and raises CircularDependencyError at dev startup, and
    # Postgres cannot create the tables in any order either. Deferring these
    # two constraints to an ALTER after table creation breaks the cycle at
    # exactly the least-load-bearing link — a sector's commander is a
    # convenience pointer, not a structural parent.
    commander_id = Column(String, ForeignKey("users.id", use_alter=True, name="fk_sectors_commander_id"), nullable=True)
    deputy_commander_id = Column(String, ForeignKey("users.id", use_alter=True, name="fk_sectors_deputy_commander_id"), nullable=True)
    # Contact number as printed on the sheet. Deliberately stored on the
    # sector rather than read off the commander's User.phone: the sheet's
    # number is the *post's* number (it moves with the role, and is often a
    # unit handset), not necessarily that person's personal line.
    contact_phone = Column(String, nullable=True)
    # Map placement — see Zone below for why this is GeoJSON text and not
    # a PostGIS geometry.
    center_lat = Column(Float, nullable=True)
    center_lng = Column(Float, nullable=True)
    boundary_geojson = Column(Text, nullable=True)
    display_order = Column(Integer, nullable=False, default=0)
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), nullable=False)

    commander = relationship("User", foreign_keys=[commander_id])
    deputy_commander = relationship("User", foreign_keys=[deputy_commander_id])
    zones = relationship("Zone", back_populates="sector")


class Zone(Base):
    """Extended from a bare label to a real, mappable posting.

    The four original rows here were coarse corridor labels with no
    geography at all ("CBD Corridor", "Thika Road Corridor"). The county's
    actual zones are street-level postings inside a sector — "TOM MBOYA /
    KHOJA / MOI LANE", "FIRE LANE / TIMBOROA LANE / LAGOS" — which is what
    an officer is actually stood on and what a commander actually points at
    on a map.

    `sector_id` is nullable so the four legacy corridor zones survive
    untouched: they are still referenced by `beats.zone_id` and by
    `users.assigned_zone_id`, and orphaning those FKs to tidy the taxonomy
    would break working data for a cosmetic gain.

    Geometry is GeoJSON in a Text column, not PostGIS. This matches the
    grain of the rest of the system, which deliberately avoids a spatial
    extension (see Beat's docstring and the corridor-approximation note on
    RouteStage) — and nothing here needs a spatial index or an ST_ query.
    A zone is drawn and clicked, not spatially joined.
    """
    __tablename__ = "zones"

    id = Column(String, primary_key=True, index=True)
    name = Column(String, nullable=False)
    description = Column(String, nullable=True)
    sector_id = Column(String, ForeignKey("sectors.id"), nullable=True)
    code = Column(String, nullable=True)  # "1".."13", or null for the legacy corridor zones
    center_lat = Column(Float, nullable=True)
    center_lng = Column(Float, nullable=True)
    boundary_geojson = Column(Text, nullable=True)
    display_order = Column(Integer, nullable=False, default=0)
    is_active = Column(Boolean, nullable=False, default=True)

    sector = relationship("Sector", back_populates="zones", foreign_keys=[sector_id])


class DemandSignal(Base):
    """One origin-destination search or booking — the raw material for the
    demand-intelligence aggregation in ARCHITECTURE_DECISIONS.md §27.3.
    "Passenger search and booking activity is itself the data source":
    aggregating these reproduces the BRN report's one-time 3,991-passenger
    survey continuously and live instead of as a point-in-time snapshot.
    Deliberately a flat append-only log (indexed for the two aggregate
    queries that read it) rather than anything normalized further — this
    table exists to be GROUP BY'd, not joined deeply.
    """
    __tablename__ = "demand_signals"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    from_stage_id = Column(String, ForeignKey("stages.id"), nullable=False)
    to_stage_id = Column(String, ForeignKey("stages.id"), nullable=True)  # null for a boarding-only signal
    source = Column(String, nullable=False)  # SEARCH, BOOKING
    recorded_at = Column(DateTime(timezone=True), nullable=False)


class Beat(Base):
    """An enforcement beat — a route-segment, not a polygon
    (ARCHITECTURE_DECISIONS.md §22.2): an ordered slice of one route's
    corridor between two stages. Reuses the Stage/RouteStage geometry
    already digitized from the BRN report (Task 8) rather than inventing a
    parallel geometry system — "this stretch to this stretch" is just two
    positions along one route's existing stage sequence. `zone_id` is kept
    as an optional coarse administrative grouping per §22.2's decision to
    keep Zone alongside, not fork it.
    """
    __tablename__ = "beats"

    id = Column(String, primary_key=True, index=True)
    name = Column(String, nullable=False)
    route_id = Column(String, ForeignKey("routes.id"), nullable=False)
    from_stage_id = Column(String, ForeignKey("stages.id"), nullable=False)
    to_stage_id = Column(String, ForeignKey("stages.id"), nullable=False)
    zone_id = Column(String, ForeignKey("zones.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False)

    route = relationship("Route")
    from_stage = relationship("Stage", foreign_keys=[from_stage_id])
    to_stage = relationship("Stage", foreign_keys=[to_stage_id])
    zone = relationship("Zone")


class BeatAssignment(Base):
    """Time-boxed officer-to-beat assignment (§22.3) — replaces the single
    sticky `User.assigned_zone_id` field's "one zone, no shift window, no
    history" limitation with a real assignment record, additive alongside
    it (assigned_zone_id stays as-is; nothing currently reading it breaks).
    Yields a real roster/coverage-timeline view and an assignment history,
    neither of which a single mutable field can provide.
    """
    __tablename__ = "beat_assignments"

    id = Column(String, primary_key=True, index=True)
    officer_id = Column(String, ForeignKey("users.id"), nullable=False)
    beat_id = Column(String, ForeignKey("beats.id"), nullable=False)
    shift_date = Column(Date, nullable=False)
    shift_start = Column(DateTime(timezone=True), nullable=False)
    shift_end = Column(DateTime(timezone=True), nullable=False)
    assigned_by = Column(String, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False)

    officer = relationship("User", foreign_keys=[officer_id])
    beat = relationship("Beat")
    assigner = relationship("User", foreign_keys=[assigned_by])


class DutyAllocation(Base):
    """One month's duty allocation — the digital form of the signed sheet
    the Section Commander sends to the Director of City Inspectorate
    ("ALLOCATION OF DUTY ... REF: SC/P.T.C.U./5/VOL.III/9/2026 ... MONTH:
    SEPTEMBER, YEAR 2026").

    Deliberately a document, not a loose pile of assignments. The paper
    process has a real draft->sign->circulate lifecycle, and reproducing
    that matters operationally: officers must not see next month's postings
    while the commander is still moving people around, and once published,
    "what were the orders on the 14th" needs to be answerable months later
    without reconstructing it from mutable rows.

    Distinct from BeatAssignment above, which stays as-is: that is a
    route-segment patrol slot on a specific datetime window, this is the
    monthly establishment — which officer holds which posting, all month.
    """
    __tablename__ = "duty_allocations"

    id = Column(String, primary_key=True, index=True)
    year = Column(Integer, nullable=False)
    month = Column(Integer, nullable=False)  # 1-12
    # The county's own file reference, as printed. Free text: the format is
    # the registry's, not this system's, and it is what someone searching
    # the physical file will quote.
    reference_no = Column(String, nullable=True)
    title = Column(String, nullable=True)
    status = Column(String, nullable=False, default="DRAFT")  # DRAFT, PUBLISHED, ARCHIVED
    notes = Column(Text, nullable=True)
    created_by = Column(String, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False)
    published_by = Column(String, ForeignKey("users.id"), nullable=True)
    published_at = Column(DateTime(timezone=True), nullable=True)

    creator = relationship("User", foreign_keys=[created_by])
    publisher = relationship("User", foreign_keys=[published_by])
    assignments = relationship("DutyAssignment", back_populates="allocation", cascade="all, delete-orphan")

    __table_args__ = (
        # One allocation document per month. The paper process issues one
        # sheet per month; two "current" allocations for September is not a
        # state anyone could act on.
        UniqueConstraint("year", "month", name="uq_duty_allocation_year_month"),
    )


class DutyAssignment(Base):
    """One officer's posting within a monthly allocation — one printed row
    of the sheet.

    A posting is either a zone, a sector (sector command and deputies sit
    at sector level, above any single zone), or neither: MOBILE, GENERAL
    STORE and the M.E.U LOADING ZONES on the real sheet are postings with
    no geography at all. `work_station` carries the printed label in every
    case, so a row always reads the way the sheet reads even when zone_id
    and sector_id are both null.

    `coverage` is how the sheet's daily and weekend allocations are one
    table rather than two: a DAILY row applies every day of the month, a
    WEEKEND row only Saturday/Sunday, WEEKDAY only Monday-Friday. Resolving
    "who is posted on the 14th" is then a filter on coverage against that
    date's weekday, not a separate document per pattern.
    """
    __tablename__ = "duty_assignments"

    id = Column(String, primary_key=True, index=True)
    allocation_id = Column(String, ForeignKey("duty_allocations.id"), nullable=False, index=True)
    officer_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    sector_id = Column(String, ForeignKey("sectors.id"), nullable=True)
    zone_id = Column(String, ForeignKey("zones.id"), nullable=True)
    # The printed WORK STATION cell — "KHOJA / KILOME ROAD", "MOBILE",
    # "GENERAL STORE", "I/C LOADING ZONE", "SECTOR COMMANDER".
    work_station = Column(String, nullable=False)
    # DAY, NOON, NIGHT — the sheet's SHIFT column. DAY and NOON are the two
    # actually in use; NIGHT is accepted because a duty system that cannot
    # express a night shift will need a migration the first time one runs.
    shift = Column(String, nullable=False, default="DAY")
    coverage = Column(String, nullable=False, default="DAILY")  # DAILY, WEEKDAY, WEEKEND
    # Optional narrowing inside the month, for a posting that starts or
    # ends mid-month (a transfer in, a secondment out). Null means "the
    # whole month", which is the common case.
    effective_from = Column(Date, nullable=True)
    effective_to = Column(Date, nullable=True)
    # Free-text role marker as printed: "I/C" (in charge), "DEPUTY
    # COMMANDER", "SECTOR COMMANDER". Not a permission — permissions come
    # from the role matrix — but it is what the sheet conveys and what
    # officers actually go by on the ground.
    posting_role = Column(String, nullable=True)
    notes = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False)

    allocation = relationship("DutyAllocation", back_populates="assignments")
    officer = relationship("User", foreign_keys=[officer_id])
    sector = relationship("Sector")
    zone = relationship("Zone")


class Broadcast(Base):
    """A command message from a commander to officers — one officer, a
    zone, a sector, or everyone.

    Persisted, unlike the rest of this system's notifications. notify_user()
    is explicitly "a live nudge, not a durable inbox": if the officer's
    browser is closed the toast is simply missed. That is the right trade
    for "your booking was confirmed" and the wrong one for "report to
    Muthurwa at 0600" — an order nobody can prove was issued or read is not
    an order. So a Broadcast is a row first and a live push second.
    """
    __tablename__ = "broadcasts"

    id = Column(String, primary_key=True, index=True)
    subject = Column(String, nullable=False)
    body = Column(Text, nullable=False)
    # NORMAL, URGENT. Urgent is not decoration: it is what the officer's
    # own view sorts and highlights on, and what justifies interrupting
    # someone mid-shift.
    priority = Column(String, nullable=False, default="NORMAL")
    # ALL, SECTOR, ZONE, OFFICER — recorded as sent, so "who was this
    # addressed to" survives an officer later transferring out of the zone
    # it was sent to.
    audience = Column(String, nullable=False)
    audience_sector_id = Column(String, ForeignKey("sectors.id"), nullable=True)
    audience_zone_id = Column(String, ForeignKey("zones.id"), nullable=True)
    sent_by = Column(String, ForeignKey("users.id"), nullable=False)
    sent_at = Column(DateTime(timezone=True), nullable=False, index=True)

    sender = relationship("User", foreign_keys=[sent_by])
    sector = relationship("Sector")
    zone = relationship("Zone")
    recipients = relationship("BroadcastRecipient", back_populates="broadcast", cascade="all, delete-orphan")


class BroadcastRecipient(Base):
    """Per-officer delivery row, resolved at send time rather than
    re-derived on read.

    Resolving "everyone in Sector 4" once, at send, is what makes the
    record honest: an officer posted into that sector tomorrow was not sent
    yesterday's order and should not retroactively appear to have been,
    and an officer posted out of it still needs to see what they were
    actually sent. Re-running the audience query on every read would get
    both of those wrong.
    """
    __tablename__ = "broadcast_recipients"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    broadcast_id = Column(String, ForeignKey("broadcasts.id"), nullable=False, index=True)
    officer_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    read_at = Column(DateTime(timezone=True), nullable=True)

    broadcast = relationship("Broadcast", back_populates="recipients")
    officer = relationship("User", foreign_keys=[officer_id])

    __table_args__ = (
        UniqueConstraint("broadcast_id", "officer_id", name="uq_broadcast_recipient"),
    )


class OffenceType(Base):
    __tablename__ = "offence_types"

    id = Column(String, primary_key=True, index=True)
    name = Column(String, nullable=False)
    default_fine_kes = Column(Numeric(12, 2), nullable=False)
    is_other = Column(Boolean, default=False)  # "Other" needs a free-text description at the scene

class EnforcementCase(Base):
    """
    An arrest-to-release enforcement case. Deliberately separate from the
    legacy CrimeRecord table (still used by the general ENFORCEMENT role's
    simpler citation flow) — this backs the new Arresting/Releasing Officer
    split workflow with a public case reference offenders can pay against
    without logging in.
    """
    __tablename__ = "enforcement_cases"

    id = Column(String, primary_key=True, index=True)
    case_reference = Column(String, unique=True, index=True, nullable=False)  # e.g. MMS-36898KDY541L

    reg_number = Column(String, nullable=False)
    offence_type_id = Column(String, ForeignKey("offence_types.id"), nullable=False)
    offence_description = Column(String, nullable=True)  # required when offence is "Other"
    fine_amount_kes = Column(Numeric(12, 2), nullable=False)  # locked from the offence type at creation time

    action_taken = Column(String, nullable=False)  # IMPOUND, SELF_DRIVE_IMPOUND, TOLL
    photo_paths = Column(Text, nullable=True)  # JSON list of /uploads paths

    zone_id = Column(String, ForeignKey("zones.id"), nullable=True)
    arresting_officer_id = Column(String, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False)

    # ARRESTED, PAID, RELEASED, DISPUTED, UNDER_REVIEW, RESOLVED_UPHELD,
    # RESOLVED_OVERTURNED, RESOLVED_PARTIAL, WAIVED. DISPUTED -> UNDER_REVIEW
    # -> RESOLVED_* mirrors Sacco verification's two-stage
    # (director_mobility_status / chief_officer_status) pattern: a dispute
    # is raised, a reviewer picks it up, then records a final outcome.
    status = Column(String, default="ARRESTED")
    payment_reference = Column(String, nullable=True)
    paid_at = Column(DateTime(timezone=True), nullable=True)

    releasing_officer_id = Column(String, ForeignKey("users.id"), nullable=True)
    released_at = Column(DateTime(timezone=True), nullable=True)

    dispute_reason = Column(Text, nullable=True)
    disputed_at = Column(DateTime(timezone=True), nullable=True)
    reviewer_id = Column(String, ForeignKey("users.id"), nullable=True)
    review_notes = Column(Text, nullable=True)  # JSON list of {authorId, authorName, note, at}
    resolution = Column(String, nullable=True)  # UPHELD, OVERTURNED, PARTIAL
    resolution_reason = Column(Text, nullable=True)
    resolved_by_id = Column(String, ForeignKey("users.id"), nullable=True)
    resolved_at = Column(DateTime(timezone=True), nullable=True)

    waived_reason = Column(Text, nullable=True)
    waived_authorized_by = Column(String, nullable=True)

    offence_type = relationship("OffenceType")
    zone = relationship("Zone")
    arresting_officer = relationship("User", foreign_keys=[arresting_officer_id])
    releasing_officer = relationship("User", foreign_keys=[releasing_officer_id])
    reviewer = relationship("User", foreign_keys=[reviewer_id])
    resolved_by = relationship("User", foreign_keys=[resolved_by_id])

class WebhookSubscription(Base):
    __tablename__ = "webhook_subscriptions"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    url = Column(String, nullable=False)
    sacco_id = Column(String, ForeignKey("saccos.id"), nullable=False)
    events = Column(String, nullable=False)
    active = Column(Boolean, default=True)

class WebhookLog(Base):
    __tablename__ = "webhook_logs"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    subscription_id = Column(Integer, ForeignKey("webhook_subscriptions.id"), nullable=False)
    event_type = Column(String, nullable=False)
    payload = Column(Text, nullable=False)
    status_code = Column(Integer, nullable=True)
    error_message = Column(Text, nullable=True)
    attempt = Column(Integer, default=1)
    timestamp = Column(DateTime(timezone=True), nullable=False)


class UploadedFile(Base):
    """DB-backed fallback for uploaded files (app/storage.py's "db" backend)
    — used on Render, where the backend's own disk isn't persistent and no
    payment method is on file for S3-compatible object storage. Postgres
    already persists reliably there for free, so this trades "files live in
    a real object store" for "files live as bytes in the same DB that's
    already durable" — fine at this project's current upload volume, not a
    forever architecture at real scale.
    `key` is the same "{category}/{entity_id}/{stored_name}" path used by
    the local-disk and S3 backends, so switching STORAGE_BACKEND later
    doesn't change any URL shape callers depend on."""
    __tablename__ = "uploaded_files"

    key = Column(String, primary_key=True)
    content_type = Column(String, nullable=False)
    data = Column(LargeBinary, nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False)
