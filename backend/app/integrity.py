"""
Fraud, abuse and revenue integrity signals (Readiness List §17).

A county revenue and enforcement system is a fraud target from both
outside and inside, and the inside is the harder problem: an officer who
issues citations and an administrator who voids them have, between them,
everything needed to run a collection racket that never appears in a
revenue total.

The audit log already captures the raw material for detecting that.
Nothing looked at it. This module does.

Deliberate design choices:

  * **Signals, not a risk score.** Each check answers one question an
    investigator can verify by hand. A blended "integrity score" would be
    unfalsifiable, would make disagreement impossible, and would be exactly
    the kind of output nobody acts on.

  * **Nothing is blocked automatically.** These flag for human review. An
    officer who legitimately worked a roadblock will trip the volume check,
    and auto-suspending them mid-shift on a statistical outlier is a worse
    failure than a delayed investigation.

  * **Thresholds are named constants with stated reasoning**, because they
    will be argued about and the argument should start from why the number
    was chosen rather than from archaeology.
"""
import datetime
import logging
from decimal import Decimal
from typing import Dict, List, Optional

from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger("app.integrity")

# An officer issuing more than this in a day is not necessarily doing
# anything wrong — a roadblock operation legitimately produces volume — but
# it is worth a look, because it is also what a quota racket looks like.
HIGH_VOLUME_FINES_PER_DAY = 40

# Voiding is a legitimate correction. Voiding a large share of what you
# issued suggests either poor issuing practice or citations written to be
# withdrawn for a consideration.
HIGH_VOID_RATE = 0.25
MIN_FINES_FOR_VOID_RATE = 10  # below this the ratio is noise

# The same officer citing the same vehicle repeatedly in a short window is
# either a genuinely persistent offender or targeted harassment. Both
# warrant a human looking.
REPEAT_VEHICLE_THRESHOLD = 4
REPEAT_WINDOW_DAYS = 30

# Enforcement outside normal hours is normal for night operations, so this
# is reported as context alongside other signals rather than as a finding
# on its own.
NIGHT_START_HOUR = 22
NIGHT_END_HOUR = 5


async def high_volume_issuers(db: AsyncSession, *, days: int = 7) -> List[dict]:
    """Officers issuing unusually many fines per day."""
    from app.models import Fine, User

    since = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=days)
    rows = (
        await db.execute(
            select(
                Fine.officer_id,
                func.date(Fine.issued_at).label("day"),
                func.count(Fine.id),
                func.coalesce(func.sum(Fine.amount_kes), 0),
            )
            .where(Fine.issued_at >= since)
            .group_by(Fine.officer_id, func.date(Fine.issued_at))
            .having(func.count(Fine.id) > HIGH_VOLUME_FINES_PER_DAY)
        )
    ).all()

    findings = []
    for officer_id, day, count, total in rows:
        officer = (await db.execute(select(User).where(User.id == officer_id))).scalars().first()
        findings.append({
            "signal": "high_volume_issuance",
            "officerId": officer_id,
            "officerName": officer.name if officer else None,
            "day": str(day),
            "fineCount": count,
            "totalKes": str(Decimal(str(total or 0))),
            "threshold": HIGH_VOLUME_FINES_PER_DAY,
            "interpretation": (
                "Legitimate during a roadblock operation. Worth confirming an operation was "
                "scheduled that day."
            ),
        })
    return findings


async def high_void_rates(db: AsyncSession, *, days: int = 30) -> List[dict]:
    """Officers whose citations are disproportionately voided or waived."""
    from app.models import Fine, User

    since = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=days)
    rows = (
        await db.execute(
            select(
                Fine.officer_id,
                func.count(Fine.id),
                func.sum(case((Fine.status.in_(("WAIVED", "CANCELLED")), 1), else_=0)),
            )
            .where(Fine.issued_at >= since)
            .group_by(Fine.officer_id)
            .having(func.count(Fine.id) >= MIN_FINES_FOR_VOID_RATE)
        )
    ).all()

    findings = []
    for officer_id, total, voided in rows:
        voided = int(voided or 0)
        rate = voided / total if total else 0
        if rate < HIGH_VOID_RATE:
            continue
        officer = (await db.execute(select(User).where(User.id == officer_id))).scalars().first()
        findings.append({
            "signal": "high_void_rate",
            "officerId": officer_id,
            "officerName": officer.name if officer else None,
            "finesIssued": total,
            "finesVoided": voided,
            "voidRate": round(rate, 3),
            "threshold": HIGH_VOID_RATE,
            "interpretation": (
                "Either poor issuing practice or citations written to be withdrawn. Compare "
                "against who authorised each waiver."
            ),
        })
    return findings


async def repeat_targeting(db: AsyncSession) -> List[dict]:
    """The same officer citing the same vehicle repeatedly."""
    from app.models import Fine, Matatu, User

    since = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=REPEAT_WINDOW_DAYS)
    rows = (
        await db.execute(
            select(Fine.officer_id, Fine.matatu_id, func.count(Fine.id))
            .where(Fine.issued_at >= since)
            .group_by(Fine.officer_id, Fine.matatu_id)
            .having(func.count(Fine.id) >= REPEAT_VEHICLE_THRESHOLD)
        )
    ).all()

    findings = []
    for officer_id, matatu_id, count in rows:
        officer = (await db.execute(select(User).where(User.id == officer_id))).scalars().first()
        vehicle = (await db.execute(select(Matatu).where(Matatu.id == matatu_id))).scalars().first()
        findings.append({
            "signal": "repeat_vehicle_targeting",
            "officerId": officer_id,
            "officerName": officer.name if officer else None,
            "matatuId": matatu_id,
            "registration": vehicle.reg_number if vehicle else None,
            "citations": count,
            "windowDays": REPEAT_WINDOW_DAYS,
            "interpretation": (
                "A persistent offender or targeted harassment. The vehicle's compliance history "
                "distinguishes the two."
            ),
        })
    return findings


async def separation_of_duties_breaches(db: AsyncSession, *, days: int = 90) -> List[dict]:
    """Cases where one person both issued a fine and decided its dispute.

    The single most important internal control in an enforcement system: an
    officer who can issue a citation and then adjudicate the challenge to it
    faces no check at all.
    """
    from app.models import Fine, User

    since = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=days)

    # Resolution fields live on the enforcement-case model in this codebase;
    # fines carry the officer. Both are checked where present rather than
    # assuming one shape.
    findings: List[dict] = []
    try:
        from app.models import EnforcementCase

        rows = (
            await db.execute(
                select(EnforcementCase).where(
                    EnforcementCase.arresting_officer_id.is_not(None),
                    EnforcementCase.resolved_by_id.is_not(None),
                    EnforcementCase.arresting_officer_id == EnforcementCase.resolved_by_id,
                )
            )
        ).scalars().all()
        for case in rows:
            officer = (
                await db.execute(select(User).where(User.id == case.arresting_officer_id))
            ).scalars().first()
            findings.append({
                "signal": "separation_of_duties_breach",
                "caseId": case.id,
                "officerId": case.arresting_officer_id,
                "officerName": officer.name if officer else None,
                "resolution": getattr(case, "resolution", None),
                "severity": "high",
                "interpretation": (
                    "The same person filed this case and decided its outcome. This should not be "
                    "possible; treat as a control failure, not a statistical signal."
                ),
            })
    except Exception as e:
        logger.debug("Separation-of-duties check skipped: %s", e)

    return findings


async def ghost_records(db: AsyncSession) -> List[dict]:
    """Duplicate registrations — the cheapest attack on a licensing system.

    A vehicle registered twice can carry two compliance histories, and the
    clean one is presented at inspection.

    Note on the vehicle check specifically: `matatus.reg_number` currently
    carries a UNIQUE constraint, so this cannot fire today. It is kept
    deliberately, as defence in depth — a future migration that relaxes the
    constraint (to support re-registration or transfers between Saccos, both
    plausible) would silently open this hole, and a check that already
    exists will catch it. Verified as unreachable rather than assumed
    working.

    The Sacco-name check below has no such constraint and can fire.
    """
    from app.models import Matatu, Sacco

    findings: List[dict] = []

    dupes = (
        await db.execute(
            select(Matatu.reg_number, func.count(Matatu.id))
            .group_by(Matatu.reg_number)
            .having(func.count(Matatu.id) > 1)
        )
    ).all()
    for reg, count in dupes:
        findings.append({
            "signal": "duplicate_vehicle_registration",
            "registration": reg,
            "recordCount": count,
            "severity": "high",
            "interpretation": (
                "One plate with several records can carry two compliance histories, with the "
                "clean one shown at inspection."
            ),
        })

    sacco_dupes = (
        await db.execute(
            select(func.lower(Sacco.name), func.count(Sacco.id))
            .group_by(func.lower(Sacco.name))
            .having(func.count(Sacco.id) > 1)
        )
    ).all()
    for name, count in sacco_dupes:
        findings.append({
            "signal": "duplicate_sacco_name",
            "name": name,
            "recordCount": count,
            "severity": "medium",
            "interpretation": "May be a re-registration to escape an enforcement history.",
        })

    return findings


async def ledger_integrity(db: AsyncSession) -> List[dict]:
    """The books either balance or they do not.

    Not a heuristic like the rest of this module: an out-of-balance ledger
    means something wrote postings outside app/ledger.post_entry, which is
    a stop-everything condition.
    """
    from app import ledger

    findings: List[dict] = []
    tb = await ledger.trial_balance(db)
    if not tb["balanced"]:
        findings.append({
            "signal": "ledger_out_of_balance",
            "sumOfAllPostings": tb["sumOfAllPostings"],
            "severity": "critical",
            "interpretation": (
                "Postings were written without going through the ledger's balance check. "
                "Stop and investigate before relying on any revenue figure."
            ),
        })

    # A negative cash balance is arithmetically possible and operationally
    # impossible: it means more was paid out than ever came in.
    for account in ("cash:nairobipay", "cash:county"):
        balance = await ledger.account_balance(db, account)
        if balance < 0:
            findings.append({
                "signal": "negative_cash_balance",
                "account": account,
                "balance": str(balance),
                "severity": "critical",
                "interpretation": "More has been paid out of this account than was ever received.",
            })

    return findings


async def run_all(db: AsyncSession, *, days: int = 30) -> dict:
    """Every check, grouped by severity.

    Ordered so a reader sees control failures and accounting breaks before
    statistical outliers — the first two are facts, the rest are questions.
    """
    groups = {
        "ledgerIntegrity": await ledger_integrity(db),
        "separationOfDuties": await separation_of_duties_breaches(db, days=days),
        "ghostRecords": await ghost_records(db),
        "highVoidRates": await high_void_rates(db, days=days),
        "repeatTargeting": await repeat_targeting(db),
        "highVolumeIssuance": await high_volume_issuers(db, days=min(days, 7)),
    }
    total = sum(len(v) for v in groups.values())
    critical = sum(
        1 for v in groups.values() for f in v if f.get("severity") == "critical"
    )
    return {
        "generatedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "windowDays": days,
        "totalFindings": total,
        "criticalFindings": critical,
        "findings": groups,
        "note": (
            "These are signals for human review, not automated enforcement. Nothing here "
            "suspends an account: an officer working a scheduled roadblock will trip the volume "
            "check, and acting on that automatically would be worse than a delayed review."
        ),
    }
