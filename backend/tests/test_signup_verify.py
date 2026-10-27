"""가입에서 이메일 PIN 확인 (spec 2026-10-27 4절 2)."""

import dataclasses
import re
import shutil

import pytest

from app import db
from app.repos import signup_codes, users
from app.security import hash_password
from tests.helpers import PASSWORD, open_db

CODE_URL = "/api/auth/signup/code"
URL = "/api/auth/signup"
MAIL = "me@example.com"


@pytest.fixture
def on_settings(settings):
    return dataclasses.replace(settings, signup_email_verify=True)


@pytest.fixture
def vc(make_client, on_settings, fake_mailer):
    return make_client(on_settings, mailer=fake_mailer)


def _pin(mailer, index=-1):
    return re.search(r"인증번호: (\d{6})", mailer.sent[index]["text"]).group(1)


def _body(code=None, email=MAIL, **over):
    body = {"email": email, "password": PASSWORD, "name": "이우진", "consent": True, **over}
    if code is not None:
        body["code"] = code
    return body


def _wrong(pin):
    return "000000" if pin != "000000" else "111111"


def _request(vc, email=MAIL):
    assert vc.post(CODE_URL, json={"email": email}).status_code == 202


def _make_user(settings, email):
    with open_db(settings) as conn:
        users.create_user(
            conn,
            email=email,
            password_hash=hash_password(PASSWORD),
            name="기존",
            created_at="2026-10-01T00:00:00.000Z",
        )


def _row(settings, email=MAIL):
    with open_db(settings) as conn:
        return signup_codes.get(conn, email)


def test_disabled_ignores_code(client):
    res = client.post(URL, json=_body("123456"))
    assert res.status_code == 201
    assert res.headers.get("set-cookie")


def test_correct_pin_creates_account_and_deletes_row(vc, fake_mailer, on_settings):
    _request(vc)
    res = vc.post(URL, json=_body(f" {_pin(fake_mailer)} "))
    assert res.status_code == 201
    assert res.headers.get("set-cookie")
    assert _row(on_settings) is None


def test_pin_cannot_be_reused_for_other_signup(vc, fake_mailer):
    _request(vc)
    pin = _pin(fake_mailer)
    assert vc.post(URL, json=_body(pin)).status_code == 201
    res = vc.post(URL, json=_body(pin, email="other@example.com"))
    assert res.status_code == 422
    assert res.json() == {"error": "code_expired", "field": "code"}


def test_code_required(vc, fake_mailer):
    _request(vc)
    for code in (None, "", "   "):
        res = vc.post(URL, json=_body(code))
        assert res.status_code == 422
        assert res.json() == {"error": "code_required", "field": "code"}


def test_no_row_is_expired(vc):
    res = vc.post(URL, json=_body("123456"))
    assert res.json() == {"error": "code_expired", "field": "code"}


def test_wrong_pin_counts_down_and_persists(vc, fake_mailer, on_settings):
    _request(vc)
    wrong = _wrong(_pin(fake_mailer))
    for left in (4, 3, 2, 1):
        res = vc.post(URL, json=_body(wrong))
        assert res.status_code == 422
        assert res.json() == {"error": "code_invalid", "field": "code", "attemptsLeft": left}
    assert _row(on_settings).attempts == 4


def test_fifth_wrong_discards_and_correct_pin_then_expired(vc, fake_mailer):
    _request(vc)
    pin = _pin(fake_mailer)
    wrong = _wrong(pin)
    for _ in range(4):
        vc.post(URL, json=_body(wrong))
    res = vc.post(URL, json=_body(wrong))
    assert res.json() == {"error": "code_expired", "field": "code"}
    res = vc.post(URL, json=_body(pin))
    assert res.status_code == 422 and res.json()["error"] == "code_expired"


def test_expires_after_ten_minutes(vc, fake_mailer, clock):
    _request(vc)
    pin = _pin(fake_mailer)
    clock.advance(600)
    res = vc.post(URL, json=_body(pin))
    assert res.json() == {"error": "code_expired", "field": "code"}


def test_resend_invalidates_old_pin(vc, fake_mailer, clock):
    _request(vc)
    old = _pin(fake_mailer)
    clock.advance(61)
    _request(vc)
    new = _pin(fake_mailer)
    if old == new:  # 1/1,000,000
        pytest.skip("same pin drawn twice")
    res = vc.post(URL, json=_body(old))
    assert res.json() == {"error": "code_invalid", "field": "code", "attemptsLeft": 4}
    assert vc.post(URL, json=_body(new)).status_code == 201


def test_field_errors_come_before_pin_check(vc, fake_mailer, on_settings):
    _request(vc)
    pin = _pin(fake_mailer)
    cases = [
        (_body(pin, email="bad"), "invalid_email"),
        (_body(pin, password="short"), "weak_password"),
        (_body(pin, name="  "), "missing_name"),
        (_body(pin, consent=False), "consent_required"),
    ]
    for body, error in cases:
        res = vc.post(URL, json=body)
        assert res.json()["error"] == error
    assert _row(on_settings).attempts == 0


def test_taken_email_is_409_after_valid_pin(vc, on_settings, clock):
    # 이미 가입한 이메일: PIN이 맞아도 409. (PIN 줄은 받을 수 없는 상태라 직접 심는다)
    _make_user(on_settings, MAIL)
    with open_db(on_settings) as conn:
        signup_codes.save_sent(
            conn, email=MAIL, code_hash=signup_codes.hash_code(MAIL, "123456"), now=clock.now
        )
    res = vc.post(URL, json=_body("123456"))
    assert res.status_code == 409 and res.json() == {"error": "email_taken"}


def test_existing_account_logs_in_with_verify_on(vc, on_settings):
    _make_user(on_settings, "first@example.com")
    res = vc.post("/api/auth/login", json={"email": "first@example.com", "password": PASSWORD})
    assert res.status_code == 200


def test_accounts_created_before_migration_008_still_log_in(make_client, on_settings, fake_mailer):
    # 008 없이 만든 DB에 계정을 심고, 앱이 기동하면서 008이 적용되는 흐름
    old_dir = on_settings.db_path.parent / "old_migrations"
    old_dir.mkdir(parents=True)
    for f in db.MIGRATIONS_DIR.glob("*.sql"):
        if int(f.name.split("_", 1)[0]) < 8:
            shutil.copy(f, old_dir / f.name)
    on_settings.db_path.parent.mkdir(parents=True, exist_ok=True)
    with db.connection(on_settings.db_path) as conn:
        assert db.migrate(conn, old_dir) == 7
        users.create_user(
            conn,
            email="old@example.com",
            password_hash=hash_password(PASSWORD),
            name="옛 계정",
            created_at="2026-10-01T00:00:00.000Z",
        )
    c = make_client(on_settings, mailer=fake_mailer)
    with open_db(on_settings) as conn:
        assert conn.execute("SELECT COUNT(*) FROM signup_codes").fetchone()[0] == 0
    res = c.post("/api/auth/login", json={"email": "old@example.com", "password": PASSWORD})
    assert res.status_code == 200


def test_concurrent_wrong_guesses_are_capped_at_five(vc, fake_mailer, on_settings):
    from concurrent.futures import ThreadPoolExecutor

    _request(vc)
    wrong = _wrong(_pin(fake_mailer))
    with ThreadPoolExecutor(max_workers=10) as pool:
        results = list(pool.map(lambda _: vc.post(URL, json=_body(wrong)).json(), range(10)))
    errors = [r["error"] for r in results]
    assert errors.count("code_invalid") == 4  # 1~4번째 오답 — 남은 횟수 4,3,2,1이 한 번씩
    assert sorted(r["attemptsLeft"] for r in results if "attemptsLeft" in r) == [1, 2, 3, 4]
    assert errors.count("code_expired") == 6
    assert _row(on_settings).attempts == 5
