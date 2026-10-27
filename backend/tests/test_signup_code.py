"""가입 인증번호 받기·설정 조회 (spec 2026-10-27 4절)."""

import dataclasses
import re

import pytest

from app.config import Settings
from app.repos import signup_codes
from tests.helpers import open_db, signup

URL = "/api/auth/signup/code"
MAIL = "me@example.com"


@pytest.fixture
def on_settings(settings: Settings) -> Settings:
    return dataclasses.replace(settings, signup_email_verify=True)


@pytest.fixture
def vc(make_client, on_settings, fake_mailer):
    return make_client(on_settings, mailer=fake_mailer)


def _row(settings, email=MAIL):
    with open_db(settings) as conn:
        return signup_codes.get(conn, email)


def _pin(mailer, index=-1):
    return re.search(r"인증번호: (\d{6})", mailer.sent[index]["text"]).group(1)


def test_disabled_returns_404_and_config_false(client):
    res = client.post(URL, json={"email": MAIL})
    assert res.status_code == 404 and res.json() == {"error": "verify_disabled"}
    assert client.get("/api/auth/signup/config").json() == {"emailVerify": False}


def test_config_true(vc):
    assert vc.get("/api/auth/signup/config").json() == {"emailVerify": True}


def test_sends_mail_and_stores_hash_only(vc, fake_mailer, on_settings, clock):
    res = vc.post(URL, json={"email": f"  {MAIL.upper()} "})
    assert res.status_code == 202
    assert res.json() == {"expiresInSec": 600, "resendInSec": 60}
    assert len(fake_mailer.sent) == 1
    mail = fake_mailer.sent[0]
    assert mail["to"] == MAIL
    assert mail["subject"] == "[모두의 모의면접] 가입 인증번호"
    pin = _pin(fake_mailer)
    assert mail["text"] == (
        f"인증번호: {pin}\n\n10분 안에 입력해 주세요.\n"
        "가입을 요청하지 않았다면 이 메일은 무시하셔도 됩니다."
    )
    row = _row(on_settings)
    assert row.code_hash == signup_codes.hash_code(MAIL, pin)
    assert row.expires_at == clock.now + 600 and row.attempts == 0
    assert row.window_count == 1
    with open_db(on_settings) as conn:
        dump = " ".join(str(v) for v in conn.execute("SELECT * FROM signup_codes").fetchone())
    assert pin not in dump


def test_cooldown_then_resend_replaces_hash(vc, fake_mailer, on_settings, clock):
    vc.post(URL, json={"email": MAIL})
    first = _row(on_settings).code_hash
    clock.advance(20)
    res = vc.post(URL, json={"email": MAIL})
    assert res.status_code == 429
    assert res.json() == {"error": "code_cooldown", "retryAfterSec": 40}
    assert len(fake_mailer.sent) == 1
    clock.advance(41)
    assert vc.post(URL, json={"email": MAIL}).status_code == 202
    assert len(fake_mailer.sent) == 2
    row = _row(on_settings)
    assert row.code_hash != first
    assert row.code_hash == signup_codes.hash_code(MAIL, _pin(fake_mailer))
    assert row.window_count == 2


def test_hourly_limit_and_window_reset(vc, fake_mailer, clock):
    for _ in range(5):
        assert vc.post(URL, json={"email": MAIL}).status_code == 202
        clock.advance(61)
    res = vc.post(URL, json={"email": MAIL})
    assert res.status_code == 429 and res.json() == {"error": "code_limit"}
    assert len(fake_mailer.sent) == 5
    clock.advance(3600)
    assert vc.post(URL, json={"email": MAIL}).status_code == 202


def test_window_resets_count(vc, on_settings, clock):
    vc.post(URL, json={"email": MAIL})
    clock.advance(3601)
    vc.post(URL, json={"email": MAIL})
    row = _row(on_settings)
    assert row.window_count == 1 and row.window_start == clock.now


def test_ip_rate_limit(vc):
    for i in range(5):
        assert vc.post(URL, json={"email": f"u{i}@example.com"}).status_code == 202
    res = vc.post(URL, json={"email": "u9@example.com"})
    assert res.status_code == 429 and res.json() == {"error": "rate_limited"}


def test_taken_email_409_no_mail(vc, fake_mailer):
    signup(vc, email=MAIL)
    res = vc.post(URL, json={"email": MAIL})
    assert res.status_code == 409 and res.json() == {"error": "email_taken"}
    assert fake_mailer.sent == []


@pytest.mark.parametrize("bad", ["", "nope", "a@b"])
def test_invalid_email_422(vc, bad):
    res = vc.post(URL, json={"email": bad})
    assert res.status_code == 422
    assert res.json() == {"error": "invalid_email", "field": "email"}


def test_no_mailer_503(make_client, on_settings):
    res = make_client(on_settings).post(URL, json={"email": MAIL})
    assert res.status_code == 503 and res.json() == {"error": "mail_unavailable"}


def test_send_failure_502_keeps_row_and_no_cooldown(vc, fake_mailer, on_settings, clock):
    vc.post(URL, json={"email": MAIL})
    before = _row(on_settings)
    clock.advance(61)
    fake_mailer.fail = True
    res = vc.post(URL, json={"email": MAIL})
    assert res.status_code == 502 and res.json() == {"error": "mail_failed"}
    assert _row(on_settings) == before
    fake_mailer.fail = False
    assert vc.post(URL, json={"email": MAIL}).status_code == 202


def test_send_failure_first_time_stores_nothing(vc, fake_mailer, on_settings):
    fake_mailer.fail = True
    assert vc.post(URL, json={"email": MAIL}).status_code == 502
    assert _row(on_settings) is None
    fake_mailer.fail = False
    assert vc.post(URL, json={"email": MAIL}).status_code == 202


def test_repo_add_attempt_and_delete(vc, on_settings):
    vc.post(URL, json={"email": MAIL})
    with open_db(on_settings) as conn:
        assert signup_codes.add_attempt(conn, MAIL) == 1
        assert signup_codes.add_attempt(conn, MAIL) == 2
        signup_codes.delete(conn, MAIL)
        assert signup_codes.get(conn, MAIL) is None
        assert signup_codes.add_attempt(conn, MAIL) == 0
