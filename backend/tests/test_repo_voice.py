import json

import pytest

from app import db
from app.llm.baze import StoredVoice
from app.repos import premium, users, voice
from tests.fakes import FakeBaze
from tests.helpers import T0

DAY_START = "2026-10-12T15:00:00.000Z"
RESULT = {
    "syllables": 5,
    "fillers": {"count": 1, "examples": ["음"]},
    "confidence": {"level": "mid", "reason": "r"},
    "tone": {"level": "calm", "reason": "r"},
    "tremor": {"present": False, "reason": "r"},
    "trailingOff": {"present": True, "reason": "r"},
    "clarity": {"level": "good", "reason": "r"},
}


@pytest.fixture
def conn(tmp_path):
    p = tmp_path / "t.sqlite3"
    db.init_db(p)
    with db.connection(p) as c:
        yield c


def _start(conn, **kw) -> str:
    uid = users.create_user(conn, email="a@b.com", password_hash="h", name=None, created_at=T0).id
    conn.execute("UPDATE users SET tickets = 5 WHERE id = ?", (uid,))
    iid = premium.start_interview(
        conn,
        user_id=uid,
        track="company",
        inputs={},
        created_at=T0,
        day_start=DAY_START,
        daily_limit=30,
        **kw,
    )
    return iid


def test_voice_consent_defaults_to_zero(conn):
    iid = _start(conn)
    uid = conn.execute("SELECT user_id FROM premium_interviews").fetchone()[0]
    assert premium.get_interview(conn, user_id=uid, interview_id=iid).voice_consent is False


def test_voice_consent_stored(conn):
    iid = _start(conn, voice_consent=True)
    uid = conn.execute("SELECT user_id FROM premium_interviews").fetchone()[0]
    assert premium.get_interview(conn, user_id=uid, interview_id=iid).voice_consent is True


def test_queue_finish_results_roundtrip(conn):
    voice.queue(conn, interview_id="pi_1", answer=1, now=T0)
    assert voice.results(conn, interview_id="pi_1") == {1: ("queued", None)}
    voice.finish(
        conn,
        interview_id="pi_1",
        answer=1,
        status="done",
        result_json=json.dumps(RESULT),
        error_code=None,
        now=T0,
    )
    voice.queue(conn, interview_id="pi_1", answer=2, now=T0)
    got = voice.results(conn, interview_id="pi_1")
    status, res = got[1]
    assert (
        status == "done"
        and isinstance(res, StoredVoice)
        and res.fillers.count == 1
        and res.syllables == 5
    )
    assert got[2] == ("queued", None)
    assert voice.results(conn, interview_id="pi_other") == {}


def test_queue_overwrites_and_clears_result(conn):
    voice.queue(conn, interview_id="pi_1", answer=1, now=T0)
    voice.finish(
        conn,
        interview_id="pi_1",
        answer=1,
        status="done",
        result_json=json.dumps(RESULT),
        error_code=None,
        now=T0,
    )
    voice.queue(conn, interview_id="pi_1", answer=1, now="2026-10-23T00:00:00.000Z")
    assert voice.results(conn, interview_id="pi_1") == {1: ("queued", None)}
    row = conn.execute("SELECT * FROM voice_analysis").fetchone()
    assert row["result_json"] is None and row["error_code"] is None
    assert row["created_at"] == T0 and row["updated_at"] == "2026-10-23T00:00:00.000Z"


def test_failed_and_bad_json(conn):
    voice.queue(conn, interview_id="pi_1", answer=1, now=T0)
    voice.finish(
        conn,
        interview_id="pi_1",
        answer=1,
        status="failed",
        result_json=None,
        error_code="bad_output",
        now=T0,
    )
    assert voice.results(conn, interview_id="pi_1") == {1: ("failed", None)}
    assert conn.execute("SELECT error_code FROM voice_analysis").fetchone()[0] == "bad_output"
    voice.finish(
        conn,
        interview_id="pi_1",
        answer=1,
        status="done",
        result_json="{broken",
        error_code=None,
        now=T0,
    )
    assert voice.results(conn, interview_id="pi_1") == {1: ("failed", None)}


def test_record_usage(conn):
    voice.record_usage(
        conn,
        at=T0,
        user_id="u_1",
        interview_id="pi_1",
        key_index=2,
        model="gemini-x",
        input_tokens=10,
        output_tokens=3,
        outcome="ok",
    )
    voice.record_usage(
        conn,
        at=T0,
        user_id="u_1",
        interview_id=None,
        key_index=None,
        model="gemini-x",
        input_tokens=0,
        output_tokens=0,
        outcome="unavailable",
    )
    rows = conn.execute("SELECT * FROM baze_usage ORDER BY id").fetchall()
    assert len(rows) == 2 and rows[0]["id"].startswith("bu_")
    assert rows[0]["key_index"] == 2 and rows[0]["input_tokens"] == 10
    assert rows[1]["key_index"] is None and rows[1]["outcome"] == "unavailable"


def test_fake_baze_surface():
    f = FakeBaze()
    out = f.analyze(b"abc")
    assert out.outcome == "ok" and out.result is not None
    assert f.calls == [3]
    f.results.append(RuntimeError("boom"))
    with pytest.raises(RuntimeError):
        f.analyze(b"x")
    f.available_flag = False
    assert f.available() is False
    f.refresh_credits()
    assert isinstance(f.status(), list)


def test_restart_cleanup_fails_queued_only(conn):
    voice.queue(conn, interview_id="pi_1", answer=1, now=T0)
    voice.queue(conn, interview_id="pi_1", answer=2, now=T0)
    voice.finish(
        conn,
        interview_id="pi_1",
        answer=2,
        status="done",
        result_json=json.dumps(RESULT),
        error_code=None,
        now=T0,
    )
    assert voice.restart_cleanup(conn, now=T0) == 1
    rows = {
        r["answer"]: (r["status"], r["error_code"])
        for r in conn.execute("SELECT * FROM voice_analysis")
    }
    assert rows == {1: ("failed", "restart"), 2: ("done", None)}


def test_count_for_interview_counts_usage_and_queued(conn):
    assert voice.count_for_interview(conn, interview_id="pi_1") == 0
    voice.queue(conn, interview_id="pi_1", answer=1, now=T0)
    voice.record_usage(
        conn,
        at=T0,
        user_id="u",
        interview_id="pi_1",
        key_index=1,
        model="m",
        input_tokens=1,
        output_tokens=1,
        outcome="ok",
    )
    voice.record_usage(
        conn,
        at=T0,
        user_id="u",
        interview_id="pi_2",
        key_index=1,
        model="m",
        input_tokens=1,
        output_tokens=1,
        outcome="ok",
    )
    assert voice.count_for_interview(conn, interview_id="pi_1") == 2
