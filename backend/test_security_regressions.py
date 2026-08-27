"""
Permanent regression tests for the authorization gaps and concurrency
races found during the 2026-08-27 bug sweep. Each test here corresponds
to a real bug that shipped and sat undetected until manually found —
the whole point of this file is that these can never silently regress
again without a test failure.

Run with: python -m pytest -v  (from the backend/ directory)
"""
import asyncio

from conftest import _login, auth_headers


# --- Webhook endpoint authorization (fixed in b9190c2) -----------------
# Before the fix, all four routes/webhooks.py endpoints only required
# get_current_user — any authenticated role, including PASSENGER, could
# create webhook subscriptions for ANY Sacco, list every Sacco's
# subscription URLs/delivery logs, and forge simulator events against
# another Sacco's real registered endpoint.

async def test_webhook_subscription_requires_manage_webhooks_permission(client, crew_token):
    """CREW has no manage_webhooks permission (only SUPERADMIN/ADMIN/
    SACCO_OPERATOR do) — this is the closest seeded account to the
    PASSENGER role that triggered the original bug, since there's no
    seeded PASSENGER login in app/seed.py."""
    res = await client.post(
        "/api/webhooks/subscriptions",
        json={"url": "http://127.0.0.1:9999/hook", "saccoId": "sacco-1", "events": ["FINE_ISSUED"]},
        headers=auth_headers(crew_token),
    )
    assert res.status_code == 403


async def test_webhook_subscription_allowed_for_own_sacco_operator(client, sacco_token):
    res = await client.post(
        "/api/webhooks/subscriptions",
        json={"url": "http://127.0.0.1:9999/hook", "saccoId": "sacco-1", "events": ["FINE_ISSUED"]},
        headers=auth_headers(sacco_token),
    )
    assert res.status_code == 201


async def test_webhook_subscription_blocked_for_other_sacco(client, sacco_token):
    """operator@umoinner.co.ke owns sacco-1, not sacco-2 — enforce_own_sacco
    must reject a subscription request for a Sacco they don't belong to."""
    res = await client.post(
        "/api/webhooks/subscriptions",
        json={"url": "http://127.0.0.1:9999/hook", "saccoId": "sacco-2", "events": ["FINE_ISSUED"]},
        headers=auth_headers(sacco_token),
    )
    assert res.status_code == 403


async def test_webhook_simulator_trigger_requires_permission(client, crew_token):
    res = await client.post(
        "/api/webhooks/simulator/trigger",
        params={"event_type": "FINE_ISSUED", "sacco_id": "sacco-1"},
        json={},
        headers=auth_headers(crew_token),
    )
    assert res.status_code == 403


# --- Last-Super-Admin lockout race (fixed in ec8b134) -------------------
# Two concurrent PATCH requests demoting the only two Super Admins could
# each pass the "does another Super Admin exist?" check before either
# committed, leaving zero Super Admins — an unrecoverable lockout.

async def test_cannot_demote_both_last_two_superadmins_concurrently(client, superadmin_token):
    """app/seed.py seeds exactly one Super Admin (u-superadmin), so adding
    one more brings the total to exactly two — the real "last two" scenario
    the lockout guard exists for. u-superadmin is otherwise required by
    later tests in this shared-DB suite (impersonation needs manage_admins,
    which is Super-Admin-only), so whichever of the two this race demotes
    gets explicitly restored afterward rather than left to chance.
    """
    create_res = await client.post("/api/users", json={
        "name": "Race Test Superadmin", "email": "race-superadmin@nairobi.go.ke",
        "password": "superadmin123", "role": "SUPERADMIN",
    }, headers=auth_headers(superadmin_token))
    assert create_res.status_code == 201, create_res.text
    new_id = create_res.json()["id"]

    demote_u_superadmin_res, demote_new_res = await asyncio.gather(
        client.patch("/api/users/u-superadmin", json={"role": "ADMIN"}, headers=auth_headers(superadmin_token)),
        client.patch(f"/api/users/{new_id}", json={"role": "ADMIN"}, headers=auth_headers(superadmin_token)),
    )
    codes = sorted([demote_u_superadmin_res.status_code, demote_new_res.status_code])
    u_superadmin_was_demoted = demote_u_superadmin_res.status_code == 200

    # Whichever of the two survived as Super Admin has valid manage_admins
    # credentials to restore the other with — if the race demoted
    # u-superadmin itself, superadmin_token's own account just lost that
    # permission (get_current_user re-checks the live DB role on every
    # request, not the JWT's issue-time claims), so it can't perform its
    # own restore; use the still-Super-Admin race-test account instead.
    restorer_token = (
        await _login(client, "race-superadmin@nairobi.go.ke", "superadmin123")
        if u_superadmin_was_demoted else superadmin_token
    )
    restore_res = await client.patch(
        "/api/users/u-superadmin", json={"role": "SUPERADMIN"}, headers=auth_headers(restorer_token)
    )
    assert restore_res.status_code == 200, (
        f"failed to restore u-superadmin after the race test — later tests need it: {restore_res.text}"
    )

    assert codes == [200, 400], f"expected exactly one demotion to succeed, got {codes}"

    remaining = await client.get("/api/users", headers=auth_headers(restorer_token))
    superadmins = [u for u in remaining.json() if u["role"] == "SUPERADMIN"]
    assert len(superadmins) >= 1, "LOCKOUT: zero Super Admins remain"


# --- Impersonation ticket single-use race (fixed in 6e275c3) ------------
# GET-then-DELETE on the Redis ticket key let two concurrent consume
# requests both pass the check before either deleted it.

async def test_impersonation_ticket_single_use_under_concurrency(client, superadmin_token):
    start_res = await client.post(
        "/api/auth/impersonate/u-sacco",
        headers=auth_headers(superadmin_token),
    )
    assert start_res.status_code == 200, start_res.text
    ticket = start_res.json()["ticket"]

    results = await asyncio.gather(*[
        client.post("/api/auth/impersonate/consume", json={"ticket": ticket})
        for _ in range(5)
    ])
    codes = sorted(r.status_code for r in results)
    assert codes.count(200) == 1, f"expected exactly one successful consume, got {codes}"
    assert codes.count(401) == 4


# --- crew_number generation race (fixed in 6e275c3) ----------------------
# Two concurrent crew-issue requests for different vehicles in the same
# Sacco could read the same "not yet committed" max sequence number and
# mint the same crew_number for two unrelated teams.

async def test_crew_number_generation_race_produces_distinct_numbers(client, sacco_token):
    results = await asyncio.gather(
        client.post("/api/crew", json={
            "matatuId": "m-1", "crewRole": "DRIVER",
            "name": "Race Driver A", "phone": "0700000001",
        }, headers=auth_headers(sacco_token)),
        client.post("/api/crew", json={
            "matatuId": "m-2", "crewRole": "DRIVER",
            "name": "Race Driver B", "phone": "0700000002",
        }, headers=auth_headers(sacco_token)),
    )
    for r in results:
        assert r.status_code == 201, r.text
    numbers = [r.json()["crewNumber"] for r in results]
    assert len(set(numbers)) == 2, f"crew_number collision: {numbers}"


# --- Enforcement case status guards (fixed in 7468636) -------------------
# dispute_case()/waive_case() had no terminal-status guard, unlike every
# sibling transition endpoint — a RELEASED/WAIVED/RESOLVED_* case could be
# knocked back to DISPUTED or re-waived.

async def _file_and_release_case(client, admin_token, sacco_token) -> str:
    offence_res = await client.get("/api/enforcement/offence-types", headers=auth_headers(admin_token))
    offence_id = offence_res.json()[0]["id"]

    file_res = await client.post(
        "/api/enforcement/cases",
        data={"reg_number": "KDA 112B", "offence_type_id": offence_id, "action_taken": "TOLL"},
        files={"photos": ("scene.jpg", b"fake-bytes", "image/jpeg")},
        headers=auth_headers(admin_token),
    )
    assert file_res.status_code == 200, file_res.text
    case_id = file_res.json()["id"]
    case_reference = file_res.json()["caseReference"]

    pay_res = await client.post(f"/api/enforcement/cases/public/{case_reference}/pay")
    assert pay_res.status_code == 200, pay_res.text

    release_res = await client.patch(f"/api/enforcement/cases/{case_id}/release", headers=auth_headers(admin_token))
    assert release_res.status_code == 200, release_res.text
    return case_id


async def test_cannot_dispute_a_released_case(client, admin_token, sacco_token):
    case_id = await _file_and_release_case(client, admin_token, sacco_token)
    res = await client.patch(
        f"/api/enforcement/cases/{case_id}/dispute",
        json={"reason": "trying to reopen a settled case"},
        headers=auth_headers(admin_token),
    )
    assert res.status_code == 400


async def test_cannot_waive_a_released_case(client, admin_token, sacco_token):
    case_id = await _file_and_release_case(client, admin_token, sacco_token)
    res = await client.patch(
        f"/api/enforcement/cases/{case_id}/waive",
        json={"reason": "trying to waive a settled case", "authorizedBy": "Test"},
        headers=auth_headers(admin_token),
    )
    assert res.status_code == 400
