"""
Double-entry ledger for county revenue (Readiness List §15).

Fares, fines and licence renewals are public money. A schema that stores
balances rather than immutable entries cannot answer "where did this
shilling come from" — and county revenue *will* be audited, so that is not
a hypothetical requirement.

The three rules this module exists to enforce:

  1. **Every entry balances.** Postings within a journal entry must sum to
     exactly zero. This is checked before the write, so an unbalanced entry
     cannot reach the database — the single most valuable property of
     double-entry bookkeeping is worthless if it is merely intended.

  2. **Nothing is ever mutated.** Entries are never updated or deleted. A
     mistake is corrected by posting a reversing entry that references the
     original, so the trail shows what happened *and* what was corrected,
     which is exactly what an auditor asks for.

  3. **Money is never a float.** All amounts are Decimal, in shillings with
     two decimal places. Binary floating point cannot represent 0.10
     exactly; a system that adds up money in floats will eventually disagree
     with the bank by a few cents and nobody will be able to explain why.

Sign convention: a posting's `amount` is positive for a debit and negative
for a credit. One signed column rather than separate debit/credit columns
makes "sum to zero" a single SQL aggregate instead of a comparison, and
makes an unbalanced entry impossible to express as a rounding artefact.
"""
import datetime
import logging
import uuid
from decimal import Decimal, InvalidOperation
from typing import Dict, List, Optional, Sequence, Tuple

from sqlalchemy import func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

logger = logging.getLogger("app.ledger")

ZERO = Decimal("0.00")


class LedgerError(Exception):
    """Raised when a posting would violate an accounting invariant."""


# --- Chart of accounts ------------------------------------------------------
#
# Deliberately a fixed catalogue in code rather than a user-editable table.
# An operator inventing a new account mid-incident is how a ledger stops
# reconciling; adding one should be a reviewed code change.
#
# type drives the sign convention an auditor expects:
#   asset/expense    — increased by debits  (positive amounts)
#   liability/revenue— increased by credits (negative amounts)

ACCOUNTS: Dict[str, Dict[str, str]] = {
    "cash:nairobipay": {
        "type": "asset",
        "description": "Funds held at NairobiPay on the county's behalf, not yet settled to the county account.",
    },
    "cash:county": {
        "type": "asset",
        "description": "Funds settled into the county's own bank account.",
    },
    "receivable:fines": {
        "type": "asset",
        "description": "Fines issued and legally owed but not yet paid.",
    },
    "receivable:licences": {
        "type": "asset",
        "description": "Licence renewal fees invoiced but not yet paid.",
    },
    "revenue:fines": {
        "type": "revenue",
        "description": "Enforcement fine income.",
    },
    "revenue:fares": {
        "type": "revenue",
        "description": "County commission on fare bookings.",
    },
    "revenue:licences": {
        "type": "revenue",
        "description": "Operator licence and renewal income.",
    },
    "liability:sacco_settlement": {
        "type": "liability",
        "description": "Fare money collected on behalf of Saccos and owed to them.",
    },
    "liability:refunds_payable": {
        "type": "liability",
        "description": "Amounts owed back to payers for overturned fines or cancelled bookings.",
    },
}


def account_type(code: str) -> str:
    meta = ACCOUNTS.get(code)
    if meta is None:
        raise LedgerError(f"Unknown ledger account: {code}")
    return meta["type"]


def chart_of_accounts() -> List[dict]:
    return [
        {"code": code, "type": meta["type"], "description": meta["description"]}
        for code, meta in sorted(ACCOUNTS.items())
    ]


# --- Amount handling --------------------------------------------------------

def to_amount(value) -> Decimal:
    """Coerces to a two-decimal Decimal, refusing anything lossy.

    Floats are rejected outright rather than converted. Accepting a float
    here would be the exact bug this module exists to prevent, and doing it
    silently would make the resulting discrepancy untraceable.
    """
    if isinstance(value, float):
        raise LedgerError(
            "Refusing to post a float amount — money must be Decimal or str to avoid "
            "binary rounding error. Convert at the call site, deliberately."
        )
    try:
        amount = Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        raise LedgerError(f"Not a valid monetary amount: {value!r}")
    return amount.quantize(Decimal("0.01"))


# --- Posting ----------------------------------------------------------------

class Posting:
    """One line of a journal entry.

    Positive = debit, negative = credit.
    """

    __slots__ = ("account", "amount", "memo")

    def __init__(self, account: str, amount, memo: Optional[str] = None):
        account_type(account)  # raises on unknown account
        self.account = account
        self.amount = to_amount(amount)
        self.memo = memo

    def __repr__(self) -> str:
        return f"<Posting {self.account} {self.amount}>"


def debit(account: str, amount, memo: Optional[str] = None) -> Posting:
    value = to_amount(amount)
    if value <= ZERO:
        raise LedgerError("A debit must be a positive amount.")
    return Posting(account, value, memo)


def credit(account: str, amount, memo: Optional[str] = None) -> Posting:
    value = to_amount(amount)
    if value <= ZERO:
        raise LedgerError("A credit must be a positive amount.")
    return Posting(account, -value, memo)


async def post_entry(
    db: AsyncSession,
    *,
    description: str,
    postings: Sequence[Posting],
    reference_type: Optional[str] = None,
    reference_id: Optional[str] = None,
    idempotency_key: Optional[str] = None,
    actor_id: Optional[str] = None,
    reverses_entry_id: Optional[str] = None,
    occurred_at: Optional[datetime.datetime] = None,
) -> Optional[str]:
    """Writes one balanced journal entry. Returns its id.

    Does NOT commit — the caller commits, so the ledger entry lands in the
    same transaction as the business change that caused it. A payment marked
    PAID without its posting, or a posting without the payment, would each be
    worse than failing outright.

    `idempotency_key` makes replay safe: a redelivered payment callback that
    reuses the key posts nothing the second time and returns None, rather
    than crediting the county twice.
    """
    from app.models import JournalEntry, LedgerPosting

    if len(postings) < 2:
        raise LedgerError("A journal entry needs at least two postings.")

    total = sum((p.amount for p in postings), ZERO)
    if total != ZERO:
        # The invariant, enforced rather than assumed.
        raise LedgerError(
            f"Journal entry does not balance: postings sum to {total}, must be 0.00. "
            f"Postings: {[(p.account, str(p.amount)) for p in postings]}"
        )

    if idempotency_key:
        existing = (
            await db.execute(
                select(JournalEntry).where(JournalEntry.idempotency_key == idempotency_key)
            )
        ).scalars().first()
        if existing is not None:
            logger.info(
                "Ledger entry for key %s already posted (%s); skipping duplicate.",
                idempotency_key, existing.id,
            )
            return None

    entry_id = f"je-{uuid.uuid4().hex[:12]}"
    db.add(JournalEntry(
        id=entry_id,
        description=description,
        reference_type=reference_type,
        reference_id=reference_id,
        idempotency_key=idempotency_key,
        actor_id=actor_id,
        reverses_entry_id=reverses_entry_id,
        occurred_at=occurred_at or datetime.datetime.now(datetime.timezone.utc),
        created_at=datetime.datetime.now(datetime.timezone.utc),
    ))
    for index, p in enumerate(postings):
        db.add(LedgerPosting(
            id=f"lp-{uuid.uuid4().hex[:12]}",
            entry_id=entry_id,
            line_number=index,
            account=p.account,
            amount=p.amount,
            memo=p.memo,
        ))

    logger.info("Ledger entry %s: %s", entry_id, description)
    return entry_id


async def reverse_entry(
    db: AsyncSession,
    *,
    entry_id: str,
    reason: str,
    actor_id: Optional[str] = None,
) -> str:
    """Posts the mirror image of an existing entry.

    This is the only way to undo something. Editing or deleting the original
    would destroy the record of what was originally believed to be true,
    which is the specific thing an audit needs to see.
    """
    from app.models import JournalEntry, LedgerPosting

    original = (
        await db.execute(select(JournalEntry).where(JournalEntry.id == entry_id))
    ).scalars().first()
    if original is None:
        raise LedgerError(f"No journal entry {entry_id}")

    already = (
        await db.execute(
            select(JournalEntry).where(JournalEntry.reverses_entry_id == entry_id)
        )
    ).scalars().first()
    if already is not None:
        raise LedgerError(f"Entry {entry_id} was already reversed by {already.id}")

    lines = (
        await db.execute(
            select(LedgerPosting).where(LedgerPosting.entry_id == entry_id)
            .order_by(LedgerPosting.line_number)
        )
    ).scalars().all()
    if not lines:
        raise LedgerError(f"Entry {entry_id} has no postings to reverse")

    mirrored = [Posting(l.account, -Decimal(l.amount), f"Reversal: {reason}") for l in lines]
    new_id = await post_entry(
        db,
        description=f"Reversal of {entry_id}: {reason}",
        postings=mirrored,
        reference_type=original.reference_type,
        reference_id=original.reference_id,
        actor_id=actor_id,
        reverses_entry_id=entry_id,
    )
    return new_id  # type: ignore[return-value]


# --- Reporting --------------------------------------------------------------

async def account_balance(db: AsyncSession, account: str,
                          as_of: Optional[datetime.datetime] = None) -> Decimal:
    """Balance is always derived by summing postings, never stored.

    A stored balance is a second source of truth that can silently disagree
    with the entries that produced it; recomputing means the number shown can
    always be traced to the lines behind it.
    """
    from app.models import LedgerPosting, JournalEntry

    query = select(func.coalesce(func.sum(LedgerPosting.amount), 0)).where(
        LedgerPosting.account == account
    )
    if as_of is not None:
        query = query.join(JournalEntry, LedgerPosting.entry_id == JournalEntry.id).where(
            JournalEntry.occurred_at <= as_of
        )
    raw = (await db.execute(query)).scalar_one()
    return to_amount(raw or 0)


async def trial_balance(db: AsyncSession) -> dict:
    """Every account's balance, plus the system-wide zero check.

    If `balanced` is ever false the ledger has been corrupted by something
    bypassing post_entry, and that is a stop-everything condition rather
    than a report to skim.
    """
    from app.models import LedgerPosting

    rows = (
        await db.execute(
            select(LedgerPosting.account, func.coalesce(func.sum(LedgerPosting.amount), 0))
            .group_by(LedgerPosting.account)
        )
    ).all()

    accounts = []
    total = ZERO
    for account, amount in rows:
        balance = to_amount(amount or 0)
        total += balance
        accounts.append({
            "account": account,
            "type": ACCOUNTS.get(account, {}).get("type", "unknown"),
            "balance": str(balance),
            # Presented the way an accountant reads it, rather than making
            # them mentally flip signs for liability and revenue accounts.
            "naturalBalance": str(-balance if ACCOUNTS.get(account, {}).get("type") in ("liability", "revenue") else balance),
        })

    return {
        "accounts": sorted(accounts, key=lambda a: a["account"]),
        "sumOfAllPostings": str(total),
        "balanced": total == ZERO,
    }
