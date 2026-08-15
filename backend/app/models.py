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

    users = relationship("User", back_populates="sacco")
    matatus = relationship("Matatu", back_populates="sacco")

class User(Base):
    __tablename__ = "users"

    id = Column(String, primary_key=True, index=True)
    name = Column(String, nullable=False)
    email = Column(String, unique=True, index=True, nullable=False)
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

    crew_assignments = relationship("CrewAssignment", back_populates="user")

    sacco = relationship("Sacco", back_populates="users")
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

    status = Column(String, default="ARRESTED")  # ARRESTED, PAID, RELEASED, DISPUTED, WAIVED
    payment_reference = Column(String, nullable=True)
    paid_at = Column(DateTime(timezone=True), nullable=True)

    releasing_officer_id = Column(String, ForeignKey("users.id"), nullable=True)
    released_at = Column(DateTime(timezone=True), nullable=True)

    dispute_reason = Column(Text, nullable=True)
    waived_reason = Column(Text, nullable=True)
    waived_authorized_by = Column(String, nullable=True)

    offence_type = relationship("OffenceType")
    zone = relationship("Zone")
    arresting_officer = relationship("User", foreign_keys=[arresting_officer_id])
    releasing_officer = relationship("User", foreign_keys=[releasing_officer_id])

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
