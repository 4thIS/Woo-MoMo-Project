"""벤 개인정보 가림(spec 2026-11-08): 라우터가 가려 보내고 응답에서 되돌린다."""

import json
from dataclasses import replace

from app.llm import pii, prompts
from tests.fakes import FakeClaude
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
