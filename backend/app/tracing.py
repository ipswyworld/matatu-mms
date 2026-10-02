"""
OpenTelemetry distributed tracing (ARCHITECTURE_DECISIONS.md §8) — added
now, before the telemetry-ingest/WS-gateway service split (Task 14)
rather than after, per the doc's own framing: "far cheaper to add before
the split than after." Once those run as separate processes, a trace ID
propagated through HTTP/WebSocket headers is the only way to answer "why
was this passenger's ETA wrong" across process boundaries — logs alone
stop being enough the moment there's more than one process.

No tracing backend (Jaeger/Tempo/Honeycomb) is deployed for this project
yet — same category as the CD pipeline's staging/orchestrator gap
(CD_PIPELINE_STATUS.md): standing one up is an infrastructure decision,
not a code change. This module is written to degrade safely either way:
- OTEL_EXPORTER_OTLP_ENDPOINT unset (default, current state) -> tracing
  is fully set up (spans are created, context propagates through
  FastAPI/SQLAlchemy/httpx automatically) but spans are simply never
  exported anywhere — zero runtime cost beyond span bookkeeping, and zero
  new failure mode (no network calls to a collector that doesn't exist).
- OTEL_EXPORTER_OTLP_ENDPOINT set -> spans export via OTLP/HTTP to
  whatever collector that endpoint points at (Grafana Tempo, Honeycomb,
  an OTel Collector in front of the existing Prometheus/Grafana stack,
  etc.) — nothing else in this module needs to change to light that up.
"""
import logging
import os

from opentelemetry import trace
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor

logger = logging.getLogger("app.tracing")

SERVICE_NAME = os.getenv("OTEL_SERVICE_NAME", "matatu-mms-backend")
OTLP_ENDPOINT = os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT")


def setup_tracing(app) -> None:
    resource = Resource.create({"service.name": SERVICE_NAME})
    provider = TracerProvider(resource=resource)

    if OTLP_ENDPOINT:
        from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
        exporter = OTLPSpanExporter(endpoint=OTLP_ENDPOINT)
        provider.add_span_processor(BatchSpanProcessor(exporter))
        logger.info("OpenTelemetry tracing enabled, exporting to %s", OTLP_ENDPOINT)
    else:
        logger.info(
            "OTEL_EXPORTER_OTLP_ENDPOINT not set — tracing context propagates "
            "but spans are not exported anywhere. Set it to a collector URL "
            "to enable real export."
        )

    trace.set_tracer_provider(provider)

    # Auto-instrumentation: FastAPI (HTTP request spans + trace-context
    # propagation across an incoming/outgoing request), SQLAlchemy (DB query
    # spans, so a slow endpoint's trace shows exactly which query dominated),
    # httpx (outbound calls — webhook delivery, future TomTom/NTSA IRMS
    # calls — carry trace context to whatever's on the other end, and show
    # up as child spans either way).
    from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
    from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor
    from opentelemetry.instrumentation.sqlalchemy import SQLAlchemyInstrumentor

    FastAPIInstrumentor.instrument_app(app)
    HTTPXClientInstrumentor().instrument()

    from app.database import engine
    SQLAlchemyInstrumentor().instrument(engine=engine.sync_engine)
