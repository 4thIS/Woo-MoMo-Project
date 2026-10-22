"""벤의 Claude 호출 (spec 4.4). 라우터는 ClaudeClient만 알고, 테스트는 가짜를 넣는다."""

import logging
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from typing import Any, Literal, Protocol

import anthropic

MODEL = "claude-sonnet-5-5"
TURN_MAX_TOKENS = 4096
REPORT_MAX_TOKENS = 16000
FALLBACK_BETA = "server-side-fallback-2026-07-01"
RESEARCH_TIMEOUT = 60.0
# 서버 쪽 검색 반복이 길어 pause_turn으로 멈추면 이어 받는다 — 무한 반복 방지 상한
MAX_CONTINUATIONS = 2
WEB_SEARCH_TOOL = {"type": "web_search_20260209", "name": "web_search", "max_uses": 5}

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


@dataclass(frozen=True)
class ResearchResult:
    text: str
    sources: list[dict[str, str]]


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
    ) -> Iterator[str]: ...

    def research(
        self,
        *,
        system: str,
        messages: list[dict[str, Any]],
        max_tokens: int,
        on_usage: UsageSink | None = None,
    ) -> ResearchResult: ...


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
            _report(on_usage, Usage(), "error")
            raise ClaudeError("claude_error") from exc
        refused = final.stop_reason == "refusal"
        _report(on_usage, _usage_of(final), "refused" if refused else "ok")
        if refused:
            raise ClaudeError("refused")

    def research(
        self,
        *,
        system: str,
        messages: list[dict[str, Any]],
        max_tokens: int,
        on_usage: UsageSink | None = None,
    ) -> ResearchResult:
        """웹 검색 서버 도구로 조사한다. 본문은 text 블록, 출처는 검색 결과 블록에서 모은다."""
        convo = list(messages)
        texts: list[str] = []
        # 첫 검색 전의 머리말 후보. 첫 server_tool_use가 오면 버리고,
        # 검색이 한 번도 없으면 본문으로 남긴다. 상태는 pause_turn 이어 받기에도 이어진다.
        preamble: list[str] = []
        searched = False
        sources: list[dict[str, str]] = []
        seen: set[str] = set()
        total = Usage()
        try:
            for _ in range(MAX_CONTINUATIONS + 1):
                # 재시도 끝: 90초 기한 안에서 조사가 여러 번 도는 것을 막는다
                resp = self._sdk.with_options(max_retries=0).messages.create(
                    model=MODEL,
                    max_tokens=max_tokens,
                    system=system,
                    messages=convo,
                    tools=[WEB_SEARCH_TOOL],
                    output_config={"effort": "medium"},
                    extra_body={"fallbacks": "default"},
                    extra_headers={"anthropic-beta": FALLBACK_BETA},
                    timeout=RESEARCH_TIMEOUT,
                )
                total += _usage_of(resp)
                if resp.stop_reason == "refusal":
                    _report(on_usage, total, "refused")
                    raise ClaudeError("refused")
                for block in resp.content:
                    if block.type == "text":
                        (texts if searched else preamble).append(block.text)
                        continue
                    if block.type == "server_tool_use" and not searched:
                        # 첫 검색 전 서술("검색해 보겠습니다")만 버린다
                        preamble.clear()
                        searched = True
                    if block.type == "web_search_tool_result" and isinstance(block.content, list):
                        # 검색 오류는 예외가 아니라 content가 오류 객체(리스트 아님)로 온다
                        for result in block.content:
                            url = getattr(result, "url", None)
                            if url and url not in seen:
                                seen.add(url)
                                sources.append(
                                    {"title": getattr(result, "title", "") or url, "url": url}
                                )
                if resp.stop_reason != "pause_turn":
                    break
                convo = [*convo, {"role": "assistant", "content": resp.content}]
        except anthropic.APIError as exc:
            _report(on_usage, total, "error")
            raise ClaudeError("claude_error") from exc
        _report(on_usage, total, "ok")
        texts.extend(preamble)  # 검색이 한 번도 없었다면 머리말도 본문이다
        return ResearchResult(text="".join(texts), sources=sources)
