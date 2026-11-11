"""벤 개인정보 가림(spec 2026-11-08): 라우터가 가려 보내고 응답에서 되돌린다."""

import json
import logging
from dataclasses import replace

import pytest

from app.llm import pii, prompts
from tests.fakes import DEFAULT_BRIEFING, FakeClaude
from tests.helpers import ADMISSION_START, COMPANY_START, open_db, sse_events, start_ben
from tests.test_report_v2 import item, summary

URL = "/api/premium/interviews"
PII_RESUME = (
    "이름: 홍길동\n연락처: 010-1234-5678, gildong@example.com\n"
    "GitHub: github.com/gildong\n결제 백엔드 3년"
)
PII_START = {**COMPANY_START, "resumeText": PII_RESUME}


def _client(make_client, settings, fake, **over):
    return make_client(replace(settings, ben_pii_mask=True, **over), claude=fake)


def _sent(fake):
    return json.dumps(fake.calls, ensure_ascii=False)


def _deltas(res):
    return "".join(d["text"] for e, d in sse_events(res.text) if e == "delta")


def _stored(settings, iid):
    with open_db(settings) as conn:
        return conn.execute(
            "SELECT messages_json, report_raw FROM premium_interviews WHERE id = ?", (iid,)
        ).fetchone()


def test_turn_sends_masked_and_returns_original(make_client, settings):
    fake = FakeClaude()
    fake.replies = [["[이름", "1]님, ", "[전화1]이 맞나요?"]]
    c = _client(make_client, settings, fake)
    iid = start_ben(c, PII_START)
    res = c.post(f"{URL}/{iid}/turns")
    assert _deltas(res) == "홍길동님, 010-1234-5678이 맞나요?"
    sent = _sent(fake)
    for raw in ("홍길동", "010-1234-5678", "gildong@example.com", "github.com/gildong"):
        assert raw not in sent
    assert "[이름1]" in sent and "결제 백엔드 3년" in sent
    stored = json.loads(_stored(settings, iid)["messages_json"])
    assert "홍길동님, 010-1234-5678이 맞나요?" in [m["text"] for m in stored]


def test_masked_turn_has_notice_in_system(make_client, settings):
    fake = FakeClaude()
    c = _client(make_client, settings, fake)
    iid = start_ben(c, PII_START)
    c.post(f"{URL}/{iid}/turns")
    assert prompts.MASK_NOTICE in _sent(fake)


def test_answers_are_masked_too(make_client, settings):
    fake = FakeClaude()
    c = _client(make_client, settings, fake)
    iid = start_ben(c, PII_START)
    c.post(f"{URL}/{iid}/turns")
    c.post(f"{URL}/{iid}/turns", json={"answer": "제 번호는 010-9999-8888입니다"})
    last = fake.calls[-1]["messages"][-1]["content"]
    assert last == "제 번호는 [전화2]입니다"
    # 저장된 답변은 원문
    stored = json.loads(_stored(settings, iid)["messages_json"])
    assert "제 번호는 010-9999-8888입니다" in [m["text"] for m in stored]


def test_system_block_is_identical_across_turns(make_client, settings):
    fake = FakeClaude()
    c = _client(make_client, settings, fake)
    iid = start_ben(c, PII_START)
    c.post(f"{URL}/{iid}/turns")
    c.post(f"{URL}/{iid}/turns", json={"answer": "a@b.co 입니다"})
    assert fake.calls[0]["system"] == fake.calls[1]["system"]


def test_admission_name_is_masked_but_university_kept(make_client, settings):
    fake = FakeClaude()
    c = _client(make_client, settings, fake)
    iid = start_ben(c, ADMISSION_START)
    c.post(f"{URL}/{iid}/turns")
    sent = _sent(fake)
    assert ADMISSION_START["admission"]["name"] not in sent
    assert ADMISSION_START["admission"]["university"] in sent


def test_mask_failure_never_calls_claude(make_client, settings, monkeypatch):
    fake = FakeClaude()
    c = _client(make_client, settings, fake)
    iid = start_ben(c, PII_START)

    def boom(self, text):
        raise RuntimeError("x")

    monkeypatch.setattr(pii.Masker, "mask", boom)
    events = sse_events(c.post(f"{URL}/{iid}/turns").text)
    assert ("error", {"code": "claude_error"}) in events
    assert fake.calls == []


def test_off_sends_original(make_client, settings):
    fake = FakeClaude()
    c = make_client(settings, claude=fake)  # 테스트 Settings 기본은 꺼짐
    iid = start_ben(c, PII_START)
    c.post(f"{URL}/{iid}/turns")
    assert "홍길동" in _sent(fake)


def _two_turns(c, iid):
    c.post(f"{URL}/{iid}/turns")
    c.post(f"{URL}/{iid}/turns", json={"answer": "답"})


def test_report_v1_is_unmasked_with_json_escape(make_client, settings):
    fake = FakeClaude()
    report = '[{"question": "q", "answer": "a", "feedback": "[이름1]님은 **좋았다**", "score": 3}]'
    fake.replies = [["첫 질문"], ["면접을 마치겠습니다."], [report[:50], report[50:]]]
    c = _client(make_client, settings, fake)
    iid = start_ben(c, PII_START)
    _two_turns(c, iid)
    res = c.post(f"{URL}/{iid}/report", json={"delivery": []})
    text = _deltas(res)
    assert json.loads(text)[0]["feedback"] == "홍길동님은 **좋았다**"
    assert _stored(settings, iid)["report_raw"] == text
    assert "홍길동" not in json.dumps(fake.calls[-1], ensure_ascii=False)


def test_report_v1_mask_failure_never_calls_claude(make_client, settings, monkeypatch):
    fake = FakeClaude()
    fake.replies = [["첫 질문"], ["면접을 마치겠습니다."]]
    c = _client(make_client, settings, fake)
    iid = start_ben(c, PII_START)
    _two_turns(c, iid)
    monkeypatch.setattr(pii.Masker, "mask_messages", lambda self, m: 1 / 0)
    events = sse_events(c.post(f"{URL}/{iid}/report", json={"delivery": []}).text)
    assert ("error", {"code": "claude_error"}) in events
    assert len(fake.calls) == 2


def test_report_v2_is_unmasked(make_client, settings):
    fake = FakeClaude()
    obj = {
        "items": [item(1, "main", feedback='[이름1]님은 "결제"를 잘 설명했다')],
        "summary": summary(
            strengths=[{"point": "a", "answers": [1]}],
            improvements=[{"point": "b", "answers": [1]}],
        ),
    }
    raw = json.dumps(obj, ensure_ascii=False)
    fake.replies = [["첫 질문"], ["면접을 마치겠습니다."], [raw[:40], raw[40:]]]
    c = _client(make_client, settings, fake, ben_report_v2=True)
    iid = start_ben(c, PII_START)
    _two_turns(c, iid)
    events = sse_events(c.post(f"{URL}/{iid}/report", json={"delivery": []}).text)
    reports = [d for e, d in events if e == "report"]
    assert reports, events
    assert reports[0]["items"][0]["feedback"] == '홍길동님은 "결제"를 잘 설명했다'
    stored = _stored(settings, iid)["report_raw"]
    assert "[이름1]" not in stored and "홍길동" in stored
    assert "홍길동" not in json.dumps(fake.calls[-1], ensure_ascii=False)


# ── 최종 검토 ──

LEAK_RESUME = (
    "이름: 홍길동\n생년월일: 1999.01.02\n주소: 서울 강남구 역삼동 123-4\n"
    "신한은행 110-123-456789\n결제 백엔드 3년"
)
LEAK_RAW = ("홍길동", "1999.01.02", "서울 강남구 역삼동 123-4", "110-123-456789")


def test_restored_values_are_masked_again_in_later_calls(make_client, settings):
    fake = FakeClaude()
    fake.replies = [["[주소1]에서 다니셨군요. [생년월일1]생이시고 [계좌1]로 받으셨죠?"], ["다음"]]
    c = _client(make_client, settings, fake)
    iid = start_ben(c, {**COMPANY_START, "resumeText": LEAK_RESUME})
    first = _deltas(c.post(f"{URL}/{iid}/turns"))
    assert first == (
        "서울 강남구 역삼동 123-4에서 다니셨군요. 1999.01.02생이시고 110-123-456789로 받으셨죠?"
    )
    c.post(f"{URL}/{iid}/turns", json={"answer": "네 맞습니다"})
    c.post(f"{URL}/{iid}/report", json={"delivery": []})
    assert len(fake.calls) == 3
    for call in fake.calls[1:]:
        sent = json.dumps(call, ensure_ascii=False)
        for raw in LEAK_RAW:
            assert raw not in sent
    assert fake.calls[1]["messages"][1]["content"].startswith("[주소1]에서 다니셨군요. [생년월일1]")
    # 시스템 블록은 턴마다 같아 번호도 같다
    assert fake.calls[0]["system"] == fake.calls[1]["system"]


@pytest.mark.parametrize("name", ["남궁민수아", "Alex"])
def test_admission_names_without_a_pattern_are_masked(make_client, settings, name):
    fake = FakeClaude()
    c = _client(make_client, settings, fake)
    body = {**ADMISSION_START, "admission": {**ADMISSION_START["admission"], "name": name}}
    iid = start_ben(c, body)
    c.post(f"{URL}/{iid}/turns")
    sent = _sent(fake)
    assert name not in sent and "[이름" in sent


def _boom_init(self, names=()):
    raise RuntimeError("x")


@pytest.mark.parametrize("v2", [False, True])
def test_masker_build_failure_never_calls_claude_on_report(make_client, settings, monkeypatch, v2):
    fake = FakeClaude()
    fake.replies = [["첫 질문"], ["면접을 마치겠습니다."]]
    c = _client(make_client, settings, fake, ben_report_v2=v2)
    iid = start_ben(c, PII_START)
    _two_turns(c, iid)
    monkeypatch.setattr(pii.Masker, "__init__", _boom_init)
    res = c.post(f"{URL}/{iid}/report", json={"delivery": []})
    assert ("error", {"code": "claude_error"}) in sse_events(res.text)
    assert len(fake.calls) == 2


def test_masker_build_failure_never_calls_claude_on_turn(make_client, settings, monkeypatch):
    fake = FakeClaude()
    c = _client(make_client, settings, fake)
    iid = start_ben(c, PII_START)
    monkeypatch.setattr(pii.Masker, "__init__", _boom_init)
    res = c.post(f"{URL}/{iid}/turns")
    assert ("error", {"code": "claude_error"}) in sse_events(res.text)
    assert fake.calls == []


def test_names_in_failure_never_calls_claude(make_client, settings, monkeypatch):
    fake = FakeClaude()
    c = _client(make_client, settings, fake)
    iid = start_ben(c, PII_START)
    monkeypatch.setattr(pii, "names_in", lambda text: 1 / 0)
    res = c.post(f"{URL}/{iid}/turns")
    assert ("error", {"code": "claude_error"}) in sse_events(res.text)
    assert fake.calls == []


def test_report_v2_mask_failure_never_calls_claude(make_client, settings, monkeypatch):
    fake = FakeClaude()
    fake.replies = [["첫 질문"], ["면접을 마치겠습니다."]]
    c = _client(make_client, settings, fake, ben_report_v2=True)
    iid = start_ben(c, PII_START)
    _two_turns(c, iid)
    monkeypatch.setattr(pii.Masker, "mask_messages", lambda self, m: 1 / 0)
    res = c.post(f"{URL}/{iid}/report", json={"delivery": []})
    assert ("error", {"code": "claude_error"}) in sse_events(res.text)
    assert len(fake.calls) == 2


def _v2_raw(feedback):
    obj = {
        "items": [item(1, "main", feedback=feedback)],
        "summary": summary(
            strengths=[{"point": "a", "answers": [1]}],
            improvements=[{"point": "b", "answers": [1]}],
        ),
    }
    return json.dumps(obj, ensure_ascii=False)


def test_report_v2_retry_sends_same_masked_payload_and_restores_second(make_client, settings):
    fake = FakeClaude()
    good = _v2_raw("[이름1]님, [전화1] 확인")
    fake.replies = [["첫 질문"], ["면접을 마치겠습니다."], ['{"items": [이름1'], [good]]
    c = _client(make_client, settings, fake, ben_report_v2=True)
    iid = start_ben(c, PII_START)
    _two_turns(c, iid)
    events = sse_events(c.post(f"{URL}/{iid}/report", json={"delivery": []}).text)
    assert ("reset", {}) in events
    assert fake.calls[2] == fake.calls[3]
    assert "홍길동" not in json.dumps(fake.calls[3], ensure_ascii=False)
    reports = [d for e, d in events if e == "report"]
    assert reports, events
    assert reports[0]["items"][0]["feedback"] == "홍길동님, 010-1234-5678 확인"


BRIEFING_PII = DEFAULT_BRIEFING + " 채용 담당 연락처는 010-2222-3333, recruit-kim@toss.im 이다."


def test_first_turn_briefing_is_masked_and_system_stays_same(make_client, settings):
    fake = FakeClaude()
    fake.complete_results = [BRIEFING_PII]
    c = _client(make_client, settings, fake)
    named = {**PII_START, "company": {**COMPANY_START["company"], "name": "토스(비바리퍼블리카)"}}
    iid = start_ben(c, named)
    c.post(f"{URL}/{iid}/turns")
    c.post(f"{URL}/{iid}/turns", json={"answer": "답"})
    sent = _sent(fake)
    for raw in ("010-2222-3333", "recruit-kim@toss.im", "홍길동", "010-1234-5678"):
        assert raw not in sent
    assert "간편송금" in sent  # 브리핑 본문은 남는다
    assert len(fake.calls[0]["system"]) == 3
    assert fake.calls[0]["system"] == fake.calls[1]["system"]


def test_with_voice_report_is_masked(make_client, settings):
    from tests.test_ben_report import METRIC, _put_voice

    fake = FakeClaude()
    fake.replies = [["첫 질문"], ["다음 질문"], ['[{"feedback": "[전화2]"}]']]
    c = _client(make_client, settings, fake)
    iid = start_ben(c, {**PII_START, "voiceAnalysisConsent": True})
    c.post(f"{URL}/{iid}/turns")
    c.post(f"{URL}/{iid}/turns", json={"answer": "제 번호는 010-9999-8888입니다"})
    _put_voice(settings, iid)
    res = c.post(f"{URL}/{iid}/report", json={"delivery": [METRIC]})
    assert prompts.VOICE_NOTE in fake.calls[-1]["messages"][-1]["content"]
    sent = json.dumps(fake.calls[-1], ensure_ascii=False)
    for raw in ("홍길동", "010-1234-5678", "010-9999-8888"):
        assert raw not in sent
    assert json.loads(_deltas(res))[0]["feedback"] == "010-9999-8888"


ESC_RESUME = '이름: 홍길동\n주소: 서울 "우리"동 3\\4\n결제 백엔드 3년'
ESC_VALUE = '서울 "우리"동 3\\4'


def test_report_v1_restores_value_needing_json_escape(make_client, settings):
    fake = FakeClaude()
    report = '[{"question": "q", "answerSummary": "a", "feedback": "[주소1]에 사시는군요"}]'
    fake.replies = [["첫 질문"], ["면접을 마치겠습니다."], [report[:60], report[60:]]]
    c = _client(make_client, settings, fake)
    iid = start_ben(c, {**COMPANY_START, "resumeText": ESC_RESUME})
    _two_turns(c, iid)
    res = c.post(f"{URL}/{iid}/report", json={"delivery": []})
    assert json.loads(_deltas(res))[0]["feedback"] == f"{ESC_VALUE}에 사시는군요"
    assert ESC_VALUE not in json.dumps(fake.calls[-1], ensure_ascii=False)


def test_report_v2_restores_value_needing_json_escape(make_client, settings):
    fake = FakeClaude()
    raw = _v2_raw("[주소1]에 사시는군요")
    fake.replies = [["첫 질문"], ["면접을 마치겠습니다."], [raw[:30], raw[30:]]]
    c = _client(make_client, settings, fake, ben_report_v2=True)
    iid = start_ben(c, {**COMPANY_START, "resumeText": ESC_RESUME})
    _two_turns(c, iid)
    events = sse_events(c.post(f"{URL}/{iid}/report", json={"delivery": []}).text)
    reports = [d for e, d in events if e == "report"]
    assert reports, events
    assert reports[0]["items"][0]["feedback"] == f"{ESC_VALUE}에 사시는군요"
    stored = json.loads(_stored(settings, iid)["report_raw"])
    assert stored["items"][0]["feedback"] == f"{ESC_VALUE}에 사시는군요"


def test_log_has_english_counts_only(make_client, settings, caplog):
    fake = FakeClaude()
    c = _client(make_client, settings, fake)
    iid = start_ben(c, PII_START)
    with caplog.at_level(logging.INFO):
        c.post(f"{URL}/{iid}/turns")
    lines = [r.getMessage() for r in caplog.records if r.getMessage().startswith("pii masked")]
    assert lines == ["pii masked email=1 link=1 name=1 phone=1"]
    for raw in ("홍길동", "010-1234-5678", "gildong"):
        assert raw not in caplog.text
