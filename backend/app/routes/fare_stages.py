import datetime
import io
import secrets
from decimal import Decimal, InvalidOperation
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.database import get_db
from app.models import FareStage, Route, Stage, User
from app.schemas import FareStageCreate, FareStageResponse, FareStageUploadResult
from app.auth import get_current_user, requires_permission
from app.route_access import enforce_route_access as _enforce_route_access

router = APIRouter(tags=["Fare Stages"])


async def _route_or_404(db: AsyncSession, route_id: str) -> Route:
    result = await db.execute(select(Route).where(Route.id == route_id))
    route = result.scalars().first()
    if not route:
        raise HTTPException(status_code=404, detail="Route not found")
    return route


@router.get("/api/routes/{route_id}/fare-stages", response_model=List[FareStageResponse])
async def list_fare_stages(
    route_id: str,
    current_user: User = Depends(requires_permission("view_routes")),
    db: AsyncSession = Depends(get_db),
):
    await _route_or_404(db, route_id)
    result = await db.execute(select(FareStage).where(FareStage.route_id == route_id))
    return result.scalars().all()


@router.post("/api/routes/{route_id}/fare-stages", response_model=FareStageResponse, status_code=status.HTTP_201_CREATED)
async def create_fare_stage(
    route_id: str,
    payload: FareStageCreate,
    current_user: User = Depends(requires_permission("manage_fare_stages")),
    db: AsyncSession = Depends(get_db),
):
    route = await _route_or_404(db, route_id)
    await _enforce_route_access(db, current_user, route)

    fare_stage = FareStage(
        id=f"fs-{secrets.token_hex(4)}",
        route_id=route_id,
        from_stage_id=payload.from_stage_id,
        to_stage_id=payload.to_stage_id,
        from_label=payload.from_label.strip(),
        to_label=payload.to_label.strip(),
        fare_kes=payload.fare_kes,
        direction=payload.direction,
        source="MANUAL",
        created_at=datetime.datetime.now(datetime.timezone.utc),
    )
    db.add(fare_stage)
    await db.commit()
    await db.refresh(fare_stage)
    return fare_stage


@router.delete("/api/fare-stages/{fare_stage_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_fare_stage(
    fare_stage_id: str,
    current_user: User = Depends(requires_permission("manage_fare_stages")),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(FareStage).where(FareStage.id == fare_stage_id))
    fare_stage = result.scalars().first()
    if not fare_stage:
        raise HTTPException(status_code=404, detail="Fare stage entry not found")
    route = await _route_or_404(db, fare_stage.route_id)
    await _enforce_route_access(db, current_user, route)
    await db.delete(fare_stage)
    await db.commit()


def _parse_fare_kes(raw: str) -> Optional[Decimal]:
    cleaned = raw.replace("KES", "").replace("Ksh", "").replace(",", "").strip()
    try:
        return Decimal(cleaned)
    except InvalidOperation:
        return None


def _extract_fare_rows(contents: bytes) -> List[dict]:
    """Parses a fare-chart PDF table into raw rows. Expects a table with
    columns identifiable as From/Origin, To/Destination, and Fare/Amount —
    the same pdfplumber table-extraction approach as the vehicle
    bulk-import parser (routes/matatus.py), applied to a different schema."""
    import pdfplumber

    FROM_ALIASES = {"from", "origin", "boarding", "departure"}
    TO_ALIASES = {"to", "destination", "alighting", "arrival"}
    FARE_ALIASES = {"fare", "amount", "fare(kes)", "farekes", "price", "cost"}

    def normalize(h: str) -> str:
        return "".join(ch for ch in h.strip().lower() if ch.isalnum())

    rows: List[dict] = []
    header_index: Optional[dict] = None
    with pdfplumber.open(io.BytesIO(contents)) as pdf:
        for page in pdf.pages:
            table = page.extract_table()
            if not table or len(table) < 1:
                continue
            if header_index is None:
                raw_headers = [normalize(str(h)) if h is not None else "" for h in table[0]]
                header_index = {}
                for i, h in enumerate(raw_headers):
                    if h in FROM_ALIASES:
                        header_index[i] = "from"
                    elif h in TO_ALIASES:
                        header_index[i] = "to"
                    elif h in FARE_ALIASES:
                        header_index[i] = "fare"
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
    if not header_index or not {"from", "to", "fare"}.issubset(header_index.values()):
        raise ValueError(
            "Could not find From/To/Fare columns in this PDF's table. "
            "Expected a table with headers like 'From', 'To', and 'Fare'."
        )
    return rows


@router.post("/api/routes/{route_id}/fare-stages/upload", response_model=FareStageUploadResult)
async def upload_fare_chart(
    route_id: str,
    file: UploadFile = File(...),
    current_user: User = Depends(requires_permission("manage_fare_stages")),
    db: AsyncSession = Depends(get_db),
):
    route = await _route_or_404(db, route_id)
    await _enforce_route_access(db, current_user, route)

    contents = await file.read()
    try:
        raw_rows = _extract_fare_rows(contents)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        # pdfplumber/pdfminer raise their own exception types (not
        # ValueError) for a malformed or unreadable PDF — same broad catch
        # matatus.py's bulk-import PDF path uses, so a bad upload is a
        # clean 422 instead of an unhandled 500.
        raise HTTPException(status_code=422, detail=f"Could not read this PDF: {e}")

    stages_result = await db.execute(select(Stage))
    stages_by_name = {s.name.strip().lower(): s.id for s in stages_result.scalars().all()}

    created: List[FareStage] = []
    unmatched = 0
    now = datetime.datetime.now(datetime.timezone.utc)
    for row in raw_rows:
        from_label = row.get("from", "").strip()
        to_label = row.get("to", "").strip()
        fare_raw = row.get("fare", "").strip()
        if not from_label or not to_label or not fare_raw:
            continue
        fare_kes = _parse_fare_kes(fare_raw)
        if fare_kes is None:
            continue
        from_stage_id = stages_by_name.get(from_label.lower())
        to_stage_id = stages_by_name.get(to_label.lower())
        if from_stage_id is None or to_stage_id is None:
            unmatched += 1
        fare_stage = FareStage(
            id=f"fs-{secrets.token_hex(4)}",
            route_id=route_id,
            from_stage_id=from_stage_id,
            to_stage_id=to_stage_id,
            from_label=from_label,
            to_label=to_label,
            fare_kes=fare_kes,
            source="PDF_UPLOAD",
            created_at=now,
        )
        db.add(fare_stage)
        created.append(fare_stage)

    if not created:
        raise HTTPException(
            status_code=422,
            detail="No usable fare rows found in this PDF — check that From/To/Fare columns have values.",
        )

    await db.commit()
    for fs in created:
        await db.refresh(fs)

    return FareStageUploadResult(created=created, unmatched_rows=unmatched, total_rows=len(raw_rows))


async def get_fare_for_stage_pair(
    db: AsyncSession, route_id: str, from_stage_id: Optional[str], to_stage_id: Optional[str]
) -> Decimal:
    """Looks up the structured fare for a boarding/alighting stage pair,
    falling back to the route's flat Route.fare_kes when no fare-stage data
    exists yet (older routes, or routes whose operator hasn't uploaded a
    chart). Consumed by the passenger O-D search / booking flow (Task 22 —
    ARCHITECTURE_DECISIONS.md §29.2, §27.1)."""
    if from_stage_id and to_stage_id:
        result = await db.execute(
            select(FareStage).where(
                FareStage.route_id == route_id,
                FareStage.from_stage_id == from_stage_id,
                FareStage.to_stage_id == to_stage_id,
            )
        )
        fare_stage = result.scalars().first()
        if fare_stage:
            return Decimal(str(fare_stage.fare_kes))

    route = await _route_or_404(db, route_id)
    return Decimal(str(route.fare_kes))
