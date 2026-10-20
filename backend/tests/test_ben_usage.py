from app.llm.claude import ClaudeError
from app.repos import usage
from tests.helpers import COMPANY_START, open_db, sse_events, start_ben

NAMED = {**COMPANY_START, "company": {**COMPANY_START["company"], "name": "토스"}}


def _rows(settings):
    with open_db(settings) as conn:
        return conn.execute("SELECT * FROM claude_usage ORDER BY at, kind").fetchall()


def _turn(client, iid, answer=None):
    return client.post(
        f"/api/premium/interviews/{iid}/turns", json={} if answer is None else {"answer": answer}
    )


def test_turn_records_one_usage_row(client, settings):
    iid = start_ben(client)
    _turn(client, iid)
    (row,) = _rows(settings)
    assert (row["kind"], row["outcome"], row["input_tokens"], row["output_tokens"]) == (
        "turn",
        "ok",
        100,
        20,
    )
    assert row["interview_id"] == iid and row["model"]


def test_company_first_turn_records_research_and_turn(client, settings):
    iid = start_ben(client, NAMED)
    _turn(client, iid)
    assert sorted(r["kind"] for r in _rows(settings)) == ["research", "turn"]


def test_failed_turn_records_error(client, fake_claude, settings):
    iid = start_ben(client)
    fake_claude.replies = [[ClaudeError("claude_error")]]
    _turn(client, iid)
    (row,) = _rows(settings)
    assert (row["kind"], row["outcome"], row["input_tokens"]) == ("turn", "error", 0)


def test_report_records_report_row(client, settings):
    iid = start_ben(client)
    _turn(client, iid)
    client.post(f"/api/premium/interviews/{iid}/report")
    assert sorted(r["kind"] for r in _rows(settings)) == ["report", "turn"]


def test_recording_failure_does_not_break_the_turn(client, monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("db down")

    monkeypatch.setattr(usage, "record", boom)
    iid = start_ben(client)
    events = sse_events(_turn(client, iid).text)
    assert events[-1] == ("done", {"ended": False})
