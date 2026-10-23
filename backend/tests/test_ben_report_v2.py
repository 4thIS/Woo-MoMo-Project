import dataclasses
import json

import pytest

from app.config import Settings
from app.llm import prompts
from app.llm.claude import ClaudeError
from app.llm.report_v2 import REPORT_V2_SCHEMA
from app.repos import premium, voice
from tests.helpers import ADMISSION_START, COMPANY_START, open_db, sse_events, start_ben
from tests.test_report_v2 import item, summary

DELIVERY = {
    "delivery": [
        {
            "answer": 1,
            "speechSec": 60.0,
            "syllables": 300,
            "longPauses": 1,
            "longestPauseSec": 2.5,
            "firstWordSec": 1.5,
            "fillerLevel": "normal",
        }
    ]
}
POSTING_BRIEFING = (
    prompts.POSTING_MARK + "\n" + "백엔드 개발자는 대용량 트래픽 결제 시스템을 다룹니다. " * 3
)


def _obj(**kw):
    base = {
        "strengths": [{"point": "a", "answers": [1, 1]}],
        "improvements": [{"point": "b", "answers": [1]}],
    }
    return {"items": [item(1, "main")], "summary": summary(**{**base, **kw})}


def _raw(**kw):
    return json.dumps(_obj(**kw), ensure_ascii=False)


@pytest.fixture
def v2_settings(settings: Settings) -> Settings:
    return dataclasses.replace(settings, ben_report_v2=True)


@pytest.fixture
def v2_client(make_client, v2_settings):
    return make_client(v2_settings)


def _two_turns(client, iid):
    client.post(f"/api/premium/interviews/{iid}/turns", json={})
    client.post(f"/api/premium/interviews/{iid}/turns", json={"answer": "저는 개발자입니다"})


def _report(client, iid, body=None):
    return client.post(f"/api/premium/interviews/{iid}/report", json=body)


def _row(settings, iid):
    with open_db(settings) as conn:
        return conn.execute("SELECT * FROM premium_interviews WHERE id = ?", (iid,)).fetchone()


def test_flag_defaults_off_and_parses():
    assert Settings.from_env({}).ben_report_v2 is False
    assert Settings.from_env({"BEN_REPORT_V2": "true"}).ben_report_v2 is True


def test_flag_off_has_no_output_format(client, fake_claude):
    iid = start_ben(client)
    _two_turns(client, iid)
    fake_claude.replies = [["[]"]]
    events = sse_events(_report(client, iid).text)
    assert [e for e, _ in events] == ["delta", "done"]
    assert "output_format" not in fake_claude.calls[-1]


def test_v2_success(v2_client, fake_claude, v2_settings):
    iid = start_ben(v2_client)
    _two_turns(v2_client, iid)
    raw = _raw()
    fake_claude.replies = [[raw[:10], raw[10:]]]
    events = sse_events(_report(v2_client, iid, DELIVERY).text)
    assert [e for e, _ in events] == ["delta", "delta", "report", "done"]
    data = events[2][1]
    assert data["version"] == 2
    assert data["items"][0]["id"] == "Q1"
    assert data["items"][0]["measurements"]["syllablesPerMin"] == 300
    call = fake_claude.calls[-1]
    assert call["output_format"] == REPORT_V2_SCHEMA
    assert call["effort"] == "medium"
    row = _row(v2_settings, iid)
    assert row["status"] == "done"
    assert row["report_raw"] == raw
    assert json.loads(row["report_v2_json"]) == data


def test_v2_no_posting_in_system_without_posting_briefing(v2_client, fake_claude, v2_settings):
    iid = start_ben(v2_client)
    _two_turns(v2_client, iid)
    with open_db(v2_settings) as conn:
        conn.execute(
            "UPDATE premium_interviews SET briefing = ? WHERE id = ?", ("회사 소개만 있음", iid)
        )
    fake_claude.replies = [[_raw()]]
    _report(v2_client, iid)
    system = json.dumps(fake_claude.calls[-1]["system"], ensure_ascii=False)
    assert "회사 소개만 있음" not in system


def test_v2_posting_briefing_goes_to_system_and_instruction(v2_client, fake_claude, v2_settings):
    iid = start_ben(v2_client)
    _two_turns(v2_client, iid)
    with open_db(v2_settings) as conn:
        conn.execute(
            "UPDATE premium_interviews SET briefing = ? WHERE id = ?", (POSTING_BRIEFING, iid)
        )
    fake_claude.replies = [[_raw()]]
    events = sse_events(_report(v2_client, iid).text)
    call = fake_claude.calls[-1]
    assert "대용량 트래픽 결제" in json.dumps(call["system"], ensure_ascii=False)
    assert prompts.POSTING_FIT_INSTRUCTION in call["messages"][-1]["content"]
    assert events[-2][1]["summary"]["postingFit"] == {"met": ["x"], "gaps": ["y"]}


def test_v2_no_delivery_nulls_everything(v2_client, fake_claude):
    iid = start_ben(v2_client)
    _two_turns(v2_client, iid)
    fake_claude.replies = [[_raw()]]
    data = sse_events(_report(v2_client, iid).text)[-2][1]
    assert data["items"][0]["delivery"] is None
    assert data["items"][0]["measurements"] is None
    assert data["summary"]["delivery"] is None
    assert data["summary"]["postingFit"] is None


def test_v2_invalid_then_valid_resets_and_counts_two_attempts(v2_client, fake_claude, v2_settings):
    iid = start_ben(v2_client)
    _two_turns(v2_client, iid)
    before = _row(v2_settings, iid)["attempts"]
    fake_claude.replies = [["not json"], [_raw()]]
    events = sse_events(_report(v2_client, iid).text)
    assert [e for e, _ in events] == ["delta", "reset", "delta", "report", "done"]
    assert events[1][1] == {}
    assert _row(v2_settings, iid)["attempts"] == before + 2


def test_v2_two_failures_is_bad_report(v2_client, fake_claude, v2_settings):
    iid = start_ben(v2_client)
    _two_turns(v2_client, iid)
    fake_claude.replies = [["x"], ["y"]]
    events = sse_events(_report(v2_client, iid).text)
    assert [e for e, _ in events] == ["delta", "reset", "delta", "error"]
    assert events[-1] == ("error", {"code": "bad_report"})
    row = _row(v2_settings, iid)
    assert row["status"] == "active"
    assert row["report_raw"] is None


def test_v2_attempt_cap_stops_second_call(v2_client, fake_claude, v2_settings):
    iid = start_ben(v2_client)
    _two_turns(v2_client, iid)
    with open_db(v2_settings) as conn:
        conn.execute(
            "UPDATE premium_interviews SET attempts = ? WHERE id = ?",
            (premium.MAX_ATTEMPTS - 1, iid),
        )
    fake_claude.replies = [["x"], [_raw()]]
    n = len(fake_claude.calls)
    events = sse_events(_report(v2_client, iid).text)
    assert events[-1] == ("error", {"code": "bad_report"})
    assert "reset" not in [e for e, _ in events]
    assert len(fake_claude.calls) == n + 1


def test_v2_claude_error_as_before(v2_client, fake_claude, v2_settings):
    iid = start_ben(v2_client)
    _two_turns(v2_client, iid)
    fake_claude.replies = [[ClaudeError("claude_error")]]
    assert sse_events(_report(v2_client, iid).text) == [("error", {"code": "claude_error"})]
    assert _row(v2_settings, iid)["status"] == "active"


def test_v2_empty_is_claude_error(v2_client, fake_claude):
    iid = start_ben(v2_client)
    _two_turns(v2_client, iid)
    fake_claude.replies = [["  "]]
    assert sse_events(_report(v2_client, iid).text)[-1] == ("error", {"code": "claude_error"})


def test_replay_sends_stored_report(v2_client, fake_claude):
    iid = start_ben(v2_client)
    _two_turns(v2_client, iid)
    raw = _raw()
    fake_claude.replies = [[raw]]
    first = sse_events(_report(v2_client, iid).text)
    n = len(fake_claude.calls)
    again = sse_events(_report(v2_client, iid).text)
    assert [e for e, _ in again] == ["delta", "report", "done"]
    assert again[0][1] == {"text": raw}
    assert again[1][1] == first[-2][1]
    assert len(fake_claude.calls) == n


def test_replay_of_v1_report_has_no_report_event(client, fake_claude):
    iid = start_ben(client)
    _two_turns(client, iid)
    fake_claude.replies = [["[]"]]
    _report(client, iid)
    assert [e for e, _ in sse_events(_report(client, iid).text)] == ["delta", "done"]


def test_v2_voice_in_measurements(v2_client, fake_claude, v2_settings):
    iid = start_ben(v2_client, {**COMPANY_START, "voiceAnalysisConsent": True})
    _two_turns(v2_client, iid)
    stored = {
        "syllables": 400,
        "fillers": {"count": 2, "examples": ["음"]},
        "confidence": {"level": "high", "reason": "또렷"},
        "tone": {"level": "calm", "reason": "차분"},
        "tremor": {"present": False, "reason": ""},
        "trailingOff": {"present": False, "reason": ""},
        "clarity": {"level": "good", "reason": "좋음"},
    }
    with open_db(v2_settings) as conn:
        voice.queue(conn, interview_id=iid, answer=1, now="2026-10-23T00:00:00.000Z")
        voice.finish(
            conn,
            interview_id=iid,
            answer=1,
            status="done",
            result_json=json.dumps(stored),
            error_code=None,
            now="2026-10-23T00:00:01.000Z",
        )
    fake_claude.replies = [[_raw()]]
    data = sse_events(_report(v2_client, iid, DELIVERY).text)[-2][1]
    assert data["items"][0]["measurements"]["voice"]["confidence"]["level"] == "high"


def test_replay_of_stored_v2_report_with_flag_off_still_sends_report(
    v2_client, fake_claude, v2_settings
):
    iid = start_ben(v2_client)
    _two_turns(v2_client, iid)
    fake_claude.replies = [[_raw()]]
    first = sse_events(_report(v2_client, iid).text)
    # 같은 앱·DB에서 플래그만 끈다
    v2_client.app.state.settings = dataclasses.replace(v2_settings, ben_report_v2=False)
    n = len(fake_claude.calls)
    again = sse_events(_report(v2_client, iid).text)
    assert [e for e, _ in again] == ["delta", "report", "done"]
    assert again[1][1] == first[-2][1]
    assert len(fake_claude.calls) == n


def test_v2_admission_with_posting_like_briefing_gets_no_posting(
    v2_client, fake_claude, v2_settings
):
    iid = start_ben(v2_client, ADMISSION_START)
    _two_turns(v2_client, iid)
    with open_db(v2_settings) as conn:
        conn.execute(
            "UPDATE premium_interviews SET briefing = ? WHERE id = ?", (POSTING_BRIEFING, iid)
        )
    fake_claude.replies = [[_raw()]]
    events = sse_events(_report(v2_client, iid).text)
    assert events[-2][1]["summary"]["postingFit"] is None
    call = fake_claude.calls[-1]
    assert "대용량 트래픽 결제" not in json.dumps(call["system"], ensure_ascii=False)
    assert prompts.POSTING_FIT_INSTRUCTION not in call["messages"][-1]["content"]


def test_v2_regeneration_records_usage_for_both_attempts(v2_client, fake_claude, v2_settings):
    iid = start_ben(v2_client)
    _two_turns(v2_client, iid)
    fake_claude.replies = [["not json"], [_raw()]]
    _report(v2_client, iid)
    with open_db(v2_settings) as conn:
        n = conn.execute(
            "SELECT COUNT(*) FROM claude_usage WHERE interview_id = ? AND kind = 'report'", (iid,)
        ).fetchone()[0]
    assert n == 2


def test_v2_no_answers_is_409_without_claude_or_attempt(v2_client, fake_claude, v2_settings):
    iid = start_ben(v2_client)
    v2_client.post(f"/api/premium/interviews/{iid}/turns", json={})  # 첫 질문만
    before = _row(v2_settings, iid)["attempts"]
    n = len(fake_claude.calls)
    res = _report(v2_client, iid)
    assert res.status_code == 409
    assert res.json() == {"error": "no_answers"}
    assert len(fake_claude.calls) == n
    assert _row(v2_settings, iid)["attempts"] == before


def test_v2_too_long_is_error_without_regeneration(v2_client, fake_claude, v2_settings):
    iid = start_ben(v2_client)
    _two_turns(v2_client, iid)
    fake_claude.replies = [["{", ClaudeError("too_long")], [_raw()]]
    n = len(fake_claude.calls)
    events = sse_events(_report(v2_client, iid).text)
    assert events[-1] == ("error", {"code": "too_long"})
    assert "reset" not in [e for e, _ in events]
    assert len(fake_claude.calls) == n + 1
    assert _row(v2_settings, iid)["status"] == "active"


def test_flag_off_request_is_exactly_the_v1_prompt(client, fake_claude, settings):
    iid = start_ben(client)
    _two_turns(client, iid)
    fake_claude.replies = [["[]"]]
    _report(client, iid)
    with open_db(settings) as conn:
        row = conn.execute("SELECT * FROM premium_interviews WHERE id = ?", (iid,)).fetchone()
        iv = premium._interview(row)
    call = fake_claude.calls[-1]
    assert call["system"] == prompts.build_system(iv.track, iv.inputs)
    assert call["messages"] == prompts.report_messages(iv.messages, None)
