from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from app.models import Sacco, User, Route, Matatu, ActivityLog, Fine, Zone, OffenceType, Stage, RouteStage, Beat, RouteDetour, Sector
from app.auth import get_password_hash
from app.brn_data import STAGE_COORDS, GEOCODED_STAGE_COORDS, ROUTES as BRN_ROUTES
import datetime
import re


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

def _slug(name: str) -> str:
    """Stage id from a stage name: lowercase, non-alnum runs collapsed to
    a single hyphen. Shared landmark names (e.g. "GPO") recur across many
    routes' stage lists, so this must be deterministic — the same name
    always yields the same id, which is how re-used stages get deduped."""
    s = re.sub(r"[^a-z0-9]+", "-", name.strip().lower()).strip("-")
    return f"stage-{s}"


async def seed_brn_data(db: AsyncSession):
    """Loads the digitized BRN routes/stages from app/brn_data.py. Runs
    independently of seed_data()'s "already seeded" guard, and is itself
    idempotent per-route (checked via each route's brn_serial, not an
    all-or-nothing "any stage exists" guard) — so it's safe to call on
    every startup, and extending BRN_ROUTES with more serials picks up
    automatically on the next boot against an already-seeded database,
    without a separate migration or backfill script."""
    existing_serials = set(
        (await db.execute(select(Route.brn_serial).where(Route.brn_serial.isnot(None)))).scalars().all()
    )
    new_routes = [r for r in BRN_ROUTES if r["brn_serial"] not in existing_serials]
    if not new_routes:
        return  # Nothing new to seed

    existing_stage_ids = set((await db.execute(select(Stage.id))).scalars().all())
    stage_ids: dict[str, str] = {sid: sid for sid in existing_stage_ids}

    def get_or_create_stage(name: str) -> str:
        stage_id = _slug(name)
        if stage_id in stage_ids:
            return stage_id
        coords = STAGE_COORDS.get(name) or GEOCODED_STAGE_COORDS.get(name)
        db.add(Stage(
            id=stage_id,
            name=name,
            stage_type="TERMINUS" if name in (
                r["start"] for r in BRN_ROUTES
            ) or name in (r["end"] for r in BRN_ROUTES) else "STAGE",
            lat=coords[0] if coords else None,
            lng=coords[1] if coords else None,
            geocoded=coords is not None,
        ))
        stage_ids[stage_id] = stage_id
        return stage_id

    route_ids: dict[str, str] = {r["brn_serial"]: f"brn-route-{r['brn_serial']}" for r in BRN_ROUTES}
    for r in new_routes:
        db.add(Route(
            id=route_ids[r["brn_serial"]],
            code=f"BRN-{r['brn_serial']}",
            name=f"{r['start']} - {r['end']}",
            description=f"BRN {r['brn_serial']}: {r['start']} to {r['end']}",
            fare_kes=100.0,
            brn_serial=r["brn_serial"],
            corridor=r["corridor"],
            start_point=r["start"],
            end_point=r["end"],
        ))

    # Second pass: link lettered variants (e.g. "2A") to their base route
    # ("2"), now that every route_id — old and newly added — exists.
    for r in new_routes:
        base_serial = re.match(r"^(\d+)", r["brn_serial"]).group(1)
        if base_serial != r["brn_serial"] and base_serial in route_ids:
            route = await db.get(Route, route_ids[r["brn_serial"]])
            route.base_route_id = route_ids[base_serial]

    for r in new_routes:
        route_id = route_ids[r["brn_serial"]]
        for direction, stage_names in (("OUTBOUND", r["outbound"]), ("RETURN", r["return"])):
            for sequence, name in enumerate(stage_names, start=1):
                stage_id = get_or_create_stage(name)
                db.add(RouteStage(
                    route_id=route_id,
                    stage_id=stage_id,
                    sequence=sequence,
                    direction=direction,
                ))

    await db.commit()


async def seed_zones_and_beats(db: AsyncSession):
    """Enforcement zones (coarse corridor labels, no polygon/boundary data)
    and a starter beat per zone. Idempotent per-row (checked by id, not an
    all-or-nothing guard) for the same reason seed_brn_data() is — an
    already-seeded database (e.g. live Render Postgres) must still pick up
    new zones/beats added here on its next boot, not silently skip them
    because seed_data()'s Sacco check already returned. Depends on
    seed_brn_data() having already run (it has — called first in both
    seed_data() and here) so the stage/route ids these beats reference
    already exist.
    """
    existing_zone_ids = set((await db.execute(select(Zone.id))).scalars().all())
    zones = [
        Zone(id="zone-cbd", name="CBD Corridor", description="Nairobi CBD and immediate approach roads"),
        Zone(id="zone-thika-road", name="Thika Road Corridor", description="Thika Road from CBD to Kasarani/Roysambu"),
        Zone(id="zone-langata", name="Langata Corridor", description="Langata Road and Rongai approach"),
        Zone(id="zone-outer-ring", name="Outer Ring Corridor", description="Outer Ring Road / Kawangware / Waiyaki Way"),
    ]
    for z in zones:
        if z.id not in existing_zone_ids:
            db.add(z)

    # Real route/stage pairs from the digitized BRN data (both stages
    # genuinely geocoded, not fabricated coordinates) — one per zone so the
    # enforcement live map has something to draw on first boot.
    existing_beat_ids = set((await db.execute(select(Beat.id))).scalars().all())
    now = datetime.datetime.now(datetime.timezone.utc)
    beats = [
        Beat(id="beat-cbd-1", name="GPO - ICEA (CBD)", route_id="brn-route-11",
             from_stage_id="stage-gpo", to_stage_id="stage-icea", zone_id="zone-cbd", created_at=now),
        Beat(id="beat-thika-1", name="Mwiki - Kasarani (Thika Rd)", route_id="brn-route-10",
             from_stage_id="stage-mwiki", to_stage_id="stage-kasarani", zone_id="zone-thika-road", created_at=now),
        Beat(id="beat-langata-1", name="Community - Kibera Drive (Langata)", route_id="brn-route-9",
             from_stage_id="stage-community", to_stage_id="stage-kibera-drive", zone_id="zone-langata", created_at=now),
        Beat(id="beat-outer-1", name="Kawangware - Ngong Rd (Outer Ring)", route_id="brn-route-1",
             from_stage_id="stage-kawangware", to_stage_id="stage-ngong-rd", zone_id="zone-outer-ring", created_at=now),
    ]
    for b in beats:
        if b.id not in existing_beat_ids:
            db.add(b)

    await db.commit()


async def seed_ptcu_sectors_and_zones(db: AsyncSession):
    """The Public Transport Control Unit's real sector/zone geography,
    transcribed from the county's own monthly "ALLOCATION OF DUTY" sheet
    (REF SC/P.T.C.U./5/VOL.III/9/2026).

    Two deliberate omissions, both about not inventing data:

    1. **No personnel.** The source sheet names 153 serving officers with
       their manpower numbers and, for commanders, personal mobile numbers.
       None of that is seeded here. Sector commanders, deputies and contact
       numbers are left null for the county to fill in against real
       accounts — loading a government unit's staff list into a demo
       database is easy to do and hard to undo.

    2. **Centre points, no boundaries.** `center_lat`/`center_lng` are
       approximate CBD coordinates, good enough to drop a pin on roughly
       the right block and no better. `boundary_geojson` is left null
       rather than filled with plausible-looking polygons: a drawn boundary
       that was guessed would be indistinguishable on screen from one
       surveyed, and enforcement boundaries are the kind of thing people
       argue about in court. Real boundaries should come from the county's
       own GIS, through the zone editor.

    Idempotent per-row by id, same as seed_zones_and_beats above and for
    the same reason: an already-seeded live database must still pick these
    up on its next boot.
    """
    now = datetime.datetime.now(datetime.timezone.utc)
    existing_sector_ids = set((await db.execute(select(Sector.id))).scalars().all())

    # (id, code, name, lat, lng, display_order)
    sectors = [
        ("sector-1", "1", "Tom Mboya from Khoja Roundabout - Latema", -1.2824, 36.8287, 1),
        ("sector-2", "2", "Tom Mboya - Latema to Accra", -1.2835, 36.8288, 2),
        ("sector-3", "3", "Tom Mboya - Accra to Ronald Ngala", -1.2820, 36.8298, 3),
        ("sector-4", "4", "Bus Station / Mfangano St / Tom Mboya - Ronald Ngala - Haile Selassie", -1.2862, 36.8272, 4),
        ("sector-5", "5", "Ambassadeur / Kencom / Moi Service Lane / Nkrumah Lane", -1.2855, 36.8232, 5),
        ("sector-5b", "5B", "Upper Tom Mboya from Archives / Super Metro / Cabral St / Mondlane / Moi Service Lane", -1.2838, 36.8252, 6),
        ("sector-6", "6", "Uyoma / Temple Road & Lane / Race Course Rd to Riverside", -1.2886, 36.8305, 7),
        ("sector-7", "7", "Athusi / Ladhies / Gwasi Road / Ring Road", -1.2899, 36.8338, 8),
        ("sector-8", "8", "Nyamakima / Kirinyaga", -1.2809, 36.8331, 9),
        ("sector-9", "9", "Country Bus / New Pumwani Road", -1.2894, 36.8383, 10),
        ("sector-10", "10", "Muthurwa Terminus", -1.2889, 36.8349, 11),
        ("sector-11", "11", "Ngara / Fig Tree / Park Road", -1.2744, 36.8266, 12),
        # The M.E.U loading zones sit outside the numbered sector sequence
        # on the sheet but are posted and commanded the same way, so they
        # are a sector here rather than a special case everything downstream
        # would have to remember.
        ("sector-meu", "MEU", "M.E.U Loading Zones", -1.2870, 36.8290, 13),
    ]
    for sector_id, code, name, lat, lng, order in sectors:
        if sector_id not in existing_sector_ids:
            db.add(
                Sector(
                    id=sector_id, code=code, name=name,
                    center_lat=lat, center_lng=lng,
                    display_order=order, is_active=True, created_at=now,
                )
            )

    existing_zone_ids = set((await db.execute(select(Zone.id))).scalars().all())
    # (id, code, name, sector_id, lat, lng, display_order)
    zones = [
        ("ptcu-zone-1", "1", "Tom Mboya / Khoja / Moi Lane", "sector-1", -1.2818, 36.8285, 1),
        ("ptcu-zone-2", "2", "Fire Lane / Timboroa Lane / Lagos", "sector-1", -1.2829, 36.8291, 2),
        ("ptcu-zone-3", "3", "Tom Mboya / Latema", "sector-2", -1.2831, 36.8290, 3),
        ("ptcu-zone-4", "4", "Tom Mboya / Accra", "sector-2", -1.2841, 36.8286, 4),
        ("ptcu-zone-5", "5", "Luthuli / Gaberone / Mfangano Lane / Mfangano Street A", "sector-3", -1.2836, 36.8292, 5),
        ("ptcu-zone-6", "6", "Munyu / Ronald Ngala Street / Sheikh Karume", "sector-3", -1.2819, 36.8310, 6),
        ("ptcu-zone-7", "7", "Afya Centre / Hakati", "sector-4", -1.2879, 36.8264, 7),
        ("ptcu-zone-8", "8", "Bus Station / Mfangano Street", "sector-4", -1.2856, 36.8276, 8),
        ("ptcu-zone-9", "9", "Ambassadeur / Moi Service Lane (KTDA) / Gill House / Railway Roundabout", "sector-5", -1.2872, 36.8243, 9),
        ("ptcu-zone-10", "10", "Kencom", "sector-5", -1.2864, 36.8228, 10),
        ("ptcu-zone-11", "11", "Uyoma / Temple Road / Racecourse Road / Riverside", "sector-6", -1.2887, 36.8303, 11),
        ("ptcu-zone-12", "12", "Ladhies / Gwasi / Ukwala / Ring Road / Athusi", "sector-7", -1.2901, 36.8339, 12),
        ("ptcu-zone-13", "13", "Nyamakima — Price Road / Charles Rubia / Kumasi", "sector-8", -1.2808, 36.8332, 13),
        # Sectors 5B, 9, 10, 11 and MEU post officers directly to named
        # stations rather than numbered zones on the sheet. A zone per
        # station keeps the drill-down (sector -> zone -> officers) working
        # uniformly instead of needing a second path for "sectors without
        # zones" — the code column is null because the sheet gives them no
        # number, not because it is missing.
        ("ptcu-zone-country-bus", None, "Country Bus", "sector-9", -1.2894, 36.8383, 14),
        ("ptcu-zone-kware-pumwani", None, "Kware / New Pumwani Junction / Solidarity / Meru / DC Area", "sector-9", -1.2901, 36.8395, 15),
        ("ptcu-zone-muthurwa", None, "Muthurwa", "sector-10", -1.2889, 36.8349, 16),
        ("ptcu-zone-ngara", None, "Ngara", "sector-11", -1.2744, 36.8266, 17),
        ("ptcu-zone-parkroad", None, "Park Road", "sector-11", -1.2701, 36.8291, 18),
        ("ptcu-zone-meu-loading", None, "M.E.U Loading Zone", "sector-meu", -1.2870, 36.8290, 19),
        ("ptcu-zone-upper-tom-mboya", None, "Upper Tom Mboya / Super Metro / Cabral Street", "sector-5b", -1.2838, 36.8252, 20),
    ]
    for zone_id, code, name, sector_id, lat, lng, order in zones:
        if zone_id not in existing_zone_ids:
            db.add(
                Zone(
                    id=zone_id, code=code, name=name, sector_id=sector_id,
                    center_lat=lat, center_lng=lng,
                    display_order=order, is_active=True,
                )
            )

    await db.commit()


async def seed_route_detour(db: AsyncSession):
    """One demo RouteDetour so the public "Live Updates" feed
    (/api/public/route-alerts) has something to show on first boot, using
    the same real, already-geocoded GPO-ICEA CBD segment as beat-cbd-1
    above rather than fabricating a new stage pair. Idempotent per-row,
    same reasoning as seed_zones_and_beats."""
    existing_ids = set((await db.execute(select(RouteDetour.id))).scalars().all())
    if "detour-gpo-icea-demo" not in existing_ids:
        db.add(RouteDetour(
            id="detour-gpo-icea-demo",
            route_id="brn-route-11",
            from_stage_id="stage-gpo",
            to_stage_id="stage-icea",
            alternate_description="Roadworks near GPO — matatus diverting via Kenyatta Avenue until further notice.",
            active=True,
            created_at=datetime.datetime.now(datetime.timezone.utc),
        ))
        await db.commit()


async def backfill_demo_passenger_phone(db: AsyncSession):
    """Same idempotent-per-row pattern as seed_zones_and_beats above — the
    demo passenger account was seeded before phone-based password reset
    existed, so an already-seeded database needs this patched in on its
    next boot rather than requiring a manual reseed."""
    result = await db.execute(select(User).where(User.id == "u-passenger"))
    user = result.scalars().first()
    if user and not user.phone:
        user.phone = "+254712345678"
        await db.commit()


async def seed_data(db: AsyncSession):
    await seed_brn_data(db)
    await seed_zones_and_beats(db)
    await seed_ptcu_sectors_and_zones(db)
    await seed_route_detour(db)
    await backfill_demo_passenger_phone(db)

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

    # These 4 pre-BRN legacy routes predate the digitized BRN stage/sequence
    # data (seed_brn_data(), called separately) and otherwise have zero
    # RouteStage rows — meaning no real geometry to draw on the network map
    # (components/dashboard/RouteNetworkMap.tsx). Kencom is the same
    # real, well-known CBD terminus already used elsewhere (GisMap.tsx's
    # NAIROBI_STAGES); pairing it with each route's actual named
    # destination (already a real, geocoded Stage from the BRN data) gives
    # every legacy route a genuine two-point line instead of a fabricated
    # one.
    legacy_route_destinations = {
        "route-1": "stage-rongai-tassia-supermarket-magadi-rd",
        "route-2": "stage-kasarani",
        "route-3": "stage-kawangware",
        "route-4": "stage-umoja",
    }
    existing_route_stage_route_ids = set(
        (await db.execute(select(RouteStage.route_id).where(RouteStage.route_id.in_(legacy_route_destinations.keys())))).scalars().all()
    )
    for route_id, dest_stage_id in legacy_route_destinations.items():
        if route_id in existing_route_stage_route_ids:
            continue
        db.add(RouteStage(route_id=route_id, stage_id="stage-kencom", sequence=0, direction="OUTBOUND"))
        db.add(RouteStage(route_id=route_id, stage_id=dest_stage_id, sequence=1, direction="OUTBOUND"))
        db.add(RouteStage(route_id=route_id, stage_id=dest_stage_id, sequence=0, direction="RETURN"))
        db.add(RouteStage(route_id=route_id, stage_id="stage-kencom", sequence=1, direction="RETURN"))


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
            password=await get_password_hash("superadmin123"),
            role="SUPERADMIN"
        ),
        User(
            id="u-admin",
            name="Grace Wambui",
            email="admin@nairobi.go.ke",
            password=await get_password_hash("admin123"),
            role="ADMIN"
        ),
        User(
            id="u-enforce",
            name="Peter Otieno",
            email="enforcement@nairobi.go.ke",
            password=await get_password_hash("enforce123"),
            role="ENFORCEMENT"
        ),
        User(
            id="u-sacco",
            name="Daniel Kiptoo",
            email="operator@umoinner.co.ke",
            password=await get_password_hash("sacco123"),
            role="SACCO_OPERATOR",
            sacco_id="sacco-1"
        ),
        User(
            id="u-viewer",
            name="Hon. Alice Njeri",
            email="viewer@nairobi.go.ke",
            password=await get_password_hash("viewer123"),
            role="VIEWER"
        ),
        User(
            id="u-passenger",
            name="John Kamau",
            email="commuter@nairobi.go.ke",
            phone="+254712345678",
            password=await get_password_hash("pass123"),
            role="PASSENGER"
        ),
        User(
            id="u-crew",
            name="James Omwamba",
            email="crew@umoinner.co.ke",
            password=await get_password_hash("crew123"),
            role="CREW",
            sacco_id="sacco-1"
        ),
        User(
            id="u-director-mobility",
            name="Eng. Samuel Mwaura",
            email="director.mobility@nairobi.go.ke",
            password=await get_password_hash("director123"),
            role="DIRECTOR_MOBILITY"
        ),
        User(
            id="u-chief-officer",
            name="Ms. Josephine Wanjala",
            email="chiefofficer@nairobi.go.ke",
            password=await get_password_hash("chief123"),
            role="CHIEF_OFFICER"
        ),
        User(
            id="u-sacco4",
            name="Michael Kamande",
            email="operator@kilimanidirect.co.ke",
            password=await get_password_hash("sacco123"),
            role="SACCO_OPERATOR",
            sacco_id="sacco-4"
        ),
        User(
            id="u-commander",
            name="Cdr. Francis Mutua",
            email="commander@nairobi.go.ke",
            password=await get_password_hash("commander123"),
            role="ENFORCEMENT_COMMANDER",
            commander_title="Commander of Public Transport Compliance",
        ),
        User(
            id="u-arresting",
            name="Officer Brian Kiprop",
            email="arresting.officer@nairobi.go.ke",
            password=await get_password_hash("arrest123"),
            role="ARRESTING_OFFICER",
            enforcement_duty="ARRESTING",
            assigned_zone_id="zone-cbd",
        ),
        User(
            id="u-releasing",
            name="Officer Nancy Chebet",
            email="releasing.officer@nairobi.go.ke",
            password=await get_password_hash("release123"),
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
