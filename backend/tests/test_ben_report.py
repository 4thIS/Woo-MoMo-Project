import pytest

from app.llm import prompts
from app.llm.claude import REPORT_MAX_TOKENS, ClaudeError
from app.repos import premium
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


def test_repeated_report_replays_the_stored_raw_without_claude(client, fake_claude, settings):
    iid = start_ben(client)
    _one_turn(client, iid)
    fake_claude.replies = [[REPORT_RAW[:20], REPORT_RAW[20:]]]
    _report(client, iid)
    with open_db(settings) as conn:
        row = conn.execute(
            "SELECT report_raw FROM premium_interviews WHERE id = ?", (iid,)
        ).fetchone()
    assert row[0] == REPORT_RAW
    calls = len(fake_claude.calls)
    res = _report(client, iid)
    assert res.status_code == 200
    assert res.text.startswith(": ping\n\n")
    assert sse_events(res.text) == [("delta", {"text": REPORT_RAW}), ("done", {})]
    assert len(fake_claude.calls) == calls


def test_unexpected_report_error_is_server_error(client, fake_claude, settings):
    iid = start_ben(client)
    _one_turn(client, iid)
    fake_claude.replies = [[RuntimeError("boom")]]
    assert sse_events(_report(client, iid).text) == [("error", {"code": "server_error"})]
    assert _status(settings, iid) == "active"


def test_report_counts_an_attempt_and_respects_the_cap(client, fake_claude, settings):
    iid = start_ben(client)
    _one_turn(client, iid)
    with open_db(settings) as conn:
        conn.execute(
            "UPDATE premium_interviews SET attempts = ? WHERE id = ?", (premium.MAX_ATTEMPTS, iid)
        )
    calls = len(fake_claude.calls)
    res = _report(client, iid)
    assert res.status_code == 409
    assert res.json() == {"error": "interview_over"}
    assert len(fake_claude.calls) == calls


METRIC = {
    "answer": 1,
    "speechSec": 60,
    "syllables": 300,
    "longPauses": 1,
    "longestPauseSec": 2.5,
    "firstWordSec": 1.5,
    "fillerLevel": "normal",
}


def _answered(client, iid, n=1):
    _one_turn(client, iid)
    for i in range(n - 1):
        client.post(f"/api/premium/interviews/{iid}/turns", json={"answer": f"답 {i}"})


def test_report_with_delivery_appends_the_block(client, fake_claude):
    iid = start_ben(client)
    _answered(client, iid, 2)  # 사용자 답변 1개
    fake_claude.replies = [[REPORT_RAW]]
    res = client.post(f"/api/premium/interviews/{iid}/report", json={"delivery": [METRIC]})
    assert sse_events(res.text)[-1] == ("done", {})
    content = fake_claude.calls[-1]["messages"][-1]["content"]
    assert content.startswith(prompts.report_instruction())
    assert prompts.DELIVERY_INSTRUCTION in content
    assert content.endswith(
        "답변 1: 분당 300음절(보통), 2초 이상 쉼 1회·말한 1분당 1.0회(적음), "
        "가장 긴 쉼 2.5초, 첫마디까지 1.5초(보통), 군말 보통"
    )


@pytest.mark.parametrize("body", [None, {}, {"delivery": []}])
def test_report_without_delivery_is_unchanged(client, fake_claude, body):
    iid = start_ben(client)
    _one_turn(client, iid)
    fake_claude.replies = [[REPORT_RAW]]
    url = f"/api/premium/interviews/{iid}/report"
    res = client.post(url) if body is None else client.post(url, json=body)
    assert res.status_code == 200
    assert fake_claude.calls[-1]["messages"][-1] == {
        "role": "user",
        "content": prompts.report_instruction(),
    }


@pytest.mark.parametrize(
    "delivery",
    [
        [{**METRIC, "answer": 2}],  # 실제 답변은 1개
        [METRIC, METRIC],  # 번호 중복
        [{**METRIC, "speechSec": -1}],
        [{**METRIC, "syllables": 5001}],
        [{**METRIC, "fillerLevel": "loud"}],
        [{**METRIC, "answer": i} for i in range(1, 10)],  # 9개
        "nope",
    ],
)
def test_bad_delivery_is_422_without_claude_or_attempt(client, fake_claude, settings, delivery):
    iid = start_ben(client)
    _answered(client, iid, 2)
    calls = len(fake_claude.calls)
    with open_db(settings) as conn:
        before = conn.execute(
            "SELECT attempts FROM premium_interviews WHERE id = ?", (iid,)
        ).fetchone()[0]
    res = client.post(f"/api/premium/interviews/{iid}/report", json={"delivery": delivery})
    assert res.status_code == 422
    assert res.json() == {"error": "invalid", "field": "delivery"}
    assert len(fake_claude.calls) == calls
    with open_db(settings) as conn:
        after = conn.execute(
            "SELECT attempts FROM premium_interviews WHERE id = ?", (iid,)
        ).fetchone()[0]
    assert after == before


def test_non_object_body_is_422_delivery(client, fake_claude):
    iid = start_ben(client)
    _one_turn(client, iid)
    res = client.post(f"/api/premium/interviews/{iid}/report", json=[1])
    assert res.status_code == 422
    assert res.json() == {"error": "invalid", "field": "delivery"}


def test_done_report_ignores_delivery(client, fake_claude):
    iid = start_ben(client)
    _one_turn(client, iid)
    fake_claude.replies = [[REPORT_RAW]]
    _report(client, iid)
    calls = len(fake_claude.calls)
    res = client.post(f"/api/premium/interviews/{iid}/report", json={"delivery": [METRIC]})
    assert "".join(d["text"] for e, d in sse_events(res.text) if e == "delta") == REPORT_RAW
    assert len(fake_claude.calls) == calls


@pytest.mark.parametrize(
    "bad",
    [
        {"answer": 0},
        {"longPauses": 201},
        {"firstWordSec": 601},
    ],
)
def test_out_of_range_metric_is_422_delivery(client, fake_claude, bad):
    iid = start_ben(client)
    _answered(client, iid, 2)
    res = client.post(
        f"/api/premium/interviews/{iid}/report", json={"delivery": [{**METRIC, **bad}]}
    )
    assert res.status_code == 422
    assert res.json() == {"error": "invalid", "field": "delivery"}


def test_null_filler_level_is_accepted_without_filler_text(client, fake_claude):
    iid = start_ben(client)
    _answered(client, iid, 2)
    fake_claude.replies = [[REPORT_RAW]]
    res = client.post(
        f"/api/premium/interviews/{iid}/report",
        json={"delivery": [{**METRIC, "fillerLevel": None}]},
    )
    assert res.status_code == 200
    content = fake_claude.calls[-1]["messages"][-1]["content"]
    block = content.split("[답변별 전달력 측정]", 1)[1]
    assert "군말" not in block


# ── 목소리 분석 합치기 ──

import time  # noqa: E402

from app.llm.baze import VoiceResult  # noqa: E402
from app.repos import voice as voice_repo  # noqa: E402
from app.routers import premium as premium_router  # noqa: E402
from tests.fakes import DEFAULT_VOICE_RESULT  # noqa: E402

VOICE_LINE = (
    "답변 1: 분당 300음절(보통), 2초 이상 쉼 1회·말한 1분당 1.0회(적음), "
    "가장 긴 쉼 2.5초, 첫마디까지 1.5초(보통), 군말 적음, "
    "목소리: 자신감 보통·어조 차분·떨림 없음·끝 흐려짐 없음·발음 좋음 "
    "(근거: 자신감 또박또박 말함 / 어조 일정한 속도 / 떨림 떨림 없음 "
    "/ 끝 흐려짐 끝까지 말함 / 발음 발음이 또렷함)"
)


def _voice_result(syllables=300) -> str:
    data = {**DEFAULT_VOICE_RESULT, "transcript": "가" * syllables}
    return VoiceResult.model_validate(data).model_dump_json()


def _consent_interview(client, consent=True) -> str:
    from tests.helpers import COMPANY_START

    iid = start_ben(client, {**COMPANY_START, "voiceAnalysisConsent": consent})
    _answered(client, iid, 2)
    return iid


def _put_voice(settings, iid, answer=1, status="done", syllables=300):
    with open_db(settings) as conn:
        voice_repo.queue(conn, interview_id=iid, answer=answer, now="2026-10-23T00:00:00.000Z")
        if status != "queued":
            voice_repo.finish(
                conn,
                interview_id=iid,
                answer=answer,
                status=status,
                result_json=_voice_result(syllables) if status == "done" else None,
                error_code=None if status == "done" else "x",
                now="2026-10-23T00:00:01.000Z",
            )
        conn.commit()


def _post_report(client, iid, delivery=(METRIC,)):
    return client.post(f"/api/premium/interviews/{iid}/report", json={"delivery": list(delivery)})


def test_consented_done_voice_is_merged_with_note(client, fake_claude, settings):
    iid = _consent_interview(client)
    _put_voice(settings, iid)
    fake_claude.replies = [[REPORT_RAW]]
    res = _post_report(client, iid, [{**METRIC, "syllables": 1}])
    assert sse_events(res.text)[-1] == ("done", {})
    content = fake_claude.calls[-1]["messages"][-1]["content"]
    assert content == (
        f"{prompts.report_instruction()}\n\n{prompts.DELIVERY_INSTRUCTION} {prompts.VOICE_NOTE}"
        f"\n\n[답변별 전달력 측정]\n{VOICE_LINE}"
    )


def test_no_consent_ignores_stored_voice_results(client, fake_claude, settings):
    iid = _consent_interview(client, consent=False)
    _put_voice(settings, iid)
    fake_claude.replies = [[REPORT_RAW]]
    _post_report(client, iid)
    content = fake_claude.calls[-1]["messages"][-1]["content"]
    assert prompts.VOICE_NOTE not in content and "목소리:" not in content
    assert content.endswith("첫마디까지 1.5초(보통), 군말 보통")


def test_consent_without_results_is_byte_identical(client, fake_claude, settings):
    iid = _consent_interview(client)
    fake_claude.replies = [[REPORT_RAW]]
    _post_report(client, iid)
    content = fake_claude.calls[-1]["messages"][-1]["content"]
    assert prompts.VOICE_NOTE not in content
    assert content == (
        f"{prompts.report_instruction()}\n\n{prompts.DELIVERY_INSTRUCTION}\n\n"
        "[답변별 전달력 측정]\n"
        "답변 1: 분당 300음절(보통), 2초 이상 쉼 1회·말한 1분당 1.0회(적음), "
        "가장 긴 쉼 2.5초, 첫마디까지 1.5초(보통), 군말 보통"
    )


def test_failed_voice_is_not_merged_and_voice_alone_adds_nothing(client, fake_claude, settings):
    iid = _consent_interview(client)
    _put_voice(settings, iid, status="failed")
    fake_claude.replies = [[REPORT_RAW]]
    _post_report(client, iid)
    assert prompts.VOICE_NOTE not in fake_claude.calls[-1]["messages"][-1]["content"]
    # 브라우저 측정이 없으면 목소리만으로는 줄을 만들지 않는다
    iid2 = _consent_interview(client)
    _put_voice(settings, iid2)
    fake_claude.replies = [[REPORT_RAW]]
    _post_report(client, iid2, [])
    assert fake_claude.calls[-1]["messages"][-1]["content"] == prompts.report_instruction()


def test_queued_voice_is_awaited_with_pings_then_merged(client, fake_claude, settings, monkeypatch):
    import threading

    monkeypatch.setattr(premium_router, "VOICE_WAIT_SEC", 5.0)
    monkeypatch.setattr(premium_router, "VOICE_PING_EVERY", 0.05)
    monkeypatch.setattr(premium_router, "VOICE_POLL_SEC", 0.01)
    iid = _consent_interview(client)
    _put_voice(settings, iid, status="queued")
    threading.Timer(0.3, lambda: _put_voice(settings, iid)).start()
    fake_claude.replies = [[REPORT_RAW]]
    res = _post_report(client, iid)
    assert res.text.count(": ping") >= 3  # 맨 앞 1개 + 기다리는 동안
    assert sse_events(res.text)[-1] == ("done", {})
    assert prompts.VOICE_NOTE in fake_claude.calls[-1]["messages"][-1]["content"]


def test_queued_voice_times_out_and_report_goes_without_it(
    client, fake_claude, settings, monkeypatch
):
    monkeypatch.setattr(premium_router, "VOICE_WAIT_SEC", 0.2)
    monkeypatch.setattr(premium_router, "VOICE_POLL_SEC", 0.01)
    iid = _consent_interview(client)
    _put_voice(settings, iid, status="queued")
    fake_claude.replies = [[REPORT_RAW]]
    started = time.monotonic()
    res = _post_report(client, iid)
    assert time.monotonic() - started < 3
    assert sse_events(res.text)[-1] == ("done", {})
    assert "목소리:" not in fake_claude.calls[-1]["messages"][-1]["content"]


def test_queued_voice_for_answer_without_browser_metric_is_not_awaited(
    client, fake_claude, settings, monkeypatch
):
    monkeypatch.setattr(premium_router, "VOICE_WAIT_SEC", 30.0)
    iid = _consent_interview(client)
    _put_voice(settings, iid, status="queued")
    fake_claude.replies = [[REPORT_RAW]]
    started = time.monotonic()
    _post_report(client, iid, [])
    assert time.monotonic() - started < 3
