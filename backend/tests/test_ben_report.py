from app.llm import prompts
from app.llm.claude import REPORT_MAX_TOKENS, ClaudeError
from tests.helpers import archive_body, open_db, sse_events, start_ben

REPORT_RAW = (
    '[{"question": "자기소개", "answerSummary": "요약", "feedback": "**근거**가 부족합니다."}]'
)


def _report(client, iid):
    return client.post(f"/api/premium/interviews/{iid}/report")


def _one_turn(client, iid) -> None:
    client.post(f"/api/premium/interviews/{iid}/turns", json={})


def _status(settings, iid) -> str:
    with open_db(settings) as conn:
        row = conn.execute("SELECT status FROM premium_interviews WHERE id = ?", (iid,)).fetchone()
    return row[0]


def test_report_streams_and_finishes(client, fake_claude, settings):
    iid = start_ben(client)
    _one_turn(client, iid)
    fake_claude.replies = [[REPORT_RAW[:20], REPORT_RAW[20:]]]
    events = sse_events(_report(client, iid).text)
    assert "".join(d["text"] for e, d in events if e == "delta") == REPORT_RAW
    assert events[-1] == ("done", {})
    call = fake_claude.calls[-1]
    assert call["effort"] == "medium"
    assert call["max_tokens"] == REPORT_MAX_TOKENS
    assert call["messages"][-1] == {"role": "user", "content": prompts.report_instruction()}
    assert _status(settings, iid) == "done"
    assert _report(client, iid).json() == {"error": "interview_over"}
    turn = client.post(f"/api/premium/interviews/{iid}/turns", json={"answer": "더"})
    assert turn.json() == {"error": "interview_over"}


def test_report_needs_a_turn_first(client):
    iid = start_ben(client)
    res = _report(client, iid)
    assert res.status_code == 409
    assert res.json() == {"error": "interview_not_started"}


def test_report_unknown_interview_is_404(client):
    start_ben(client)
    res = _report(client, "pi_NOPE")
    assert res.status_code == 404
    assert res.json() == {"error": "not_found"}


def test_failed_report_keeps_the_interview_active(client, fake_claude, settings):
    iid = start_ben(client)
    _one_turn(client, iid)
    fake_claude.replies = [[ClaudeError("claude_error")]]
    assert sse_events(_report(client, iid).text) == [("error", {"code": "claude_error"})]
    assert _status(settings, iid) == "active"
    assert sse_events(_report(client, iid).text)[-1] == ("done", {})


def test_empty_report_is_a_failure(client, fake_claude, settings):
    iid = start_ben(client)
    _one_turn(client, iid)
    fake_claude.replies = [["  "]]
    events = sse_events(_report(client, iid).text)
    assert events[-1] == ("error", {"code": "claude_error"})
    assert ("done", {}) not in events
    assert _status(settings, iid) == "active"


def test_finished_interview_can_be_archived_once(client):
    iid = start_ben(client)
    _one_turn(client, iid)
    _report(client, iid)
    body = archive_body(premium=True, premiumInterviewId=iid, interviewerId="m2")
    res = client.post("/api/archive", json=body)
    assert res.status_code == 201
    assert res.json()["entry"]["premium"] is True
    assert client.post("/api/archive", json=body).json() == {"error": "invalid_premium_interview"}
