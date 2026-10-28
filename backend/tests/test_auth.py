from dataclasses import replace

import pytest

from app.repos.sessions import SESSION_SECONDS
from app.security import hash_token
from tests.helpers import PASSWORD, logout, open_db, signup

SIGNUP = "/api/auth/signup"
LOGIN = "/api/auth/login"


def _body(**over):
    body = {"email": "a@b.com", "password": PASSWORD, "name": "이우진", "consent": True}
    body.update(over)
    return body


def test_signup_returns_session_and_sets_cookie(client):
    res = client.post(SIGNUP, json=_body(email="  A@B.com "))
    assert res.status_code == 201
    body = res.json()
    assert body["userId"].startswith("u_")
    assert body == {
        "userId": body["userId"],
        "email": "a@b.com",
        "tier": "member",
        "tickets": 0,
        "isAdmin": False,
        "profile": {"name": "이우진", "age": None},
        "createdAt": "2025-10-09T08:53:20.000Z",
    }
    cookie = res.headers["set-cookie"].lower()
    for part in (
        "momo_session=",
        "httponly",
        "path=/api",
        "samesite=lax",
        f"max-age={SESSION_SECONDS}",
    ):
        assert part in cookie
    assert "secure" not in cookie


def test_cookie_is_secure_when_configured(make_client, settings):
    c = make_client(replace(settings, cookie_secure=True))
    res = c.post(SIGNUP, json=_body())
    assert "secure" in res.headers["set-cookie"].lower()


def test_only_token_hash_is_stored(client, settings):
    res = client.post(SIGNUP, json=_body())
    token = res.cookies["momo_session"]
    with open_db(settings) as conn:
        rows = [r["token_hash"] for r in conn.execute("SELECT token_hash FROM sessions")]
    assert rows == [hash_token(token)]


@pytest.mark.parametrize(
    ("over", "code", "field"),
    [
        ({"email": "not-an-email"}, "invalid_email", "email"),
        ({"name": "   "}, "missing_name", "name"),
        ({"name": "가" * 101}, "invalid", "name"),
        ({"consent": False}, "consent_required", "consent"),
        ({"consent": None}, "consent_required", "consent"),
    ],
)
def test_signup_validation(client, over, code, field):
    res = client.post(SIGNUP, json=_body(**over))
    assert res.status_code == 422
    assert res.json() == {"error": code, "field": field}


def test_signup_without_consent_key(client):
    body = _body()
    del body["consent"]
    res = client.post(SIGNUP, json=body)
    assert res.json() == {"error": "consent_required", "field": "consent"}


def test_duplicate_email_is_409(client):
    signup(client)
    res = client.post(SIGNUP, json=_body(email="A@b.com"))
    assert res.status_code == 409
    assert res.json() == {"error": "email_taken"}


def test_me_is_null_without_session(client):
    res = client.get("/api/me")
    assert res.status_code == 200
    assert res.json() is None


def test_me_returns_session_after_signup(client):
    session = signup(client)
    assert client.get("/api/me").json() == session


def test_login_success(client):
    signup(client)
    logout(client)
    assert client.get("/api/me").json() is None
    res = client.post(LOGIN, json={"email": " A@B.COM", "password": PASSWORD})
    assert res.status_code == 200
    assert res.json()["email"] == "a@b.com"
    assert client.get("/api/me").json()["email"] == "a@b.com"


def test_login_failures_share_one_error(client):
    signup(client)
    logout(client)
    wrong = client.post(LOGIN, json={"email": "a@b.com", "password": "wrongpass1"})
    missing = client.post(LOGIN, json={"email": "nobody@b.com", "password": PASSWORD})
    not_email = client.post(LOGIN, json={"email": "someone", "password": PASSWORD})
    for res in (wrong, missing, not_email):
        assert res.status_code == 401
        assert res.json() == {"error": "bad_credentials"}


def test_logout_deletes_session_and_cookie(client, settings):
    signup(client)
    res = client.post("/api/auth/logout")
    assert res.status_code == 204
    assert "max-age=0" in res.headers["set-cookie"].lower()
    with open_db(settings) as conn:
        assert conn.execute("SELECT COUNT(*) FROM sessions").fetchone()[0] == 0
    assert client.get("/api/me").json() is None


def test_logout_without_session_is_204(client):
    assert client.post("/api/auth/logout").status_code == 204


def test_session_expires_after_30_days(client, clock, settings):
    signup(client)
    clock.advance(SESSION_SECONDS - 1)
    assert client.get("/api/me").json() is not None
    clock.advance(1)
    assert client.get("/api/me").json() is None
    with open_db(settings) as conn:
        assert conn.execute("SELECT COUNT(*) FROM sessions").fetchone()[0] == 0


def test_login_is_rate_limited_per_ip(client, clock):
    body = {"email": "nobody@b.com", "password": PASSWORD}
    for _ in range(10):
        assert client.post(LOGIN, json=body).status_code == 401
    res = client.post(LOGIN, json=body)
    assert res.status_code == 429
    assert res.json() == {"error": "rate_limited"}
    other = client.post(LOGIN, json=body, headers={"CF-Connecting-IP": "203.0.113.7"})
    assert other.status_code == 401
    clock.advance(60)
    assert client.post(LOGIN, json=body).status_code == 401


def test_signup_is_rate_limited_per_ip(client):
    for _ in range(10):
        assert client.post(SIGNUP, json=_body(email="bad")).status_code == 422
    res = client.post(SIGNUP, json=_body(email="bad"))
    assert res.status_code == 429
    assert res.json() == {"error": "rate_limited"}


@pytest.mark.parametrize("login_email", ["mixed@case.com", "MIXED@CASE.COM", "  Mixed@Case.Com "])
def test_mixed_case_signup_then_login(client, settings, login_email):
    session = signup(client, email="MiXeD@Case.COM")
    assert session["email"] == "mixed@case.com"
    with open_db(settings) as conn:
        stored = conn.execute("SELECT email FROM users WHERE is_admin = 0").fetchone()["email"]
    assert stored == "mixed@case.com"
    logout(client)
    res = client.post(LOGIN, json={"email": login_email, "password": PASSWORD})
    assert res.status_code == 200
    assert res.json()["userId"] == session["userId"]
