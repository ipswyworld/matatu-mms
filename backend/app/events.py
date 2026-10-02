import asyncio
from typing import Dict, List, Callable, Any, Awaitable
import logging

from app.database import IS_SQLITE

logger = logging.getLogger("app.events")

class EventDispatcher:
    def __init__(self):
        # Maps event names to lists of async callbacks
        self._listeners: Dict[str, List[Callable[[str, Any], Awaitable[None]]]] = {}

    def register(self, event_type: str, listener: Callable[[str, Any], Awaitable[None]]):
        """Registers an asynchronous listener callback for an event type."""
        if event_type not in self._listeners:
            self._listeners[event_type] = []
        self._listeners[event_type].append(listener)

    def dispatch(self, event_type: str, data: Any):
        """
        Dispatches an event asynchronously in the background.
        Ensures execution is concurrent and isolated (one failure doesn't halt others).

        Also durably records the event to a Redis Stream (app/streams.py) in
        Postgres/prod mode — additive, not a replacement: listener
        invocation below is unchanged, so a Redis outage degrades event
        durability (see streams.py's fail-open publish_event) without ever
        blocking or breaking the actual notification/webhook dispatch a
        caller is relying on. Skipped in SQLite/dev mode to keep the fast,
        no-services local/CI path exactly as it was (ARCHITECTURE_
        DECISIONS.md §14.1 — the whole point of that job is needing no
        Redis/Postgres services at all).
        """
        if not IS_SQLITE:
            from app.streams import publish_event
            asyncio.create_task(publish_event(event_type, data))

        listeners = self._listeners.get(event_type, [])
        if not listeners:
            return

        async def run_listener(listener_func, evt, payload):
            try:
                await listener_func(evt, payload)
            except Exception as e:
                logger.error(
                    f"Listener '{listener_func.__name__}' failed on event '{evt}': {e}",
                    exc_info=True
                )

        # Run all listeners concurrently in the background
        for listener in listeners:
            asyncio.create_task(run_listener(listener, event_type, data))

# Global event dispatcher singleton
dispatcher = EventDispatcher()
