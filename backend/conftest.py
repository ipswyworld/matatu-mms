"""
Shared fixtures for test_security_regressions.py. Env vars must be set
before anything under app/ is imported (app/config.py reads them at
import time), so this happens at module load, mirroring test_backend.py's
own setup rather than duplicating a second convention.
"""
import asyncio
import os

os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///./test_security.db")
os.environ["SECRET_KEY"] = "test-secret-key"
os.environ["WEBHOOK_MAX_RETRIES"] = "1"
os.environ["TESTING"] = "1"

import httpx
import pytest
import pytest_asyncio

from app.main import app
from app.database import Base, engine
from app.seed import seed_data
from app.listeners import register_listeners


@pytest_asyncio.fixture(scope="session")
async def _prepared_db():
    """One shared, freshly-seeded DB for the whole test session — these
    tests read/write disjoint rows (different Sacco/user/case fixtures per
    test), so session scope is safe and much faster than reseeding per
    test. If a future test needs true isolation, give it its own
    function-scoped DB instead of loosening this for everyone."""
    if os.path.exists("./test_security.db"):
        os.remove("./test_security.db")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    register_listeners()
    from app.database import AsyncSessionLocal
    async with AsyncSessionLocal() as session:
        await seed_data(session)
    yield
    await engine.dispose()
    if os.path.exists("./test_security.db"):
        os.remove("./test_security.db")


@pytest_asyncio.fixture
async def client(_prepared_db):
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


async def _login(client: httpx.AsyncClient, email: str, password: str) -> str:
    res = await client.post("/api/auth/login", json={"email": email, "password": password})
    assert res.status_code == 200, f"login failed for {email}: {res.text}"
    return res.json()["accessToken"]


@pytest_asyncio.fixture
async def superadmin_token(client):
    return await _login(client, "superadmin@nairobi.go.ke", "superadmin123")


@pytest_asyncio.fixture
async def admin_token(client):
    return await _login(client, "admin@nairobi.go.ke", "admin123")


@pytest_asyncio.fixture
async def sacco_token(client):
    """Seeded Sacco Operator — see app/seed.py for which Sacco/fleet this owns."""
    return await _login(client, "operator@umoinner.co.ke", "sacco123")


@pytest_asyncio.fixture
async def crew_token(client):
    return await _login(client, "crew@umoinner.co.ke", "crew123")


def auth_headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}
