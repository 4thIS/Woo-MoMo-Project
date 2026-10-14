from concurrent.futures import ThreadPoolExecutor

import pytest

from app import db
from app.repos import resumes, users
from tests.helpers import T0

T1 = "2026-10-13T05:00:00.000Z"


@pytest.fixture
def path(tmp_path):
    p = tmp_path / "t.sqlite3"
    db.init_db(p)
    return p


def _user(conn, email="a@b.com") -> str:
    return users.create_user(conn, email=email, password_hash="h", name=None, created_at=T0).id


def _create(conn, uid, kind="company", title="t", now=T0):
    return resumes.create_resume(conn, user_id=uid, kind=kind, title=title, text="x", now=now)


def test_migration_creates_tables(path):
    with db.connection(path) as conn:
        rows = conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")
        names = {r["name"] for r in rows}
    assert {"resumes", "premium_interviews", "archive", "recordings"} <= names


def test_three_slots_per_kind(path):
    with db.connection(path) as conn:
        uid = _user(conn)
        for i in range(3):
            _create(conn, uid, title=f"t{i}")
        with pytest.raises(resumes.SlotFull) as exc:
            _create(conn, uid)
        assert exc.value.kind == "company"
        # 다른 종류는 따로 센다
        assert _create(conn, uid, kind="admission").kind == "admission"


def test_concurrent_creates_never_exceed_slots(path):
    with db.connection(path) as conn:
        uid = _user(conn)

    def attempt(i: int) -> bool:
        with db.connection(path) as c:
            try:
                _create(c, uid, title=f"t{i}")
                return True
            except resumes.SlotFull:
                return False

    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(attempt, range(8)))
    assert results.count(True) == 3
    with db.connection(path) as conn:
        assert len(resumes.list_resumes(conn, uid)) == 3


def test_list_is_recent_first_and_scoped(path):
    with db.connection(path) as conn:
        uid = _user(conn)
        other = _user(conn, "b@b.com")
        a = _create(conn, uid, now=T0)
        b = _create(conn, uid, now=T1)
        _create(conn, other)
        assert [r.id for r in resumes.list_resumes(conn, uid)] == [b.id, a.id]


def test_update_and_delete_are_scoped_to_owner(path):
    with db.connection(path) as conn:
        uid = _user(conn)
        other = _user(conn, "b@b.com")
        r = _create(conn, uid)
        assert (
            resumes.update_resume(conn, user_id=other, resume_id=r.id, title="x", text="y", now=T1)
            is None
        )
        updated = resumes.update_resume(
            conn, user_id=uid, resume_id=r.id, title="새 제목", text="y", now=T1
        )
        assert updated is not None
        assert (updated.title, updated.text, updated.updated_at) == ("새 제목", "y", T1)
        assert not resumes.delete_resume(conn, user_id=other, resume_id=r.id)
        assert resumes.delete_resume(conn, user_id=uid, resume_id=r.id)
        assert resumes.list_resumes(conn, uid) == []
