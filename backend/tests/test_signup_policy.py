"""가입 비밀번호 규칙 · 약관 동의 (spec 2026-10-28 3·4절)."""

import dataclasses
import shutil

import pytest

from app import db
from app.repos import users
from app.security import hash_password
from app.timefmt import iso
from tests.helpers import PASSWORD, open_db

SIGNUP = "/api/auth/signup"
LOGIN = "/api/auth/login"
CONFIG = "/api/auth/signup/config"


def _body(**over):
    body = {"email": "a@b.com", "password": PASSWORD, "name": "이우진", "consent": True}
    body.update(over)
    return body


@pytest.mark.parametrize(
    ("password", "rule"),
    [
        ("abc1234", "length"),  # 7자
        ("a1" * 33, "length"),  # 66자
        ("a" * 64 + "1", "length"),  # 65자
        ("", "length"),
        ("abcd 1234", "whitespace"),
        ("abcd\t1234", "whitespace"),
        ("abcd\u30001234", "whitespace"),  # 전각 공백
        ("12345678", "letter_digit"),
        ("abcdefgh", "letter_digit"),
        ("!@#$%^&*", "letter_digit"),
        ("가나다라마바사1", "letter_digit"),  # 한글+숫자: 영문 없음
        ("abcdefgh가", "letter_digit"),
        ("short 1", "length"),  # 길이가 공백보다 먼저
        ("12345 678", "whitespace"),  # 공백이 letter_digit보다 먼저
    ],
)
def test_weak_password_rules(client, password, rule):
    res = client.post(SIGNUP, json=_body(password=password))
    assert res.status_code == 422
    assert res.json() == {"error": "weak_password", "field": "password", "rule": rule}


@pytest.mark.parametrize(
    "password",
    ["abcdefg1", "a" * 63 + "1", "Abc!@#$%1", "비밀번호abc1", "pass-word_1.2"],
)
def test_valid_passwords(client, password):
    assert client.post(SIGNUP, json=_body(password=password)).status_code == 201


def test_boundaries_are_in_characters(client):
    assert client.post(SIGNUP, json=_body(password="a1가나다라마바")).status_code == 201


def test_old_weak_password_account_still_logs_in(client, settings):
    with open_db(settings) as conn:
        users.create_user(
            conn,
            email="old@b.com",
            password_hash=hash_password("pass"),
            name="x",
            created_at="2026-10-01T00:00:00.000Z",
        )
    res = client.post(LOGIN, json={"email": "old@b.com", "password": "pass"})
    assert res.status_code == 200


def test_password_checked_after_email_before_name(client):
    res = client.post(SIGNUP, json=_body(password="x", name=" "))
    assert res.json()["error"] == "weak_password"
    res = client.post(SIGNUP, json=_body(password="x", email="bad"))
    assert res.json()["error"] == "invalid_email"


# --- 약관 ---


@pytest.fixture
def terms_on(make_client, settings):
    return make_client(dataclasses.replace(settings, signup_terms_required=True))


def test_terms_off_is_unchanged(client, settings):
    assert client.post(SIGNUP, json=_body()).status_code == 201
    with open_db(settings) as conn:
        row = conn.execute(
            "SELECT terms_version, terms_agreed_at FROM users WHERE email = 'a@b.com'"
        ).fetchone()
    assert (row[0], row[1]) == (None, None)


def test_terms_on_requires_agreement(terms_on):
    for over in ({}, {"termsAgreed": False}):
        res = terms_on.post(SIGNUP, json=_body(**over))
        assert res.status_code == 422
        assert res.json() == {"error": "terms_required", "field": "termsAgreed"}


def test_terms_on_accepts_and_stores(terms_on, settings, clock):
    assert terms_on.post(SIGNUP, json=_body(termsAgreed=True)).status_code == 201
    with open_db(settings) as conn:
        row = conn.execute(
            "SELECT terms_version, terms_agreed_at FROM users WHERE email = 'a@b.com'"
        ).fetchone()
    assert row[0] == "2026-10-28"
    assert row[1] == iso(clock())


def test_terms_stored_even_when_not_required(client, settings, clock):
    assert client.post(SIGNUP, json=_body(termsAgreed=True)).status_code == 201
    with open_db(settings) as conn:
        row = conn.execute(
            "SELECT terms_version, terms_agreed_at FROM users WHERE email = 'a@b.com'"
        ).fetchone()
    assert (row[0], row[1]) == ("2026-10-28", iso(clock()))


def test_terms_check_order(terms_on):
    # consent가 termsAgreed보다 먼저
    res = terms_on.post(SIGNUP, json=_body(consent=False))
    assert res.json()["error"] == "consent_required"
    # 비밀번호·이름이 약관보다 먼저
    assert terms_on.post(SIGNUP, json=_body(password="x")).json()["error"] == "weak_password"
    assert terms_on.post(SIGNUP, json=_body(name=" ")).json()["error"] == "missing_name"


def test_terms_before_email_taken(terms_on):
    assert terms_on.post(SIGNUP, json=_body(termsAgreed=True)).status_code == 201
    res = terms_on.post(SIGNUP, json=_body())
    assert res.status_code == 422
    assert res.json()["error"] == "terms_required"
    assert terms_on.post(SIGNUP, json=_body(termsAgreed=True)).status_code == 409


def test_session_response_unchanged(client):
    res = client.post(SIGNUP, json=_body(termsAgreed=True))
    assert "termsVersion" not in res.json()
    assert "terms_version" not in res.json()


def test_config_fields(client, terms_on):
    base = {"emailVerify": False, "termsVersion": "2026-10-28"}
    assert client.get(CONFIG).json() == {**base, "termsRequired": False}
    assert terms_on.get(CONFIG).json() == {**base, "termsRequired": True}


def test_migration_009_keeps_old_accounts(tmp_path):
    old = tmp_path / "old"
    old.mkdir()
    for f in sorted(db.MIGRATIONS_DIR.glob("*.sql")):
        if int(f.name.split("_", 1)[0]) < 9:
            shutil.copy(f, old / f.name)
    with db.connection(tmp_path / "t.sqlite3") as conn:
        assert db.migrate(conn, old) == 8
        conn.execute(
            "INSERT INTO users (id, email, password_hash, name, created_at) VALUES (?,?,?,?,?)",
            ("u_old", "old@b.com", hash_password("pass"), "x", "2026-10-01T00:00:00.000Z"),
        )
        assert db.migrate(conn) >= 9
        user = users.get_by_email(conn, "old@b.com")
        row = conn.execute(
            "SELECT terms_version, terms_agreed_at FROM users WHERE email = 'old@b.com'"
        ).fetchone()
    assert user is not None
    assert (row[0], row[1]) == (None, None)
