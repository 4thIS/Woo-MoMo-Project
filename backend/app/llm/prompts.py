"""벤(프리미엄 면접관) 프롬프트 (spec 4.4). 백엔드 계층 규율 경로.

바꾸면 demomo에서 벤 1회 완주 + 리포트 JSON 파싱을 확인한다.
프론트와 글자까지 같아야 하는 값(tests/test_prompt_parity.py가 묶는다):
- END_PHRASE ↔ frontend/src/utils/endDetector.ts
- KICKOFF ↔ frontend/src/prompts/interviewer.ts
- REPORT_INSTRUCTION ↔ frontend/src/prompts/report.ts
- SHARP_* ↔ frontend/src/prompts/personas.ts의 sharp (벤 = m2 = sharp)
"""

from typing import Any

Message = dict[str, Any]

END_PHRASE = "면접을 마치겠습니다"
KICKOFF = "면접을 시작해 주세요."

REPORT_INSTRUCTION = """면접이 끝났습니다. 지금까지 당신이 한 질문과 지원자의 답변을 문항별로 정리해 피드백을 작성하세요.
꼬리질문은 원래 질문에 합쳐 하나의 문항으로 다룹니다.
아래 JSON 배열 형식으로만 출력하고, 다른 말은 하지 마세요. 코드 펜스는 써도 됩니다.
feedback 안에서 가장 중요한 구절 하나는 **별표 두 개**로 감싸 강조하세요.

[
  {"question": "질문 원문", "answerSummary": "지원자 답변 요약 (한두 문장)", "feedback": "구체적인 피드백 (두세 문장, 점수 없이)"}
]"""

SHARP_CHARACTER = "논리와 근거를 엄격하게 확인합니다. 간결하고 건조한 존댓말을 쓰고, 수치·근거·본인의 기여·한계를 캐묻습니다. 모호한 표현은 구체적으로 되묻습니다. 무례하거나 인신공격적인 표현은 쓰지 않습니다."
SHARP_FOLLOW_UP = "지원자의 답변에 근거·수치·본인의 기여가 부족하거나 모호하면 꼬리질문으로 구체적으로 되묻습니다. 한 질문당 꼬리질문은 최대 2개입니다."
SHARP_REACTION = "네."
SHARP_REPORT_TONE = "칭찬은 생략하고 근거 부족·모호한 표현·빠진 수치를 직설적으로 짚습니다."

# 프론트 stores/interview.ts FIELD_LABELS와 같은 이름
FIELD_LABELS = {
    "it": "IT",
    "finance": "금융",
    "manufacturing": "제조",
    "retail": "유통",
    "general": "기타",
}

COMPANY_FOCUS = (
    "이력서 내용을 근거로 질문 5개를 준비해 순서대로 진행합니다. 첫 질문은 자기소개입니다."
)
ADMISSION_FOCUS = (
    "자기소개서 내용을 근거로 질문 5개를 준비해 순서대로 진행합니다. 첫 질문은 자기소개입니다. "
    "전공 적합성, 탐구 경험, 자기소개서에 쓴 내용의 근거를 고르게 묻습니다."
)


def _rules(focus: str) -> str:
    # 로컬 면접관(frontend/src/prompts/interviewer.ts)과 같은 진행 규칙. 2번만 트랙별로 다르다.
    return "\n".join(
        [
            "[진행 규칙]",
            "1. 한국어 존댓말을 씁니다. 한 번에 질문을 하나만 합니다. 질문은 두 문장 이내로 짧게 합니다.",
            f"2. {focus}",
            f"3. {SHARP_FOLLOW_UP}",
            f'4. 답변에 대한 평가, 점수, 조언은 면접 중에는 절대 말하지 않습니다. 짧은 반응("{SHARP_REACTION}" 정도)만 허용됩니다.',
            "5. 질문 번호나 남은 질문 수를 말하지 않습니다.",
            f'6. 다섯 번째 질문의 답변(꼬리질문 포함)이 끝나면 정확히 이 문장으로 끝냅니다: "{END_PHRASE}."',
            "7. 질문 외의 설명, 머리말, 이모지, 마크다운은 쓰지 않습니다.",
        ]
    )


def _company_intro(company: dict[str, Any]) -> str:
    label = FIELD_LABELS.get(company["field"], company["field"])
    return (
        f'당신은 {label} 분야 기업의 채용 면접관입니다. 지원 직무는 "{company["job"]}"입니다.\n'
        "지금부터 지원자와 1:1 모의 면접을 진행합니다.\n"
        f"{SHARP_CHARACTER}"
    )


def _admission_intro(a: dict[str, Any]) -> str:
    return (
        f"당신은 {a['university']} {a['department']}의 입학 면접관입니다. "
        f"지원자는 {a['name']}({a['age']}세)입니다.\n"
        "지금부터 지원자와 1:1 모의 입학 면접을 진행합니다.\n"
        f"{SHARP_CHARACTER}"
    )


def build_system(track: str, inputs: dict[str, Any]) -> list[dict[str, Any]]:
    """[소개+규칙, 이력서] 두 블록. 면접 내내 같으므로 끝 블록에 캐시를 건다."""
    if track == "company":
        intro = _company_intro(inputs["company"])
        focus, heading = COMPANY_FOCUS, "[지원자 이력서]"
    else:
        intro = _admission_intro(inputs["admission"])
        focus, heading = ADMISSION_FOCUS, "[지원자 자기소개서]"
    return [
        {"type": "text", "text": f"{intro}\n\n{_rules(focus)}"},
        {
            "type": "text",
            "text": f"{heading}\n{inputs['resumeText']}",
            "cache_control": {"type": "ephemeral"},
        },
    ]


def _history(messages: list[Message]) -> list[Message]:
    out: list[Message] = [{"role": "user", "content": KICKOFF}]
    for m in messages:
        role = "assistant" if m["role"] == "model" else "user"
        out.append({"role": role, "content": m["text"]})
    return out


def turn_messages(messages: list[Message], answer: str | None) -> list[Message]:
    out = _history(messages)
    if answer is not None:
        out.append({"role": "user", "content": answer})
    return out


def report_instruction() -> str:
    """프론트 buildReportInstruction(PERSONAS.sharp)과 같다: JSON 예시 앞에 말투 한 줄."""
    return REPORT_INSTRUCTION.replace("\n\n[", f"\n{SHARP_REPORT_TONE}\n\n[", 1)


def report_messages(messages: list[Message]) -> list[Message]:
    return [*_history(messages), {"role": "user", "content": report_instruction()}]


def has_end_phrase(text: str) -> bool:
    """프론트 hasEndPhrase와 같다: 공백을 모두 빼고 비교한다."""
    return "".join(END_PHRASE.split()) in "".join(text.split())
