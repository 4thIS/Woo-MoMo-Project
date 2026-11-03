"""BAZE(학교 AI 게이트웨이) 클라이언트 — 키 풀 + Gemini 오디오 분석.

키 값은 로그·상태·예외에 남기지 않는다(순번 1부터만). 상태는 메모리·잠금 보호.
"""

import threading
import time
from collections.abc import Callable
from datetime import UTC, datetime, timedelta, timezone
from typing import Any

import httpx

from app.config import Settings
from app.llm.voice_common import (  # noqa: F401 — 기존 import 경로(app.llm.baze)를 그대로 둔다
    VOICE_INSTRUCTION,
    VOICE_SCHEMA,
    Clarity,
    Confidence,
    Fillers,
    Flag,
    Outcome,
    StoredVoice,
    Tone,
    VoiceAnalyzer,
    VoiceOutcome,
    VoiceResult,
    parse_response,
    request_body,
)

BAZE_BASE_URL = "https://factchat-cloud.mindlogic.ai/v1/gateway"
USER_AGENT = "woo-momo/1.0"
REQUEST_TIMEOUT = 60.0
KST = timezone(timedelta(hours=9))


def _next_month_kst(now: float) -> float:
    d = datetime.fromtimestamp(now, KST)
    year, month = (d.year + 1, 1) if d.month == 12 else (d.year, d.month + 1)
    return datetime(year, month, 1, tzinfo=KST).timestamp()


class KeyPool:
    def __init__(
        self,
        keys: tuple[str, ...] | list[str],
        *,
        clock: Callable[[], float] = time.time,
        min_remaining: float = 50.0,
    ) -> None:
        self._keys = tuple(keys)
        self._clock = clock
        self._min = min_remaining
        self._lock = threading.Lock()
        # state: ok | low | exhausted | dead
        self._state = ["ok"] * len(self._keys)
        self._until: list[float] = [0.0] * len(self._keys)
        self._remaining: list[float | None] = [None] * len(self._keys)

    def key(self, i: int) -> str:
        return self._keys[i]

    def __len__(self) -> int:
        return len(self._keys)

    def _effective(self, i: int, now: float) -> str:
        if self._state[i] == "exhausted" and now >= self._until[i]:
            self._state[i] = "ok"
            self._remaining[i] = None
        return self._state[i]

    def pick(self, exclude: frozenset[int] | set[int] = frozenset()) -> int | None:
        with self._lock:
            now = self._clock()
            first_low = None
            for i in range(len(self._keys)):
                if i in exclude:
                    continue
                st = self._effective(i, now)
                if st == "ok":
                    return i
                if st == "low" and first_low is None:
                    first_low = i
            return first_low

    def mark_exhausted(self, i: int, renewal: datetime | None) -> None:
        with self._lock:
            now = self._clock()
            self._state[i] = "exhausted"
            self._until[i] = renewal.timestamp() if renewal else _next_month_kst(now)
            self._remaining[i] = 0

    def mark_dead(self, i: int) -> None:
        with self._lock:
            self._state[i] = "dead"

    def set_remaining(self, i: int, remaining: float, renewal: datetime | None) -> None:
        with self._lock:
            if self._state[i] == "dead":
                return
            self._remaining[i] = remaining
            if remaining <= 0:
                self._state[i] = "exhausted"
                self._until[i] = renewal.timestamp() if renewal else _next_month_kst(self._clock())
            elif remaining < self._min:
                self._state[i] = "low"
            else:
                self._state[i] = "ok"

    def available(self) -> bool:
        return self.pick() is not None

    def status(self) -> list[dict[str, Any]]:
        with self._lock:
            now = self._clock()
            return [
                {"index": i + 1, "state": self._effective(i, now), "remaining": self._remaining[i]}
                for i in range(len(self._keys))
            ]

    def indices(self) -> range:
        return range(len(self._keys))

    def is_dead(self, i: int) -> bool:
        with self._lock:
            return self._state[i] == "dead"


def _parse_renewal(value: Any) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        d = datetime.fromisoformat(value)
    except ValueError:
        return None
    return d if d.tzinfo else d.replace(tzinfo=UTC)


class BazeClient:
    def __init__(
        self,
        settings: Settings,
        *,
        http: httpx.Client | None = None,
        clock: Callable[[], float] = time.time,
    ) -> None:
        self._model = settings.baze_voice_model
        self._http = http or httpx.Client(timeout=REQUEST_TIMEOUT)
        self._pool = KeyPool(
            settings.baze_api_keys, clock=clock, min_remaining=settings.baze_min_remaining
        )

    def available(self) -> bool:
        return self._pool.available()

    def status(self) -> list[dict[str, Any]]:
        return self._pool.status()

    def _headers(self, i: int) -> dict[str, str]:
        return {"Authorization": f"Bearer {self._pool.key(i)}", "User-Agent": USER_AGENT}

    def refresh_credits(self) -> None:
        for i in self._pool.indices():
            if self._pool.is_dead(i):
                continue
            try:
                r = self._http.get(
                    f"{BAZE_BASE_URL}/credits/", headers=self._headers(i), timeout=REQUEST_TIMEOUT
                )
                if r.status_code == 401:
                    self._pool.mark_dead(i)
                    continue
                if r.status_code != 200:
                    continue
                data = r.json()
                remaining = float(data["total"]["remaining"])
                renewal = _parse_renewal((data.get("monthly_allocated") or {}).get("renewal_date"))
            except Exception:  # noqa: BLE001 — 잔액 확인 실패는 무시(키·응답 내용 로그 금지)
                continue
            self._pool.set_remaining(i, remaining, renewal)

    def _post(self, i: int, wav: bytes) -> httpx.Response | None:
        body = request_body(wav)
        url = f"{BAZE_BASE_URL}/gemini/v1beta/models/{self._model}:generateContent"
        try:
            return self._http.post(
                url, json=body, headers=self._headers(i), timeout=REQUEST_TIMEOUT
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
        tried: set[int] = set()
        saw_402 = saw_429 = False
        while (i := self._pool.pick(tried)) is not None:
            tried.add(i)
            idx = i + 1
            r = self._post_with_retry(i, wav)
            if r is None:
                return VoiceOutcome("error", key_index=idx)
            if r.status_code == 402:
                self._pool.mark_exhausted(i, None)
                saw_402 = True
                continue
            if r.status_code == 401:
                self._pool.mark_dead(i)
                continue
            if r.status_code == 429:
                saw_429 = True
                continue
            if r.status_code != 200:
                return VoiceOutcome("error", key_index=idx)
            return parse_response(r, idx)
        if saw_429:
            return VoiceOutcome("error")
        if saw_402:
            return VoiceOutcome("exhausted")
        return VoiceOutcome("unavailable")
