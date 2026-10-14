"""테스트용 가짜 — 시계(요청 수 제한·세션 만료·하루 상한)와 Claude."""

from collections.abc import Iterator
from typing import Any

DEFAULT_REPLY = ["자기소개를 ", "해 주세요."]


class FakeClock:
    def __init__(self, start: float = 1_760_000_000.0) -> None:
        self.now = start

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


class FakeClaude:
    """replies에 넣은 순서대로 조각을 흘린다. 항목이 예외면 그 자리에서 던진다."""

    def __init__(self) -> None:
        self.replies: list[list[Any]] = []
        self.calls: list[dict[str, Any]] = []

    def stream_text(
        self,
        *,
        system: list[dict[str, Any]],
        messages: list[dict[str, Any]],
        effort: str,
        max_tokens: int,
    ) -> Iterator[str]:
        self.calls.append(
            {"system": system, "messages": messages, "effort": effort, "max_tokens": max_tokens}
        )
        reply = self.replies.pop(0) if self.replies else list(DEFAULT_REPLY)
        for item in reply:
            if isinstance(item, Exception):
                raise item
            yield item
