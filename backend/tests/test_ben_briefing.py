import json
import threading
import time

from app.llm import prompts
from app.llm.claude import ClaudeError, ResearchResult
from app.routers import premium as premium_router
from tests.fakes import DEFAULT_BRIEFING
from tests.helpers import COMPANY_START, open_db, sse_events, start_ben

NAMED = {**COMPANY_START, "company": {**COMPANY_START["company"], "name": "토스(비바리퍼블리카)"}}
QUESTION = [
    ("delta", {"text": "자기소개를 "}),
    ("delta", {"text": "해 주세요."}),
    ("done", {"ended": False}),
]
RESEARCHING = ("status", {"phase": "researching"})
OK = ("status", {"phase": "briefing", "ok": True})
FAILED = ("status", {"phase": "briefing", "ok": False})


def _join_workers():
    for t in threading.enumerate():
        if t.name.startswith("briefing"):
            t.join(timeout=5)


def _turn(client, iid, answer=None):
    body = {} if answer is None else {"answer": answer}
    return client.post(f"/api/premium/interviews/{iid}/turns", json=body)


def _row(settings, iid):
    with open_db(settings) as conn:
        return conn.execute(
            "SELECT briefing, briefing_status, attempts FROM premium_interviews WHERE id = ?",
            (iid,),
        ).fetchone()


def _start_again(client, body=NAMED):
    res = client.post("/api/premium/interviews", json=body)
    assert res.status_code == 201, res.text
    return res.json()["interviewId"]


def test_first_turn_researches_then_asks(client, fake_claude, settings):
    iid = start_ben(client, NAMED)
    events = sse_events(_turn(client, iid).text)
    assert events == [RESEARCHING, OK, *QUESTION]
    # 조사에는 회사명·직무만 — 이력서는 보내지 않는다
    research = json.dumps(fake_claude.research_calls[0], ensure_ascii=False)
    assert "토스(비바리퍼블리카)" in research and "백엔드 개발자" in research
    assert COMPANY_START["resumeText"] not in research
    system = fake_claude.calls[0]["system"]
    assert len(system) == 3
    assert system[1]["text"].endswith(DEFAULT_BRIEFING)
    assert prompts.BRIEFING_FOCUS in system[0]["text"]
    row = _row(settings, iid)
    assert (row["briefing"], row["briefing_status"]) == (DEFAULT_BRIEFING, "ok")


def test_research_counts_an_attempt(client, settings):
    iid = start_ben(client, NAMED)
    _turn(client, iid)
    assert _row(settings, iid)["attempts"] == 2  # 질문 1 + 조사 1


def test_same_company_and_job_reuse_the_briefing_for_7_days(client, fake_claude, clock):
    _turn(client, start_ben(client, NAMED))
    events = sse_events(_turn(client, _start_again(client)).text)
    assert events == [OK, *QUESTION]
    assert len(fake_claude.research_calls) == 1
    clock.advance(7 * 24 * 3600 + 1)
    events = sse_events(_turn(client, _start_again(client)).text)
    assert events[:2] == [RESEARCHING, OK]
    assert len(fake_claude.research_calls) == 2


def test_research_failure_continues_without_briefing(client, fake_claude, settings):
    fake_claude.research_results = [ClaudeError("claude_error")]
    iid = start_ben(client, NAMED)
    assert sse_events(_turn(client, iid).text) == [RESEARCHING, FAILED, *QUESTION]
    assert len(fake_claude.calls[0]["system"]) == 2
    row = _row(settings, iid)
    assert (row["briefing"], row["briefing_status"]) == (None, "failed")


def test_short_research_is_a_failure(client, fake_claude):
    fake_claude.research_results = [ResearchResult(text="짧다", sources=[])]
    iid = start_ben(client, NAMED)
    assert sse_events(_turn(client, iid).text)[:2] == [RESEARCHING, FAILED]


def test_retry_after_question_failure_does_not_research_again(client, fake_claude):
    fake_claude.replies = [[ClaudeError("claude_error")]]
    iid = start_ben(client, NAMED)
    assert sse_events(_turn(client, iid).text) == [
        RESEARCHING,
        OK,
        ("error", {"code": "claude_error"}),
    ]
    assert sse_events(_turn(client, iid).text) == [OK, *QUESTION]
    assert len(fake_claude.research_calls) == 1
    assert fake_claude.calls[1]["system"][1]["text"].endswith(DEFAULT_BRIEFING)


def test_later_turns_have_no_status_but_keep_the_briefing(client, fake_claude):
    iid = start_ben(client, NAMED)
    _turn(client, iid)
    events = sse_events(_turn(client, iid, answer="안녕하세요").text)
    assert events == QUESTION
    assert fake_claude.calls[1]["system"][1]["text"].endswith(DEFAULT_BRIEFING)


def test_without_a_name_nothing_changes(client, fake_claude):
    iid = start_ben(client)
    assert sse_events(_turn(client, iid).text) == QUESTION
    assert fake_claude.research_calls == []
    assert len(fake_claude.calls[0]["system"]) == 2


def test_report_does_not_see_the_briefing(client, fake_claude):
    iid = start_ben(client, NAMED)
    _turn(client, iid)
    client.post(f"/api/premium/interviews/{iid}/report")
    system = fake_claude.calls[-1]["system"]
    assert len(system) == 2
    assert DEFAULT_BRIEFING not in json.dumps(system, ensure_ascii=False)


def test_pings_while_researching(client, fake_claude, monkeypatch):
    monkeypatch.setattr(premium_router, "PING_EVERY", 0.05)
    original = fake_claude.research

    def slow(**kwargs):
        time.sleep(0.2)
        return original(**kwargs)

    fake_claude.research = slow
    iid = start_ben(client, NAMED)
    text = _turn(client, iid).text
    assert text.count(": ping") >= 2  # 맨 앞 1 + 조사 중 1 이상
    assert sse_events(text)[:2] == [RESEARCHING, OK]


def test_research_over_the_deadline_is_a_failure(client, fake_claude, monkeypatch):
    monkeypatch.setattr(premium_router, "PING_EVERY", 0.05)
    monkeypatch.setattr(premium_router, "RESEARCH_DEADLINE", 0.1)
    original = fake_claude.research

    def stuck(**kwargs):
        time.sleep(0.5)
        return original(**kwargs)

    fake_claude.research = stuck
    iid = start_ben(client, NAMED)
    assert sse_events(_turn(client, iid).text)[:2] == [RESEARCHING, FAILED]
    _join_workers()


def test_late_research_still_fills_the_cache(client, fake_claude, settings, monkeypatch):
    monkeypatch.setattr(premium_router, "PING_EVERY", 0.05)
    monkeypatch.setattr(premium_router, "RESEARCH_DEADLINE", 0.1)
    original = fake_claude.research

    def late(**kwargs):
        time.sleep(0.4)
        return original(**kwargs)

    fake_claude.research = late
    iid = start_ben(client, NAMED)
    assert sse_events(_turn(client, iid).text)[:2] == [RESEARCHING, FAILED]
    _join_workers()
    assert _row(settings, iid)["briefing_status"] == "failed"
    fake_claude.research = original
    events = sse_events(_turn(client, _start_again(client)).text)
    assert events == [OK, *QUESTION]
    assert len(fake_claude.research_calls) == 1


def test_unexpected_research_exception_is_a_failure(client, fake_claude, settings):
    def boom(**kwargs):
        raise RuntimeError("boom")

    fake_claude.research = boom
    iid = start_ben(client, NAMED)
    assert sse_events(_turn(client, iid).text) == [RESEARCHING, FAILED, *QUESTION]
    assert _row(settings, iid)["briefing_status"] == "failed"
    _join_workers()


def test_retry_after_failed_research_does_not_research_again(client, fake_claude):
    fake_claude.research_results = [ClaudeError("claude_error")]
    fake_claude.replies = [[ClaudeError("claude_error")]]
    iid = start_ben(client, NAMED)
    assert sse_events(_turn(client, iid).text) == [
        RESEARCHING,
        FAILED,
        ("error", {"code": "claude_error"}),
    ]
    assert sse_events(_turn(client, iid).text) == [FAILED, *QUESTION]
    assert len(fake_claude.research_calls) == 1
    assert len(fake_claude.calls[1]["system"]) == 2
