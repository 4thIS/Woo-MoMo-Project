import json
import logging
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.mail import HttpMailer, MailError
from app.main import create_app
from tests.fakes import FakeMailer

URL = "https://send.example.test/v1/send"
KEY = "sk-secret-key-123"
TO = "me@example.com"
BODY = "인증번호: 123456"


def _mailer(handler) -> HttpMailer:
    return HttpMailer(URL, KEY, client=httpx.Client(transport=httpx.MockTransport(handler)))


def _send(m: HttpMailer, idem: str = "signup-abcd") -> None:
    m.send(to=TO, subject="제목", text=BODY, idempotency_key=idem)


def test_request_shape() -> None:
    seen: list[httpx.Request] = []

    def handler(req: httpx.Request) -> httpx.Response:
        seen.append(req)
        return httpx.Response(202, json={"ok": True})

    _send(_mailer(handler), "signup-abcd")
    req = seen[0]
    assert req.method == "POST"
    assert str(req.url) == URL
    assert req.headers["authorization"] == f"Bearer {KEY}"
    assert req.headers["content-type"] == "application/json"
    assert req.headers["idempotency-key"] == "signup-abcd"
    assert req.headers["user-agent"] == "woo-momo/1.0"
    assert json.loads(req.content) == {"to": TO, "subject": "제목", "text": BODY}


@pytest.mark.parametrize("status", [400, 401, 429, 500, 503])
def test_error_status_raises_mail_error(status: int, caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level(logging.DEBUG)
    m = _mailer(lambda req: httpx.Response(status, text=f"{KEY} {TO} {BODY}"))
    with pytest.raises(MailError):
        _send(m)
    _assert_no_leak(caplog)


def test_timeout_raises_mail_error(caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level(logging.DEBUG)

    def handler(req: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("timeout", request=req)

    with pytest.raises(MailError):
        _send(_mailer(handler))
    _assert_no_leak(caplog)


def test_connect_error_raises_mail_error() -> None:
    def handler(req: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("boom", request=req)

    with pytest.raises(MailError):
        _send(_mailer(handler))


def _assert_no_leak(caplog: pytest.LogCaptureFixture) -> None:
    text = caplog.text
    for secret in (KEY, TO, "123456"):
        assert secret not in text


def test_settings_defaults() -> None:
    s = Settings.from_env({})
    assert s.signup_email_verify is False
    assert s.mail_api_key is None
    assert s.mail_api_url == "https://send.ssenu.cloud/v1/send"


def test_settings_env_parsing() -> None:
    s = Settings.from_env(
        {
            "SIGNUP_EMAIL_VERIFY": "true",
            "MAIL_API_KEY": f"  {KEY} ",
            "MAIL_API_URL": " https://x.test/send ",
        }
    )
    assert s.signup_email_verify is True
    assert s.mail_api_key == KEY
    assert s.mail_api_url == "https://x.test/send"
    assert KEY not in repr(s)


def test_settings_blank_values_fall_back() -> None:
    s = Settings.from_env({"MAIL_API_KEY": " ", "MAIL_API_URL": "", "SIGNUP_EMAIL_VERIFY": ""})
    assert s.mail_api_key is None
    assert s.mail_api_url == "https://send.ssenu.cloud/v1/send"
    assert s.signup_email_verify is False


def test_create_app_no_mailer_without_key(settings: Settings) -> None:
    with TestClient(create_app(settings=settings)) as c:
        assert c.app.state.mailer is None


def test_create_app_builds_http_mailer_with_key(tmp_path: Path) -> None:
    s = Settings(storage_dir=tmp_path / "s", mail_api_key=KEY)
    with TestClient(create_app(settings=s)) as c:
        assert isinstance(c.app.state.mailer, HttpMailer)


def test_create_app_injected_mailer_wins(tmp_path: Path) -> None:
    s = Settings(storage_dir=tmp_path / "s", mail_api_key=KEY)
    fake = FakeMailer()
    with TestClient(create_app(settings=s, mailer=fake)) as c:
        assert c.app.state.mailer is fake
