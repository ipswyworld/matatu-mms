import datetime
import json
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AuditLog


def stage_audit_log(
    db: AsyncSession,
    *,
    resource_type: str,
    resource_id: str,
    action: str,
    user_id: Optional[str],
    old_values: Optional[dict] = None,
    new_values: Optional[dict] = None,
) -> None:
    """
    Adds an audit record to the current session WITHOUT committing.

    Deliberately synchronous-looking (no await) and transaction-scoped: call
    this right before the route's own `await db.commit()` so the audit
    record and the actual mutation land in the same atomic transaction. If
    the process dies mid-request, either both persist or neither does —
    never a mutation with no trail, which is what the old
    dispatch-to-a-separate-session pattern risked.
    """
    db.add(
        AuditLog(
            resource_type=resource_type,
            resource_id=str(resource_id),
            action=action,
            old_values=json.dumps(old_values, default=str) if old_values else None,
            new_values=json.dumps(new_values, default=str) if new_values else None,
            user_id=str(user_id) if user_id else "SYSTEM",
            timestamp=datetime.datetime.now(datetime.timezone.utc),
        )
    )
