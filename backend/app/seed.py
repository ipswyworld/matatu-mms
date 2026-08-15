from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from app.models import Sacco, User, Route, Matatu, ActivityLog, Fine, Zone, OffenceType
from app.auth import get_password_hash
import datetime


def _dt(s: str) -> datetime.datetime:
    """Parses a fixed ISO seed-data string into a real tz-aware datetime,
    now that the corresponding columns are DateTime(timezone=True) instead
    of String."""
    d = datetime.datetime.fromisoformat(s.replace("Z", "+00:00"))
    if d.tzinfo is None:
        d = d.replace(tzinfo=datetime.timezone.utc)
    return d


def _date(s: str) -> datetime.date:
    """Parses a fixed ISO seed-data date string into a real date, for the
    Fine.due_date column (a calendar date, not a moment in time)."""
    return datetime.date.fromisoformat(s)

async def seed_data(db: AsyncSession):
    # Check if data already exists
    sacco_check = await db.execute(select(Sacco))
    if sacco_check.scalars().first():
        return  # Already seeded

    # Seed Saccos
    saccos = [
        Sacco(
            id="sacco-1", name="Umoinner Sacco", status="ACTIVE", license_status="ACTIVE",
            sacco_type="EXISTING", created_at=_dt("2024-01-15T00:00:00Z"),
            doc_registration_cert="/uploads/saccos/sacco-1/seed-registration-cert.pdf",
            doc_road_service_license="/uploads/saccos/sacco-1/seed-rsl.pdf",
            doc_county_permit="/uploads/saccos/sacco-1/seed-county-permit.pdf",
            doc_single_business_permit="/uploads/saccos/sacco-1/seed-sbp.pdf",
            doc_tax_compliance_cert="/uploads/saccos/sacco-1/seed-tax-compliance.pdf",
            doc_officials_contacts='{"chairpersonName": "Peter Njoroge", "chairpersonPhone": "+254722000111", "secretaryName": "Mary Wanjiku", "secretaryPhone": "+254733222333", "treasurerName": "David Otieno", "treasurerPhone": "+254711444555"}',
            director_mobility_status="APPROVED", director_mobility_decided_by="Director of Mobility", director_mobility_decided_at=_dt("2024-01-20T00:00:00Z"),
            chief_officer_status="APPROVED", chief_officer_decided_by="Chief Officer", chief_officer_decided_at=_dt("2024-01-25T00:00:00Z"),
        ),
        Sacco(
            id="sacco-2", name="Rembo Shuttle Sacco", status="ACTIVE", license_status="RENEWAL_DUE",
            sacco_type="EXISTING", created_at=_dt("2024-03-10T00:00:00Z"),
            doc_registration_cert="/uploads/saccos/sacco-2/seed-registration-cert.pdf",
            doc_road_service_license="/uploads/saccos/sacco-2/seed-rsl.pdf",
            doc_county_permit="/uploads/saccos/sacco-2/seed-county-permit.pdf",
            doc_single_business_permit="/uploads/saccos/sacco-2/seed-sbp.pdf",
            doc_tax_compliance_cert="/uploads/saccos/sacco-2/seed-tax-compliance.pdf",
            doc_officials_contacts='{"chairpersonName": "Susan Achieng", "chairpersonPhone": "+254700111222", "secretaryName": "Brian Kiplagat", "secretaryPhone": "+254711222333", "treasurerName": "Faith Mwangi", "treasurerPhone": "+254722333444"}',
            director_mobility_status="APPROVED", director_mobility_decided_by="Director of Mobility", director_mobility_decided_at=_dt("2024-03-15T00:00:00Z"),
            chief_officer_status="APPROVED", chief_officer_decided_by="Chief Officer", chief_officer_decided_at=_dt("2024-03-20T00:00:00Z"),
        ),
        Sacco(
            id="sacco-3", name="Kenya Mpya Sacco", status="PENDING_VERIFICATION", license_status="ACTIVE",
            sacco_type="NEW", created_at=_dt("2026-07-20T00:00:00Z"),
            doc_registration_cert="/uploads/saccos/sacco-3/seed-registration-cert.pdf",
            doc_road_service_license="/uploads/saccos/sacco-3/seed-rsl.pdf",
            doc_county_permit="/uploads/saccos/sacco-3/seed-county-permit.pdf",
            doc_single_business_permit="/uploads/saccos/sacco-3/seed-sbp.pdf",
            doc_officials_contacts='{"chairpersonName": "Samuel Kariuki", "chairpersonPhone": "+254733555666", "secretaryName": "Lucy Nafula", "secretaryPhone": "+254744666777", "treasurerName": "Moses Cheruiyot", "treasurerPhone": "+254755777888"}',
            director_mobility_status="PENDING", chief_officer_status="PENDING",
        ),
        Sacco(
            id="sacco-4", name="Kilimani Direct Shuttle Sacco", status="PENDING_VERIFICATION", license_status="ACTIVE",
            sacco_type="NEW", created_at=_dt("2026-07-28T00:00:00Z"),
            director_mobility_status="PENDING", chief_officer_status="PENDING",
        ),
    ]
    for s in saccos:
        db.add(s)

    # Seed Routes
    routes = [
        Route(id="route-1", code="111", name="CBD - Rongai", description="Nairobi CBD to Ongata Rongai via Langata Rd", fare_kes=100.0),
        Route(id="route-2", code="58", name="CBD - Kasarani", description="Nairobi CBD to Kasarani via Thika Rd", fare_kes=80.0),
        Route(id="route-3", code="34", name="CBD - Kawangware", description="Nairobi CBD to Kawangware via Waiyaki Way", fare_kes=70.0),
        Route(id="route-4", code="125", name="CBD - Umoja", description="Nairobi CBD to Umoja via Jogoo Rd", fare_kes=90.0),
    ]
    for r in routes:
        db.add(r)

    # Seed Enforcement Zones/Corridors (simple named-zone picker for now —
    # a real interactive GIS map is a planned upgrade once a mapping
    # provider is chosen)
    zones = [
        Zone(id="zone-cbd", name="CBD Corridor", description="Nairobi CBD and immediate approach roads"),
        Zone(id="zone-thika-road", name="Thika Road Corridor", description="Thika Road from CBD to Kasarani/Roysambu"),
        Zone(id="zone-langata", name="Langata Corridor", description="Langata Road and Rongai approach"),
        Zone(id="zone-outer-ring", name="Outer Ring Corridor", description="Outer Ring Road / Kawangware / Waiyaki Way"),
    ]
    for z in zones:
        db.add(z)

    # Seed Offence Catalog — fine amounts are fixed by county officials and
    # locked automatically when an Arresting Officer selects the offence;
    # they are never typed in by the officer at the scene.
    offence_types = [
        OffenceType(id="off-illegal-parking", name="Illegal Parking", default_fine_kes=5000.0),
        OffenceType(id="off-overloading", name="Overloading Beyond Licensed Capacity", default_fine_kes=10000.0),
        OffenceType(id="off-reckless-driving", name="Reckless / Dangerous Driving", default_fine_kes=15000.0),
        OffenceType(id="off-no-psv-badge", name="Operating Without a Valid PSV Badge", default_fine_kes=3000.0),
        OffenceType(id="off-expired-license", name="Expired Driving License", default_fine_kes=5000.0),
        OffenceType(id="off-no-safety-equipment", name="Missing Safety Equipment (Fire Extinguisher/First Aid)", default_fine_kes=2000.0),
        OffenceType(id="off-no-receipt", name="Failure to Issue Fare Receipt", default_fine_kes=1000.0),
        OffenceType(id="off-other", name="Other (describe at scene)", default_fine_kes=2000.0, is_other=True),
    ]
    for o in offence_types:
        db.add(o)

    # Seed Users (hashing their passwords)
    users = [
        User(
            id="u-superadmin",
            name="Wanjiru Kamau",
            email="superadmin@nairobi.go.ke",
            password=get_password_hash("superadmin123"),
            role="SUPERADMIN"
        ),
        User(
            id="u-admin",
            name="Grace Wambui",
            email="admin@nairobi.go.ke",
            password=get_password_hash("admin123"),
            role="ADMIN"
        ),
        User(
            id="u-enforce",
            name="Peter Otieno",
            email="enforcement@nairobi.go.ke",
            password=get_password_hash("enforce123"),
            role="ENFORCEMENT"
        ),
        User(
            id="u-sacco",
            name="Daniel Kiptoo",
            email="operator@umoinner.co.ke",
            password=get_password_hash("sacco123"),
            role="SACCO_OPERATOR",
            sacco_id="sacco-1"
        ),
        User(
            id="u-viewer",
            name="Hon. Alice Njeri",
            email="viewer@nairobi.go.ke",
            password=get_password_hash("viewer123"),
            role="VIEWER"
        ),
        User(
            id="u-passenger",
            name="John Kamau",
            email="commuter@nairobi.go.ke",
            password=get_password_hash("pass123"),
            role="PASSENGER"
        ),
        User(
            id="u-crew",
            name="James Omwamba",
            email="crew@umoinner.co.ke",
            password=get_password_hash("crew123"),
            role="CREW",
            sacco_id="sacco-1"
        ),
        User(
            id="u-director-mobility",
            name="Eng. Samuel Mwaura",
            email="director.mobility@nairobi.go.ke",
            password=get_password_hash("director123"),
            role="DIRECTOR_MOBILITY"
        ),
        User(
            id="u-chief-officer",
            name="Ms. Josephine Wanjala",
            email="chiefofficer@nairobi.go.ke",
            password=get_password_hash("chief123"),
            role="CHIEF_OFFICER"
        ),
        User(
            id="u-sacco4",
            name="Michael Kamande",
            email="operator@kilimanidirect.co.ke",
            password=get_password_hash("sacco123"),
            role="SACCO_OPERATOR",
            sacco_id="sacco-4"
        ),
        User(
            id="u-commander",
            name="Cdr. Francis Mutua",
            email="commander@nairobi.go.ke",
            password=get_password_hash("commander123"),
            role="ENFORCEMENT_COMMANDER",
            commander_title="Commander of Public Transport Compliance",
        ),
        User(
            id="u-arresting",
            name="Officer Brian Kiprop",
            email="arresting.officer@nairobi.go.ke",
            password=get_password_hash("arrest123"),
            role="ARRESTING_OFFICER",
            enforcement_duty="ARRESTING",
            assigned_zone_id="zone-cbd",
        ),
        User(
            id="u-releasing",
            name="Officer Nancy Chebet",
            email="releasing.officer@nairobi.go.ke",
            password=get_password_hash("release123"),
            role="RELEASING_OFFICER",
            enforcement_duty="RELEASING",
        ),
    ]
    for u in users:
        db.add(u)

    # Seed Matatus
    matatus = [
        Matatu(id="m-1", reg_number="KDA 112B", sacco_id="sacco-1", route_id="route-1", capacity=33, status="ACTIVE", last_inspection="2026-06-02", created_at=_dt("2025-01-10")),
        Matatu(id="m-2", reg_number="KCY 902K", sacco_id="sacco-1", route_id="route-1", capacity=14, status="FLAGGED", last_inspection="2026-04-18", created_at=_dt("2025-02-14")),
        Matatu(id="m-3", reg_number="KDB 445T", sacco_id="sacco-2", route_id="route-2", capacity=33, status="ACTIVE", last_inspection="2026-06-20", created_at=_dt("2025-03-01")),
        Matatu(id="m-4", reg_number="KCF 771P", sacco_id="sacco-3", route_id="route-3", capacity=25, status="IMPOUNDED", last_inspection="2026-03-05", created_at=_dt("2024-11-22")),
        Matatu(id="m-5", reg_number="KDD 300L", sacco_id="sacco-2", route_id="route-4", capacity=14, status="ACTIVE", last_inspection="2026-07-01", created_at=_dt("2025-05-09")),
    ]
    for m in matatus:
        db.add(m)

    # Seed Activities
    activities = [
        ActivityLog(id="a-1", matatu_id="m-1", type="TRIP", description="Morning route trip completed, no incidents.", location="Langata Rd", officer_id="u-enforce", timestamp=_dt("2026-07-14T07:20:00Z")),
        ActivityLog(id="a-2", matatu_id="m-2", type="INSPECTION", description="Roadworthiness spot-check: worn tyres flagged.", location="Rongai stage", officer_id="u-enforce", timestamp=_dt("2026-07-14T09:05:00Z")),
        ActivityLog(id="a-3", matatu_id="m-4", type="INCIDENT", description="Overloading reported by commuters; vehicle impounded.", location="Kawangware", officer_id="u-enforce", timestamp=_dt("2026-07-10T13:40:00Z")),
        ActivityLog(id="a-4", matatu_id="m-3", type="TRIP", description="Evening route trip, on schedule.", location="Thika Rd", officer_id="u-enforce", timestamp=_dt("2026-07-15T18:10:00Z")),
    ]
    for a in activities:
        db.add(a)

    # Seed Fines
    fines = [
        Fine(id="f-1", matatu_id="m-2", officer_id="u-enforce", reason="Worn tyres / unroadworthy vehicle", amount_kes=5000.0, status="PENDING", issued_at=_dt("2026-07-14"), due_date=_date("2026-07-28")),
        Fine(id="f-2", matatu_id="m-4", officer_id="u-enforce", reason="Overloading beyond licensed capacity", amount_kes=10000.0, status="PENDING", issued_at=_dt("2026-07-10"), due_date=_date("2026-07-24")),
        Fine(id="f-3", matatu_id="m-1", officer_id="u-enforce", reason="Expired route badge on one crew member", amount_kes=2000.0, status="PAID", issued_at=_dt("2026-06-01"), due_date=_date("2026-06-15")),
        Fine(id="f-4", matatu_id="m-5", officer_id="u-enforce", reason="Failure to display fare charges", amount_kes=3000.0, status="DISPUTED", issued_at=_dt("2026-06-25"), due_date=_date("2026-07-09")),
    ]
    for f in fines:
        db.add(f)

    await db.commit()
