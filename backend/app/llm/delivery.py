"""벤 답변 전달력 판정 (spec 2026-10-16 2.2). 숫자를 기준표로 판정해 프롬프트 블록을 만든다.

모델이 숫자를 해석하지 않게 서버가 판정한다. 소리·텍스트는 다루지 않는다(숫자만).

목소리 분석(BAZE, spec 2026-10-23 3.4)이 있는 답변은 `with_voice`로 합친다.
- 음절 수 <- 받아쓰기(transcript)의 한글 음절(U+AC00..U+D7A3) 수
- 군말 판정 <- fillers.count를 말한 1분당(max(speechSec/60, 0.5))으로 나눠 기준표 적용.
  "잦은 경향"이면 예시를 최대 3개 `(예: 음, 어, 그)`로 덧붙인다(1~6자 한글만).
- 한글 음절이 없는 받아쓰기는 합치지 않는다(브라우저 숫자·판정 유지, 목소리 줄 없음).
- 줄 끝(측정 부족 줄에는 붙이지 않는다):
  `, 목소리: 자신감 {..}·어조 {..}·떨림 {..}·끝 흐려짐 {..}·발음 {..} (근거: 자신감 {이유}
  / 어조 {이유} / 떨림 {이유} / 끝 흐려짐 {이유} / 발음 {이유})`
  이유는 `[]()`를 지우고 공백으로 접어 60자로 자르며, 빈 이유는 항목째 뺀다.
받아쓰기·이유는 로그에 남기지 않는다.
"""

from dataclasses import dataclass, replace

from app.llm.baze import VoiceResult

MIN_SPEECH_SEC = 5.0
SLOW_BELOW = 250
FAST_ABOVE = 330
PAUSE_FEW_MAX = 1.0
PAUSE_NORMAL_MAX = 2.0
FIRST_WORD_MAX = 3.0
RATIO_HIGH = 1.5
RATIO_LOW = 0.67

FILLER_LABELS = {"low": "적음", "normal": "보통", "high": "잦은 경향"}
FILLER_FEW_MAX = 2
FILLER_NORMAL_MAX = 5
FILLER_EXAMPLES_MAX = 3
REASON_MAX = 60
EXAMPLE_MAX_LEN = 6
_STRUCTURAL = str.maketrans("", "", "[]()")  # 블록의 구조 문자

CONFIDENCE_LABELS = {"high": "높음", "mid": "보통", "low": "낮음"}
TONE_LABELS = {"calm": "차분", "tense": "긴장", "monotone": "단조"}
CLARITY_LABELS = {"good": "좋음", "ok": "보통", "poor": "낮음"}


@dataclass(frozen=True)
class AnswerMetrics:
    answer: int
    speech_sec: float
    syllables: int
    long_pauses: int
    longest_pause_sec: float
    first_word_sec: float
    filler_level: str | None
    voice: VoiceResult | None = None
    filler_count: int | None = None  # 목소리 분석의 군말 수(있으면 filler_level 대신 쓴다)
    filler_examples: tuple[str, ...] = ()


def count_syllables(text: str) -> int:
    return sum(1 for ch in text if "가" <= ch <= "힣")


def with_voice(m: AnswerMetrics, voice: VoiceResult | None) -> AnswerMetrics:
    """목소리 분석 결과를 합친다. 없으면 그대로."""
    if voice is None or count_syllables(voice.transcript) == 0:
        return m  # 한글 없는 받아쓰기는 믿지 않는다 - 브라우저 숫자·군말 판정을 그대로 쓴다
    return replace(
        m,
        syllables=count_syllables(voice.transcript),
        voice=voice,
        filler_count=voice.fillers.count,
        filler_examples=tuple(voice.fillers.examples),
    )


def _measurable(m: AnswerMetrics) -> bool:
    return m.speech_sec >= MIN_SPEECH_SEC and m.syllables > 0


def voice_used(metrics: list[AnswerMetrics]) -> bool:
    """목소리 줄이 실제로 블록에 들어가는 답변이 하나라도 있는가."""
    return any(m.voice is not None and _measurable(m) for m in metrics)


def _filler_text(m: AnswerMetrics) -> str | None:
    if m.filler_count is None:
        return None if m.filler_level is None else FILLER_LABELS[m.filler_level]
    per_min = m.filler_count / max(m.speech_sec / 60, 0.5)
    if per_min <= FILLER_FEW_MAX:
        return FILLER_LABELS["low"]
    if per_min <= FILLER_NORMAL_MAX:
        return FILLER_LABELS["normal"]
    examples = [e for e in map(_example, m.filler_examples) if e][:FILLER_EXAMPLES_MAX]
    label = FILLER_LABELS["high"]
    return f"{label}(예: {', '.join(examples)})" if examples else label


def _reason(text: str) -> str:
    folded = " ".join(text.translate(_STRUCTURAL).split())
    return folded[:REASON_MAX]


def _example(text: str) -> str | None:
    """군말 예시는 1~6자 한글만 프롬프트로 보낸다(모델 출력이 그대로 들어가므로)."""
    folded = " ".join(text.split())
    ok = 1 <= len(folded) <= EXAMPLE_MAX_LEN and all(
        "가" <= ch <= "힣" or "ㄱ" <= ch <= "ㆎ" for ch in folded
    )
    return folded if ok else None


def _voice_part(v: VoiceResult) -> str:
    yes = {True: "있음", False: "없음"}
    labels = (
        f"자신감 {CONFIDENCE_LABELS[v.confidence.level]}"
        f"·어조 {TONE_LABELS[v.tone.level]}"
        f"·떨림 {yes[v.tremor.present]}"
        f"·끝 흐려짐 {yes[v.trailingOff.present]}"
        f"·발음 {CLARITY_LABELS[v.clarity.level]}"
    )
    reasons = [
        f"{name} {_reason(r)}"
        for name, r in (
            ("자신감", v.confidence.reason),
            ("어조", v.tone.reason),
            ("떨림", v.tremor.reason),
            ("끝 흐려짐", v.trailingOff.reason),
            ("발음", v.clarity.reason),
        )
        if _reason(r)
    ]
    tail = f" (근거: {' / '.join(reasons)})" if reasons else ""
    return f"목소리: {labels}{tail}"


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
    filler = _filler_text(m)
    if filler is not None:
        parts.append(f"군말 {filler}")
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
    if m.voice is not None:
        parts.append(_voice_part(m.voice))
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
