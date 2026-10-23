"""BAZE(학교 AI 게이트웨이) 클라이언트 — 키 풀 + Gemini 오디오 분석.

키 값은 로그·상태·예외에 남기지 않는다(순번 1부터만). 상태는 메모리·잠금 보호.
"""

import base64
import json
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta, timezone
from typing import Any, Literal

import httpx
from pydantic import BaseModel, Field, ValidationError

from app.config import Settings

BAZE_BASE_URL = "https://factchat-cloud.mindlogic.ai/v1/gateway"
USER_AGENT = "woo-momo/1.0"
REQUEST_TIMEOUT = 60.0
KST = timezone(timedelta(hours=9))

VOICE_INSTRUCTION = (
    "이 녹음은 한국어 모의면접 답변입니다. 답변 내용의 좋고 나쁨은 평가하지 말고, "
    "목소리와 전달 방식만 평가하세요. transcript는 고치거나 다듬지 말고 "
    "음·어·그 같은 군말까지 들리는 그대로 적으세요. 각 항목의 reason은 "
    "녹음에서 실제로 들린 것만 근거로 짧게 쓰세요."
)

_REASON = {"type": "STRING"}


def _level(values: list[str]) -> dict[str, Any]:
    return {
        "type": "OBJECT",
        "properties": {"level": {"type": "STRING", "enum": values}, "reason": _REASON},
        "required": ["level", "reason"],
    }


def _flag() -> dict[str, Any]:
    return {
        "type": "OBJECT",
        "properties": {"present": {"type": "BOOLEAN"}, "reason": _REASON},
        "required": ["present", "reason"],
    }


VOICE_SCHEMA: dict[str, Any] = {
    "type": "OBJECT",
    "properties": {
        "transcript": {"type": "STRING"},
        "fillers": {
            "type": "OBJECT",
            "properties": {
                "count": {"type": "INTEGER"},
                "examples": {"type": "ARRAY", "items": {"type": "STRING"}},
            },
            "required": ["count", "examples"],
        },
        "confidence": _level(["high", "mid", "low"]),
        "tone": _level(["calm", "tense", "monotone"]),
        "tremor": _flag(),
        "trailingOff": _flag(),
        "clarity": _level(["good", "ok", "poor"]),
    },
    "required": [
        "transcript",
        "fillers",
        "confidence",
        "tone",
        "tremor",
        "trailingOff",
        "clarity",
    ],
}


class Fillers(BaseModel):
    count: int = Field(ge=0)
    examples: list[str]


class Confidence(BaseModel):
    level: Literal["high", "mid", "low"]
    reason: str


class Tone(BaseModel):
    level: Literal["calm", "tense", "monotone"]
    reason: str


class Flag(BaseModel):
    present: bool
    reason: str


class Clarity(BaseModel):
    level: Literal["good", "ok", "poor"]
    reason: str


class VoiceResult(BaseModel):
    transcript: str
    fillers: Fillers
    confidence: Confidence
    tone: Tone
    tremor: Flag
    trailingOff: Flag
    clarity: Clarity


Outcome = Literal["ok", "error", "exhausted", "unavailable", "bad_output"]


@dataclass(frozen=True)
class VoiceOutcome:
    outcome: Outcome
    result: VoiceResult | None = None
    key_index: int | None = None  # 1부터
    input_tokens: int = 0
    output_tokens: int = 0


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
        body = {
            "contents": [
                {
                    "parts": [
                        {
                            "inline_data": {
                                "mime_type": "audio/wav",
                                "data": base64.b64encode(wav).decode("ascii"),
                            }
                        },
                        {"text": VOICE_INSTRUCTION},
                    ]
                }
            ],
            "generationConfig": {
                "responseMimeType": "application/json",
                "responseSchema": VOICE_SCHEMA,
            },
        }
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
            return self._parse(r, idx)
        if saw_429:
            return VoiceOutcome("error")
        if saw_402:
            return VoiceOutcome("exhausted")
        return VoiceOutcome("unavailable")

    @staticmethod
    def _parse(r: httpx.Response, idx: int) -> VoiceOutcome:
        try:
            data = r.json()
            usage = data.get("usageMetadata") or {}
            tin = int(usage.get("promptTokenCount") or 0)
            tout = int(usage.get("candidatesTokenCount") or 0) + int(
                usage.get("thoughtsTokenCount") or 0
            )
        except (ValueError, TypeError, AttributeError):
            return VoiceOutcome("bad_output", key_index=idx)
        try:
            text = data["candidates"][0]["content"]["parts"][0]["text"]
            result = VoiceResult.model_validate(json.loads(text))
        except (KeyError, IndexError, TypeError, ValueError, ValidationError):
            return VoiceOutcome("bad_output", key_index=idx, input_tokens=tin, output_tokens=tout)
        return VoiceOutcome(
            "ok", result=result, key_index=idx, input_tokens=tin, output_tokens=tout
        )
