"""벤의 Claude 호출 (spec 4.4). 라우터는 ClaudeClient만 알고, 테스트는 가짜를 넣는다."""

import logging
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from typing import Any, Literal, Protocol

import anthropic

MODEL = "claude-sonnet-5-5"
BRIEFING_MODEL = "claude-haiku-5-5"  # 회사 브리핑 요약(spec 2026-11-08) — 빠르고 싸다
TURN_MAX_TOKENS = 4096
REPORT_MAX_TOKENS = 16000
FALLBACK_BETA = "server-side-fallback-2026-07-01"

Effort = Literal["low", "medium"]


@dataclass(frozen=True)
class Usage:
    """호출 한 번의 토큰·웹 검색 사용량. 본문은 담지 않는다."""

    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0
    web_searches: int = 0

    def __add__(self, other: "Usage") -> "Usage":
        return Usage(
            self.input_tokens + other.input_tokens,
            self.output_tokens + other.output_tokens,
            self.cache_read_tokens + other.cache_read_tokens,
            self.cache_write_tokens + other.cache_write_tokens,
            self.web_searches + other.web_searches,
        )


# (사용량, 결과) — 결과는 ok | error | refused
UsageSink = Callable[[Usage, str], None]


def _usage_of(message: Any) -> Usage:
    """SDK 응답의 usage를 Usage로. 없거나 None인 칸은 0."""
    raw = getattr(message, "usage", None)
    if raw is None:
        return Usage()
    server = getattr(raw, "server_tool_use", None)
    return Usage(
        input_tokens=getattr(raw, "input_tokens", None) or 0,
        output_tokens=getattr(raw, "output_tokens", None) or 0,
        cache_read_tokens=getattr(raw, "cache_read_input_tokens", None) or 0,
        cache_write_tokens=getattr(raw, "cache_creation_input_tokens", None) or 0,
        web_searches=getattr(server, "web_search_requests", None) or 0,
    )


def _report(on_usage: UsageSink | None, usage: Usage, outcome: str) -> None:
    """기록 실패가 면접을 막지 않게 콜백 예외는 삼킨다."""
    if on_usage is None:
        return
    try:
        on_usage(usage, outcome)
    except Exception as exc:
        logging.getLogger(__name__).warning("claude usage record failed: %s", type(exc).__name__)


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
        on_usage: UsageSink | None = None,
        output_format: dict[str, Any] | None = None,
    ) -> Iterator[str]: ...

    def complete(
        self,
        *,
        system: str,
        messages: list[dict[str, Any]],
        model: str,
        max_tokens: int,
        timeout: float,
        on_usage: UsageSink | None = None,
    ) -> str: ...


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
        on_usage: UsageSink | None = None,
        output_format: dict[str, Any] | None = None,
    ) -> Iterator[str]:
        output_config: dict[str, Any] = {"effort": effort}
        if output_format is not None:
            # 구조화 출력: 스키마에 맞는 JSON만 나오게 한다
            output_config["format"] = {"type": "json_schema", "schema": output_format}
        try:
            with self._sdk.messages.stream(
                model=MODEL,
                max_tokens=max_tokens,
                system=system,
                messages=messages,
                output_config=output_config,
                # 안전 분류기 거절 시 서버 측 폴백. SDK 타입에 아직 없을 수 있어
                # 본문·헤더로 그대로 보낸다(fallbacks "default" + 베타 헤더).
                extra_body={"fallbacks": "default"},
                extra_headers={"anthropic-beta": FALLBACK_BETA},
            ) as stream:
                yield from stream.text_stream
                final = stream.get_final_message()
        except anthropic.APIError as exc:
            _report(on_usage, Usage(), "error")
            raise ClaudeError("claude_error") from exc
        refused = final.stop_reason == "refusal"
        _report(on_usage, _usage_of(final), "refused" if refused else "ok")
        if refused:
            raise ClaudeError("refused")
        if output_format is not None and final.stop_reason == "max_tokens":
            # 구조화 출력이 잘리면 JSON이 닫히지 않는다 — 다시 만들어도 같으니 재생성하지 않는다
            raise ClaudeError("too_long")

    def complete(
        self,
        *,
        system: str,
        messages: list[dict[str, Any]],
        model: str,
        max_tokens: int,
        timeout: float,
        on_usage: UsageSink | None = None,
    ) -> str:
        """도구 없이 한 번 부른다. 재시도 없음 — 늦으면 기한 안에서 포기하는 편이 낫다."""
        try:
            resp = self._sdk.with_options(max_retries=0).messages.create(
                model=model,
                max_tokens=max_tokens,
                system=system,
                messages=messages,
                timeout=timeout,
            )
        except anthropic.APIError as exc:
            _report(on_usage, Usage(), "error")
            raise ClaudeError("claude_error") from exc
        used = _usage_of(resp)
        if resp.stop_reason == "refusal":
            _report(on_usage, used, "refused")
            raise ClaudeError("refused")
        _report(on_usage, used, "ok")
        return "".join(b.text for b in resp.content if getattr(b, "type", "") == "text")
