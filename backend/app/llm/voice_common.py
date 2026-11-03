"""목소리 분석 공통 부분 — BAZE·Gemini 직접 호출이 함께 쓴다 (spec 2026-11-03 3절).

요청 본문(녹음 + 지시문 + 응답 스키마)과 응답 형식은 Gemini generateContent 그대로다.
"""

import base64
import json
from dataclasses import dataclass
from typing import Any, Literal, Protocol

import httpx
from pydantic import BaseModel, Field, ValidationError

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


class StoredVoice(BaseModel):
    """DB에 두는 목소리 결과 - 받아쓰기 본문은 버리고 한글 음절 수만 남긴다(데이터 최소화)."""

    syllables: int = Field(ge=0)
    fillers: Fillers
    confidence: Confidence
    tone: Tone
    tremor: Flag
    trailingOff: Flag
    clarity: Clarity

    @classmethod
    def from_result(cls, result: VoiceResult, syllables: int) -> "StoredVoice":
        data = result.model_dump(exclude={"transcript"})
        return cls(syllables=syllables, **data)


Outcome = Literal["ok", "error", "exhausted", "unavailable", "bad_output"]


@dataclass(frozen=True)
class VoiceOutcome:
    outcome: Outcome
    result: VoiceResult | None = None
    key_index: int | None = None  # 1부터
    input_tokens: int = 0
    output_tokens: int = 0


class VoiceAnalyzer(Protocol):
    """라우터·앱이 보는 목소리 분석 면(BazeClient·GeminiClient·테스트 대역이 같이 만족한다)."""

    def available(self) -> bool: ...

    def refresh_credits(self) -> None: ...

    def analyze(self, wav: bytes) -> VoiceOutcome: ...


def request_body(wav: bytes) -> dict[str, Any]:
    return {
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


def parse_response(r: httpx.Response, idx: int) -> VoiceOutcome:
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
        parts = data["candidates"][0]["content"]["parts"]
        # 생각(thought) 파트는 건너뛰고 나머지 text를 이어 붙인다
        text = "".join(p["text"] for p in parts if p.get("thought") is not True and "text" in p)
        result = VoiceResult.model_validate(json.loads(text))
    except (KeyError, IndexError, TypeError, ValueError, ValidationError):
        return VoiceOutcome("bad_output", key_index=idx, input_tokens=tin, output_tokens=tout)
    return VoiceOutcome("ok", result=result, key_index=idx, input_tokens=tin, output_tokens=tout)
