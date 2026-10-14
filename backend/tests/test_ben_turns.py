import json

from app.llm import prompts
from app.llm.claude import TURN_MAX_TOKENS, ClaudeError
from app.repos import premium
from tests.helpers import logout, make_premium, open_db, signup, sse_events, start_ben


def _turn(client, iid, answer=None):
    body = {} if answer is None else {"answer": answer}
    return client.post(f"/api/premium/interviews/{iid}/turns", json=body)


def _row(settings, iid):
    with open_db(settings) as conn:
        return conn.execute(
            "SELECT messages_json, model_turns, status FROM premium_interviews WHERE id = ?", (iid,)
        ).fetchone()


def test_first_turn_streams_the_first_question(client, fake_claude, settings):
    iid = start_ben(client)
    res = _turn(client, iid, answer="첫 턴의 답변은 무시된다")
    assert res.status_code == 200
    assert res.headers["content-type"].startswith("text/event-stream")
    assert sse_events(res.text) == [
        ("delta", {"text": "자기소개를 "}),
        ("delta", {"text": "해 주세요."}),
        ("done", {"ended": False}),
    ]
    call = fake_claude.calls[0]
    assert call["effort"] == "low"
    assert call["max_tokens"] == TURN_MAX_TOKENS
    assert call["messages"] == [{"role": "user", "content": prompts.KICKOFF}]
    assert call["system"][-1]["cache_control"] == {"type": "ephemeral"}
    row = _row(settings, iid)
    assert row["model_turns"] == 1
    assert json.loads(row["messages_json"]) == [{"role": "model", "text": "자기소개를 해 주세요."}]


def test_answer_is_sent_and_recorded(client, fake_claude, settings):
    iid = start_ben(client)
    _turn(client, iid)
    res = _turn(client, iid, answer="  안녕하세요, 이우진입니다. ")
    assert sse_events(res.text)[-1] == ("done", {"ended": False})
    assert fake_claude.calls[1]["messages"][-2:] == [
        {"role": "assistant", "content": "자기소개를 해 주세요."},
        {"role": "user", "content": "안녕하세요, 이우진입니다."},
    ]
    roles = [m["role"] for m in json.loads(_row(settings, iid)["messages_json"])]
    assert roles == ["model", "user", "model"]


def test_later_turns_need_an_answer(client):
    iid = start_ben(client)
    _turn(client, iid)
    res = _turn(client, iid, answer="   ")
    assert res.status_code == 422
    assert res.json() == {"error": "missing_answer", "field": "answer"}


def test_answer_is_at_most_2000_chars(client):
    iid = start_ben(client)
    _turn(client, iid)
    res = _turn(client, iid, answer="가" * 2001)
    assert res.status_code == 422
    assert res.json() == {"error": "answer_too_long", "field": "answer"}
    assert sse_events(_turn(client, iid, answer="가" * 2000).text)[-1][0] == "done"


def test_failed_turn_is_not_recorded_and_can_be_retried(client, fake_claude, settings):
    iid = start_ben(client)
    fake_claude.replies = [["부분", ClaudeError("claude_error")]]
    res = _turn(client, iid)
    assert sse_events(res.text) == [
        ("delta", {"text": "부분"}),
        ("error", {"code": "claude_error"}),
    ]
    row = _row(settings, iid)
    assert (row["model_turns"], row["messages_json"]) == (0, "[]")
    assert client.get("/api/me").json()["tickets"] == 9  # 티켓은 돌려주지 않는다
    retry = _turn(client, iid)
    assert sse_events(retry.text)[-1] == ("done", {"ended": False})
    assert _row(settings, iid)["model_turns"] == 1


def test_refusal_code_is_passed_through(client, fake_claude):
    iid = start_ben(client)
    fake_claude.replies = [[ClaudeError("refused")]]
    assert sse_events(_turn(client, iid).text) == [("error", {"code": "refused"})]


def test_end_phrase_ends_the_interview(client, fake_claude):
    iid = start_ben(client)
    fake_claude.replies = [["수고하셨습니다. 면접을 마치겠습니다."]]
    assert sse_events(_turn(client, iid).text)[-1] == ("done", {"ended": True})
    res = _turn(client, iid, answer="더 할 말")
    assert res.status_code == 409
    assert res.json() == {"error": "interview_over"}


def test_at_most_15_interviewer_turns(client, clock):
    iid = start_ben(client)
    last = None
    for i in range(15):
        clock.advance(11)  # 벤 요청 제한(분당 6회) 안에서
        res = _turn(client, iid, answer=None if i == 0 else f"답변 {i}")
        last = sse_events(res.text)[-1]
    assert last == ("done", {"ended": True})
    clock.advance(11)
    assert _turn(client, iid, answer="16번째").json() == {"error": "interview_over"}


def test_other_users_interview_is_404(client, settings):
    iid = start_ben(client)
    logout(client)
    me = signup(client, email="b@b.com")
    make_premium(settings, me["userId"])
    res = _turn(client, iid)
    assert res.status_code == 404
    assert res.json() == {"error": "not_found"}


def test_member_is_forbidden(client):
    iid = start_ben(client)
    logout(client)
    signup(client, email="b@b.com")
    assert _turn(client, iid).json() == {"error": "premium_required"}


def test_overlapping_turn_is_not_recorded(client, fake_claude, settings, monkeypatch):
    iid = start_ben(client)
    real = fake_claude.stream_text

    def racing(**kwargs):
        # 스트리밍 중에 다른 요청이 먼저 턴을 기록한 상황
        with open_db(settings) as other:
            premium.append_turn(
                other,
                interview_id=iid,
                answer=None,
                model_text="먼저 온 질문",
                expected_model_turns=0,
            )
        yield from real(**kwargs)

    monkeypatch.setattr(fake_claude, "stream_text", racing)
    events = sse_events(_turn(client, iid).text)
    assert events[-1] == ("error", {"code": "turn_conflict"})
    assert all(name != "done" for name, _ in events)
    row = _row(settings, iid)
    assert row["model_turns"] == 1
    assert json.loads(row["messages_json"]) == [{"role": "model", "text": "먼저 온 질문"}]


def test_empty_reply_is_a_failure_and_not_recorded(client, fake_claude, settings):
    iid = start_ben(client)
    fake_claude.replies = [["  ", "\n"]]
    events = sse_events(_turn(client, iid).text)
    assert events[-1] == ("error", {"code": "claude_error"})
    row = _row(settings, iid)
    assert (row["model_turns"], row["messages_json"]) == (0, "[]")


def test_stream_starts_with_a_ping_comment(client):
    iid = start_ben(client)
    res = _turn(client, iid)
    assert res.text.startswith(": ping\n\n")


def test_first_turn_may_have_no_body(client):
    iid = start_ben(client)
    res = client.post(f"/api/premium/interviews/{iid}/turns")
    assert res.status_code == 200
    assert sse_events(res.text)[-1] == ("done", {"ended": False})


def test_unexpected_error_ends_the_stream_with_server_error(client, fake_claude, settings):
    iid = start_ben(client)
    fake_claude.replies = [["부분", RuntimeError("boom")]]
    events = sse_events(_turn(client, iid).text)
    assert events == [("delta", {"text": "부분"}), ("error", {"code": "server_error"})]
    assert _row(settings, iid)["model_turns"] == 0


def test_ben_requests_are_limited_to_6_per_minute(client, clock):
    iid = start_ben(client)
    for i in range(6):
        res = _turn(client, iid, answer=None if i == 0 else f"답변 {i}")
        assert res.status_code == 200
    res = _turn(client, iid, answer="7번째")
    assert res.status_code == 429
    assert res.json() == {"error": "rate_limited"}
    assert client.post(f"/api/premium/interviews/{iid}/report").status_code == 429
    clock.advance(61)
    assert _turn(client, iid, answer="다시").status_code == 200


def test_each_claude_call_counts_an_attempt(client, fake_claude, settings):
    iid = start_ben(client)
    fake_claude.replies = [[ClaudeError("claude_error")]]
    _turn(client, iid)
    _turn(client, iid)
    with open_db(settings) as conn:
        row = conn.execute(
            "SELECT attempts FROM premium_interviews WHERE id = ?", (iid,)
        ).fetchone()
    assert row[0] == 2


def test_too_many_attempts_is_interview_over(client, fake_claude, settings):
    assert premium.MAX_ATTEMPTS == 2 * premium.MAX_MODEL_TURNS + 3
    iid = start_ben(client)
    with open_db(settings) as conn:
        conn.execute(
            "UPDATE premium_interviews SET attempts = ? WHERE id = ?", (premium.MAX_ATTEMPTS, iid)
        )
    calls = len(fake_claude.calls)
    res = _turn(client, iid)
    assert res.status_code == 409
    assert res.json() == {"error": "interview_over"}
    assert len(fake_claude.calls) == calls
