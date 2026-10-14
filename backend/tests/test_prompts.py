from app.llm import prompts

COMPANY = {
    "resumeText": "백엔드 3년, 결제 시스템",
    "company": {"field": "it", "job": "백엔드 개발자"},
}
ADMISSION = {
    "resumeText": "로봇 동아리에서 자율주행을 탐구했습니다",
    "admission": {
        "name": "홍길동",
        "age": 19,
        "university": "한국대학교",
        "department": "컴퓨터공학과",
    },
}
HISTORY = [{"role": "model", "text": "자기소개 해 주세요."}]


def test_company_system_blocks():
    rules, resume = prompts.build_system("company", COMPANY)
    text = rules["text"]
    assert 'IT 분야 기업의 채용 면접관입니다. 지원 직무는 "백엔드 개발자"입니다.' in text
    assert prompts.SHARP_CHARACTER in text
    assert prompts.SHARP_FOLLOW_UP in text
    assert f'정확히 이 문장으로 끝냅니다: "{prompts.END_PHRASE}."' in text
    assert "질문 5개" in text
    assert "cache_control" not in rules
    assert resume == {
        "type": "text",
        "text": "[지원자 이력서]\n백엔드 3년, 결제 시스템",
        "cache_control": {"type": "ephemeral"},
    }


def test_admission_system_blocks():
    rules, essay = prompts.build_system("admission", ADMISSION)
    for part in (
        "한국대학교 컴퓨터공학과의 입학 면접관",
        "홍길동(19세)",
        "전공 적합성",
        "탐구 경험",
        "자기소개서에 쓴 내용의 근거",
    ):
        assert part in rules["text"]
    assert essay["text"] == "[지원자 자기소개서]\n로봇 동아리에서 자율주행을 탐구했습니다"
    assert essay["cache_control"] == {"type": "ephemeral"}


def test_unknown_field_uses_the_code():
    rules, _ = prompts.build_system(
        "company", {**COMPANY, "company": {"field": "space", "job": "x"}}
    )
    assert "space 분야 기업" in rules["text"]


def test_turn_messages():
    assert prompts.turn_messages([], None) == [{"role": "user", "content": "면접을 시작해 주세요."}]
    assert prompts.turn_messages(HISTORY, "안녕하세요") == [
        {"role": "user", "content": prompts.KICKOFF},
        {"role": "assistant", "content": "자기소개 해 주세요."},
        {"role": "user", "content": "안녕하세요"},
    ]


def test_report_messages_end_with_sharp_instruction():
    msgs = prompts.report_messages(HISTORY)
    last = msgs[-1]
    assert last["role"] == "user"
    assert f"\n{prompts.SHARP_REPORT_TONE}\n\n[" in last["content"]
    assert (
        last["content"].replace(f"\n{prompts.SHARP_REPORT_TONE}", "", 1)
        == prompts.REPORT_INSTRUCTION
    )
    assert msgs[:-1] == prompts.turn_messages(HISTORY, None)


def test_has_end_phrase_ignores_spaces():
    assert prompts.has_end_phrase("수고하셨습니다. 면접을 마치겠습니다.")
    assert prompts.has_end_phrase("면접을  마치 겠습니다")
    assert not prompts.has_end_phrase("다음 질문입니다.")
