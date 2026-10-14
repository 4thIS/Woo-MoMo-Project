"""벤의 Claude 호출 (spec 4.4). 라우터는 ClaudeClient만 알고, 테스트는 가짜를 넣는다."""

from collections.abc import Iterator
from typing import Any, Literal, Protocol

import anthropic

MODEL = "claude-sonnet-5-5"
TURN_MAX_TOKENS = 4096
REPORT_MAX_TOKENS = 16000
FALLBACK_BETA = "server-side-fallback-2026-07-01"

Effort = Literal["low", "medium"]


class ClaudeError(Exception):
    """호출 실패(claude_error) 또는 안전 분류기 거절(refused)."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


class ClaudeClient(Protocol):
    def stream_text(
        self,
        *,
        system: list[dict[str, Any]],
        messages: list[dict[str, Any]],
        effort: Effort,
        max_tokens: int,
    ) -> Iterator[str]: ...


class AnthropicClaude:
    """공식 SDK 스트리밍. 키는 ANTHROPIC_API_KEY(서버 .env)."""

    def __init__(self, api_key: str | None = None, *, sdk: Any = None) -> None:
        self._sdk = sdk if sdk is not None else anthropic.Anthropic(api_key=api_key)

    def stream_text(
        self,
        *,
        system: list[dict[str, Any]],
        messages: list[dict[str, Any]],
        effort: Effort,
        max_tokens: int,
    ) -> Iterator[str]:
        try:
            with self._sdk.messages.stream(
                model=MODEL,
                max_tokens=max_tokens,
                system=system,
                messages=messages,
                output_config={"effort": effort},
                # 안전 분류기 거절 시 서버 측 폴백. SDK 타입에 아직 없을 수 있어
                # 본문·헤더로 그대로 보낸다(fallbacks "default" + 베타 헤더).
                extra_body={"fallbacks": "default"},
                extra_headers={"anthropic-beta": FALLBACK_BETA},
            ) as stream:
                yield from stream.text_stream
                final = stream.get_final_message()
        except anthropic.APIError as exc:
            raise ClaudeError("claude_error") from exc
        if final.stop_reason == "refusal":
            raise ClaudeError("refused")
