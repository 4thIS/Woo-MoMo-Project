import base64
import json
from datetime import UTC, datetime, timedelta
from pathlib import Path

import httpx

from app.config import Settings
from app.llm.baze import (
    VOICE_INSTRUCTION,
    VOICE_SCHEMA,
    BazeClient,
    KeyPool,
)

BASE = "https://factchat-cloud.mindlogic.ai/v1/gateway"
GEN = f"{BASE}/gemini/v1beta/models/gemini-3.8-flash:generateContent"

GOOD = {
    "transcript": "음 저는 백엔드 개발자입니다",
    "fillers": {"count": 1, "examples": ["음"]},
    "confidence": {"level": "mid", "reason": "목소리가 안정적"},
    "tone": {"level": "calm", "reason": "고른 속도"},
    "tremor": {"present": False, "reason": "떨림 없음"},
    "trailingOff": {"present": True, "reason": "끝이 흐려짐"},
    "clarity": {"level": "good", "reason": "또렷함"},
}


def ok_body(payload=None, usage=None):
    return {
        "candidates": [{"content": {"parts": [{"text": json.dumps(payload or GOOD)}]}}],
        "usageMetadata": usage
        or {"promptTokenCount": 100, "candidatesTokenCount": 20, "thoughtsTokenCount": 5},
    }


def err(code, message="x", headers=None):
    return httpx.Response(
        code, json={"detail": {"code": code, "message": message}}, headers=headers
    )


def make(keys, handler, now=1_700_000_000.0, **kw):
    settings = Settings(storage_dir=Path("."), baze_api_keys=tuple(keys), **kw)
    http = httpx.Client(transport=httpx.MockTransport(handler))
    clock = {"t": now}
    client = BazeClient(settings, http=http, clock=lambda: clock["t"])
    return client, clock


def bearer(req):
    return req.headers["authorization"].removeprefix("Bearer ")


def test_settings_parse_and_defaults():
    s = Settings.from_env({"BAZE_API_KEYS": " k1, ,k2 ,k3", "BAZE_MIN_REMAINING": "10"})
    assert s.baze_api_keys == ("k1", "k2", "k3")
    assert s.baze_min_remaining == 10.0
    assert s.baze_voice_model == "gemini-3.8-flash"
    d = Settings.from_env({})
    assert d.baze_api_keys == () and d.baze_min_remaining == 50.0
    m = Settings.from_env({"BAZE_VOICE_MODEL": "gemini-x"})
    assert m.baze_voice_model == "gemini-x"


def test_success_request_shape_and_result():
    seen = []

    def handler(req):
        seen.append(req)
        return httpx.Response(200, json=ok_body())

    client, _ = make(["k1", "k2"], handler)
    out = client.analyze(b"RIFFxxxxWAVE")
    assert out.outcome == "ok" and out.key_index == 1
    assert out.result.transcript.startswith("음") and out.result.fillers.count == 1
    assert (out.input_tokens, out.output_tokens) == (100, 25)
    req = seen[0]
    assert str(req.url) == GEN
    assert req.method == "POST"
    assert req.headers["authorization"] == "Bearer k1"
    assert req.headers["user-agent"] == "woo-momo/1.0"
    body = json.loads(req.content)
    parts = body["contents"][0]["parts"]
    assert parts[0]["inline_data"]["mime_type"] == "audio/wav"
    assert base64.b64decode(parts[0]["inline_data"]["data"]) == b"RIFFxxxxWAVE"
    assert parts[1] == {"text": VOICE_INSTRUCTION}
    assert body["generationConfig"] == {
        "responseMimeType": "application/json",
        "responseSchema": VOICE_SCHEMA,
    }
    assert VOICE_SCHEMA["type"] == "OBJECT" and "transcript" in VOICE_SCHEMA["required"]


def test_402_falls_to_next_key_and_first_recovers_after_renewal():
    calls = []
    recovered = {"v": False}

    def handler(req):
        k = bearer(req)
        calls.append(k)
        if k == "k1" and not recovered["v"]:
            return err(402, "Credit balance exhausted")
        return httpx.Response(200, json=ok_body())

    client, clock = make(["k1", "k2"], handler)
    out = client.analyze(b"w")
    assert out.outcome == "ok" and out.key_index == 2
    assert calls == ["k1", "k2"]
    assert client._pool.status()[0]["state"] == "exhausted"
    calls.clear()
    assert client.analyze(b"w").key_index == 2 and calls == ["k2"]
    # 다음 달 1일이 지난 뒤 다시 사용
    clock["t"] += 40 * 86400
    recovered["v"] = True
    calls.clear()
    assert client.analyze(b"w").key_index == 1


def test_exhausted_until_renewal_date_from_pool():
    t = {"now": 1000.0}
    pool = KeyPool(["a", "b"], clock=lambda: t["now"])
    pool.mark_exhausted(0, datetime.fromtimestamp(2000.0, UTC))
    assert pool.pick() == 1
    t["now"] = 2001.0
    assert pool.pick() == 0


def test_default_renewal_is_first_of_next_month_kst():
    # 2026-10-23 12:00 KST
    now = datetime(2026, 10, 23, 12, 0, tzinfo=UTC).timestamp() - 9 * 3600 + 9 * 3600
    t = {"now": now}
    pool = KeyPool(["a", "b"], clock=lambda: t["now"])
    pool.mark_exhausted(0, None)
    # 2026-10-31 말(KST)에는 아직 쓸 수 없고, 11-01 00:00 KST 이후엔 쓸 수 있다
    nov1_kst = datetime(2026, 10, 31, 15, 0, tzinfo=UTC).timestamp()
    t["now"] = nov1_kst - 1
    assert pool.pick() == 1
    t["now"] = nov1_kst
    assert pool.pick() == 0


def test_401_marks_dead_permanently():
    def handler(req):
        if bearer(req) == "k1":
            return err(401, "invalid")
        return httpx.Response(200, json=ok_body())

    client, clock = make(["k1", "k2"], handler)
    assert client.analyze(b"w").key_index == 2
    assert client._pool.status()[0]["state"] == "dead"
    clock["t"] += 365 * 86400
    assert client._pool.pick() == 1


def test_429_tries_next_key_without_marking():
    def handler(req):
        if bearer(req) == "k1":
            return err(429, "rate", {"Retry-After": "3"})
        return httpx.Response(200, json=ok_body())

    client, _ = make(["k1", "k2"], handler)
    assert client.analyze(b"w").key_index == 2
    assert client._pool.status()[0]["state"] == "ok"


def test_all_429_is_error():
    client, _ = make(["k1", "k2"], lambda r: err(429))
    out = client.analyze(b"w")
    assert out.outcome == "error" and out.result is None


def test_no_usable_keys_unavailable():
    client, _ = make([], lambda r: httpx.Response(500))
    out = client.analyze(b"w")
    assert out.outcome == "unavailable" and out.key_index is None
    assert client.available() is False


def test_all_dead_is_unavailable():
    client, _ = make(["k1"], lambda r: err(401))
    assert client.analyze(b"w").outcome == "unavailable"
    assert client.available() is False
    assert client.analyze(b"w").outcome == "unavailable"


def test_all_402_is_exhausted_then_unavailable():
    client, _ = make(["k1", "k2"], lambda r: err(402, "Credit balance exhausted"))
    out = client.analyze(b"w")
    assert out.outcome == "exhausted" and out.result is None
    assert client.analyze(b"w").outcome == "unavailable"


def test_5xx_retried_once_then_ok():
    n = {"c": 0}

    def handler(req):
        n["c"] += 1
        return httpx.Response(503) if n["c"] == 1 else httpx.Response(200, json=ok_body())

    client, _ = make(["k1", "k2"], handler)
    out = client.analyze(b"w")
    assert out.outcome == "ok" and out.key_index == 1 and n["c"] == 2


def test_5xx_twice_is_error_and_timeout_too():
    client, _ = make(["k1", "k2"], lambda r: httpx.Response(500))
    out = client.analyze(b"w")
    assert out.outcome == "error" and out.key_index == 1

    n = {"c": 0}

    def boom(req):
        n["c"] += 1
        raise httpx.ReadTimeout("slow")

    client, _ = make(["k1"], boom)
    assert client.analyze(b"w").outcome == "error" and n["c"] == 2


def test_bad_output():
    bad = dict(GOOD)
    del bad["clarity"]
    client, _ = make(["k1"], lambda r: httpx.Response(200, json=ok_body(bad)))
    out = client.analyze(b"w")
    assert out.outcome == "bad_output" and out.result is None and out.key_index == 1

    worse = dict(GOOD, tone={"level": "angry", "reason": "x"})
    client, _ = make(["k1"], lambda r: httpx.Response(200, json=ok_body(worse)))
    assert client.analyze(b"w").outcome == "bad_output"

    client, _ = make(["k1"], lambda r: httpx.Response(200, json={"candidates": []}))
    assert client.analyze(b"w").outcome == "bad_output"


def test_refresh_credits_skips_low_keys():
    renewal = "2026-11-01T00:00:00+09:00"
    seen = []

    def handler(req):
        seen.append(req)
        if req.url.path.endswith("/credits/"):
            rem = {"k1": 10, "k2": 500}[bearer(req)]
            return httpx.Response(
                200,
                json={
                    "total": {"quota": 1000, "used": 0, "remaining": rem},
                    "monthly_allocated": {"renewal_date": renewal},
                },
            )
        return httpx.Response(200, json=ok_body())

    client, _ = make(["k1", "k2"], handler)
    client.refresh_credits()
    assert str(seen[0].url) == f"{BASE}/credits/"
    assert seen[0].headers["user-agent"] == "woo-momo/1.0"
    st = client._pool.status()
    assert st[0]["state"] == "low" and st[0]["remaining"] == 10
    assert st[1]["state"] == "ok" and st[1]["remaining"] == 500
    assert client.analyze(b"w").key_index == 2


def test_only_low_keys_still_used():
    pool = KeyPool(["a", "b"], clock=lambda: 0.0)
    pool.set_remaining(0, 1.0, None)
    pool.set_remaining(1, 2.0, None)
    assert pool.pick() == 0 and pool.available()


def test_refresh_credits_failure_ignored():
    client, _ = make(["k1"], lambda r: httpx.Response(500))
    client.refresh_credits()
    assert client.available()


def test_status_has_no_key_values():
    client, _ = make(["secret-key-AAA", "secret-key-BBB"], lambda r: err(401))
    client.analyze(b"w")
    dump = json.dumps(client._pool.status())
    assert "secret" not in dump
    assert [s["index"] for s in client._pool.status()] == [1, 2]


def test_renewal_in_past_not_stuck():
    pool = KeyPool(["a"], clock=lambda: 5000.0)
    pool.mark_exhausted(0, datetime.fromtimestamp(5000.0, UTC) - timedelta(days=1))
    assert pool.pick() == 0
