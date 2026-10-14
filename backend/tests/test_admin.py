from dataclasses import replace

from tests.helpers import ADMIN_PASSWORD, login_admin, open_db, signup

LOGIN = "/api/auth/login"


def _admins(settings) -> list[str]:
    with open_db(settings) as conn:
        return [r["email"] for r in conn.execute("SELECT email FROM users WHERE is_admin = 1")]


def test_admin_is_created_at_startup(client, settings):
    session = login_admin(client)
    assert session["isAdmin"] is True
    assert session["email"] == "admin"
    assert (session["tier"], session["tickets"]) == ("member", 0)
    assert _admins(settings) == ["admin"]


def test_admin_login_is_normalized(make_client, settings):
    c = make_client(replace(settings, admin_login="  Admin "))
    res = c.post(LOGIN, json={"email": "ADMIN", "password": ADMIN_PASSWORD})
    assert res.status_code == 200
    assert res.json()["email"] == "admin"


def test_restart_resyncs_password_and_flag(make_client, settings):
    make_client(settings)
    with open_db(settings) as conn:
        conn.execute("UPDATE users SET is_admin = 0")
    c = make_client(replace(settings, admin_password="new-pass-5678"))
    assert c.post(LOGIN, json={"email": "admin", "password": ADMIN_PASSWORD}).status_code == 401
    res = c.post(LOGIN, json={"email": "admin", "password": "new-pass-5678"})
    assert res.status_code == 200
    assert res.json()["isAdmin"] is True
    assert _admins(settings) == ["admin"]


def test_no_admin_when_password_is_missing(make_client, settings):
    make_client(settings)
    c = make_client(replace(settings, admin_password=None))
    assert _admins(settings) == []
    res = c.post(LOGIN, json={"email": "admin", "password": ADMIN_PASSWORD})
    assert res.json() == {"error": "bad_credentials"}


def test_no_admin_when_env_is_empty(make_client, settings):
    c = make_client(replace(settings, admin_login=None, admin_password=None))
    assert _admins(settings) == []
    assert c.post(LOGIN, json={"email": "admin", "password": ADMIN_PASSWORD}).status_code == 401


def test_non_email_login_only_matches_admin_login(client):
    res = client.post(LOGIN, json={"email": "root", "password": ADMIN_PASSWORD})
    assert res.json() == {"error": "bad_credentials"}


def test_signup_still_requires_email(client):
    body = {"email": "admin2", "password": "password123", "name": "x", "consent": True}
    assert client.post("/api/auth/signup", json=body).json() == {
        "error": "invalid_email",
        "field": "email",
    }


def test_regular_user_is_not_admin(client):
    assert signup(client)["isAdmin"] is False


def _admin_sessions(settings) -> int:
    with open_db(settings) as conn:
        return conn.execute(
            "SELECT COUNT(*) FROM sessions JOIN users ON users.id = sessions.user_id"
            " WHERE users.email = 'admin'"
        ).fetchone()[0]


def test_admin_sessions_survive_restart_but_not_password_change_or_removal(make_client, settings):
    login_admin(make_client(settings))
    make_client(settings)  # 같은 비밀번호로 재기동 — 세션 유지
    assert _admin_sessions(settings) == 1
    make_client(replace(settings, admin_password="new-pass-5678"))  # 비밀번호 변경
    assert _admin_sessions(settings) == 0
    c = make_client(replace(settings, admin_password="new-pass-5678"))
    assert c.post(LOGIN, json={"email": "admin", "password": "new-pass-5678"}).status_code == 200
    assert _admin_sessions(settings) == 1
    make_client(replace(settings, admin_password=None))  # 관리자 해제
    assert _admin_sessions(settings) == 0
