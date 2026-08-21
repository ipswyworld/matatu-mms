import datetime
from sqlalchemy import Column, String, Integer, Float, Numeric, Date, ForeignKey, DateTime, Boolean, Text
from sqlalchemy.orm import relationship
from app.database import Base

class Sacco(Base):
    __tablename__ = "saccos"

    id = Column(String, primary_key=True, index=True)
    name = Column(String, nullable=False)
    status = Column(String, default="ACTIVE")  # PENDING_VERIFICATION, ACTIVE, REJECTED, SUSPENDED
    license_status = Column(String, default="ACTIVE")  # ACTIVE, RENEWAL_DUE, EXPIRED
    primary_route_id = Column(String, nullable=True)
    secondary_route_ids = Column(String, nullable=True)  # Comma separated route IDs

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

    # Passenger's preferred operator (roadmap: "passenger side they can
    # pick a favorite sacco/operator they prefer") — self-service only, set
    # via PATCH /api/users/me/favorite-sacco, never by an admin/operator
    # editing someone else's account.
    favorite_sacco_id = Column(String, ForeignKey("saccos.id"), nullable=True)

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

class Zone(Base):
    __tablename__ = "zones"

    id = Column(String, primary_key=True, index=True)
    name = Column(String, nullable=False)
    description = Column(String, nullable=True)


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
