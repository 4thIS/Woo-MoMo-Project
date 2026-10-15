from concurrent.futures import ThreadPoolExecutor

import pytest

from app import db
from app.repos import premium, users
from tests.helpers import T0

DAY_START = "2026-10-12T15:00:00.000Z"  # 2026-10-13 0시(KST)
INPUTS = {"resumeText": "이력서", "company": {"field": "it", "job": "백엔드"}}


@pytest.fixture
def path(tmp_path):
    p = tmp_path / "t.sqlite3"
    db.init_db(p)
    return p


def _premium_user(conn, email="a@b.com", tickets=2) -> str:
    uid = users.create_user(conn, email=email, password_hash="h", name=None, created_at=T0).id
    conn.execute("UPDATE users SET tier = 'premium', tickets = ? WHERE id = ?", (tickets, uid))
    return uid


def _start(conn, uid, created_at=T0, limit=30) -> str:
    return premium.start_interview(
        conn,
        user_id=uid,
        track="company",
        inputs=INPUTS,
        created_at=created_at,
        day_start=DAY_START,
        daily_limit=limit,
    )


def _tickets(conn, uid) -> int:
    return users.get_by_id(conn, uid).tickets


def test_max_model_turns_is_15():
    assert premium.MAX_MODEL_TURNS == 15


def test_start_spends_a_ticket_and_creates_a_row(path):
    with db.connection(path) as conn:
        uid = _premium_user(conn)
        iid = _start(conn, uid)
        assert iid.startswith("pi_")
        assert _tickets(conn, uid) == 1
        iv = premium.get_interview(conn, user_id=uid, interview_id=iid)
        assert iv is not None
        assert (iv.track, iv.inputs, iv.messages, iv.model_turns, iv.status) == (
            "company",
            INPUTS,
            [],
            0,
            "active",
        )


def test_no_tickets(path):
    with db.connection(path) as conn:
        uid = _premium_user(conn, tickets=0)
        with pytest.raises(premium.NoTickets):
            _start(conn, uid)
        assert conn.execute("SELECT COUNT(*) FROM premium_interviews").fetchone()[0] == 0


def test_daily_limit_counts_everyone_today_and_keeps_tickets(path):
    with db.connection(path) as conn:
        a = _premium_user(conn)
        b = _premium_user(conn, "b@b.com")
        _start(conn, a, created_at="2026-10-12T14:59:59.999Z", limit=2)  # 어제(KST)라 세지 않는다
        _start(conn, a, limit=2)
        _start(conn, b, limit=2)
        with pytest.raises(premium.DailyLimitReached):
            _start(conn, b, limit=2)
        assert _tickets(conn, b) == 1


def test_concurrent_starts_spend_each_ticket_once(path):
    with db.connection(path) as conn:
        uid = _premium_user(conn, tickets=3)

    def attempt(_: int) -> bool:
        with db.connection(path) as c:
            try:
                _start(c, uid)
                return True
            except premium.NoTickets:
                return False

    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(attempt, range(8)))
    assert results.count(True) == 3
    with db.connection(path) as conn:
        assert _tickets(conn, uid) == 0
        assert conn.execute("SELECT COUNT(*) FROM premium_interviews").fetchone()[0] == 3


def test_append_turn_and_mark_done(path):
    with db.connection(path) as conn:
        uid = _premium_user(conn)
        iid = _start(conn, uid)
        iv = premium.append_turn(
            conn,
            interview_id=iid,
            answer=None,
            model_text="자기소개 해 주세요.",
            expected_model_turns=0,
        )
        assert iv.messages == [{"role": "model", "text": "자기소개 해 주세요."}]
        assert iv.model_turns == 1
        iv = premium.append_turn(
            conn,
            interview_id=iid,
            answer="안녕하세요",
            model_text="다음 질문",
            expected_model_turns=1,
        )
        assert [m["role"] for m in iv.messages] == ["model", "user", "model"]
        assert iv.model_turns == 2
        premium.mark_done(conn, interview_id=iid, report_raw="[]")
        done = premium.get_interview(conn, user_id=uid, interview_id=iid)
        assert (done.status, done.report_raw) == ("done", "[]")


def test_get_is_scoped_to_owner(path):
    with db.connection(path) as conn:
        uid = _premium_user(conn)
        other = _premium_user(conn, "b@b.com")
        iid = _start(conn, uid)
        assert premium.get_interview(conn, user_id=other, interview_id=iid) is None


def _snapshot(conn, iid):
    return tuple(
        conn.execute(
            "SELECT messages_json, model_turns, status FROM premium_interviews WHERE id = ?", (iid,)
        ).fetchone()
    )


def test_append_turn_with_stale_expected_turns_conflicts(path):
    with db.connection(path) as conn:
        iid = _start(conn, _premium_user(conn))
        premium.append_turn(
            conn, interview_id=iid, answer=None, model_text="q1", expected_model_turns=0
        )
        before = _snapshot(conn, iid)
        with pytest.raises(premium.TurnConflict):
            premium.append_turn(
                conn, interview_id=iid, answer="a", model_text="q2", expected_model_turns=0
            )
        assert _snapshot(conn, iid) == before


def test_append_turn_on_done_interview_conflicts(path):
    with db.connection(path) as conn:
        iid = _start(conn, _premium_user(conn))
        premium.mark_done(conn, interview_id=iid, report_raw="[]")
        before = _snapshot(conn, iid)
        with pytest.raises(premium.TurnConflict):
            premium.append_turn(
                conn, interview_id=iid, answer=None, model_text="q", expected_model_turns=0
            )
        assert _snapshot(conn, iid) == before


def test_append_turn_at_max_turns_conflicts(path):
    with db.connection(path) as conn:
        iid = _start(conn, _premium_user(conn))
        for i in range(premium.MAX_MODEL_TURNS):
            premium.append_turn(
                conn,
                interview_id=iid,
                answer=None if i == 0 else "a",
                model_text="q",
                expected_model_turns=i,
            )
        before = _snapshot(conn, iid)
        with pytest.raises(premium.TurnConflict):
            premium.append_turn(
                conn,
                interview_id=iid,
                answer="a",
                model_text="q",
                expected_model_turns=premium.MAX_MODEL_TURNS,
            )
        assert _snapshot(conn, iid) == before


def test_count_attempt_is_capped(path):
    with db.connection(path) as conn:
        iid = _start(conn, _premium_user(conn))
        for n in range(1, premium.MAX_ATTEMPTS + 1):
            assert premium.count_attempt(conn, interview_id=iid) == n
        with pytest.raises(premium.TooManyAttempts):
            premium.count_attempt(conn, interview_id=iid)


def test_new_interview_has_no_briefing(path):
    with db.connection(path) as conn:
        uid = _premium_user(conn)
        iid = _start(conn, uid)
        got = premium.get_interview(conn, user_id=uid, interview_id=iid)
    assert (got.briefing, got.briefing_status) == (None, "none")


def test_start_with_pending_briefing_then_set(path):
    with db.connection(path) as conn:
        uid = _premium_user(conn)
        iid = premium.start_interview(
            conn,
            user_id=uid,
            track="company",
            inputs=INPUTS,
            created_at=T0,
            day_start=DAY_START,
            daily_limit=30,
            briefing_status="pending",
        )
        assert (
            premium.get_interview(conn, user_id=uid, interview_id=iid).briefing_status == "pending"
        )
        premium.set_briefing(conn, interview_id=iid, briefing="본문")
        got = premium.get_interview(conn, user_id=uid, interview_id=iid)
    assert (got.briefing, got.briefing_status) == ("본문", "ok")


def test_set_briefing_none_is_failed_and_only_from_pending(path):
    with db.connection(path) as conn:
        uid = _premium_user(conn)
        iid = premium.start_interview(
            conn,
            user_id=uid,
            track="company",
            inputs=INPUTS,
            created_at=T0,
            day_start=DAY_START,
            daily_limit=30,
            briefing_status="pending",
        )
        premium.set_briefing(conn, interview_id=iid, briefing=None)
        premium.set_briefing(
            conn, interview_id=iid, briefing="늦게 온 본문"
        )  # pending이 아니면 무시
        got = premium.get_interview(conn, user_id=uid, interview_id=iid)
    assert (got.briefing, got.briefing_status) == (None, "failed")
