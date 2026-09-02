"""
Ledger reporting and reconciliation (Readiness List §15).

Read-only by design. Nothing here posts entries: postings happen as a side
effect of the business events that cause them (a fine issued, a payment
received), never as a standalone "adjust the books" action. An endpoint
that let someone hand-write a journal entry would be the single most
abusable surface in a revenue system.

Corrections go through app/ledger.reverse_entry, which is reachable from
the ops console with a reason and a full audit trail, not from here.
"""
import datetime
import logging
from decimal import Decimal
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app import ledger
from app.auth import requires_permission
from app.database import get_db
from app.models import JournalEntry, LedgerPosting, User

logger = logging.getLogger("app.routes.ledger")
router = APIRouter(prefix="/api/ledger", tags=["Revenue Ledger"])


@router.get("/accounts")
async def get_chart_of_accounts(
    current_user: User = Depends(requires_permission("view_reports")),
):
    return {"accounts": ledger.chart_of_accounts()}


@router.get("/trial-balance")
async def get_trial_balance(
    current_user: User = Depends(requires_permission("view_reports")),
    db: AsyncSession = Depends(get_db),
):
    """Every account's balance, and the system-wide zero check.

    `balanced: false` means something wrote postings without going through
    post_entry(). That is a stop-everything condition, not a number to note
    and move past, so it is surfaced as the headline field rather than
    buried among the account rows.
    """
    result = await ledger.trial_balance(db)
    if not result["balanced"]:
        logger.error(
            "LEDGER OUT OF BALANCE: postings sum to %s", result["sumOfAllPostings"]
        )
    return result


@router.get("/entries")
async def list_entries(
    reference_type: Optional[str] = Query(None),
    reference_id: Optional[str] = Query(None),
    account: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    current_user: User = Depends(requires_permission("view_reports")),
    db: AsyncSession = Depends(get_db),
):
    """Journal entries with their postings, newest first."""
    query = select(JournalEntry)
    if reference_type:
        query = query.where(JournalEntry.reference_type == reference_type)
    if reference_id:
        query = query.where(JournalEntry.reference_id == reference_id)
    if account:
        query = query.where(
            JournalEntry.id.in_(
                select(LedgerPosting.entry_id).where(LedgerPosting.account == account)
            )
        )

    entries = (
        await db.execute(
            query.order_by(JournalEntry.occurred_at.desc(), JournalEntry.id.desc())
            .limit(limit).offset(offset)
        )
    ).scalars().all()

    entry_ids = [e.id for e in entries]
    postings_by_entry = {}
    if entry_ids:
        rows = (
            await db.execute(
                select(LedgerPosting).where(LedgerPosting.entry_id.in_(entry_ids))
                .order_by(LedgerPosting.entry_id, LedgerPosting.line_number)
            )
        ).scalars().all()
        for p in rows:
            postings_by_entry.setdefault(p.entry_id, []).append({
                "account": p.account,
                "amount": str(p.amount),
                "direction": "debit" if Decimal(p.amount) > 0 else "credit",
                "memo": p.memo,
            })

    return {
        "data": [
            {
                "id": e.id,
                "description": e.description,
                "referenceType": e.reference_type,
                "referenceId": e.reference_id,
                "reversesEntryId": e.reverses_entry_id,
                "actorId": e.actor_id,
                "occurredAt": e.occurred_at.isoformat() if e.occurred_at else None,
                "postings": postings_by_entry.get(e.id, []),
            }
            for e in entries
        ],
        "pagination": {"limit": limit, "offset": offset, "count": len(entries)},
    }


@router.get("/reconciliation")
async def reconciliation_report(
    expected_provider_balance: Optional[str] = Query(
        None,
        description="Balance NairobiPay reports holding, from their settlement statement.",
    ),
    current_user: User = Depends(requires_permission("view_reports")),
    db: AsyncSession = Depends(get_db),
):
    """Compares the ledger against what the payment provider says it holds.

    Providers and internal records always drift — a callback lost in
    transit, a payment recorded manually that also arrived automatically, a
    refund processed provider-side but never posted. The question is only
    whether that is discovered daily or during an annual audit.

    Pass the provider's own figure to get the discrepancy computed; omit it
    to see the ledger's position alone.
    """
    ledger_cash = await ledger.account_balance(db, "cash:nairobipay")
    receivable_fines = await ledger.account_balance(db, "receivable:fines")
    sacco_owed = await ledger.account_balance(db, "liability:sacco_settlement")
    refunds_owed = await ledger.account_balance(db, "liability:refunds_payable")

    report = {
        "generatedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "ledger": {
            "cashAtProvider": str(ledger_cash),
            "outstandingFineReceivables": str(receivable_fines),
            # Liabilities carry a credit (negative) balance internally;
            # negate so the report reads as an amount owed rather than
            # asking the reader to interpret a sign.
            "owedToSaccos": str(-sacco_owed),
            "refundsPayable": str(-refunds_owed),
        },
        "provider": None,
        "discrepancy": None,
        "reconciled": None,
    }

    if expected_provider_balance is not None:
        try:
            provider = ledger.to_amount(expected_provider_balance)
        except ledger.LedgerError as e:
            raise HTTPException(status_code=400, detail=str(e))
        difference = ledger_cash - provider
        report["provider"] = {"reportedBalance": str(provider)}
        report["discrepancy"] = str(difference)
        report["reconciled"] = difference == ledger.ZERO
        if difference != ledger.ZERO:
            logger.warning(
                "Reconciliation discrepancy: ledger %s vs provider %s (diff %s)",
                ledger_cash, provider, difference,
            )

    return report
