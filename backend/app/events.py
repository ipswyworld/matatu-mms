import asyncio
from typing import Dict, List, Callable, Any, Awaitable
import logging

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
        """
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
