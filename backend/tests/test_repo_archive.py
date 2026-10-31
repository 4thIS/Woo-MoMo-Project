import pytest

from app import db
from app.repos import archive, users
from tests.helpers import T0, insert_premium_interview, insert_recording


@pytest.fixture
def conn(tmp_path):
    path = tmp_path / "t.sqlite3"
    db.init_db(path)
    with db.connection(path) as c:
        yield c


def _user(conn, email="a@b.com") -> str:
    return users.create_user(conn, email=email, password_hash="h", name=None, created_at=T0).id


def _new(**over) -> archive.NewArchive:
    base = dict(
        interviewer_id="m1",
        premium=False,
        premium_interview_id=None,
        track="company",
        field="it",
        job="백엔드",
        name=None,
        age=None,
        university=None,
        department=None,
        question_count=5,
        started_at=T0,
        ended_at="2026-10-13T04:21:00.000Z",
        messages_json="[]",
        report_json="[]",
        report_raw="",
    )
    base.update(over)
    return archive.NewArchive(**base)


def _at(hour: int) -> str:
    return f"2026-10-13T{hour:02d}:00:00.000Z"


def test_limit_is_five():
    assert archive.ARCHIVE_LIMIT == 5


def test_sixth_free_entry_evicts_the_oldest(conn):
    uid = _user(conn)
    ids = []
    for hour in range(1, 6):
        result = archive.save_archive(conn, user_id=uid, new=_new(started_at=_at(hour)))
        assert result.evicted == []
        ids.append(result.archive_id)
    sixth = archive.save_archive(conn, user_id=uid, new=_new(started_at=_at(6)))
    assert sixth.evicted == [ids[0]]
    listed = [s.id for s in archive.list_archive(conn, uid)]
    assert listed == [sixth.archive_id, *reversed(ids[1:])]


def test_premium_entries_are_not_counted(conn):
    uid = _user(conn)
    for hour in (1, 2):
        pi = insert_premium_interview(conn, uid)
        new = _new(premium=True, premium_interview_id=pi, started_at=_at(hour))
        assert archive.save_archive(conn, user_id=uid, new=new).evicted == []
    for hour in range(3, 8):
        assert archive.save_archive(conn, user_id=uid, new=_new(started_at=_at(hour))).evicted == []
    assert len(archive.list_archive(conn, uid)) == 7


def test_premium_requires_own_done_unused_interview(conn):
    uid = _user(conn)
    other = _user(conn, "b@b.com")
    active = insert_premium_interview(conn, uid, status="active")
    others = insert_premium_interview(conn, other)
    done = insert_premium_interview(conn, uid)
    for bad in (None, "pi_missing", active, others):
        with pytest.raises(archive.InvalidPremiumInterview):
            archive.save_archive(
                conn, user_id=uid, new=_new(premium=True, premium_interview_id=bad)
            )
    archive.save_archive(conn, user_id=uid, new=_new(premium=True, premium_interview_id=done))
    # 같은 벤 면접을 두 번 저장할 수 없다
    with pytest.raises(archive.InvalidPremiumInterview):
        archive.save_archive(conn, user_id=uid, new=_new(premium=True, premium_interview_id=done))
    assert len(archive.list_archive(conn, uid)) == 1


def test_free_entry_drops_premium_interview_id(conn):
    uid = _user(conn)
    done = insert_premium_interview(conn, uid)
    result = archive.save_archive(conn, user_id=uid, new=_new(premium_interview_id=done))
    row = conn.execute(
        "SELECT premium_interview_id FROM archive WHERE id = ?", (result.archive_id,)
    ).fetchone()
    assert row[0] is None


def test_eviction_returns_recording_paths(conn):
    uid = _user(conn)
    first = archive.save_archive(conn, user_id=uid, new=_new(started_at=_at(1))).archive_id
    path = f"recordings/{uid}/rec_x.webm"
    insert_recording(conn, archive_id=first, user_id=uid, turn=1, path=path)
    for hour in range(2, 6):
        archive.save_archive(conn, user_id=uid, new=_new(started_at=_at(hour)))
    result = archive.save_archive(conn, user_id=uid, new=_new(started_at=_at(6)))
    assert result.evicted == [first]
    assert result.removed_paths == [path]
    assert conn.execute("SELECT COUNT(*) FROM recordings").fetchone()[0] == 0


def test_get_and_delete_are_scoped(conn):
    uid = _user(conn)
    other = _user(conn, "b@b.com")
    aid = archive.save_archive(conn, user_id=uid, new=_new(messages_json='[{"x":1}]')).archive_id
    insert_recording(conn, archive_id=aid, user_id=uid, turn=2, path="recordings/u/b.webm")
    r1 = insert_recording(conn, archive_id=aid, user_id=uid, turn=1, path="recordings/u/a.webm")
    record = archive.get_archive(conn, user_id=uid, archive_id=aid)
    assert record is not None
    assert record.summary.has_recording is True
    assert record.messages_json == '[{"x":1}]'
    assert record.recordings[0] == (1, r1, None)
    assert archive.get_archive(conn, user_id=other, archive_id=aid) is None
    assert archive.delete_archive(conn, user_id=other, archive_id=aid) is None
    removed = archive.delete_archive(conn, user_id=uid, archive_id=aid)
    assert removed is not None
    assert sorted(removed) == ["recordings/u/a.webm", "recordings/u/b.webm"]
    assert archive.get_archive(conn, user_id=uid, archive_id=aid) is None
