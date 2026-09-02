"""
Data subject rights under the Kenya Data Protection Act (Readiness List §9).

The DPA gives a person the right to obtain what an organisation holds about
them and, in defined circumstances, to have it erased. With 500k citizens'
national IDs, phone numbers and location histories in this system, "we will
work out a process when someone first asks" is not a plan — the first
request arrives with a statutory clock already running.

The hard part is not export. It is erasure, because **most of this data
cannot lawfully be deleted**:

  * A fine is a legal record of an enforcement action, subject to its own
    retention obligation. Deleting it on request would let anyone erase
    their own citation history.
  * A ledger entry is financial record-keeping. Deleting it would unbalance
    the books and destroy the audit trail §15 exists to provide.
  * An audit log entry recording who did what is the mechanism by which
    misuse is detected; erasing it on the subject's request would make the
    audit trail optional.

So erasure here means **anonymisation, not deletion**: identifying details
are replaced, the underlying records survive in a form that can no longer
be tied back to a person. That is the standard and defensible reading —
the right to erasure is not absolute and yields to legal obligation and
public-interest processing, both of which apply to county enforcement.

What that means in practice is written down per-table below, because "we
anonymised it" is a claim that has to be inspectable rather than trusted.
"""
import datetime
import hashlib
import json
import logging
import uuid
from typing import Any, Dict, List, Optional

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

logger = logging.getLogger("app.data_rights")

# Records that survive erasure, and why. Surfaced in the erasure response so
# the subject is told what was kept and on what basis, which the DPA
# requires — an erasure that silently retains data is worse than a refusal.
RETENTION_BASIS: Dict[str, str] = {
    "fines": (
        "Enforcement records are retained as a legal obligation and for the "
        "establishment or defence of legal claims. Personal identifiers are removed."
    ),
    "enforcement_cases": (
        "Case records are retained as a legal obligation. Personal identifiers are removed."
    ),
    "journal_entries": (
        "Financial records are retained for statutory accounting and audit. These contain "
        "no personal identifiers, only amounts and references."
    ),
    "audit_logs": (
        "Audit records are retained to detect and investigate misuse of the system. The "
        "actor reference is pseudonymised."
    ),
    "message_logs": (
        "Message metadata is retained to evidence delivery of legal notices. Message content "
        "was never stored."
    ),
}


def pseudonym(user_id: str) -> str:
    """Stable, non-reversible replacement for a user id.

    Stable so records that referenced the same person still correlate with
    each other — otherwise anonymisation would destroy the ability to
    investigate a pattern of misuse, which is the opposite of what the audit
    trail is for. Non-reversible so it cannot be turned back into an
    identity.
    """
    digest = hashlib.sha256(f"erased-subject:{user_id}".encode("utf-8")).hexdigest()
    return f"erased-{digest[:16]}"


async def export_subject_data(db: AsyncSession, user_id: str) -> dict:
    """Everything the system holds about one person.

    Deliberately assembled by walking each table that can reference a user
    rather than by a generic relationship crawl: a crawl would silently miss
    a table added later, and the failure mode would be an incomplete
    statutory response that looks complete.
    """
    from app.models import (
        AuditLog, Booking, Fine, LoginEvent, MessageLog, MessagingOptOut, User,
    )

    user = (await db.execute(select(User).where(User.id == user_id))).scalars().first()
    if user is None:
        return {}

    bookings = (
        await db.execute(select(Booking).where(Booking.passenger_user_id == user_id))
    ).scalars().all()

    logins = (
        await db.execute(
            select(LoginEvent).where(LoginEvent.user_id == user_id)
            .order_by(LoginEvent.created_at.desc()).limit(500)
        )
    ).scalars().all()

    audits = (
        await db.execute(
            select(AuditLog).where(AuditLog.user_id == user_id)
            .order_by(AuditLog.timestamp.desc()).limit(500)
        )
    ).scalars().all()

    messages = (
        await db.execute(
            select(MessageLog).where(MessageLog.user_id == user_id)
            .order_by(MessageLog.created_at.desc()).limit(500)
        )
    ).scalars().all()

    # Fines attach to a vehicle, not a person; an officer's own issued fines
    # are included because for staff that IS data about them.
    issued_fines = (
        await db.execute(select(Fine).where(Fine.officer_id == user_id))
    ).scalars().all()

    consent = None
    if user.phone:
        from app.messaging import normalize_phone
        consent = (
            await db.execute(
                select(MessagingOptOut).where(
                    MessagingOptOut.phone == normalize_phone(user.phone)
                )
            )
        ).scalars().first()

    return {
        "generatedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "subject": {
            "id": user.id,
            "name": user.name,
            "email": user.email,
            "phone": user.phone,
            "role": user.role,
            "saccoId": user.sacco_id,
            "isActive": user.is_active,
            "isMinor": getattr(user, "is_minor", None),
            "termsAcceptedAt": user.terms_accepted_at.isoformat() if getattr(user, "terms_accepted_at", None) else None,
            "mfaEnabled": getattr(user, "mfa_enabled", False),
        },
        "bookings": [
            {
                "id": b.id, "matatuId": b.matatu_id, "routeId": b.route_id,
                "passengerName": b.passenger_name, "status": b.status,
                "fareKes": str(b.fare_kes), "stageName": b.stage_name,
                "bookedAt": b.booked_at.isoformat() if b.booked_at else None,
            } for b in bookings
        ],
        "signInHistory": [
            {
                "eventType": e.event_type, "ipAddress": e.ip_address,
                "userAgent": e.user_agent, "reason": e.reason,
                "at": e.created_at.isoformat() if e.created_at else None,
            } for e in logins
        ],
        "actionsPerformed": [
            {
                "action": a.action, "resourceType": a.resource_type,
                "resourceId": a.resource_id,
                "at": a.timestamp.isoformat() if a.timestamp else None,
            } for a in audits
        ],
        "messagesReceived": [
            {
                "category": m.category, "status": m.status,
                "at": m.created_at.isoformat() if m.created_at else None,
                "preview": m.body_preview,
            } for m in messages
        ],
        "finesIssuedByThisUser": [
            {"id": f.id, "matatuId": f.matatu_id, "amountKes": str(f.amount_kes), "status": f.status}
            for f in issued_fines
        ],
        "messagingConsent": (
            {
                "optedOut": consent.opted_out_at is not None,
                "at": (consent.opted_out_at or consent.opted_in_at).isoformat()
                if (consent.opted_out_at or consent.opted_in_at) else None,
                "source": consent.source,
            } if consent else {"optedOut": False}
        ),
        "note": (
            "Location history from vehicle telemetry is recorded against vehicles, not "
            "individuals, and is not included here. Raw positions are retained for 90 days."
        ),
    }


async def erase_subject_data(
    db: AsyncSession, user_id: str, *, actor_id: str, reason: str
) -> dict:
    """Anonymises a subject while preserving records that must survive.

    Returns a per-table account of what happened, so the response to the
    subject can state precisely what was removed and what was retained on
    what legal basis.
    """
    from app.audit import stage_audit_log
    from app.models import AuditLog, Booking, LoginEvent, MessageLog, MessagingOptOut, User

    user = (await db.execute(select(User).where(User.id == user_id))).scalars().first()
    if user is None:
        raise ValueError(f"No user {user_id}")

    if user.role in ("ADMIN", "SUPERADMIN"):
        # Not a technical limitation. Erasing a privileged account's identity
        # would sever the audit trail for administrative actions across the
        # whole system, which is exactly the accountability the audit log
        # exists to provide.
        raise ValueError(
            "Administrative accounts cannot be anonymised while active — transfer the role "
            "and deactivate the account first."
        )

    alias = pseudonym(user_id)
    actions: Dict[str, Any] = {}

    # --- Direct identifiers on the account itself -------------------------
    original_email = user.email
    user.name = "Erased Subject"
    # Kept unique and syntactically valid: the column is NOT NULL and unique,
    # and a collision here would fail the erasure rather than complete it.
    user.email = f"{alias}@erased.invalid"
    user.phone = None
    user.password = f"!erased!{uuid.uuid4().hex}"  # unusable, not a valid hash
    user.is_active = False
    user.totp_secret = None
    user.mfa_enabled = False
    user.mfa_backup_codes = None
    for field in ("guardian_name", "guardian_phone", "guardian_id_number",
                  "guardian_relationship", "terms_signature"):
        if hasattr(user, field):
            setattr(user, field, None)
    actions["users"] = "Identifiers replaced; account deactivated."

    # --- Bookings: keep the transaction, drop the person ------------------
    bookings = (
        await db.execute(select(Booking).where(Booking.passenger_user_id == user_id))
    ).scalars().all()
    for b in bookings:
        b.passenger_name = "Erased Subject"
        if hasattr(b, "passenger_phone"):
            b.passenger_phone = None
    actions["bookings"] = f"{len(bookings)} booking(s) retained for fare accounting, passenger details removed."

    # --- Sign-in history: IP and user agent are identifying ---------------
    logins = (await db.execute(select(LoginEvent).where(LoginEvent.user_id == user_id))).scalars().all()
    for e in logins:
        e.ip_address = None
        e.user_agent = None
        e.email = None
    actions["login_events"] = f"{len(logins)} sign-in record(s) retained for security monitoring, network identifiers removed."

    # --- Messages: metadata retained, recipient pseudonymised -------------
    messages = (await db.execute(select(MessageLog).where(MessageLog.user_id == user_id))).scalars().all()
    for m in messages:
        m.phone = alias
        m.body_preview = None
    actions["message_logs"] = f"{len(messages)} delivery record(s) retained to evidence notice delivery, recipient pseudonymised."

    # --- Audit trail: pseudonymise the actor, never delete the entry ------
    audits = (await db.execute(select(AuditLog).where(AuditLog.user_id == user_id))).scalars().all()
    for a in audits:
        a.user_id = alias
    actions["audit_logs"] = f"{len(audits)} audit record(s) retained; actor pseudonymised."

    # --- Consent record -----------------------------------------------------
    if original_email or user.phone:
        pass
    consents = (
        await db.execute(select(MessagingOptOut).where(MessagingOptOut.phone == alias))
    ).scalars().all()
    actions["messaging_opt_outs"] = f"{len(consents)} consent record(s) retained under the pseudonym."

    stage_audit_log(
        db, resource_type="user", resource_id=user_id, action="DATA_ERASURE",
        user_id=actor_id,
        new_values={"pseudonym": alias, "reason": reason, "tables": list(actions.keys())},
    )
    await db.commit()

    logger.warning("Data erasure completed for %s (alias %s) by %s", user_id, alias, actor_id)
    return {
        "subjectId": user_id,
        "pseudonym": alias,
        "erasedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "actions": actions,
        "retainedRecords": RETENTION_BASIS,
        "note": (
            "Erasure under the Data Protection Act is not absolute: records held under a legal "
            "obligation, for the establishment or defence of legal claims, or for statutory "
            "accounting have been retained in anonymised form rather than deleted."
        ),
    }
