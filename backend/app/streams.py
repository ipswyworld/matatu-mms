"""
Durable event bus on Redis Streams (ARCHITECTURE_DECISIONS.md §4.2) —
persistence + consumer groups, unlike the pub/sub used in app/realtime.py
(fire-and-forget by design there, correctly so for live GPS/dashboard
fan-out where a missed update is superseded by the next one seconds later).

Events matter differently: `app/events.py`'s EventDispatcher previously
only ever fired `asyncio.create_task` — a process restart between dispatch
and task execution silently loses the event, which for audit-adjacent
signals (fine issuance, booking status) is data loss, not a missed
refresh. XADD persists the entry to Redis before this returns, so a crash
after publish_event() succeeds never loses it — a consumer restarted later
picks it up from the stream. This module is additive: it durably records
every dispatched event for replay/audit; the existing in-process listener
invocation in EventDispatcher.dispatch() is unchanged (see events.py) —
migrating individual listeners (webhook delivery, notifications) onto
consuming *from* the stream instead of being invoked directly is real
follow-up work, not done here.
"""
import asyncio
import json
import logging
from typing import Any, Dict

from app.realtime import get_redis

logger = logging.getLogger("app.streams")

EVENT_STREAM = "events:dispatch"
CONSUMER_GROUP = "event-log"

# Backoff between consumer-loop retries after a Redis error, so a blip
# doesn't spin the loop hot — matches the resilience posture already used
# elsewhere in this codebase (app/resilience.py) rather than crashing the
# background task, which would silently stop all durable event recording
# until the next process restart.
_RETRY_BACKOFF_SECONDS = 5


async def publish_event(event_type: str, data: Dict[str, Any]) -> None:
    """Durably records a dispatched event. Best-effort at the call site
    (errors are logged, never raised) — a Redis outage degrades event
    durability, it must never break the mutation that triggered the event,
    matching the same fail-open posture as realtime.py's publish()."""
    try:
        r = await get_redis()
        await r.xadd(EVENT_STREAM, {
            "event_type": event_type,
            "data": json.dumps(data, default=str),
        })
    except Exception:
        logger.warning(
            "Failed to durably publish event '%s' to %s — event was still "
            "dispatched to in-process listeners, but won't survive a crash "
            "before they ran.",
            event_type, EVENT_STREAM, exc_info=True,
        )


async def ensure_consumer_group() -> None:
    """Idempotent — creates the stream + group on first run, no-ops after."""
    r = await get_redis()
    try:
        await r.xgroup_create(EVENT_STREAM, CONSUMER_GROUP, id="0", mkstream=True)
    except Exception as e:
        if "BUSYGROUP" not in str(e):
            raise


async def consume_events_forever(consumer_name: str) -> None:
    """Long-running consumer loop, started once per process at app startup.
    On startup, first drains this consumer's own pending (unacked) entries
    from a previous crash (id="0") before switching to new entries
    (id=">") — so a restart after a crash mid-processing doesn't skip
    whatever was in flight.

    Current handler is intentionally minimal (log + ack) — this proves the
    durable pipeline end-to-end (publish -> persist -> consume -> ack) and
    is the foundation for the module-boundary extraction in Task 14; wiring
    real listeners (webhook delivery, notifications) to consume from here
    instead of being invoked directly by EventDispatcher is follow-up work.
    """
    await ensure_consumer_group()
    read_backlog = True
    while True:
        try:
            read_id = "0" if read_backlog else ">"
            resp = await (await get_redis()).xreadgroup(
                CONSUMER_GROUP, consumer_name,
                {EVENT_STREAM: read_id}, count=10, block=5000,
            )
            if not resp:
                read_backlog = False
                continue
            for _stream_name, messages in resp:
                if not messages:
                    read_backlog = False
                for message_id, fields in messages:
                    await _handle_event(message_id, fields)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.warning("Event consumer loop error — retrying", exc_info=True)
            await asyncio.sleep(_RETRY_BACKOFF_SECONDS)


async def _handle_event(message_id: str, fields: Dict[str, str]) -> None:
    event_type = fields.get("event_type", "UNKNOWN")
    try:
        data = json.loads(fields.get("data", "{}"))
        logger.info("Durable event recorded: %s %s", event_type, data.get("sacco_id", ""))
    except Exception:
        logger.warning("Malformed durable event payload for %s", event_type, exc_info=True)
    finally:
        # Ack regardless of handler outcome — matches EventDispatcher's own
        # "one failure doesn't halt others" isolation; a parse failure here
        # is logged, not retried forever.
        try:
            r = await get_redis()
            await r.xack(EVENT_STREAM, CONSUMER_GROUP, message_id)
        except Exception:
            logger.warning("Failed to ack event %s", message_id, exc_info=True)
