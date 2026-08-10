import asyncio
import time
import logging
from typing import Callable, Any, Awaitable, TypeVar

logger = logging.getLogger("app.resilience")

T = TypeVar("T")

class CircuitBreakerOpenException(Exception):
    """Raised when the circuit breaker is OPEN and rejects calls."""
    pass

class CircuitBreaker:
    def __init__(self, failure_threshold: int = 3, recovery_time: float = 30.0):
        self.failure_threshold = failure_threshold
        self.recovery_time = recovery_time
        
        self.state = "CLOSED"  # CLOSED, OPEN, HALF-OPEN
        self.failure_count = 0
        self.last_failure_time = 0.0

    async def call(self, func: Callable[..., Awaitable[T]], *args, **kwargs) -> T:
        current_time = time.time()

        # Check state transition from OPEN to HALF-OPEN
        if self.state == "OPEN":
            if current_time - self.last_failure_time > self.recovery_time:
                self.state = "HALF-OPEN"
                logger.info("Circuit Breaker transitioned to HALF-OPEN. Testing recovery.")
            else:
                raise CircuitBreakerOpenException("Circuit breaker is OPEN. Access blocked.")

        try:
            result = await func(*args, **kwargs)
            # If in HALF-OPEN and succeeds, close the circuit
            if self.state == "HALF-OPEN":
                self.state = "CLOSED"
                self.failure_count = 0
                logger.info("Circuit Breaker recovered. Transitioned to CLOSED.")
            elif self.state == "CLOSED":
                self.failure_count = 0
            return result
        except Exception as e:
            self.failure_count += 1
            self.last_failure_time = time.time()
            logger.warning(f"Circuit Breaker call failed ({self.failure_count}/{self.failure_threshold}): {e}")

            if self.failure_count >= self.failure_threshold:
                self.state = "OPEN"
                logger.error("Failure threshold reached. Circuit Breaker tripped to OPEN.")
            
            raise e

async def retry_async(
    func: Callable[..., Awaitable[T]],
    *args,
    retries: int = 3,
    initial_delay: float = 2.0,
    backoff_factor: float = 2.0,
    allowed_exceptions: tuple = (Exception,),
    **kwargs
) -> T:
    """
    Retries an async function with exponential backoff.
    """
    delay = initial_delay
    for attempt in range(1, retries + 1):
        try:
            return await func(*args, **kwargs)
        except allowed_exceptions as e:
            if attempt == retries:
                logger.error(f"Failed after {retries} attempts: {e}")
                raise e
            logger.warning(f"Attempt {attempt} failed: {e}. Retrying in {delay} seconds...")
            await asyncio.sleep(delay)
            delay *= backoff_factor
