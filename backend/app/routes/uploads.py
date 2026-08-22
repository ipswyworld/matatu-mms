from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.database import get_db
from app.models import UploadedFile

router = APIRouter(prefix="/api/uploads", tags=["Uploads"])


@router.get("/{key:path}")
async def get_uploaded_file(key: str, db: AsyncSession = Depends(get_db)):
    """Serves files stored via app/storage.py's "db" backend. No auth check
    — matches the local-disk StaticFiles mount this replaces (app/main.py),
    which has never been access-controlled either; every file URL already
    contains an unguessable per-record UUID segment."""
    result = await db.execute(select(UploadedFile).where(UploadedFile.key == key))
    record = result.scalars().first()
    if not record:
        raise HTTPException(status_code=404, detail="File not found")
    return Response(
        content=record.data,
        media_type=record.content_type,
        headers={"Cache-Control": "public, max-age=31536000, immutable"},
    )
