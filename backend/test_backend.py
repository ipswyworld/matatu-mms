import asyncio
import datetime
import os
import sys
import shutil
import httpx
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy import select

# Set environment variables for testing before imports. Defaults to the
# throwaway SQLite DB (no services needed) but respects a pre-set
# DATABASE_URL — the Postgres/PostGIS CI integration job (ARCHITECTURE_
# DECISIONS.md §14.2) exports a real Postgres service-container URL before
# invoking this script, exercising the exact same boot-smoke suite against
# the engine actually deployed, not just SQLite.
os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///./test_mms.db")
os.environ["SECRET_KEY"] = "test-secret-key"
os.environ["WEBHOOK_MAX_RETRIES"] = "1"
# Distinct from DATABASE_URL/IS_SQLITE: this suite deliberately registers a
# loopback webhook target (127.0.0.1:9999) to simulate a delivery failure
# in TEST 8/9, which the webhook SSRF guard (app/security.py, Task 25)
# would otherwise correctly reject regardless of which database backs the
# run — that guard's job is exactly to block loopback/private targets, so
# gating it on the database engine was the wrong signal. TESTING is the
# right one: "are we deliberately running the test suite," independent of
# whether that suite happens to run against SQLite or a real Postgres
# service container (the Postgres/PostGIS CI integration job, Task 12).
os.environ["TESTING"] = "1"

from app.main import app
from app.database import Base, engine, get_db, IS_SQLITE
from app.models import User, Matatu, Fine, AuditLog, WebhookSubscription, WebhookLog
from app.auth import get_password_hash

from app.seed import seed_data
from app.listeners import register_listeners

async def setup_test_db():
    if IS_SQLITE:
        # Remove existing test DB if any
        if os.path.exists("./test_mms.db"):
            os.remove("./test_mms.db")
        # Re-create tables directly — no Alembic involved for the SQLite
        # dev/fast-path run.
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
    # else: Postgres — the CI job runs `alembic upgrade head` against this
    # same DATABASE_URL before invoking this script, so the schema already
    # exists via the real migration chain (the whole point of this path:
    # prove migrations work against Postgres/PostGIS, not just that the
    # ORM models can build a schema from scratch).

    # Register listeners
    register_listeners()

    # Seed data manually
    from app.database import AsyncSessionLocal
    async with AsyncSessionLocal() as session:
        await seed_data(session)

async def cleanup_test_db():
    await engine.dispose()
    if IS_SQLITE and os.path.exists("./test_mms.db"):
        os.remove("./test_mms.db")

async def run_tests():
    print("==================================================")
    print("        RUNNING NCCG BACKEND AUTOMATED TESTS      ")
    print("==================================================")
    
    await setup_test_db()
    
    # 1. Start httpx AsyncClient
    # We use transport=httpx.ASGITransport(app=app) to query the FastAPI app directly without starting a server process.
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        
        # Test Case 1: Login Admin
        print("\n[TEST 1] Testing Admin Login...")
        login_payload = {
            "email": "admin@nairobi.go.ke",
            "password": "admin123"
        }
        res = await client.post("/api/auth/login", json=login_payload)
        assert res.status_code == 200, f"Login failed: {res.text}"
        admin_data = res.json()
        admin_token = admin_data["accessToken"]
        print("  [OK] Admin Login Successful!")
        print(f"  [OK] Admin Token: {admin_token[:25]}...")
        
        # Test Case 2: Login Sacco Operator
        print("\n[TEST 2] Testing Sacco Operator Login...")
        sacco_payload = {
            "email": "operator@umoinner.co.ke",
            "password": "sacco123"
        }
        res = await client.post("/api/auth/login", json=sacco_payload)
        assert res.status_code == 200, f"Login failed: {res.text}"
        sacco_data = res.json()
        sacco_token = sacco_data["accessToken"]
        sacco_id = sacco_data["user"]["saccoId"]
        print("  [OK] Sacco Operator Login Successful!")
        print(f"  [OK] Sacco Operator ID: {sacco_id}")

        # Header definitions
        admin_headers = {"Authorization": f"Bearer {admin_token}"}
        sacco_headers = {"Authorization": f"Bearer {sacco_token}"}

        # Test Case 3: Sacco Operator Fleet Filtering
        print("\n[TEST 3] Testing Sacco Operator Matatu Filter...")
        res = await client.get("/api/matatus", headers=sacco_headers)
        assert res.status_code == 200
        matatus = res.json()
        print(f"  [OK] Retrieved {len(matatus)} matatus.")
        for m in matatus:
            assert m["saccoId"] == "sacco-1", f"Found vehicle of another Sacco: {m}"
        print("  [OK] Fleet filtering enforced correctly.")

        # Test Case 4: Issue Fine (Admin)
        print("\n[TEST 4] Testing Fine Issuance (Admin)...")
        fine_payload = {
            "matatuId": "m-2",
            "reason": "Speeding on Langata road",
            "amountKes": 5000.0,
            "dueDate": "2026-08-01"
        }
        res = await client.post("/api/fines", json=fine_payload, headers=admin_headers)
        assert res.status_code == 201, f"Failed to issue fine: {res.text}"
        fine_data = res.json()
        fine_id = fine_data["id"]
        print(f"  [OK] Fine issued successfully. ID: {fine_id}")
        
        # Test Case 5: Verify Audit Log created for the fine
        print("\n[TEST 5] Checking Event listener (Audit Trail)...")
        await asyncio.sleep(0.5) # Give background task a moment
        
        # Query DB directly to check audit logs
        async with AsyncSessionLocal() as session:
            db_res = await session.execute(
                select(AuditLog).where(AuditLog.resource_id == fine_id)
            )
            audit_records = db_res.scalars().all()
            assert len(audit_records) > 0, "No audit log created for the fine!"
            print(f"  [OK] Audit Log Found. Action: {audit_records[0].action}")

        # Test Case 6: Dispute Fine (Sacco Operator)
        print("\n[TEST 6] Testing Fine Dispute (Sacco)...")
        dispute_payload = {"status": "DISPUTED"}
        res = await client.patch(f"/api/fines/{fine_id}/status", json=dispute_payload, headers=sacco_headers)
        assert res.status_code == 200, f"Dispute failed: {res.text}"
        disputed_fine = res.json()
        assert disputed_fine["status"] == "DISPUTED"
        print(f"  [OK] Fine status successfully disputed.")

        # Test Case 7: NairobiPay Callback Payment Simulation
        print("\n[TEST 7] Testing NairobiPay Webhook Callback Simulation...")
        nairobipay_payload = {
            "transaction_type": "Pay Bill",
            "transaction_id": "NRBPAY100293",
            "transaction_time": "20260717143000",
            "amount": "5000.00",
            "reference": fine_id,
            "payer_phone": "254711223344",
            "payer_name": "James Mwangi"
        }
        from app.config import NAIROBIPAY_CALLBACK_SECRET
        res = await client.post(f"/api/payments/nairobipay-callback/{NAIROBIPAY_CALLBACK_SECRET}", json=nairobipay_payload)
        assert res.status_code == 200, f"NairobiPay callback failed: {res.text}"
        callback_res = res.json()
        assert callback_res["resultCode"] == 0
        print("  [OK] NairobiPay Callback Accepted.")
        
        # Verify fine is indeed paid now
        res = await client.get(f"/api/matatus/m-2", headers=sacco_headers)
        matatu_detail = res.json()
        # Find fine in matatu details
        matched_fine = next(f for f in matatu_detail["fines"] if f["id"] == fine_id)
        assert matched_fine["status"] == "PAID", f"Fine status is {matched_fine['status']} instead of PAID"
        print("  [OK] Verified fine status changed to PAID in database.")

        # Test Case 8: Webhook Subscription
        print("\n[TEST 8] Testing Webhook Subscription Registration...")
        webhook_payload = {
            "url": "http://127.0.0.1:9999/webhook",
            "saccoId": "sacco-1",
            "events": ["FINE_ISSUED", "VEHICLE_STATUS_CHANGED"]
        }
        res = await client.post("/api/webhooks/subscriptions", json=webhook_payload, headers=sacco_headers)
        assert res.status_code == 201, f"Webhook subscription failed: {res.text}"
        webhook_sub = res.json()
        assert webhook_sub["url"] == "http://127.0.0.1:9999/webhook"
        print("  [OK] Webhook Subscription Registered.")

        # Test Case 9: Webhook Delivery Log
        print("\n[TEST 9] Checking Webhook simulator queue delivery logs...")
        # Since we registered a webhook subscription, issuing a fine should trigger a webhook log in the database
        fine_payload2 = {
            "matatuId": "m-2",
            "reason": "Overloading spot check",
            "amountKes": 3000.0,
            "dueDate": "2026-08-05"
        }
        res = await client.post("/api/fines", json=fine_payload2, headers=admin_headers)
        assert res.status_code == 201
        
        await asyncio.sleep(6.0) # wait for event dispatcher + delivery attempts
        
        res = await client.get("/api/webhooks/logs", headers=sacco_headers)
        assert res.status_code == 200
        logs = res.json()
        assert len(logs) > 0, "No webhook delivery attempts logged!"
        print(f"  [OK] Webhook Log entries found. First delivery error message (expected since URL is mock): {logs[0]['errorMessage']}")

        print("\n[TEST 10] Testing PTCU duty allocation (sectors, postings, publish, broadcast)...")
        # Covers the path a commander actually walks: a sector has zones, a
        # month gets an allocation, officers get posted, the sheet is
        # published, and only then does the officer see it.
        res = await client.get("/api/duty/sectors", headers=admin_headers)
        assert res.status_code == 200, f"Sectors unavailable: {res.status_code}"
        sectors = res.json()
        assert len(sectors) >= 13, f"Expected the seeded PTCU sectors, got {len(sectors)}"
        assert any(s["code"] == "5B" for s in sectors), "Sector 5B missing — the sheet does not renumber"
        print(f"  [OK] {len(sectors)} PTCU sectors seeded, including 5B.")

        res = await client.get("/api/duty/zones", headers=admin_headers, params={"sector_id": "sector-1"})
        assert res.status_code == 200 and len(res.json()) == 2, "Sector 1 should hold Zones 1 and 2"
        print("  [OK] Sector -> zone drill-down returns the right zones.")

        today = datetime.date.today()
        res = await client.post(
            "/api/duty/allocations",
            json={"year": today.year, "month": today.month, "referenceNo": "TEST/PTCU/1"},
            headers=admin_headers,
        )
        assert res.status_code == 201, f"Allocation create failed: {res.text[:200]}"
        allocation = res.json()
        assert allocation["status"] == "DRAFT"
        print(f"  [OK] Monthly allocation created as DRAFT ({allocation['id']}).")

        res = await client.get("/api/duty/officers", headers=admin_headers)
        assert res.status_code == 200 and res.json(), "No enforcement officers on the roster"
        test_officer = next(o for o in res.json() if o["role"] == "ARRESTING_OFFICER")
        assert test_officer["dutyStatus"] == "ON_DUTY", "Officers should default to ON_DUTY"

        res = await client.post(
            f"/api/duty/allocations/{allocation['id']}/assignments",
            json={"officerId": test_officer["id"], "zoneId": "ptcu-zone-1",
                  "workStation": "Khoja / Kilome Road", "shift": "DAY", "coverage": "DAILY"},
            headers=admin_headers,
        )
        assert res.status_code == 201, f"Posting failed: {res.text[:200]}"
        assert res.json()["sectorId"] == "sector-1", "Posting should inherit its zone's sector"
        print("  [OK] Officer posted to a zone; sector denormalized from the zone.")

        res = await client.post(
            f"/api/duty/allocations/{allocation['id']}/assignments",
            json={"officerId": test_officer["id"], "zoneId": "ptcu-zone-2",
                  "workStation": "Timboroa", "shift": "DAY", "coverage": "DAILY"},
            headers=admin_headers,
        )
        assert res.status_code == 400, "Double-posting the same officer on one shift must be refused"
        print("  [OK] Double-posting on the same shift refused.")

        officer_login = await client.post(
            "/api/auth/login",
            json={"email": "arresting.officer@nairobi.go.ke", "password": "arrest123"},
        )
        assert officer_login.status_code == 200
        officer_headers = {"Authorization": f"Bearer {officer_login.json()['accessToken']}"}

        res = await client.get("/api/duty/my-duty", headers=officer_headers)
        assert res.status_code == 200 and res.json()["today"] == [], \
            "A DRAFT allocation must not be visible to officers"
        print("  [OK] Draft allocation correctly hidden from the officer.")

        res = await client.post(f"/api/duty/allocations/{allocation['id']}/publish", headers=admin_headers)
        assert res.status_code == 200 and res.json()["status"] == "PUBLISHED", res.text[:200]

        res = await client.get("/api/duty/my-duty", headers=officer_headers)
        my_duty = res.json()
        assert len(my_duty["today"]) == 1, f"Officer should see their posting once published: {my_duty}"
        assert my_duty["today"][0]["workStation"] == "Khoja / Kilome Road"
        print("  [OK] Published allocation visible to the posted officer.")

        res = await client.patch(
            f"/api/duty/officers/{test_officer['id']}/status",
            json={"dutyStatus": "LEAVE", "dutyStatusNote": "Annual leave"},
            headers=admin_headers,
        )
        assert res.status_code == 200 and res.json()["dutyStatus"] == "LEAVE"
        res = await client.get("/api/duty/my-duty", headers=officer_headers)
        assert res.json()["onDutyToday"] is False, \
            "An officer on leave is not on duty, even holding a posting"
        print("  [OK] Duty status (LEAVE) overrides an active posting.")

        res = await client.post(
            "/api/broadcasts",
            json={"subject": "Parade 0600", "body": "Report to Khoja at 0600.",
                  "audience": "ZONE", "zoneId": "ptcu-zone-1", "priority": "URGENT"},
            headers=admin_headers,
        )
        assert res.status_code == 201, f"Broadcast failed: {res.text[:200]}"
        assert res.json()["recipientCount"] == 1, res.json()
        res = await client.get("/api/broadcasts/mine", headers=officer_headers)
        assert len(res.json()) == 1 and res.json()[0]["readAt"] is None, res.json()
        print("  [OK] Zone broadcast delivered to the posted officer, unread.")

        res = await client.post(
            "/api/broadcasts",
            json={"subject": "nope", "body": "x", "audience": "ALL"},
            headers=officer_headers,
        )
        assert res.status_code == 403, "An officer must not be able to broadcast"
        print("  [OK] Broadcast permission enforced (officer refused).")

    print("\n==================================================")
    print("        ALL AUTOMATED TESTS PASSED SUCCESSFULLY!  ")
    print("==================================================")

if __name__ == "__main__":
    # Update global scope database session reference for local tests
    from app.database import AsyncSessionLocal
    
    try:
        asyncio.run(run_tests())
    except Exception as e:
        print(f"\n[FAIL] TEST RUN ENCOUNTERED AN ERROR: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
    finally:
        asyncio.run(cleanup_test_db())
