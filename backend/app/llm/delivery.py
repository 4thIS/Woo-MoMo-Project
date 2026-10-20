"""벤 답변 전달력 판정 (spec 2026-10-16 2.2). 숫자를 기준표로 판정해 프롬프트 블록을 만든다.

모델이 숫자를 해석하지 않게 서버가 판정한다. 소리·텍스트는 다루지 않는다(숫자만).
"""

from dataclasses import dataclass

MIN_SPEECH_SEC = 5.0
SLOW_BELOW = 250
FAST_ABOVE = 330
PAUSE_FEW_MAX = 1.0
PAUSE_NORMAL_MAX = 2.0
FIRST_WORD_MAX = 3.0
RATIO_HIGH = 1.5
RATIO_LOW = 0.67

FILLER_LABELS = {"low": "적음", "normal": "보통", "high": "잦은 경향"}


@dataclass(frozen=True)
class AnswerMetrics:
    answer: int
    speech_sec: float
    syllables: int
    long_pauses: int
    longest_pause_sec: float
    first_word_sec: float
    filler_level: str | None


def _per_minute(m: AnswerMetrics) -> int:
    return round(m.syllables / m.speech_sec * 60)


def _pause_rate(m: AnswerMetrics) -> float:
    return m.long_pauses / max(m.speech_sec / 60, 0.5)


def _speed(spm: int) -> str:
    if spm < SLOW_BELOW:
        return "느림"
    return "빠름" if spm > FAST_ABOVE else "보통"


def _pause(rate: float) -> str:
    if rate <= PAUSE_FEW_MAX:
        return "적음"
    return "보통" if rate <= PAUSE_NORMAL_MAX else "잦음"


def _far(ratio: float) -> bool:
    return ratio >= RATIO_HIGH or ratio <= RATIO_LOW


def _line(m: AnswerMetrics, base: AnswerMetrics | None) -> str:
    if m.speech_sec < MIN_SPEECH_SEC:
        return f"답변 {m.answer}: 측정 부족(말한 시간 5초 미만)"
    if m.syllables == 0:  # 말소리는 있는데 받아쓰기가 빔 — "느림"이 아니라 측정 실패
        return f"답변 {m.answer}: 측정 부족(받아쓴 음절 없음)"
    spm = _per_minute(m)
    rate = _pause_rate(m)
    first = "보통" if m.first_word_sec <= FIRST_WORD_MAX else "망설임 긺"
    parts = [
        f"분당 {spm}음절({_speed(spm)})",
        f"2초 이상 쉼 {m.long_pauses}회·말한 1분당 {rate:.1f}회({_pause(round(rate, 1))})",
        f"가장 긴 쉼 {m.longest_pause_sec:.1f}초",
        f"첫마디까지 {m.first_word_sec:.1f}초({first})",
    ]
    if m.filler_level is not None:
        parts.append(f"군말 {FILLER_LABELS[m.filler_level]}")
    if base is not None and base.answer != m.answer:
        notes = []
        speed_ratio = spm / _per_minute(base)
        if _far(speed_ratio):
            notes.append(f"말 속도 {speed_ratio:.1f}배")
        base_rate = _pause_rate(base)
        if base_rate > 0 and rate > 0 and _far(rate / base_rate):
            notes.append(f"쉼 {rate / base_rate:.1f}배")
        if notes:
            parts.append("기준 대비 " + "·".join(notes))
    return f"답변 {m.answer}: " + ", ".join(parts)


def render(metrics: list[AnswerMetrics]) -> str | None:
    """측정 블록. 1번 답변(자기소개)이 충분히 측정됐으면 그것을 개인 기준으로 쓴다."""
    if not metrics:
        return None
    ordered = sorted(metrics, key=lambda x: x.answer)
    first = ordered[0]
    base = (
        first
        if first.answer == 1 and first.speech_sec >= MIN_SPEECH_SEC and _per_minute(first) > 0
        else None
    )
    return "\n".join(["[답변별 전달력 측정]", *(_line(m, base) for m in ordered)])
