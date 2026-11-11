import json
import threading
import time

from app.llm import prompts
from app.llm.claude import ClaudeError
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


def test_first_turn_researches_then_asks(client, fake_claude, fake_collector, settings):
    iid = start_ben(client, NAMED)
    events = sse_events(_turn(client, iid).text)
    assert events == [RESEARCHING, OK, *QUESTION]
    # 모으기에는 회사명·직무만, 요약에도 이력서는 보내지 않는다
    assert fake_collector.calls == [("토스(비바리퍼블리카)", "백엔드 개발자", None)]
    research = json.dumps(fake_claude.complete_calls[0], ensure_ascii=False)
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


def test_same_company_and_job_reuse_the_briefing_for_7_days(
    client, fake_claude, fake_collector, clock
):
    _turn(client, start_ben(client, NAMED))
    events = sse_events(_turn(client, _start_again(client)).text)
    assert events == [OK, *QUESTION]
    assert len(fake_collector.calls) == 1
    assert len(fake_claude.complete_calls) == 1
    clock.advance(7 * 24 * 3600 + 1)
    events = sse_events(_turn(client, _start_again(client)).text)
    assert events[:2] == [RESEARCHING, OK]
    assert len(fake_collector.calls) == 2
    assert len(fake_claude.complete_calls) == 2


def test_research_failure_continues_without_briefing(client, fake_claude, settings):
    fake_claude.complete_results = [ClaudeError("claude_error")]
    iid = start_ben(client, NAMED)
    assert sse_events(_turn(client, iid).text) == [RESEARCHING, FAILED, *QUESTION]
    assert len(fake_claude.calls[0]["system"]) == 2
    row = _row(settings, iid)
    assert (row["briefing"], row["briefing_status"]) == (None, "failed")


def test_short_research_is_a_failure(client, fake_claude):
    fake_claude.complete_results = ["짧다"]
    iid = start_ben(client, NAMED)
    assert sse_events(_turn(client, iid).text)[:2] == [RESEARCHING, FAILED]


def test_retry_after_question_failure_does_not_research_again(client, fake_claude, fake_collector):
    fake_claude.replies = [[ClaudeError("claude_error")]]
    iid = start_ben(client, NAMED)
    assert sse_events(_turn(client, iid).text) == [
        RESEARCHING,
        OK,
        ("error", {"code": "claude_error"}),
    ]
    assert sse_events(_turn(client, iid).text) == [OK, *QUESTION]
    assert len(fake_collector.calls) == 1
    assert len(fake_claude.complete_calls) == 1
    assert fake_claude.calls[1]["system"][1]["text"].endswith(DEFAULT_BRIEFING)


def test_later_turns_have_no_status_but_keep_the_briefing(client, fake_claude):
    iid = start_ben(client, NAMED)
    _turn(client, iid)
    events = sse_events(_turn(client, iid, answer="안녕하세요").text)
    assert events == QUESTION
    assert fake_claude.calls[1]["system"][1]["text"].endswith(DEFAULT_BRIEFING)


def test_without_a_name_nothing_changes(client, fake_claude, fake_collector):
    iid = start_ben(client)
    assert sse_events(_turn(client, iid).text) == QUESTION
    assert fake_collector.calls == []
    assert fake_claude.complete_calls == []
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
    original = fake_claude.complete

    def slow(**kwargs):
        time.sleep(0.2)
        return original(**kwargs)

    fake_claude.complete = slow
    iid = start_ben(client, NAMED)
    text = _turn(client, iid).text
    assert text.count(": ping") >= 2  # 맨 앞 1 + 조사 중 1 이상
    assert sse_events(text)[:2] == [RESEARCHING, OK]


def test_research_over_the_deadline_is_a_failure(client, fake_claude, monkeypatch):
    monkeypatch.setattr(premium_router, "PING_EVERY", 0.05)
    monkeypatch.setattr(premium_router, "RESEARCH_DEADLINE", 0.1)
    original = fake_claude.complete

    def stuck(**kwargs):
        time.sleep(0.5)
        return original(**kwargs)

    fake_claude.complete = stuck
    iid = start_ben(client, NAMED)
    assert sse_events(_turn(client, iid).text)[:2] == [RESEARCHING, FAILED]
    _join_workers()


def test_late_research_still_fills_the_cache(client, fake_claude, settings, monkeypatch):
    monkeypatch.setattr(premium_router, "PING_EVERY", 0.05)
    monkeypatch.setattr(premium_router, "RESEARCH_DEADLINE", 0.1)
    original = fake_claude.complete

    def late(**kwargs):
        time.sleep(0.4)
        return original(**kwargs)

    fake_claude.complete = late
    iid = start_ben(client, NAMED)
    assert sse_events(_turn(client, iid).text)[:2] == [RESEARCHING, FAILED]
    _join_workers()
    assert _row(settings, iid)["briefing_status"] == "failed"
    fake_claude.complete = original
    events = sse_events(_turn(client, _start_again(client)).text)
    assert events == [OK, *QUESTION]
    assert len(fake_claude.complete_calls) == 1


def test_unexpected_research_exception_is_a_failure(client, fake_claude, settings):
    def boom(**kwargs):
        raise RuntimeError("boom")

    fake_claude.complete = boom
    iid = start_ben(client, NAMED)
    assert sse_events(_turn(client, iid).text) == [RESEARCHING, FAILED, *QUESTION]
    assert _row(settings, iid)["briefing_status"] == "failed"
    _join_workers()


def test_retry_after_failed_research_does_not_research_again(client, fake_claude, fake_collector):
    fake_claude.complete_results = [ClaudeError("claude_error")]
    fake_claude.replies = [[ClaudeError("claude_error")]]
    iid = start_ben(client, NAMED)
    assert sse_events(_turn(client, iid).text) == [
        RESEARCHING,
        FAILED,
        ("error", {"code": "claude_error"}),
    ]
    assert sse_events(_turn(client, iid).text) == [FAILED, *QUESTION]
    assert len(fake_collector.calls) == 1
    assert len(fake_claude.complete_calls) == 1
    assert len(fake_claude.calls[1]["system"]) == 2


POSTING = "https://www.wanted.co.kr/wd/1"
URL_ONLY = {**COMPANY_START, "company": {**COMPANY_START["company"], "postingUrl": POSTING}}


def _posting_read(fake_collector):
    """공고 본문을 실제로 읽은 모으기 결과 — 캐시 대상."""
    from app.llm.briefing import Material
    from app.llm.naver import Doc

    fake_collector.material = Material(
        posting=Doc("posting", "모집공고", "Kotlin 결제 백엔드 " * 30, POSTING),
        found=fake_collector.material.found,
        posting_url=POSTING,
    )


def test_posting_url_only_researches_on_the_first_turn(
    client, fake_claude, fake_collector, settings
):
    iid = start_ben(client, URL_ONLY)
    events = sse_events(_turn(client, iid).text)
    assert events == [RESEARCHING, OK, *QUESTION]
    # 공고 링크는 모으기에 넘어간다(공고 페이지 읽기)
    assert fake_collector.calls == [("", "백엔드 개발자", POSTING)]
    assert len(fake_claude.complete_calls) == 1
    call = fake_claude.complete_calls[0]
    assert COMPANY_START["resumeText"] not in json.dumps(call, ensure_ascii=False)
    assert _row(settings, iid)["briefing_status"] == "ok"


def test_cache_depends_on_the_posting_url(client, fake_collector):
    _posting_read(fake_collector)
    other = {**URL_ONLY, "company": {**URL_ONLY["company"], "postingUrl": POSTING + "2"}}
    _turn(client, start_ben(client, URL_ONLY))
    assert sse_events(_turn(client, _start_again(client, URL_ONLY)).text) == [OK, *QUESTION]
    assert len(fake_collector.calls) == 1
    sse_events(_turn(client, _start_again(client, other)).text)
    assert [c[2] for c in fake_collector.calls] == [POSTING, POSTING + "2"]


def test_name_only_research_has_no_fetch_domains(client, fake_collector):
    # 공고 링크가 없으면 공고 페이지를 읽지 않는다(공고 링크 None)
    _turn(client, start_ben(client, NAMED))
    assert fake_collector.calls[0][2] is None


FAILED_POSTING_TEXT = (
    "사업: 간편송금 서비스 운영 " * 20 + "\n## 모집공고 요구사항\n공고를 확인하지 못함"
)


def test_failed_posting_read_is_not_cached(client, fake_claude, fake_collector, settings):
    _posting_read(fake_collector)  # 본문은 읽었어도 요약이 "확인하지 못함"이면 캐시하지 않는다
    fake_claude.complete_results = [FAILED_POSTING_TEXT]
    iid = start_ben(client, URL_ONLY)
    assert sse_events(_turn(client, iid).text) == [RESEARCHING, OK, *QUESTION]
    _join_workers()
    assert _row(settings, iid)["briefing"] == FAILED_POSTING_TEXT
    # 같은 URL의 다음 면접은 캐시 없이 다시 조사한다
    assert sse_events(_turn(client, _start_again(client, URL_ONLY)).text)[0] == RESEARCHING
    assert len(fake_collector.calls) == 2
    assert len(fake_claude.complete_calls) == 2


def test_unread_posting_is_not_cached_even_if_the_summary_hides_it(
    client, fake_claude, fake_collector, settings
):
    from app.llm.briefing import Material

    # 공고 링크는 있었지만 공고를 못 읽었다. 요약이 "확인하지 못함"을 빼먹어도 캐시하지 않는다
    fake_collector.material = Material(
        posting=None, found=fake_collector.material.found, posting_url=POSTING
    )
    assert prompts.POSTING_MISSING_STEM not in DEFAULT_BRIEFING
    iid = start_ben(client, URL_ONLY)
    assert sse_events(_turn(client, iid).text) == [RESEARCHING, OK, *QUESTION]
    _join_workers()
    assert _row(settings, iid)["briefing"] == DEFAULT_BRIEFING
    assert sse_events(_turn(client, _start_again(client, URL_ONLY)).text)[0] == RESEARCHING
    assert len(fake_collector.calls) == 2


def test_name_and_posting_url_are_both_researched_and_keyed(client, fake_claude, fake_collector):
    _posting_read(fake_collector)
    both = {
        **URL_ONLY,
        "company": {**URL_ONLY["company"], "name": "토스(비바리퍼블리카)"},
    }
    _turn(client, start_ben(client, both))
    assert fake_collector.calls == [("토스(비바리퍼블리카)", "백엔드 개발자", POSTING)]
    content = fake_claude.complete_calls[0]["messages"][0]["content"]
    assert "토스(비바리퍼블리카)" in content
    assert "(공고에서 확인)" not in content
    # 같은 이름+URL은 캐시, 이름이 없으면 다른 키라 새로 조사
    assert sse_events(_turn(client, _start_again(client, both)).text) == [OK, *QUESTION]
    assert len(fake_collector.calls) == 1
    sse_events(_turn(client, _start_again(client, URL_ONLY)).text)
    assert len(fake_collector.calls) == 2


def test_research_deadline_is_10_seconds():
    # 시작 → 첫 질문 15초 안(spec 2026-11-08)
    assert premium_router.RESEARCH_DEADLINE == 10.0


def test_research_usage_is_recorded_with_haiku(client, settings):
    _turn(client, start_ben(client, NAMED))
    with open_db(settings) as conn:
        row = conn.execute("SELECT model FROM claude_usage WHERE kind = 'research'").fetchone()
    assert row["model"] == "claude-haiku-5-5"


def test_empty_material_skips_claude_and_continues(client, fake_claude, fake_collector):
    from app.llm.briefing import Material

    fake_collector.material = Material(posting=None, found=[], posting_url=None)
    iid = start_ben(client, NAMED)
    assert sse_events(_turn(client, iid).text) == [RESEARCHING, FAILED, *QUESTION]
    assert fake_claude.complete_calls == []


def test_deadline_is_enforced_before_the_first_ping(client, fake_claude, monkeypatch):
    # ping 간격이 기한보다 길어도 기한에서 바로 포기한다(예전엔 ping 간격만큼 더 기다렸다).
    # 요약은 문이 열릴 때까지 막아 두고, 차이(기한 0.1초 vs ping 5초)를 크게 잡아 느린 기계에서도 안정적이다
    monkeypatch.setattr(premium_router, "PING_EVERY", 5.0)
    monkeypatch.setattr(premium_router, "RESEARCH_DEADLINE", 0.1)
    original = fake_claude.complete
    release = threading.Event()

    def gated(**kwargs):
        release.wait(5)
        return original(**kwargs)

    fake_claude.complete = gated
    iid = start_ben(client, NAMED)
    started = time.monotonic()
    text = _turn(client, iid).text
    elapsed = time.monotonic() - started
    release.set()
    _join_workers()
    assert sse_events(text)[:2] == [RESEARCHING, FAILED]
    assert elapsed < 2.0
