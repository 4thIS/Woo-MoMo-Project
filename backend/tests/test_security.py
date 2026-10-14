from starlette.requests import Request

from app.security import (
    RateLimiter,
    burn_password_check,
    client_ip,
    hash_password,
    hash_token,
    new_session_token,
    verify_password,
)
from tests.fakes import FakeClock


def test_password_round_trip():
    h = hash_password("password123")
    assert h.startswith("$argon2")
    assert verify_password(h, "password123")
    assert not verify_password(h, "password124")


def test_verify_rejects_garbage_hash():
    assert not verify_password("not-a-hash", "password123")


def test_burn_password_check_does_not_raise():
    assert burn_password_check("anything") is None


def test_session_token_and_hash():
    token = new_session_token()
    assert len(token) >= 43
    assert token != new_session_token()
    digest = hash_token(token)
    assert len(digest) == 64
    assert digest == hash_token(token)
    assert digest != token


def test_rate_limiter_sliding_window():
    clock = FakeClock()
    limiter = RateLimiter(clock)
    assert [limiter.allow("login:1.1.1.1", 3) for _ in range(4)] == [True, True, True, False]
    assert limiter.allow("login:2.2.2.2", 3)  # 키마다 따로 센다
    clock.advance(59)
    assert not limiter.allow("login:1.1.1.1", 3)
    clock.advance(1)
    assert limiter.allow("login:1.1.1.1", 3)


def test_rate_limiter_deletes_empty_key():
    clock = FakeClock()
    limiter = RateLimiter(clock)
    assert limiter.allow("k", 1)
    clock.advance(60)
    assert not limiter.allow("k", 0)  # 창이 지나 비었고 차단돼도 키는 남기지 않는다
    assert "k" not in limiter._hits


def test_rate_limiter_sweeps_stale_keys_when_many():
    clock = FakeClock()
    limiter = RateLimiter(clock)
    assert limiter.allow("k", 1)
    for i in range(1024):
        assert limiter.allow(f"ip{i}", 1)
    clock.advance(60)
    assert limiter.allow("other", 1)  # 키가 1024개를 넘으면 창 밖 키를 모두 지운다
    assert "k" not in limiter._hits
    assert set(limiter._hits) == {"other"}


def _request(headers: dict[str, str], client: tuple[str, int] = ("9.9.9.9", 1234)) -> Request:
    raw = [(k.lower().encode(), v.encode()) for k, v in headers.items()]
    scope = {
        "type": "http",
        "method": "GET",
        "path": "/",
        "query_string": b"",
        "headers": raw,
        "client": client,
    }
    return Request(scope)


def test_client_ip_prefers_cloudflare_header():
    assert client_ip(_request({"CF-Connecting-IP": "1.2.3.4"})) == "1.2.3.4"
    assert client_ip(_request({})) == "9.9.9.9"
