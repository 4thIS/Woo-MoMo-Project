import pytest

from app import db
from app.repos import audit


@pytest.fixture
def conn(tmp_path):
    p = tmp_path / "t.sqlite3"
    db.init_db(p)
    with db.connection(p) as c:
        c.execute(
            "INSERT INTO users (id, email, password_hash, created_at) VALUES ('u_a', 'a@x.com', 'h', 't')"
        )
        c.execute(
            "INSERT INTO users (id, email, password_hash, created_at) VALUES ('u_t', 't@x.com', 'h', 't')"
        )
        yield c


def _rec(conn, i, target="u_t", admin="u_a"):
    audit.record_tickets(
        conn,
        at=f"2026-10-17T00:{i // 60:02d}:{i % 60:02d}.000Z",
        admin_user_id=admin,
        target_user_id=target,
        delta=i,
        reason=f"r{i}",
    )


def test_page_newest_first_with_emails(conn):
    _rec(conn, 1)
    _rec(conn, 2)
    total, items = audit.page(conn, page=1)
    assert total == 2
    assert items[0] == {
        "at": "2026-10-17T00:00:02.000Z",
        "adminEmail": "a@x.com",
        "action": "tickets",
        "targetUserId": "u_t",
        "targetEmail": "t@x.com",
        "delta": 2,
        "reason": "r2",
    }
    assert items[1]["delta"] == 1


def test_page_second_page_has_one(conn):
    for i in range(1, 52):
        _rec(conn, i)
    total, first = audit.page(conn, page=1)
    _, second = audit.page(conn, page=2)
    assert total == 51 and len(first) == 50 and len(second) == 1
    assert second[0]["delta"] == 1


def test_missing_user_gives_none_email(conn):
    _rec(conn, 1, target="u_gone", admin="u_gone2")
    _, items = audit.page(conn, page=1)
    assert items[0]["targetEmail"] is None and items[0]["adminEmail"] is None


def test_ticket_log_filters_target_and_limits(conn):
    for i in range(1, 6):
        _rec(conn, i)
    _rec(conn, 9, target="u_other")
    log = audit.ticket_log(conn, target_user_id="u_t", limit=3)
    assert [e["delta"] for e in log] == [5, 4, 3]
    assert log[0] == {
        "at": "2026-10-17T00:00:05.000Z",
        "adminEmail": "a@x.com",
        "delta": 5,
        "reason": "r5",
    }
