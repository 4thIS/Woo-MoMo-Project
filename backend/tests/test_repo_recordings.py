import pytest

from app import db
from app.repos import archive, recordings, users
from tests.helpers import T0, insert_premium_interview

LIMIT = 100


@pytest.fixture
def conn(tmp_path):
    path = tmp_path / "t.sqlite3"
    db.init_db(path)
    with db.connection(path) as c:
        yield c


def _archive(conn) -> tuple[str, str]:
    uid = users.create_user(conn, email="a@b.com", password_hash="h", name=None, created_at=T0).id
    pi = insert_premium_interview(conn, uid)
    new = archive.NewArchive(
        interviewer_id="m2",
        premium=True,
        premium_interview_id=pi,
        track="company",
        field="it",
        job="백엔드",
        name=None,
        age=None,
        university=None,
        department=None,
        question_count=5,
        started_at=T0,
        ended_at=T0,
        messages_json="[]",
        report_json="[]",
        report_raw="",
    )
    return uid, archive.save_archive(conn, user_id=uid, new=new).archive_id


def _rec(uid, aid, turn, size, rid) -> recordings.Recording:
    return recordings.Recording(
        id=rid,
        archive_id=aid,
        user_id=uid,
        turn=turn,
        path=f"recordings/{uid}/{rid}.webm",
        mime="audio/webm",
        size=size,
    )


def test_replace_allows_exactly_the_limit_and_rejects_one_more(conn):
    uid, aid = _archive(conn)
    assert (
        recordings.replace_recording(
            conn, recording=_rec(uid, aid, 1, 60, "rec_a"), created_at=T0, limit=LIMIT
        )
        is None
    )
    # 40 + 60 == 한도 → 성공
    recordings.replace_recording(
        conn, recording=_rec(uid, aid, 2, 40, "rec_b"), created_at=T0, limit=LIMIT
    )
    # 같은 turn 교체는 옛 크기를 빼고 센다: 60 + 41 > 100
    with pytest.raises(recordings.TooLarge):
        recordings.replace_recording(
            conn, recording=_rec(uid, aid, 1, 61, "rec_c"), created_at=T0, limit=LIMIT
        )
    assert recordings.used_bytes(conn, archive_id=aid, excluding_turn=99) == 100
