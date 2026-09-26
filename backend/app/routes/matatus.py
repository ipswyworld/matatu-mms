import csv
import datetime
import io
import uuid
from typing import List
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models import Matatu, User, Sacco, Route, ActivityLog, Fine, Booking
from app.schemas import (
    MatatuResponse,
    MatatuCreate,
    MatatuStatusUpdate,
    MatatuDetailResponse,
    BulkImportResult,
    BulkImportRowError,
    validate_reg_number,
)
from app.auth import get_current_user, requires_permission
from app.events import dispatcher
from app.audit import stage_audit_log
from app.abac import sacco_scope_query, enforce_own_sacco
from app.scheduled_booking_scheduler import reassign_scheduled_bookings_for_matatu

router = APIRouter(prefix="/api/matatus", tags=["Matatus"])

@router.get("", response_model=List[MatatuResponse])
async def get_matatus(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    query = select(Matatu).options(selectinload(Matatu.sacco), selectinload(Matatu.route))
    
    query = sacco_scope_query(current_user, query, Matatu.sacco_id)

    result = await db.execute(query)
    matatus = result.scalars().all()
    
    for m in matatus:
        if not m.terminal_segment:
            m.terminal_segment = f"{m.sacco.name if m.sacco else 'County'}: CBD Route Terminal Segment"
            
    return matatus

@router.post("", response_model=MatatuResponse, status_code=status.HTTP_201_CREATED)
async def create_matatu(
    payload: MatatuCreate,
    current_user: User = Depends(requires_permission("add_matatu")),
    db: AsyncSession = Depends(get_db)
):
    # add_matatu is only ever granted to SACCO_OPERATOR (app/rbac.py) — every
    # caller here is onboarding into their own fleet, never another
    # operator's. payload.sacco_id was previously trusted as-is, which let
    # any operator onboard a vehicle under an arbitrary Sacco ID just by
    # putting a different one in the request body; enforce it matches their
    # own the same way every other write in this router does.
    enforce_own_sacco(current_user, payload.sacco_id, "You can only onboard vehicles under your own Sacco.")

    # Verify Sacco exists
    sacco_result = await db.execute(select(Sacco).where(Sacco.id == payload.sacco_id))
    sacco = sacco_result.scalars().first()
    if not sacco:
        raise HTTPException(status_code=400, detail="Invalid Sacco ID")
        
    # Verify Route exists
    route_result = await db.execute(select(Route).where(Route.id == payload.route_id))
    if not route_result.scalars().first():
        raise HTTPException(status_code=400, detail="Invalid Route ID")

    matatu_id = f"m-{uuid.uuid4().hex[:8]}"

    new_matatu = Matatu(
        id=matatu_id,
        reg_number=payload.reg_number.upper().strip(),
        sacco_id=payload.sacco_id,
        route_id=payload.route_id,
        terminal_segment=payload.terminal_segment or f"{sacco.name}: CBD-Terminal Stage",
        capacity=payload.capacity,
        status=payload.status or "ACTIVE",
        created_at=datetime.datetime.now(datetime.timezone.utc),
        driver_name=payload.driver_name,
        driver_license=payload.driver_license,
        driver_phone=payload.driver_phone,
        conductor_name=payload.conductor_name,
        conductor_license=payload.conductor_license,
        conductor_phone=payload.conductor_phone,
    )
    
    db.add(new_matatu)
    stage_audit_log(
        db, resource_type="matatu", resource_id=matatu_id, action="CREATE",
        user_id=current_user.id,
        new_values={"regNumber": new_matatu.reg_number, "saccoId": new_matatu.sacco_id, "routeId": new_matatu.route_id, "status": new_matatu.status},
    )
    await db.commit()

    result = await db.execute(
        select(Matatu)
        .options(selectinload(Matatu.sacco), selectinload(Matatu.route))
        .where(Matatu.id == matatu_id)
    )
    return result.scalars().first()

HEADER_ALIASES = {
    "reg_number": ["regnumber", "registrationnumber", "platenumber", "numberplate", "plate", "plateno"],
    "route_id": ["routeid"],
    "route_code": ["routecode", "route"],
    "terminal_segment": ["terminalsegment", "terminal", "stage"],
    "capacity": ["capacity", "seats", "seatingcapacity"],
    "driver_name": ["drivername", "driver", "driverfullname"],
    "driver_license": ["driverlicense", "driverlicence", "driverdlnumber", "driverdl"],
    "driver_phone": ["driverphone", "drivercontact", "driverphonenumber", "drivertelephone"],
    "conductor_name": ["conductorname", "conductor", "conductorfullname"],
    "conductor_license": ["conductorlicense", "conductorlicence"],
    "conductor_phone": ["conductorphone", "conductorcontact", "conductorphonenumber"],
}

REQUIRED_FIELDS = [
    "reg_number", "capacity", "driver_name", "driver_license", "driver_phone",
    "conductor_name", "conductor_license", "conductor_phone",
]


def _normalize_header(raw: str) -> str:
    return "".join(ch for ch in raw.lower() if ch.isalnum())


def _build_header_map(headers: List[str]) -> dict:
    """Maps each recognized raw column header to our canonical snake_case field name."""
    normalized_to_field = {}
    for field, aliases in HEADER_ALIASES.items():
        for alias in aliases:
            normalized_to_field[alias] = field

    header_map = {}
    for raw in headers:
        if raw is None:
            continue
        key = _normalize_header(str(raw))
        if key in normalized_to_field:
            header_map[raw] = normalized_to_field[key]
    return header_map


def _rows_from_csv(contents: bytes) -> List[dict]:
    text = contents.decode("utf-8-sig", errors="ignore")
    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        return []
    header_map = _build_header_map(reader.fieldnames)
    rows = []
    for raw_row in reader:
        row = {header_map[k]: (v.strip() if isinstance(v, str) else v) for k, v in raw_row.items() if k in header_map}
        if row:
            rows.append(row)
    return rows


def _rows_from_xlsx(contents: bytes) -> List[dict]:
    from openpyxl import load_workbook
    wb = load_workbook(io.BytesIO(contents), read_only=True, data_only=True)
    sheet = wb.worksheets[0]
    rows_iter = sheet.iter_rows(values_only=True)
    try:
        headers = next(rows_iter)
    except StopIteration:
        return []
    header_map = _build_header_map([str(h) if h is not None else "" for h in headers])
    header_index = {i: header_map[h] for i, h in enumerate(headers) if h in header_map}
    rows = []
    for raw_row in rows_iter:
        if raw_row is None or all(v is None for v in raw_row):
            continue
        row = {}
        for i, field in header_index.items():
            if i < len(raw_row) and raw_row[i] is not None:
                row[field] = str(raw_row[i]).strip()
        if row:
            rows.append(row)
    return rows


def _rows_from_pdf(contents: bytes) -> List[dict]:
    import pdfplumber
    rows: List[dict] = []
    header_index = None  # position -> canonical field name, fixed from the first table's header row
    with pdfplumber.open(io.BytesIO(contents)) as pdf:
        for page in pdf.pages:
            table = page.extract_table()
            if not table or len(table) < 1:
                continue
            if header_index is None:
                raw_headers = [str(h) if h is not None else "" for h in table[0]]
                header_map = _build_header_map(raw_headers)
                header_index = {i: header_map[h] for i, h in enumerate(raw_headers) if h in header_map}
                data_rows = table[1:]
            else:
                data_rows = table
            for raw_row in data_rows:
                row = {}
                for i, field in header_index.items():
                    if i < len(raw_row) and raw_row[i] is not None:
                        row[field] = str(raw_row[i]).strip()
                if row:
                    rows.append(row)
    if header_index is None:
        raise ValueError(
            "No table could be detected in this PDF. Please export your vehicle list as CSV or Excel instead."
        )
    return rows


@router.post("/bulk-import", response_model=BulkImportResult)
async def bulk_import_matatus(
    file: UploadFile = File(...),
    current_user: User = Depends(requires_permission("add_matatu")),
    db: AsyncSession = Depends(get_db),
):
    """
    Bulk-onboard vehicles from a CSV, Excel (.xlsx), or PDF (table-based) file
    the Sacco already has on hand. Column headers are matched loosely (case
    and spacing-insensitive) against known aliases. Every row is validated
    independently — valid rows are created immediately, invalid ones are
    reported back with exactly which fields are missing so the operator can
    fix and re-upload just those.
    """
    filename = (file.filename or "").lower()
    contents = await file.read()

    try:
        if filename.endswith(".csv"):
            rows = _rows_from_csv(contents)
        elif filename.endswith(".xlsx") or filename.endswith(".xlsm"):
            rows = _rows_from_xlsx(contents)
        elif filename.endswith(".pdf"):
            rows = _rows_from_pdf(contents)
        else:
            raise HTTPException(status_code=400, detail="Unsupported file type. Please upload a .csv, .xlsx, or .pdf file.")
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not read file: {e}")

    if not rows:
        raise HTTPException(status_code=400, detail="No recognizable vehicle rows found in this file. Check that it has a header row matching plate number, capacity, driver and conductor details.")

    sacco_id = current_user.sacco_id
    if current_user.role != "SACCO_OPERATOR" or not sacco_id:
        raise HTTPException(status_code=403, detail="Only a Sacco Operator can bulk-import vehicles into their own fleet.")

    routes_result = await db.execute(select(Route))
    all_routes = routes_result.scalars().all()
    route_by_code = {r.code.upper(): r for r in all_routes if r.code}
    route_by_id = {r.id: r for r in all_routes}

    sacco_result = await db.execute(select(Sacco).where(Sacco.id == sacco_id))
    sacco = sacco_result.scalars().first()

    created: List[Matatu] = []
    errors: List[BulkImportRowError] = []

    for idx, row in enumerate(rows, start=2):  # row 1 is the header
        missing = [f for f in REQUIRED_FIELDS if not row.get(f)]

        route = None
        if row.get("route_id"):
            route = route_by_id.get(row["route_id"])
        elif row.get("route_code"):
            route = route_by_code.get(row["route_code"].upper())
        if not route:
            missing.append("route_id/routeCode (must match an existing route)")

        capacity_value = None
        if row.get("capacity"):
            try:
                capacity_value = int(float(row["capacity"]))
            except ValueError:
                missing.append("capacity (must be a number)")

        if missing:
            errors.append(BulkImportRowError(row=idx, reg_number=row.get("reg_number"), missing_fields=missing, message="Missing or invalid: " + ", ".join(missing)))
            continue

        try:
            reg_number = validate_reg_number(row["reg_number"])
        except ValueError as e:
            errors.append(BulkImportRowError(row=idx, reg_number=row.get("reg_number"), missing_fields=[], message=str(e)))
            continue
        existing = await db.execute(select(Matatu).where(Matatu.reg_number == reg_number))
        if existing.scalars().first():
            errors.append(BulkImportRowError(row=idx, reg_number=reg_number, missing_fields=[], message=f"A vehicle with plate {reg_number} is already registered."))
            continue

        matatu_id = f"m-{uuid.uuid4().hex[:8]}"
        new_matatu = Matatu(
            id=matatu_id,
            reg_number=reg_number,
            sacco_id=sacco_id,
            route_id=route.id,
            terminal_segment=row.get("terminal_segment") or (f"{sacco.name}: CBD-Terminal Stage" if sacco else "CBD-Terminal Stage"),
            capacity=capacity_value,
            status="REGISTRATION_PENDING",
            created_at=datetime.datetime.now(datetime.timezone.utc),
            driver_name=row.get("driver_name"),
            driver_license=row.get("driver_license"),
            driver_phone=row.get("driver_phone"),
            conductor_name=row.get("conductor_name"),
            conductor_license=row.get("conductor_license"),
            conductor_phone=row.get("conductor_phone"),
        )
        db.add(new_matatu)
        created.append(new_matatu)
        stage_audit_log(
            db, resource_type="matatu", resource_id=matatu_id, action="CREATE_BULK_IMPORT",
            user_id=current_user.id,
            new_values={"regNumber": reg_number, "saccoId": sacco_id, "routeId": route.id},
        )

    await db.commit()

    result_rows = []
    for m in created:
        r = await db.execute(
            select(Matatu).options(selectinload(Matatu.sacco), selectinload(Matatu.route)).where(Matatu.id == m.id)
        )
        result_rows.append(r.scalars().first())

    return BulkImportResult(created=result_rows, errors=errors, total_rows=len(rows))


@router.delete("/{id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_matatu(
    id: str,
    current_user: User = Depends(requires_permission("remove_matatu")),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Matatu).where(Matatu.id == id))
    matatu = result.scalars().first()
    if not matatu:
        raise HTTPException(status_code=404, detail="Matatu not found")

    enforce_own_sacco(current_user, matatu.sacco_id, "You can only remove vehicles from your own Sacco.")

    pending_fines = await db.execute(
        select(Fine).where(Fine.matatu_id == id, Fine.status == "PENDING")
    )
    if pending_fines.scalars().first():
        raise HTTPException(status_code=400, detail="This vehicle has pending fines. Resolve them before removing it from the fleet.")

    active_bookings = await db.execute(
        select(Booking).where(Booking.matatu_id == id, Booking.status == "CONFIRMED")
    )
    if active_bookings.scalars().first():
        raise HTTPException(status_code=400, detail="This vehicle has active passenger bookings. Wait for trips to complete before removing it.")

    old_values = {"regNumber": matatu.reg_number, "saccoId": matatu.sacco_id, "routeId": matatu.route_id, "status": matatu.status}
    stage_audit_log(
        db, resource_type="matatu", resource_id=id, action="DELETE",
        user_id=current_user.id, old_values=old_values,
    )
    await db.delete(matatu)
    await db.commit()

    dispatcher.dispatch("VEHICLE_REMOVED", {
        "matatu_id": id,
        "regNumber": matatu.reg_number,
        "sacco_id": matatu.sacco_id,
        "user_id": current_user.id,
    })
    return None


@router.get("/{id}", response_model=MatatuDetailResponse)
async def get_matatu_by_id(
    id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    query = select(Matatu).options(
        selectinload(Matatu.sacco),
        selectinload(Matatu.route),
        selectinload(Matatu.activities),
        selectinload(Matatu.fines)
    ).where(Matatu.id == id)
    
    result = await db.execute(query)
    matatu = result.scalars().first()
    
    if not matatu:
        raise HTTPException(status_code=404, detail="Matatu not found")
        
    enforce_own_sacco(current_user, matatu.sacco_id, "Forbidden: This vehicle belongs to another Sacco.")
        
    if not matatu.terminal_segment:
        matatu.terminal_segment = f"{matatu.sacco.name if matatu.sacco else 'County'}: CBD Terminal Stage"
        
    return matatu

@router.patch("/{id}/status", response_model=MatatuResponse)
async def update_matatu_status(
    id: str,
    payload: MatatuStatusUpdate,
    current_user: User = Depends(requires_permission("edit_matatu_status")),
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(
        select(Matatu)
        .options(selectinload(Matatu.sacco), selectinload(Matatu.route))
        .where(Matatu.id == id)
    )
    matatu = result.scalars().first()
    
    if not matatu:
        raise HTTPException(status_code=404, detail="Matatu not found")
        
    old_status = matatu.status
    new_status = payload.status.upper().strip()
    
    if new_status not in ["REGISTRATION_PENDING", "ACTIVE", "FLAGGED", "IMPOUNDED", "DECOMMISSIONED"]:
        raise HTTPException(status_code=400, detail="Invalid status value")
        
    if old_status != new_status:
        matatu.status = new_status
        stage_audit_log(
            db, resource_type="matatu", resource_id=matatu.id, action="STATUS_CHANGE",
            user_id=current_user.id, old_values={"status": old_status}, new_values={"status": new_status},
        )

        reassigned_count = 0
        if new_status in ("FLAGGED", "IMPOUNDED", "DECOMMISSIONED"):
            # Event-driven, not just the next cron tick — a stranded
            # passenger shouldn't wait up to 5 minutes to learn their
            # vehicle broke down. Runs in this same transaction so a
            # partial failure never leaves the status change committed
            # without its dependent bookings handled.
            reassigned_count = await reassign_scheduled_bookings_for_matatu(db, matatu.id)

        await db.commit()

        dispatcher.dispatch("VEHICLE_STATUS_CHANGED", {
            "matatu_id": matatu.id,
            "regNumber": matatu.reg_number,
            "sacco_id": matatu.sacco_id,
            "old_status": old_status,
            "new_status": new_status,
            "user_id": current_user.id
        })
        
    return matatu
