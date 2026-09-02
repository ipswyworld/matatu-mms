"""
Revenue flows — the bridge from business events to ledger entries
(Readiness List §15).

app/ledger.py deliberately knows nothing about fines or fares; it only
knows that entries must balance. This module holds the accounting policy:
which accounts each real-world event touches, and in which direction.

Keeping that policy in one place matters because it is the part that gets
argued about. When the county's finance function asks "why is fine revenue
recognised at issue rather than at payment", the answer is one function
here, not logic scattered across route handlers.

Recognition policy, stated explicitly because it is a real accounting
choice and not an implementation detail:

  * **Fines are recognised when issued**, not when paid, because the county
    is legally owed the money at issue. The unpaid balance sits in
    `receivable:fines` where it is visible, rather than being invisible
    until someone happens to pay.
  * **Fares are not county revenue.** Money collected for a seat belongs to
    the Sacco; only the county's commission is revenue. The rest is a
    liability until settled, which is why it must never be reported as
    income.
"""
import logging
from decimal import Decimal
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession

from app import ledger
from app.ledger import Posting, credit, debit, post_entry, to_amount

logger = logging.getLogger("app.revenue")

# County commission on a fare booking. A configuration decision with a real
# policy meaning, so it lives here named rather than inline as a magic
# number in a route handler.
FARE_COMMISSION_RATE = Decimal("0.05")


async def record_fine_issued(
    db: AsyncSession, *, fine_id: str, amount, officer_id: Optional[str] = None
) -> Optional[str]:
    """A fine is issued: the county is now owed money.

    DR receivable:fines / CR revenue:fines
    """
    value = to_amount(amount)
    if value <= ledger.ZERO:
        raise ledger.LedgerError("A fine must have a positive amount.")

    return await post_entry(
        db,
        description=f"Fine {fine_id} issued",
        postings=[
            debit("receivable:fines", value, memo=f"Fine {fine_id}"),
            credit("revenue:fines", value, memo=f"Fine {fine_id}"),
        ],
        reference_type="fine",
        reference_id=fine_id,
        # Issuing the same fine twice is a bug, not a business event.
        idempotency_key=f"fine:issued:{fine_id}",
        actor_id=officer_id,
    )


async def record_fine_paid(
    db: AsyncSession, *, fine_id: str, amount, transaction_id: str
) -> Optional[str]:
    """A fine is paid: the receivable is settled, cash arrives at the provider.

    DR cash:nairobipay / CR receivable:fines

    Deliberately does NOT touch revenue — that was already recognised at
    issue. Crediting revenue again here is the classic double-count, and it
    would inflate reported county income by the full value of every
    collected fine.
    """
    value = to_amount(amount)
    return await post_entry(
        db,
        description=f"Fine {fine_id} paid (txn {transaction_id})",
        postings=[
            debit("cash:nairobipay", value, memo=f"Fine {fine_id}"),
            credit("receivable:fines", value, memo=f"Fine {fine_id}"),
        ],
        reference_type="fine",
        reference_id=fine_id,
        # Keyed on the provider's transaction id: a redelivered callback
        # carries the same one, so the replay posts nothing.
        idempotency_key=f"fine:paid:{transaction_id}",
    )


async def record_fine_overturned(
    db: AsyncSession, *, fine_id: str, amount, reviewer_id: Optional[str] = None,
    was_paid: bool = False,
) -> Optional[str]:
    """A disputed fine is overturned.

    Unpaid: reverse the receivable and the revenue.
      DR revenue:fines / CR receivable:fines

    Already paid: the revenue reverses, but the county now owes the money
    back rather than having never received it.
      DR revenue:fines / CR liability:refunds_payable

    Treating a paid overturn as if it were unpaid would leave the ledger
    claiming a receivable that no longer exists and no refund obligation —
    wrong in two directions at once.
    """
    value = to_amount(amount)
    counter = "liability:refunds_payable" if was_paid else "receivable:fines"
    return await post_entry(
        db,
        description=f"Fine {fine_id} overturned{' (refund due)' if was_paid else ''}",
        postings=[
            debit("revenue:fines", value, memo=f"Fine {fine_id} overturned"),
            credit(counter, value, memo=f"Fine {fine_id} overturned"),
        ],
        reference_type="fine",
        reference_id=fine_id,
        idempotency_key=f"fine:overturned:{fine_id}",
        actor_id=reviewer_id,
    )


async def record_fine_waived(
    db: AsyncSession, *, fine_id: str, amount, authorized_by: Optional[str] = None
) -> Optional[str]:
    """A fine is waived by authority: the county writes off what it was owed.

    DR revenue:fines / CR receivable:fines

    Identical postings to an unpaid overturn but recorded as a distinct
    event, because "we were wrong to issue this" and "we chose not to
    collect this" are different facts and a revenue report should be able
    to distinguish them.
    """
    value = to_amount(amount)
    return await post_entry(
        db,
        description=f"Fine {fine_id} waived",
        postings=[
            debit("revenue:fines", value, memo=f"Fine {fine_id} waived"),
            credit("receivable:fines", value, memo=f"Fine {fine_id} waived"),
        ],
        reference_type="fine",
        reference_id=fine_id,
        idempotency_key=f"fine:waived:{fine_id}",
        actor_id=authorized_by,
    )


async def record_fare_collected(
    db: AsyncSession, *, booking_id: str, amount, transaction_id: str,
    commission_rate: Optional[Decimal] = None,
) -> Optional[str]:
    """A passenger pays a fare.

    Cash arrives, but most of it is not the county's money:
      DR cash:nairobipay        (full amount)
      CR revenue:fares          (county commission)
      CR liability:sacco_settlement (the Sacco's share, owed onward)

    The split is the whole point. Recording the full fare as county revenue
    would overstate income by roughly twentyfold and create a settlement
    obligation nothing in the books acknowledges.
    """
    total = to_amount(amount)
    rate = commission_rate if commission_rate is not None else FARE_COMMISSION_RATE
    commission = to_amount(total * rate)
    sacco_share = to_amount(total - commission)

    # Guard against a rounding split that fails to reconstitute the total.
    if commission + sacco_share != total:
        raise ledger.LedgerError(
            f"Fare split does not reconstitute the total: {commission} + {sacco_share} != {total}"
        )

    return await post_entry(
        db,
        description=f"Fare collected for booking {booking_id}",
        postings=[
            debit("cash:nairobipay", total, memo=f"Booking {booking_id}"),
            credit("revenue:fares", commission, memo=f"County commission @ {rate}"),
            credit("liability:sacco_settlement", sacco_share, memo="Owed to Sacco"),
        ],
        reference_type="booking",
        reference_id=booking_id,
        idempotency_key=f"fare:collected:{transaction_id}",
    )


async def record_licence_fee_paid(
    db: AsyncSession, *, sacco_id: str, amount, transaction_id: str
) -> Optional[str]:
    """An operator pays a licence or renewal fee. Straight county income.

    DR cash:nairobipay / CR revenue:licences
    """
    value = to_amount(amount)
    return await post_entry(
        db,
        description=f"Licence fee paid by {sacco_id}",
        postings=[
            debit("cash:nairobipay", value, memo=f"Sacco {sacco_id}"),
            credit("revenue:licences", value, memo=f"Sacco {sacco_id}"),
        ],
        reference_type="sacco",
        reference_id=sacco_id,
        idempotency_key=f"licence:paid:{transaction_id}",
    )


async def record_settlement_to_county(
    db: AsyncSession, *, amount, settlement_reference: str
) -> Optional[str]:
    """The provider settles held funds into the county's bank account.

    DR cash:county / CR cash:nairobipay

    Moves money between two asset accounts; total assets are unchanged,
    which is the correct representation — settlement is not income.
    """
    value = to_amount(amount)
    return await post_entry(
        db,
        description=f"NairobiPay settlement {settlement_reference}",
        postings=[
            debit("cash:county", value, memo=settlement_reference),
            credit("cash:nairobipay", value, memo=settlement_reference),
        ],
        reference_type="settlement",
        reference_id=settlement_reference,
        idempotency_key=f"settlement:{settlement_reference}",
    )


async def record_refund_paid(
    db: AsyncSession, *, refund_reference: str, amount, actor_id: Optional[str] = None
) -> Optional[str]:
    """A refund actually leaves the account, discharging the obligation.

    DR liability:refunds_payable / CR cash:nairobipay
    """
    value = to_amount(amount)
    return await post_entry(
        db,
        description=f"Refund paid {refund_reference}",
        postings=[
            debit("liability:refunds_payable", value, memo=refund_reference),
            credit("cash:nairobipay", value, memo=refund_reference),
        ],
        reference_type="refund",
        reference_id=refund_reference,
        idempotency_key=f"refund:paid:{refund_reference}",
        actor_id=actor_id,
    )
