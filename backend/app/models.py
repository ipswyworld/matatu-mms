import datetime
from sqlalchemy import Column, String, Integer, Float, ForeignKey, DateTime, Boolean, Text
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
    created_at = Column(String, nullable=True)
    application_submitted_at = Column(String, nullable=True)  # set once the operator finishes the onboarding wizard

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
    director_mobility_decided_at = Column(String, nullable=True)
    chief_officer_status = Column(String, default="PENDING")  # PENDING, APPROVED, REJECTED
    chief_officer_reason = Column(Text, nullable=True)
    chief_officer_decided_by = Column(String, nullable=True)
    chief_officer_decided_at = Column(String, nullable=True)

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
    terms_accepted_at = Column(String, nullable=True)
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
    reset_token_expires_at = Column(String, nullable=True)

    sacco = relationship("Sacco", back_populates="users")
    assigned_zone = relationship("Zone")

class Route(Base):
    __tablename__ = "routes"

    id = Column(String, primary_key=True, index=True)
    code = Column(String, nullable=False, unique=True)
    name = Column(String, nullable=False)
    description = Column(String, nullable=True)
    fare_kes = Column(Float, default=100.0)

    matatus = relationship("Matatu", back_populates="route")

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
    created_at = Column(String, nullable=False)

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

class ActivityLog(Base):
    __tablename__ = "activity_logs"

    id = Column(String, primary_key=True, index=True)
    matatu_id = Column(String, ForeignKey("matatus.id"), nullable=False)
    type = Column(String, nullable=False)
    description = Column(Text, nullable=False)
    location = Column(String, nullable=False)
    officer_id = Column(String, ForeignKey("users.id"), nullable=False)
    timestamp = Column(String, nullable=False)

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
    fine_amount_kes = Column(Float, default=0.0)
    remarks = Column(Text, nullable=True)
    officer_id = Column(String, ForeignKey("users.id"), nullable=False)
    timestamp = Column(String, nullable=False)
    status = Column(String, default="PENDING")  # PENDING, PROCESSED, PAID, DISPUTED
    photo_path = Column(String, nullable=True)

    officer = relationship("User")

class Fine(Base):
    __tablename__ = "fines"

    id = Column(String, primary_key=True, index=True)
    matatu_id = Column(String, ForeignKey("matatus.id"), nullable=False)
    officer_id = Column(String, ForeignKey("users.id"), nullable=False)
    reason = Column(String, nullable=False)
    amount_kes = Column(Float, nullable=False)
    status = Column(String, default="PENDING")
    issued_at = Column(String, nullable=False)
    due_date = Column(String, nullable=False)

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
    fare_kes = Column(Float, nullable=False)
    status = Column(String, default="CONFIRMED")  # CONFIRMED, USED, CANCELLED
    booked_at = Column(String, nullable=False)

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
    created_at = Column(String, nullable=False)

class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    resource_type = Column(String, nullable=False)
    resource_id = Column(String, nullable=False)
    action = Column(String, nullable=False)
    old_values = Column(Text, nullable=True)
    new_values = Column(Text, nullable=True)
    user_id = Column(String, nullable=False)
    timestamp = Column(String, nullable=False)

class Zone(Base):
    __tablename__ = "zones"

    id = Column(String, primary_key=True, index=True)
    name = Column(String, nullable=False)
    description = Column(String, nullable=True)

class OffenceType(Base):
    __tablename__ = "offence_types"

    id = Column(String, primary_key=True, index=True)
    name = Column(String, nullable=False)
    default_fine_kes = Column(Float, nullable=False)
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
    fine_amount_kes = Column(Float, nullable=False)  # locked from the offence type at creation time

    action_taken = Column(String, nullable=False)  # IMPOUND, SELF_DRIVE_IMPOUND, TOLL
    photo_paths = Column(Text, nullable=True)  # JSON list of /uploads paths

    zone_id = Column(String, ForeignKey("zones.id"), nullable=True)
    arresting_officer_id = Column(String, ForeignKey("users.id"), nullable=False)
    created_at = Column(String, nullable=False)

    status = Column(String, default="ARRESTED")  # ARRESTED, PAID, RELEASED, DISPUTED, WAIVED
    payment_reference = Column(String, nullable=True)
    paid_at = Column(String, nullable=True)

    releasing_officer_id = Column(String, ForeignKey("users.id"), nullable=True)
    released_at = Column(String, nullable=True)

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
    timestamp = Column(String, nullable=False)
