"""벤의 Claude 호출 (spec 4.4). 라우터는 ClaudeClient만 알고, 테스트는 가짜를 넣는다."""

from collections.abc import Iterator
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
    ) -> Iterator[str]: ...

    def research(
        self, *, system: str, messages: list[dict[str, Any]], max_tokens: int
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

    def research(
        self, *, system: str, messages: list[dict[str, Any]], max_tokens: int
    ) -> ResearchResult:
        """웹 검색 서버 도구로 조사한다. 본문은 text 블록, 출처는 검색 결과 블록에서 모은다."""
        convo = list(messages)
        texts: list[str] = []
        sources: list[dict[str, str]] = []
        seen: set[str] = set()
        try:
            for _ in range(MAX_CONTINUATIONS + 1):
                resp = self._sdk.messages.create(
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
                if resp.stop_reason == "refusal":
                    raise ClaudeError("refused")
                for block in resp.content:
                    if block.type == "text":
                        texts.append(block.text)
                    elif block.type == "web_search_tool_result" and isinstance(block.content, list):
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
            raise ClaudeError("claude_error") from exc
        return ResearchResult(text="".join(texts), sources=sources)
