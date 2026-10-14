"""테스트용 가짜 — 시계(요청 수 제한·세션 만료·하루 상한)."""


class FakeClock:
    def __init__(self, start: float = 1_760_000_000.0) -> None:
        self.now = start

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds
