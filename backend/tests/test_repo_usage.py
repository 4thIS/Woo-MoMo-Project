import pytest

from app import db
from app.repos import usage


@pytest.fixture
def conn(tmp_path):
    p = tmp_path / "t.sqlite3"
    db.init_db(p)
    with db.connection(p) as c:
        yield c


def _rec(conn, at, **kw):
    base = dict(at=at, user_id="u_1", interview_id=None, kind="turn", model="m", outcome="ok")
    base.update(kw)
    usage.record(conn, **base)


def test_migration_creates_tables(conn):
    names = {r["name"] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert {"claude_usage", "admin_audit"} <= names


def test_record_and_rows_since_ascending(conn):
    _rec(conn, "2026-10-17T02:00:00.000Z", input_tokens=5, web_searches=2)
    _rec(conn, "2026-10-17T01:00:00.000Z", output_tokens=7, interview_id="pi_x")
    _rec(conn, "2026-10-16T01:00:00.000Z")
    rows = usage.rows_since(conn, "2026-10-17T00:00:00.000Z")
    assert [r["at"] for r in rows] == ["2026-10-17T01:00:00.000Z", "2026-10-17T02:00:00.000Z"]
    assert rows[0]["output_tokens"] == 7 and rows[0]["interview_id"] == "pi_x"
    assert rows[1]["input_tokens"] == 5 and rows[1]["web_searches"] == 2
    assert rows[1]["cache_read_tokens"] == 0


def test_first_at(conn):
    assert usage.first_at(conn) is None
    _rec(conn, "2026-10-17T02:00:00.000Z")
    _rec(conn, "2026-10-16T01:00:00.000Z")
    assert usage.first_at(conn) == "2026-10-16T01:00:00.000Z"
