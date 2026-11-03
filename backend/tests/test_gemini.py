import json
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx
import pytest

from app.config import Settings
from app.llm.gemini import GeminiClient
from app.llm.voice_common import VOICE_INSTRUCTION, VOICE_SCHEMA

URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent"
NOW = datetime(2026, 11, 3, 12, 0, tzinfo=UTC).timestamp()

GOOD = {
    "transcript": "음 저는 백엔드 개발자입니다",
    "fillers": {"count": 1, "examples": ["음"]},
    "confidence": {"level": "mid", "reason": "안정적"},
    "tone": {"level": "calm", "reason": "고른 속도"},
    "tremor": {"present": False, "reason": "없음"},
    "trailingOff": {"present": True, "reason": "끝이 흐려짐"},
    "clarity": {"level": "good", "reason": "또렷함"},
}


def ok() -> httpx.Response:
    return httpx.Response(
        200,
        json={
            "candidates": [{"content": {"parts": [{"text": json.dumps(GOOD)}]}}],
            "usageMetadata": {"promptTokenCount": 100, "candidatesTokenCount": 20},
        },
    )


def quota(per_day: bool = False, delay: str | None = "7s") -> httpx.Response:
    quota_id = (
        "GenerateRequestsPerDayPerProjectPerModel-FreeTier"
        if per_day
        else "GenerateRequestsPerMinutePerProjectPerModel-FreeTier"
    )
    details: list[dict[str, Any]] = [
        {
            "@type": "type.googleapis.com/google.rpc.QuotaFailure",
            "violations": [{"quotaId": quota_id}],
        }
    ]
    if delay:
        details.append({"@type": "type.googleapis.com/google.rpc.RetryInfo", "retryDelay": delay})
    return httpx.Response(
        429, json={"error": {"code": 429, "status": "RESOURCE_EXHAUSTED", "details": details}}
    )


def bad_key() -> httpx.Response:
    info = {"@type": "type.googleapis.com/google.rpc.ErrorInfo", "reason": "API_KEY_INVALID"}
    return httpx.Response(
        400, json={"error": {"code": 400, "status": "INVALID_ARGUMENT", "details": [info]}}
    )


Handler = Callable[[httpx.Request], httpx.Response]


def make(
    keys: list[str], handler: Handler, now: float = NOW, **kw: Any
) -> tuple[GeminiClient, dict[str, float], list[float]]:
    settings = Settings(storage_dir=Path("."), gemini_api_keys=tuple(keys), **kw)
    clock = {"t": now}
    slept: list[float] = []

    def sleep(sec: float) -> None:
        slept.append(sec)
        clock["t"] += sec

    http = httpx.Client(transport=httpx.MockTransport(handler))
    client = GeminiClient(settings, http=http, clock=lambda: clock["t"], sleep=sleep)
    return client, clock, slept


def key(req: httpx.Request) -> str:
    return req.headers["x-goog-api-key"]


def test_ok_request_shape_and_tokens() -> None:
    seen: list[httpx.Request] = []

    def handler(req: httpx.Request) -> httpx.Response:
        seen.append(req)
        return ok()

    c, _, _ = make(["k1"], handler)
    out = c.analyze(b"RIFFxxxxWAVE")
    assert out.outcome == "ok" and out.result is not None
    assert out.result.transcript == GOOD["transcript"]
    assert (out.key_index, out.input_tokens, out.output_tokens) == (1, 100, 20)
    req = seen[0]
    assert str(req.url) == URL and key(req) == "k1"
    assert "authorization" not in req.headers
    body = json.loads(req.content)
    assert body["contents"][0]["parts"][1]["text"] == VOICE_INSTRUCTION
    assert body["generationConfig"]["responseSchema"] == VOICE_SCHEMA


def test_model_setting_used() -> None:
    seen: list[str] = []

    def handler(req: httpx.Request) -> httpx.Response:
        seen.append(str(req.url))
        return ok()

    c, _, _ = make(["k1"], handler, gemini_voice_model="m2")
    c.analyze(b"x")
    assert seen == ["https://generativelanguage.googleapis.com/v1beta/models/m2:generateContent"]


def test_bad_output() -> None:
    c, _, _ = make(["k1"], lambda r: httpx.Response(200, json={"candidates": []}))
    assert c.analyze(b"x").outcome == "bad_output"


def test_minute_limit_moves_to_next_key() -> None:
    calls: list[str] = []

    def handler(req: httpx.Request) -> httpx.Response:
        calls.append(key(req))
        return quota() if key(req) == "k1" else ok()

    c, _, slept = make(["k1", "k2"], handler)
    out = c.analyze(b"x")
    assert out.outcome == "ok" and out.key_index == 2
    assert calls == ["k1", "k2"] and slept == []
    # k1은 7초 쉬는 동안 건너뛴다
    calls.clear()
    c.analyze(b"x")
    assert calls == ["k2"]


def test_minute_limit_waits_and_retries_once() -> None:
    calls: list[str] = []

    def handler(req: httpx.Request) -> httpx.Response:
        calls.append(key(req))
        return quota(delay="7s") if len(calls) == 1 else ok()

    c, _, slept = make(["k1"], handler)
    out = c.analyze(b"x")
    assert out.outcome == "ok" and slept == [7.0] and calls == ["k1", "k1"]


def test_minute_limit_waits_only_once_then_error() -> None:
    c, _, slept = make(["k1"], lambda r: quota(delay="3s"))
    out = c.analyze(b"x")
    assert out.outcome == "error" and slept == [3.0]
    assert c.available()  # 분당 한도는 잠깐 쉬는 것 — 쓸 수 있는 키로 본다


def test_minute_limit_over_30s_gives_up_without_waiting() -> None:
    c, _, slept = make(["k1"], lambda r: quota(delay="45s"))
    assert c.analyze(b"x").outcome == "error" and slept == []


def test_minute_limit_without_retry_info_rests_60s() -> None:
    state = {"limited": True}

    def handler(req: httpx.Request) -> httpx.Response:
        return quota(delay=None) if state["limited"] else ok()

    c, clock, slept = make(["k1"], handler)
    assert c.analyze(b"x").outcome == "error" and slept == []  # 60초는 30초 넘음 — 안 기다림
    state["limited"] = False
    clock["t"] += 29
    assert c.analyze(b"x").outcome == "error" and slept == []  # 31초 남음 — 보내지 않는다
    clock["t"] += 1
    assert c.analyze(b"x").outcome == "ok" and slept == [30.0]


def test_daily_limit_rests_until_pacific_midnight() -> None:
    # 2026-11-03 12:00 UTC → 다음 태평양 자정(UTC-8 고정) = 2026-11-04 08:00 UTC
    c, clock, slept = make(["k1"], lambda r: quota(per_day=True))
    assert c.analyze(b"x").outcome == "exhausted" and slept == []
    assert not c.available()
    clock["t"] = datetime(2026, 11, 4, 7, 59, tzinfo=UTC).timestamp()
    assert not c.available()
    clock["t"] = datetime(2026, 11, 4, 8, 0, tzinfo=UTC).timestamp()
    assert c.available()


def test_daily_on_one_key_minute_on_other_is_error() -> None:
    def handler(req: httpx.Request) -> httpx.Response:
        return quota(per_day=True) if key(req) == "k1" else quota(delay="60s")

    c, _, _ = make(["k1", "k2"], handler)
    assert c.analyze(b"x").outcome == "error"


@pytest.mark.parametrize(
    "resp", [lambda: httpx.Response(401), lambda: httpx.Response(403), bad_key]
)
def test_invalid_key_is_dead(resp: Callable[[], httpx.Response]) -> None:
    calls: list[str] = []

    def handler(req: httpx.Request) -> httpx.Response:
        calls.append(key(req))
        return resp() if key(req) == "k1" else ok()

    c, _, _ = make(["k1", "k2"], handler)
    assert c.analyze(b"x").key_index == 2
    calls.clear()
    c.analyze(b"x")
    assert calls == ["k2"]


def test_all_dead_unavailable() -> None:
    c, _, _ = make(["k1"], lambda r: httpx.Response(403))
    assert c.analyze(b"x").outcome == "unavailable"
    assert not c.available()


def test_no_keys_unavailable() -> None:
    c, _, _ = make([], lambda r: ok())
    assert not c.available() and c.analyze(b"x").outcome == "unavailable"


def test_5xx_retried_once_then_error() -> None:
    calls: list[int] = []

    def handler(req: httpx.Request) -> httpx.Response:
        calls.append(1)
        return httpx.Response(503) if len(calls) == 1 else ok()

    c, _, _ = make(["k1"], handler)
    assert c.analyze(b"x").outcome == "ok" and len(calls) == 2
    c2, _, _ = make(["k1"], lambda r: httpx.Response(500))
    assert c2.analyze(b"x").outcome == "error"


def test_timeout_retried_then_error() -> None:
    def handler(req: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("t", request=req)

    c, _, _ = make(["k1"], handler)
    assert c.analyze(b"x").outcome == "error"


def test_other_4xx_error() -> None:
    c, _, _ = make(["k1"], lambda r: httpx.Response(400, json={"error": {"code": 400}}))
    out = c.analyze(b"x")
    assert out.outcome == "error" and out.key_index == 1


def test_refresh_credits_noop_and_status_hides_keys() -> None:
    def handler(req: httpx.Request) -> httpx.Response:
        raise AssertionError("no http")

    c, _, _ = make(["AIza-secret-1"], handler)
    c.refresh_credits()
    assert "AIza-secret" not in repr(c.status())
    assert c.status() == [{"index": 1, "state": "ok"}]
