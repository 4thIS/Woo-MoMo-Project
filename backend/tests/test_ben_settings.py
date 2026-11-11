"""벤 성향 설정(spec 2026-11-07): 기본값은 지금 프롬프트와 글자까지 같고, 축마다 문장이 바뀐다."""

import json
import re
from pathlib import Path
from typing import Any

import pytest
from pydantic import ValidationError

from app.llm import prompts
from app.schemas import BenSettings, InterviewStart

FIXTURE = Path(__file__).parent / "fixtures" / "ben_prompts_before_settings.json"
FRONTEND_SRC = Path(__file__).resolve().parents[2] / "frontend" / "src"

COMPANY = {
    "resumeText": "이력서",
    "company": {"field": "it", "job": "백엔드 개발자", "name": "토스"},
}
ADMISSION = {
    "resumeText": "자소서",
    "admission": {
        "name": "홍길동",
        "age": 19,
        "university": "한국대학교",
        "department": "컴퓨터공학과",
    },
}
BRIEF = "사업: 간편송금"
POST = "사업: 간편송금\n## 모집공고 요구사항\n- Kotlin, 결제 도메인, 대용량 트래픽 처리"
H = [{"role": "model", "text": "자기소개 해 주세요."}, {"role": "user", "text": "안녕하세요"}]
DEFAULTS = {
    "warmth": "low",
    "followUp": "mid",
    "questionMix": "balanced",
    "difficulty": "practical",
    "companyWeight": "mid",
}


def _with(inputs: dict[str, Any], **settings: str) -> dict[str, Any]:
    return {**inputs, "benSettings": {**DEFAULTS, **settings}}


def _rules(track: str, inputs: dict[str, Any], briefing: str | None = None) -> str:
    return prompts.build_system(track, inputs, briefing)[0]["text"]


# ── 기본값 = 변경 전과 같다 ──


def _built(variant: dict[str, Any] | None) -> dict[str, Any]:
    def inp(base: dict[str, Any]) -> dict[str, Any]:
        return base if variant is None else {**base, "benSettings": variant}

    return {
        "company": prompts.build_system("company", inp(COMPANY)),
        "company_brief": prompts.build_system("company", inp(COMPANY), BRIEF),
        "company_posting": prompts.build_system("company", inp(COMPANY), POST),
        "admission": prompts.build_system("admission", inp(ADMISSION)),
        "report_v1": prompts.report_messages(H, "블록", voice=True),
        "report_v2": prompts.report_messages_v2(H, "블록", voice=True, posting=True),
    }


@pytest.mark.parametrize("variant", [None, {}, DEFAULTS])
def test_defaults_match_prompts_before_settings(variant: dict[str, Any] | None) -> None:
    before = json.loads(FIXTURE.read_text(encoding="utf-8"))
    assert json.loads(json.dumps(_built(variant), ensure_ascii=False)) == before


def test_low_warmth_report_is_unchanged() -> None:
    assert prompts.report_messages(H, "블록", voice=True, warmth="low") == prompts.report_messages(
        H, "블록", voice=True
    )
    assert prompts.report_messages_v2(
        H, None, voice=False, posting=False, warmth="low"
    ) == prompts.report_messages_v2(H, None, voice=False, posting=False)


# ── 설정 읽기 ──


def test_ben_settings_fills_defaults() -> None:
    assert prompts.ben_settings(COMPANY) == DEFAULTS
    assert prompts.ben_settings({**COMPANY, "benSettings": {"warmth": "high"}}) == {
        **DEFAULTS,
        "warmth": "high",
    }


def test_schema_defaults_and_rejects() -> None:
    assert BenSettings().model_dump() == DEFAULTS
    assert BenSettings.model_validate({"difficulty": "advanced"}).difficulty == "advanced"
    with pytest.raises(ValidationError):
        BenSettings.model_validate({"warmth": "very"})
    with pytest.raises(ValidationError):
        BenSettings.model_validate({"tone": "low"})
    body = {"track": "company", "resumeText": "x", "company": {"field": "it", "job": "개발"}}
    assert InterviewStart.model_validate(body).benSettings is None


# ── 온화함 ──


def test_warmth_mid_uses_standard_persona() -> None:
    rules = _rules("company", _with(COMPANY, warmth="mid"))
    assert prompts.SHARP_CHARACTER not in rules
    assert '"네, 알겠습니다."' in rules
    assert "진행합니다.\n\n[진행 규칙]" in rules  # 성격 문장 자리에 빈 줄이 남지 않는다


def test_warmth_high_uses_gentle_persona() -> None:
    rules = _rules("admission", _with(ADMISSION, warmth="high"))
    assert prompts.GENTLE_CHARACTER in rules
    assert prompts.SHARP_CHARACTER not in rules
    assert '"네, 잘 들었습니다."' in rules


def test_report_tone_follows_warmth() -> None:
    assert prompts.SHARP_REPORT_TONE in prompts.report_instruction("low")
    assert prompts.report_instruction("mid") == prompts.REPORT_INSTRUCTION
    assert prompts.GENTLE_REPORT_TONE in prompts.report_instruction("high")
    v1 = prompts.report_messages(H, None, warmth="high")[-1]["content"]
    assert v1 == prompts.report_instruction("high")
    for warmth in ("mid", "high"):
        v2 = prompts.report_messages_v2(H, None, voice=False, posting=False, warmth=warmth)
        content = v2[-1]["content"]
        assert "압박 면접관답게" not in content
        assert prompts.REPORT_V2_TONE[warmth] in content


# ── 꼬리질문 ──


def test_follow_up_levels() -> None:
    low = _rules("company", _with(COMPANY, followUp="low"))
    assert prompts.GENTLE_FOLLOW_UP in low and "모두 합쳐 최대 1개" in low
    assert prompts.SHARP_FOLLOW_UP not in low
    high = _rules("company", _with(COMPANY, followUp="high"))
    assert "한 질문당 꼬리질문은 최대 3개" in high
    assert prompts.BEN_FOLLOW_UP_TOTAL in high  # 전체 상한은 3개 그대로


# ── 질문 비중·난이도 ──


@pytest.mark.parametrize(
    ("track", "inputs", "mix", "phrase"),
    [
        ("company", COMPANY, "technical", "직무에 필요한 지식"),
        ("company", COMPANY, "personal", "협업"),
        ("admission", ADMISSION, "technical", "전공 지식"),
        ("admission", ADMISSION, "personal", "공동체 경험"),
    ],
)
def test_question_mix_by_track(track: str, inputs: dict[str, Any], mix: str, phrase: str) -> None:
    assert phrase in _rules(track, _with(inputs, questionMix=mix))
    assert phrase not in _rules(track, inputs)


def test_difficulty_levels() -> None:
    assert prompts.DIFFICULTY_FOCUS["basic"] in _rules(
        "company", _with(COMPANY, difficulty="basic")
    )
    adv = _rules("admission", _with(ADMISSION, difficulty="advanced"))
    assert prompts.DIFFICULTY_FOCUS["advanced"] in adv


# ── 회사·공고 비중 ──


def test_company_weight_changes_counts() -> None:
    low = _rules("company", _with(COMPANY, companyWeight="low"), POST)
    assert "질문 중 1개는 [지원 기업 최신 정보]" in low and "합쳐 1~2개" in low
    high = _rules("company", _with(COMPANY, companyWeight="high"), POST)
    assert "질문 중 2~3개는 [지원 기업 최신 정보]" in high and "합쳐 3~4개" in high


def test_company_weight_ignored_without_briefing_or_on_admission() -> None:
    assert _rules("company", _with(COMPANY, companyWeight="high")) == _rules("company", COMPANY)
    assert _rules("admission", _with(ADMISSION, companyWeight="high"), POST) == _rules(
        "admission", ADMISSION
    )


# ── 프론트 페르소나와 같은 문구 ──


def _persona(src: str, name: str) -> str:
    start = src.index(f"  {name}: {{")
    return src[start : src.index("\n  },", start)]


def test_standard_and_gentle_text_match_frontend() -> None:
    src = (FRONTEND_SRC / "prompts" / "personas.ts").read_text(encoding="utf-8")
    src = src.replace("\r\n", "\n")
    gentle = re.sub(r"\n\s+", " ", _persona(src, "gentle"))
    for value in (prompts.GENTLE_CHARACTER, prompts.GENTLE_FOLLOW_UP, prompts.GENTLE_REPORT_TONE):
        assert f"'{value}'" in gentle
    assert f"reaction: '{prompts.GENTLE_REACTION}'" in gentle
    standard = _persona(src, "standard")
    assert "character: null" in standard and "reportTone: null" in standard
    assert f"reaction: '{prompts.STANDARD_REACTION}'" in standard


# ── 라우터: 시작 때 저장하고 턴·리포트가 쓴다 ──


def _start(client: Any, settings: dict[str, Any] | None = None) -> str:
    from tests.helpers import COMPANY_START, start_ben

    body = dict(COMPANY_START)
    if settings is not None:
        body["benSettings"] = settings
    return start_ben(client, body)


def _inputs(app_settings: Any, iid: str) -> dict[str, Any]:
    from tests.helpers import open_db

    with open_db(app_settings) as conn:
        row = conn.execute(
            "SELECT inputs_json FROM premium_interviews WHERE id = ?", (iid,)
        ).fetchone()
    return json.loads(row["inputs_json"])


def test_start_stores_filled_settings(client: Any, settings: Any) -> None:
    iid = _start(client, {"warmth": "high"})
    assert _inputs(settings, iid)["benSettings"] == {**DEFAULTS, "warmth": "high"}
    iid2 = _start(client)
    assert _inputs(settings, iid2)["benSettings"] == DEFAULTS


@pytest.mark.parametrize("bad", [{"warmth": "very"}, {"tone": "low"}, {"difficulty": None}])
def test_start_rejects_bad_settings(client: Any, bad: dict[str, Any]) -> None:
    from tests.helpers import COMPANY_START, login_admin

    login_admin(client)
    assert client.post("/api/premium/purchase").status_code == 200
    res = client.post("/api/premium/interviews", json={**COMPANY_START, "benSettings": bad})
    assert res.status_code == 422


def test_turn_and_report_use_saved_settings(client: Any, fake_claude: Any) -> None:
    iid = _start(client, {"warmth": "high", "difficulty": "advanced"})
    client.post(f"/api/premium/interviews/{iid}/turns", json={})
    rules = fake_claude.calls[-1]["system"][0]["text"]
    assert prompts.GENTLE_CHARACTER in rules
    assert prompts.DIFFICULTY_FOCUS["advanced"] in rules
    client.post(f"/api/premium/interviews/{iid}/turns", json={"answer": "저는 개발자입니다"})
    fake_claude.replies = [["[]"]]
    client.post(f"/api/premium/interviews/{iid}/report", json=None)
    call = fake_claude.calls[-1]
    assert prompts.GENTLE_CHARACTER in call["system"][0]["text"]
    assert call["messages"][-1]["content"] == prompts.report_instruction("high")


def test_report_v2_uses_saved_warmth(make_client: Any, settings: Any, fake_claude: Any) -> None:
    import dataclasses

    client = make_client(dataclasses.replace(settings, ben_report_v2=True))
    iid = _start(client, {"warmth": "mid"})
    client.post(f"/api/premium/interviews/{iid}/turns", json={})
    client.post(f"/api/premium/interviews/{iid}/turns", json={"answer": "저는 개발자입니다"})
    fake_claude.replies = [["{}"], ["{}"]]
    client.post(f"/api/premium/interviews/{iid}/report", json=None)
    content = fake_claude.calls[-1]["messages"][-1]["content"]
    assert prompts.REPORT_V2_TONE["mid"] in content
    assert prompts.REPORT_V2_TONE["low"] not in content
