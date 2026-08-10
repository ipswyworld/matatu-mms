import logging
import sys

from pythonjsonlogger import jsonlogger


def configure_logging(level: str = "INFO") -> None:
    """
    Structured JSON logging so logs are queryable by a log aggregator
    (Loki/ELK) instead of grepping plain-text stdout. Every record carries
    timestamp, level, logger name, and message as JSON fields; anything
    passed via `extra={...}` on a log call rides along as additional fields
    automatically (e.g. `logger.info("case filed", extra={"case_id": ...})`).
    """
    handler = logging.StreamHandler(sys.stdout)
    formatter = jsonlogger.JsonFormatter(
        "%(asctime)s %(levelname)s %(name)s %(message)s",
        rename_fields={"asctime": "timestamp", "levelname": "level", "name": "logger"},
    )
    handler.setFormatter(formatter)

    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(level)

    # Route uvicorn's own loggers through the same JSON handler instead of
    # uvicorn's default colored text formatter, so access/error logs are
    # queryable alongside application logs.
    for name in ("uvicorn", "uvicorn.access", "uvicorn.error"):
        uv_logger = logging.getLogger(name)
        uv_logger.handlers = [handler]
        uv_logger.propagate = False
