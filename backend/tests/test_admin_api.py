from dataclasses import replace
from datetime import datetime

from app.ids import new_id
from app.timefmt import KST, iso
from tests.helpers import (
    archive_body,
    insert_premium_interview,
    insert_recording,
    login_admin,
    logout,
    open_db,
    signup,
)

GET_PATHS = [
    "/api/admin/overview",
    "/api/admin/users",
    "/api/admin/users/u_x",
    "/api/admin/usage",
    "/api/admin/audit",
]


def _uid(settings, email):
    with open_db(settings) as conn:
        return conn.execute("SELECT id FROM users WHERE email = ?", (email,)).fetchone()["id"]


def _tickets(settings, user_id):
    with open_db(settings) as conn:
        return conn.execute("SELECT tickets FROM users WHERE id = ?", (user_id,)).fetchone()[0]


def _audit_rows(settings):
    with open_db(settings) as conn:
        return conn.execute("SELECT COUNT(*) FROM admin_audit").fetchone()[0]


def _usage(conn, *, at, user_id, interview_id="pi_1", kind="turn", outcome="ok", **tokens):
    conn.execute(
        "INSERT INTO claude_usage (id, at, user_id, interview_id, kind, model, input_tokens,"
        " output_tokens, cache_read_tokens, cache_write_tokens, web_searches, outcome)"
        " VALUES (?, ?, ?, ?, ?, 'claude-sonnet-5-5', ?, ?, ?, ?, ?, ?)",
        (
            new_id("cu"),
            at,
            user_id,
            interview_id,
            kind,
            tokens.get("input_tokens", 0),
            tokens.get("output_tokens", 0),
            tokens.get("cache_read_tokens", 0),
            tokens.get("cache_write_tokens", 0),
            tokens.get("web_searches", 0),
            outcome,
        ),
    )


# ── 권한 ──


def test_all_endpoints_require_login(client):
    for path in GET_PATHS:
        assert client.get(path).status_code == 401, path
    res = client.post("/api/admin/users/u_x/tickets", json={"delta": 1, "reason": "x"})
    assert res.status_code == 401


def test_all_endpoints_reject_regular_users(client):
    signup(client)
    for path in GET_PATHS:
        res = client.get(path)
        assert (res.status_code, res.json()) == (403, {"error": "admin_required"}), path
    res = client.post("/api/admin/users/u_x/tickets", json={"delta": 1, "reason": "x"})
    assert (res.status_code, res.json()) == (403, {"error": "admin_required"})


# ── 개요 ──


def test_overview_empty_db(client, settings):
    login_admin(client)
    body = client.get("/api/admin/overview").json()
    assert body["users"] == {
        "total": 1,
        "last7Days": 1,
        "last30Days": 1,
        "withTickets": 0,
        "admins": 1,
    }
    assert body["tickets"] == {"outstanding": 0}
    assert body["ben"]["today"] == 0
    assert body["ben"]["dailyLimit"] == settings.ben_daily_limit
    assert len(body["ben"]["byDay"]) == 30
    assert all(d["count"] == 0 for d in body["ben"]["byDay"])
    assert body["archive"] == {"entries": 0, "ben": 0}
    assert body["recordings"] == {"count": 0, "bytes": 0}
    assert body["briefings"] == {"cached": 0}
    assert body["weakEmergencyPassword"] is False


def test_overview_counts(client, settings, clock):
    signup(client, "a@b.com")
    a = _uid(settings, "a@b.com")
    with open_db(settings) as conn:
        conn.execute("UPDATE users SET tickets = 4 WHERE id = ?", (a,))
        pi = insert_premium_interview(conn, a)
        insert_premium_interview(conn, a)
    res = client.post("/api/archive", json=archive_body())
    assert res.status_code == 201, res.text
    res = client.post(
        "/api/archive",
        json=archive_body(premium=True, premiumInterviewId=pi, interviewerId="ben"),
    )
    assert res.status_code == 201, res.text
    archive_id = res.json()["entry"]["id"]
    with open_db(settings) as conn:
        insert_recording(conn, archive_id=archive_id, user_id=a, turn=0, path="p", size=100)
        insert_recording(conn, archive_id=archive_id, user_id=a, turn=1, path="q", size=50)
        conn.execute(
            "INSERT INTO company_briefings (key, company, job, briefing, sources_json, created_at)"
            " VALUES ('k', 'c', 'j', 'b', '[]', ?)",
            (iso(clock.now),),
        )
    logout(client)
    login_admin(client)
    body = client.get("/api/admin/overview").json()
    assert body["users"]["total"] == 2
    assert body["users"]["withTickets"] == 1
    assert body["users"]["admins"] == 1
    assert body["tickets"]["outstanding"] == 4
    assert body["archive"] == {"entries": 2, "ben": 1}
    assert body["recordings"] == {"count": 2, "bytes": 150}
    assert body["briefings"] == {"cached": 1}


def test_overview_ben_today_uses_kst_midnight(client, settings, clock):
    midnight = datetime(2026, 10, 17, 0, 0, 0, tzinfo=KST).timestamp()
    clock.now = midnight + 3600
    login_admin(client)
    uid = _uid(settings, "admin")
    with open_db(settings) as conn:
        for ts in (midnight - 1, midnight, midnight + 60):
            iid = insert_premium_interview(conn, uid)
            conn.execute(
                "UPDATE premium_interviews SET created_at = ? WHERE id = ?", (iso(ts), iid)
            )
    ben = client.get("/api/admin/overview").json()["ben"]
    assert ben["today"] == 2
    assert ben["byDay"][-1] == {"date": "2026-10-17", "count": 2}
    assert ben["byDay"][-2] == {"date": "2026-10-16", "count": 1}
    assert ben["byDay"][0]["date"] == "2026-09-18"
    clock.now = midnight - 3600  # 한국 날짜로 아직 16일
    ben = client.get("/api/admin/overview").json()["ben"]
    assert ben["byDay"][-1]["date"] == "2026-10-16"


def test_overview_weak_emergency_password(make_client, settings):
    c = make_client(replace(settings, admin_password="admin"))
    assert (
        c.post("/api/auth/login", json={"email": "admin", "password": "admin"}).status_code == 200
    )
    assert c.get("/api/admin/overview").json()["weakEmergencyPassword"] is True
    c = make_client(replace(settings, admin_password="123456789012"))
    c.post("/api/auth/login", json={"email": "admin", "password": "123456789012"})
    assert c.get("/api/admin/overview").json()["weakEmergencyPassword"] is False


# ── 사용자 ──


def test_users_page_search_and_no_tier(client, settings):
    for i in range(3):
        signup(client, f"u{i}@b.com", name=f"홍{i}")
        logout(client)
    login_admin(client)
    res = client.get("/api/admin/users")
    body = res.json()
    assert (body["page"], body["pageSize"], body["total"]) == (1, 50, 4)
    assert '"tier"' not in res.text
    assert set(body["items"][0]) == {
        "id",
        "email",
        "name",
        "createdAt",
        "tickets",
        "isAdmin",
        "archiveCount",
        "benCount",
        "lastActiveAt",
    }
    found = client.get("/api/admin/users", params={"q": "U1@B"}).json()
    assert [i["email"] for i in found["items"]] == ["u1@b.com"]
    by_name = client.get("/api/admin/users", params={"q": "홍2"}).json()
    assert [i["email"] for i in by_name["items"]] == ["u2@b.com"]
    assert client.get("/api/admin/users", params={"page": 2}).json()["items"] == []


def test_users_paging_50(client, settings):
    login_admin(client)
    with open_db(settings) as conn:
        for i in range(55):
            conn.execute(
                "INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, 'x', ?)",
                (f"u_{i}", f"m{i}@b.com", f"2026-01-01T00:00:{i:02d}.000Z"),
            )
    p1 = client.get("/api/admin/users").json()
    p2 = client.get("/api/admin/users", params={"page": 2}).json()
    assert (p1["total"], len(p1["items"]), len(p2["items"])) == (56, 50, 6)


def test_users_last_active_and_counts(client, settings):
    signup(client, "a@b.com")
    a = _uid(settings, "a@b.com")
    with open_db(settings) as conn:
        insert_premium_interview(conn, a)
        conn.execute(
            "UPDATE premium_interviews SET created_at = '2099-01-01T00:00:00.000Z'"
            " WHERE user_id = ?",
            (a,),
        )
    logout(client)
    login_admin(client)
    items = {i["email"]: i for i in client.get("/api/admin/users").json()["items"]}
    assert items["a@b.com"]["benCount"] == 1
    assert items["a@b.com"]["lastActiveAt"] == "2099-01-01T00:00:00.000Z"
    assert items["admin"]["lastActiveAt"] is not None  # 방금 만든 세션


def test_users_invalid_query(client):
    login_admin(client)
    assert client.get("/api/admin/users", params={"page": 0}).status_code == 422
    assert client.get("/api/admin/users", params={"q": "x" * 101}).status_code == 422


SECRET_TEXT = "비밀대화문장-고유1234"
SECRET_RESUME = "비밀이력서-고유5678"


def test_user_detail_has_metadata_only(client, settings):
    signup(client, "a@b.com")
    a = _uid(settings, "a@b.com")
    with open_db(settings) as conn:
        pi = insert_premium_interview(conn, a)
        conn.execute(
            "INSERT INTO resumes (id, user_id, kind, title, text, updated_at)"
            " VALUES ('r1', ?, 'company', 't', ?, 'x')",
            (a, SECRET_RESUME),
        )
    body = archive_body(
        messages=[{"role": "model", "text": SECRET_TEXT, "at": 1}], reportRaw=SECRET_TEXT
    )
    res = client.post("/api/archive", json=body)
    assert res.status_code == 201, res.text
    with_rec = res.json()["entry"]["id"]
    res = client.post("/api/archive", json=archive_body())
    assert res.status_code == 201
    with open_db(settings) as conn:
        insert_recording(conn, archive_id=with_rec, user_id=a, turn=0, path="p")
    logout(client)
    login_admin(client)
    res = client.get(f"/api/admin/users/{a}")
    assert res.status_code == 200
    assert SECRET_TEXT not in res.text and SECRET_RESUME not in res.text
    assert '"tier"' not in res.text
    data = res.json()
    assert data["user"]["email"] == "a@b.com"
    assert data["ben"][0]["id"] == pi
    assert set(data["ben"][0]) == {
        "id",
        "createdAt",
        "track",
        "status",
        "modelTurns",
        "briefingStatus",
    }
    flags = {e["id"]: e["hasRecording"] for e in data["archive"]}
    assert flags[with_rec] is True and list(flags.values()).count(False) == 1
    assert set(data["archive"][0]) == {
        "id",
        "startedAt",
        "interviewerId",
        "premium",
        "track",
        "questionCount",
        "hasRecording",
    }
    assert data["ticketLog"] == []


def test_user_detail_not_found(client):
    login_admin(client)
    res = client.get("/api/admin/users/u_nope")
    assert (res.status_code, res.json()) == (404, {"error": "not_found"})


# ── 티켓 ──


def test_adjust_tickets_adds_and_logs(client, settings):
    signup(client, "a@b.com")
    a = _uid(settings, "a@b.com")
    logout(client)
    login_admin(client)
    res = client.post(f"/api/admin/users/{a}/tickets", json={"delta": 5, "reason": "  이벤트  "})
    assert (res.status_code, res.json()) == (200, {"tickets": 5})
    assert _tickets(settings, a) == 5
    assert _audit_rows(settings) == 1
    log = client.get(f"/api/admin/users/{a}").json()["ticketLog"]
    assert [(e["adminEmail"], e["delta"], e["reason"]) for e in log] == [("admin", 5, "이벤트")]
    audit = client.get("/api/admin/audit").json()
    assert audit["items"][0]["targetEmail"] == "a@b.com"
    res = client.post(f"/api/admin/users/{a}/tickets", json={"delta": -5, "reason": "회수"})
    assert res.json() == {"tickets": 0}


def test_adjust_tickets_insufficient(client, settings):
    signup(client, "a@b.com")
    a = _uid(settings, "a@b.com")
    logout(client)
    login_admin(client)
    client.post(f"/api/admin/users/{a}/tickets", json={"delta": 2, "reason": "x"})
    res = client.post(f"/api/admin/users/{a}/tickets", json={"delta": -3, "reason": "x"})
    assert (res.status_code, res.json()) == (409, {"error": "insufficient_tickets"})
    assert _tickets(settings, a) == 2
    assert _audit_rows(settings) == 1


def test_adjust_tickets_validation_and_404(client, settings):
    login_admin(client)
    a = _uid(settings, "admin")
    url = f"/api/admin/users/{a}/tickets"
    for body in (
        {"delta": 0, "reason": "x"},
        {"delta": 101, "reason": "x"},
        {"delta": -101, "reason": "x"},
        {"delta": 1, "reason": "   "},
        {"delta": 1, "reason": "x" * 201},
        {"delta": 1},
        {"delta": 1.5, "reason": "x"},
    ):
        assert client.post(url, json=body).status_code == 422, body
    assert _audit_rows(settings) == 0
    res = client.post("/api/admin/users/u_nope/tickets", json={"delta": 1, "reason": "x"})
    assert (res.status_code, res.json()) == (404, {"error": "not_found"})
    assert _audit_rows(settings) == 0


# ── 사용량 ──


def test_usage_empty(client):
    login_admin(client)
    body = client.get("/api/admin/usage").json()
    assert body["since"] is None
    assert len(body["byDay"]) == 30 and all(d["calls"] == 0 for d in body["byDay"])
    assert body["byKind"] == []
    assert body["topInterviews"] == []
    assert body["pricing"]["model"] == "claude-sonnet-5-5"


def test_usage_aggregates(client, settings, clock):
    login_admin(client)
    admin = _uid(settings, "admin")
    now = clock.now
    with open_db(settings) as conn:
        _usage(conn, at=iso(now), user_id=admin, input_tokens=1_000_000, output_tokens=100_000)
        _usage(conn, at=iso(now), user_id=admin, kind="report", outcome="error", web_searches=3)
        _usage(conn, at=iso(now), user_id=admin, interview_id="pi_2", outcome="refused")
        _usage(conn, at=iso(now - 3 * 86400), user_id=admin, interview_id="pi_2", kind="research")
        _usage(conn, at=iso(now - 40 * 86400), user_id=admin, interview_id="pi_3")  # 기간 밖
    body = client.get("/api/admin/usage", params={"days": 7}).json()
    assert len(body["byDay"]) == 7
    today = body["byDay"][-1]
    assert (today["calls"], today["errors"], today["refusals"], today["webSearches"]) == (
        3,
        1,
        1,
        3,
    )
    assert today["inputTokens"] == 1_000_000
    assert today["costUsd"] == round(2.0 + 1.0 + 0.03, 4)
    kinds = {k["kind"]: k for k in body["byKind"]}
    assert kinds["turn"]["calls"] == 2 and kinds["report"]["calls"] == 1
    assert kinds["research"]["calls"] == 1
    assert kinds["turn"]["costUsd"] == 3.0
    top = body["topInterviews"]
    assert top[0]["interviewId"] == "pi_1" and top[0]["calls"] == 2
    assert top[0]["userEmail"] == "admin"
    assert "pi_3" not in [t["interviewId"] for t in top]
    assert body["since"] == iso(now - 40 * 86400)[:10]


def test_usage_days_validation(client):
    login_admin(client)
    for days in (0, 91):
        assert client.get("/api/admin/usage", params={"days": days}).status_code == 422


# ── 감사 ──


def test_audit_page_newest_first(client, settings, clock):
    signup(client, "a@b.com")
    a = _uid(settings, "a@b.com")
    logout(client)
    login_admin(client)
    for delta in (1, 2, 3):
        clock.advance(10)
        client.post(f"/api/admin/users/{a}/tickets", json={"delta": delta, "reason": f"r{delta}"})
    body = client.get("/api/admin/audit").json()
    assert (body["page"], body["pageSize"], body["total"]) == (1, 50, 3)
    assert [i["delta"] for i in body["items"]] == [3, 2, 1]
    first = body["items"][0]
    assert set(first) == {
        "at",
        "adminEmail",
        "action",
        "targetUserId",
        "targetEmail",
        "delta",
        "reason",
    }
    assert first["action"] == "tickets" and first["adminEmail"] == "admin"
    assert client.get("/api/admin/audit", params={"page": 0}).status_code == 422


def test_weak_emergency_password_false_without_emergency_account(make_client, settings):
    s = replace(settings, admin_login=None, admin_password="short", admin_emails=("a@b.com",))
    c = make_client(s)
    signup(c, "a@b.com")
    c = make_client(s)
    c.post("/api/auth/login", json={"email": "a@b.com", "password": "password123"})
    assert c.get("/api/admin/overview").json()["weakEmergencyPassword"] is False


def test_usage_cost_totals_round_once(client, settings, clock):
    login_admin(client)
    now = clock.now
    with open_db(settings) as conn:
        admin = _uid(settings, "admin")
        for _ in range(200):
            _usage(conn, at=iso(now), user_id=admin, input_tokens=12_345)
    body = client.get("/api/admin/usage", params={"days": 1}).json()
    # 행당 0.02469 -> 반올림 0.0247 * 200 = 4.94 이 아니라 0.02469 * 200 = 4.938
    assert body["byDay"][-1]["costUsd"] == 4.938
    assert body["byKind"][0]["costUsd"] == 4.938
    assert body["topInterviews"][0]["costUsd"] == 4.938
