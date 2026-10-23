"""테스트용 가짜 — 시계(요청 수 제한·세션 만료·하루 상한)와 Claude."""

from collections.abc import Iterator
from typing import Any

from app.llm.claude import ClaudeError, ResearchResult, Usage, UsageSink

DEFAULT_REPLY = ["자기소개를 ", "해 주세요."]
DEFAULT_BRIEFING = (
    "토스(비바리퍼블리카)는 간편송금으로 시작해 결제·증권·은행으로 넓힌 금융 플랫폼이다. "
    "최근 소식: 2026년 토스증권 해외주식 거래량이 늘었고, 토스페이먼츠가 오프라인 결제 단말을 냈다. "
    "기술·제품: 코틀린·스프링 기반 마이크로서비스, 대용량 트래픽 결제 시스템, 내부 데이터 플랫폼을 운영한다. "
    "인재상: 높은 자율과 책임, 빠른 실행, 사용자 문제를 숫자로 확인하는 사람을 찾는다. "
    "백엔드 직무는 결제 안정성과 장애 대응 경험을 중요하게 본다."
)
DEFAULT_SOURCES = [{"title": "토스 기술 블로그", "url": "https://toss.tech"}]


class FakeClock:
    def __init__(self, start: float = 1_760_000_000.0) -> None:
        self.now = start

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


class FakeClaude:
    """replies에 넣은 순서대로 조각을 흘린다. 항목이 예외면 그 자리에서 던진다."""

    def __init__(self, usage: Usage | None = None) -> None:
        self.usage = usage or Usage(input_tokens=100, output_tokens=20)
        self.replies: list[list[Any]] = []
        self.calls: list[dict[str, Any]] = []
        self.research_results: list[Any] = []
        self.research_calls: list[dict[str, Any]] = []

    def stream_text(
        self,
        *,
        system: list[dict[str, Any]],
        messages: list[dict[str, Any]],
        effort: str,
        max_tokens: int,
        on_usage: UsageSink | None = None,
    ) -> Iterator[str]:
        self.calls.append(
            {"system": system, "messages": messages, "effort": effort, "max_tokens": max_tokens}
        )
        reply = self.replies.pop(0) if self.replies else list(DEFAULT_REPLY)
        for item in reply:
            if isinstance(item, Exception):
                self._report(on_usage, item)
                raise item
            yield item
        if on_usage is not None:
            on_usage(self.usage, "ok")

    def _report(self, on_usage: UsageSink | None, error: Exception) -> None:
        if on_usage is not None:
            refused = isinstance(error, ClaudeError) and error.code == "refused"
            on_usage(Usage(), "refused" if refused else "error")

    def research(
        self,
        *,
        system: str,
        messages: list[dict[str, Any]],
        max_tokens: int,
        on_usage: UsageSink | None = None,
        fetch_domains: list[str] | None = None,
    ) -> ResearchResult:
        self.research_calls.append(
            {
                "system": system,
                "messages": messages,
                "max_tokens": max_tokens,
                "fetch_domains": fetch_domains,
            }
        )
        item = (
            self.research_results.pop(0)
            if self.research_results
            else ResearchResult(text=DEFAULT_BRIEFING, sources=list(DEFAULT_SOURCES))
        )
        if isinstance(item, Exception):
            self._report(on_usage, item)
            raise item
        if on_usage is not None:
            on_usage(self.usage, "ok")
        return item
