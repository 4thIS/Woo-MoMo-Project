"""Gemini API 직접 호출 — 목소리 분석 (spec 2026-11-03).

BAZE(`baze.py`)와 같은 요청 본문·응답 파싱(`voice_common`)을 쓰고, 주소·인증·한도 처리만 다르다.
무료 등급 키를 쓰므로 429(분당·하루 한도)를 키별로 쉬게 하며 돌려 쓴다.
키 값은 로그·상태·예외에 남기지 않는다(순번 1부터만). 상태는 메모리·잠금 보호.
"""

import re
import threading
import time
from collections.abc import Callable
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx

from app.config import Settings
from app.llm.voice_common import VoiceOutcome, parse_response, request_body

GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta"
REQUEST_TIMEOUT = 60.0
# 분당 한도 응답에 대기 시간이 없을 때 쉬는 시간
DEFAULT_COOLDOWN = 60.0
# 쓸 키가 없을 때 이만큼 안에 풀리는 키가 있으면 기다렸다가 한 번 더 보낸다
MAX_WAIT = 30.0
# 하루 한도는 태평양 시간 자정에 풀린다. 서머타임과 상관없이 UTC-8로 계산한다(늦게 푸는 쪽이 안전)
PACIFIC = timezone(timedelta(hours=-8))

_DELAY = re.compile(r"^\s*(\d+(?:\.\d+)?)s\s*$")


def _next_pacific_midnight(now: float) -> float:
    d = datetime.fromtimestamp(now, PACIFIC)
    return datetime(d.year, d.month, d.day, tzinfo=PACIFIC).timestamp() + 86400


def _error_details(r: httpx.Response) -> list[dict[str, Any]]:
    try:
        details = r.json()["error"]["details"]
    except (ValueError, KeyError, TypeError):
        return []
    return [d for d in details if isinstance(d, dict)] if isinstance(details, list) else []


def _is_daily(details: list[dict[str, Any]]) -> bool:
    for d in details:
        for v in d.get("violations") or []:
            if isinstance(v, dict) and "PerDay" in str(v.get("quotaId", "")):
                return True
    return False


def _retry_delay(details: list[dict[str, Any]]) -> float:
    for d in details:
        m = _DELAY.match(str(d.get("retryDelay", "")))
        if m:
            return float(m.group(1))
    return DEFAULT_COOLDOWN


def _is_bad_key(details: list[dict[str, Any]]) -> bool:
    return any(d.get("reason") == "API_KEY_INVALID" for d in details)


class GeminiClient:
    def __init__(
        self,
        settings: Settings,
        *,
        http: httpx.Client | None = None,
        clock: Callable[[], float] = time.time,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self._keys = settings.gemini_api_keys
        self._model = settings.gemini_voice_model
        self._http = http or httpx.Client(timeout=REQUEST_TIMEOUT)
        self._clock = clock
        self._sleep = sleep
        self._lock = threading.Lock()
        # state: ok | cooling(분당 한도) | daily(하루 한도) | dead
        self._state = ["ok"] * len(self._keys)
        self._until = [0.0] * len(self._keys)

    # ── 키 상태 ──

    def _effective(self, i: int, now: float) -> str:
        if self._state[i] in ("cooling", "daily") and now >= self._until[i]:
            self._state[i] = "ok"
        return self._state[i]

    def _pick(self) -> int | None:
        with self._lock:
            now = self._clock()
            for i in range(len(self._keys)):
                if self._effective(i, now) == "ok":
                    return i
            return None

    def _rest(self, i: int, state: str, until: float) -> None:
        with self._lock:
            self._state[i], self._until[i] = state, until

    def _soonest_cooling(self) -> float | None:
        """분당 한도로 쉬는 키가 다시 쓸 수 있게 되기까지 남은 초(없으면 None)."""
        with self._lock:
            now = self._clock()
            waits = [
                self._until[i] - now
                for i in range(len(self._keys))
                if self._effective(i, now) == "cooling"
            ]
        return max(0.0, min(waits)) if waits else None

    def available(self) -> bool:
        with self._lock:
            now = self._clock()
            return any(self._effective(i, now) in ("ok", "cooling") for i in range(len(self._keys)))

    def status(self) -> list[dict[str, Any]]:
        with self._lock:
            now = self._clock()
            return [
                {"index": i + 1, "state": self._effective(i, now)} for i in range(len(self._keys))
            ]

    def refresh_credits(self) -> None:
        """Gemini에는 잔액 조회가 없다 — VoiceAnalyzer 면을 맞추려고 둔다."""

    # ── 호출 ──

    def _post(self, i: int, wav: bytes) -> httpx.Response | None:
        url = f"{GEMINI_BASE_URL}/models/{self._model}:generateContent"
        headers = {"x-goog-api-key": self._keys[i]}
        try:
            return self._http.post(
                url, json=request_body(wav), headers=headers, timeout=REQUEST_TIMEOUT
            )
        except httpx.HTTPError:
            return None

    def _post_with_retry(self, i: int, wav: bytes) -> httpx.Response | None:
        """5xx·시간 초과는 같은 키로 1회 재시도. 끝내 실패하면 None."""
        for _ in range(2):
            r = self._post(i, wav)
            if r is not None and r.status_code < 500:
                return r
        return None

    def analyze(self, wav: bytes) -> VoiceOutcome:
        waited = False
        saw_minute = saw_daily = False
        while True:
            i = self._pick()
            if i is None:
                wait = self._soonest_cooling()
                if not waited and wait is not None and wait <= MAX_WAIT:
                    waited = True
                    self._sleep(wait)
                    continue
                break
            idx = i + 1
            r = self._post_with_retry(i, wav)
            if r is None:
                return VoiceOutcome("error", key_index=idx)
            if r.status_code == 200:
                return parse_response(r, idx)
            details = _error_details(r)
            if r.status_code == 429:
                now = self._clock()
                if _is_daily(details):
                    self._rest(i, "daily", _next_pacific_midnight(now))
                    saw_daily = True
                else:
                    self._rest(i, "cooling", now + _retry_delay(details))
                    saw_minute = True
                continue
            if r.status_code in (401, 403) or (r.status_code == 400 and _is_bad_key(details)):
                self._rest(i, "dead", 0.0)
                continue
            return VoiceOutcome("error", key_index=idx)
        if saw_minute or self._soonest_cooling() is not None:
            return VoiceOutcome("error")
        if saw_daily or any(s["state"] == "daily" for s in self.status()):
            return VoiceOutcome("exhausted")
        return VoiceOutcome("unavailable")
