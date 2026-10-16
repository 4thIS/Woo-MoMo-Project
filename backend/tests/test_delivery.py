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
