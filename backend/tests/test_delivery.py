import pytest

from app.llm.delivery import AnswerMetrics, render


def m(answer, speech=60.0, syl=300, pauses=1, longest=2.5, first=1.5, filler="normal"):
    return AnswerMetrics(
        answer=answer,
        speech_sec=speech,
        syllables=syl,
        long_pauses=pauses,
        longest_pause_sec=longest,
        first_word_sec=first,
        filler_level=filler,
    )


def test_empty_is_none():
    assert render([]) is None


def test_one_normal_answer_line():
    assert render([m(1)]) == (
        "[답변별 전달력 측정]\n"
        "답변 1: 분당 300음절(보통), 2초 이상 쉼 1회·말한 1분당 1.0회(적음), "
        "가장 긴 쉼 2.5초, 첫마디까지 1.5초(보통), 군말 보통"
    )


def test_speed_boundaries():
    lines = render([m(1, syl=249), m(2, syl=250), m(3, syl=330), m(4, syl=331)]).splitlines()
    assert "(느림)" in lines[1] and "(보통)" in lines[2]
    assert "분당 330음절(보통)" in lines[3] and "(빠름)" in lines[4]


def test_pause_rate_uses_at_least_half_a_minute():
    # 20초 말하고 2번 쉼 → 2 / max(0.33, 0.5) = 4.0회/분
    line = render([m(1, speech=20.0, syl=100, pauses=2)]).splitlines()[1]
    assert "말한 1분당 4.0회(잦음)" in line
    line = render([m(1, speech=60.0, pauses=2)]).splitlines()[1]
    assert "말한 1분당 2.0회(보통)" in line


def test_first_word_and_filler_labels():
    line = render([m(1, first=3.1, filler="high")]).splitlines()[1]
    assert "첫마디까지 3.1초(망설임 긺)" in line and line.endswith("군말 잦은 경향")
    assert render([m(1, filler="low")]).splitlines()[1].endswith("군말 적음")
    assert "군말" not in render([m(1, filler=None)]).splitlines()[1]


def test_too_short_is_insufficient():
    assert render([m(2, speech=4.9)]).splitlines()[1] == "답변 2: 측정 부족(말한 시간 5초 미만)"


def test_baseline_ratios_against_answer_1():
    # 기준: 300음절/분, 1.0회/분 → 답변 2: 480음절/분(1.6배), 3.0회/분(3.0배)
    lines = render([m(1), m(2, syl=480, pauses=3)]).splitlines()
    assert lines[2].endswith(", 기준 대비 말 속도 1.6배·쉼 3.0배")
    # 0.67배 이하도 표시, 사이는 표시 안 함
    lines = render([m(1), m(2, syl=180), m(3, syl=330)]).splitlines()
    assert lines[2].endswith("기준 대비 말 속도 0.6배")
    assert "기준 대비" not in lines[3]


def test_no_baseline_when_answer_1_missing_or_short_or_zero_pauses():
    assert "기준 대비" not in render([m(2, syl=600)])
    assert "기준 대비" not in render([m(1, speech=3.0), m(2, syl=600)])
    # 기준 쉼이 0이면 쉼 비율은 계산하지 않는다(말 속도는 같으므로 비교 문구 없음)
    lines = render([m(1, pauses=0), m(2, pauses=5)]).splitlines()
    assert "기준 대비" not in lines[2]


def test_lines_are_sorted_by_answer():
    lines = render([m(3), m(1)]).splitlines()
    assert lines[1].startswith("답변 1:") and lines[2].startswith("답변 3:")


def test_baseline_that_rounds_to_zero_speed_is_not_used():
    # 600초에 4음절 → 분당 0음절로 반올림. 0으로 나누지 않고 기준 비교만 생략한다.
    text = render([m(1, speech=600.0, syl=4), m(2)])
    assert "기준 대비" not in text


def test_pause_label_agrees_with_the_displayed_rate():
    # 26회 / 25분 = 1.04 → 표시 1.0회이므로 라벨도 "적음"
    line = render([m(1, speech=1500.0, syl=7500, pauses=26)]).splitlines()[1]
    assert "말한 1분당 1.0회(적음)" in line


def test_zero_pause_answer_has_no_pause_ratio_note():
    lines = render([m(1), m(2, pauses=0)]).splitlines()
    assert "쉼 0.0배" not in lines[2]
    assert "기준 대비" not in lines[2]


def test_no_syllables_is_insufficient_not_slow():
    # 말소리는 있는데 받아쓰기가 비면(인식 실패·소음) 측정 실패로 본다 — "느림"으로 지적하지 않는다
    lines = render([m(1), m(2, speech=20.0, syl=0)]).splitlines()
    assert lines[2] == "답변 2: 측정 부족(받아쓴 음절 없음)"
    assert "기준 대비" not in lines[2]


# ── 목소리 분석 합치기 (spec 2026-10-23 3.4) ──

from app.llm.baze import VoiceResult  # noqa: E402
from app.llm.delivery import count_syllables, voice_used, with_voice  # noqa: E402


def vr(transcript="가" * 300, count=3, examples=("음",), **over):
    data = {
        "transcript": transcript,
        "fillers": {"count": count, "examples": list(examples)},
        "confidence": {"level": "high", "reason": "또박또박"},
        "tone": {"level": "calm", "reason": "일정함"},
        "tremor": {"present": False, "reason": "떨림 없음"},
        "trailingOff": {"present": True, "reason": "끝이 작아짐"},
        "clarity": {"level": "ok", "reason": "대체로 또렷"},
    }
    data.update(over)
    return VoiceResult.model_validate(data)


def test_count_syllables_counts_only_hangul():
    assert count_syllables("안녕, hello 123 하세요!") == 5
    assert count_syllables("") == 0
    assert count_syllables("ㄱㅏ") == 0  # 자모는 음절이 아니다


def test_without_voice_block_is_unchanged():
    assert render([m(1, syl=300)]) == render([with_voice(m(1, syl=300), None)])
    assert voice_used([m(1)]) is False


def test_voice_line_exact_format_and_syllables_replaced():
    metric = with_voice(m(1, syl=999, filler="high"), vr())
    assert metric.syllables == 300
    assert voice_used([metric]) is True
    assert render([metric]) == (
        "[답변별 전달력 측정]\n"
        "답변 1: 분당 300음절(보통), 2초 이상 쉼 1회·말한 1분당 1.0회(적음), "
        "가장 긴 쉼 2.5초, 첫마디까지 1.5초(보통), 군말 보통, "
        "목소리: 자신감 높음·어조 차분·떨림 없음·끝 흐려짐 있음·발음 보통 "
        "(근거: 자신감 또박또박 / 어조 일정함 / 떨림 떨림 없음 / 끝 흐려짐 끝이 작아짐 "
        "/ 발음 대체로 또렷)"
    )


@pytest.mark.parametrize(
    "count,speech,label",
    [
        (2, 60, "적음"),
        (3, 60, "보통"),
        (5, 60, "보통"),
        (6, 60, "잦은 경향(예: 음, 어, 그)"),
        (1, 10, "적음"),  # 0.5분 하한: 1 / 0.5 = 2 (10초는 5초 이상이라 측정됨)
        (3, 10, "잦은 경향(예: 음, 어, 그)"),  # 3 / 0.5 = 6 > 5
    ],
)
def test_voice_filler_judged_per_speech_minute(count, speech, label):
    metric = with_voice(
        m(1, speech=speech, syl=1, filler=None),
        vr(count=count, examples=("음", "어", "그", "저")),
    )
    line = render([metric]).splitlines()[1]
    assert f"군말 {label}," in line


def test_voice_filler_without_examples_has_no_parenthesis():
    line = render([with_voice(m(1), vr(count=9, examples=()))]).splitlines()[1]
    assert "군말 잦은 경향, 목소리" in line


def test_reasons_trimmed_to_60_chars_and_blank_skipped():
    long = "가" * 80
    metric = with_voice(
        m(1),
        vr(
            confidence={"level": "low", "reason": long},
            tone={"level": "monotone", "reason": "  "},
            clarity={"level": "poor", "reason": "a\nb"},
        ),
    )
    line = render([metric]).splitlines()[1]
    assert f"(근거: 자신감 {'가' * 60} / 떨림 떨림 없음 / 끝 흐려짐 끝이 작아짐 / 발음 a b)" in line
    assert "가" * 61 not in line
    assert "자신감 낮음·어조 단조" in line and "발음 낮음" in line


def test_insufficient_answers_get_no_voice_line():
    short = with_voice(m(1, speech=3.0), vr())
    assert render([short]).splitlines()[1] == "답변 1: 측정 부족(말한 시간 5초 미만)"
    empty = with_voice(m(2), vr(transcript="..."))
    assert render([empty]).splitlines()[1] == "답변 2: 측정 부족(받아쓴 음절 없음)"
    assert voice_used([short, empty]) is False
