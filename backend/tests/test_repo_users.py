import pytest

from app import db
from app.repos import sessions, users
from tests.helpers import T0


@pytest.fixture
def conn(tmp_path):
    path = tmp_path / "t.sqlite3"
    db.init_db(path)
    with db.connection(path) as c:
        yield c


def _make(conn, email="a@b.com"):
    return users.create_user(conn, email=email, password_hash="h", name="이우진", created_at=T0)


def test_create_and_get_user(conn):
    u = _make(conn)
    assert u.id.startswith("u_")
    assert (u.tier, u.tickets, u.is_admin) == ("member", 0, False)
    assert (u.name, u.age, u.created_at) == ("이우진", None, T0)
    assert users.get_by_email(conn, "a@b.com") == u
    assert users.get_by_id(conn, u.id) == u
    assert users.email_exists(conn, "a@b.com")
    assert not users.email_exists(conn, "x@b.com")


def test_duplicate_email_raises(conn):
    _make(conn)
    with pytest.raises(users.EmailTaken):
        _make(conn)


def test_normalize_login():
    assert users.normalize_login("  A@B.Com ") == "a@b.com"


def test_update_profile(conn):
    u = _make(conn)
    updated = users.update_profile(conn, u.id, name=None, age=19)
    assert (updated.name, updated.age) == (None, 19)


def test_session_lifecycle(conn):
    u = _make(conn)
    start = 1_000.0
    sessions.create_session(conn, token_hash="h1", user_id=u.id, now=start)
    almost = start + sessions.SESSION_SECONDS - 1
    assert sessions.user_for_token(conn, token_hash="h1", now=almost) == u
    assert sessions.user_for_token(conn, token_hash="nope", now=start) is None
    expired = start + sessions.SESSION_SECONDS
    assert sessions.user_for_token(conn, token_hash="h1", now=expired) is None
    # 만료 세션은 조회할 때 지운다
    assert conn.execute("SELECT COUNT(*) FROM sessions").fetchone()[0] == 0


def test_delete_session(conn):
    u = _make(conn)
    sessions.create_session(conn, token_hash="h1", user_id=u.id, now=0)
    sessions.delete_session(conn, "h1")
    assert sessions.user_for_token(conn, token_hash="h1", now=0) is None


def test_session_lasts_30_days():
    assert sessions.SESSION_SECONDS == 30 * 24 * 60 * 60
