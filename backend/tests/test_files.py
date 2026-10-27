from app import db
from app.files import cleanup_orphan_recordings, remove_files
from app.repos import archive, users
from tests.helpers import T0, insert_recording


def test_remove_files_ignores_missing(tmp_path):
    (tmp_path / "recordings").mkdir()
    keep = tmp_path / "recordings" / "a.webm"
    keep.write_bytes(b"x")
    remove_files(tmp_path, ["recordings/a.webm", "recordings/missing.webm"])
    assert not keep.exists()


def test_cleanup_removes_only_unknown_files(tmp_path):
    db.init_db(tmp_path / "momo.sqlite3")
    folder = tmp_path / "recordings" / "u_1"
    folder.mkdir(parents=True)
    known = folder / "rec_known.webm"
    stray = folder / "rec_stray.webm"
    partial = folder / "rec_upload.webm.part"
    for f in (known, stray, partial):
        f.write_bytes(b"x")
    with db.connection(tmp_path / "momo.sqlite3") as conn:
        uid = users.create_user(
            conn, email="a@b.com", password_hash="h", name=None, created_at=T0
        ).id
        new = archive.NewArchive(
            interviewer_id="m2",
            premium=False,
            premium_interview_id=None,
            track="company",
            field="it",
            job="백엔드",
            name=None,
            age=None,
            university=None,
            department=None,
            question_count=1,
            started_at=T0,
            ended_at=T0,
            messages_json="[]",
            report_json="[]",
            report_raw="",
        )
        aid = archive.save_archive(conn, user_id=uid, new=new).archive_id
        insert_recording(
            conn, archive_id=aid, user_id=uid, turn=1, path="recordings/u_1/rec_known.webm"
        )
        assert cleanup_orphan_recordings(conn, tmp_path) == 2
    assert known.exists()
    assert not stray.exists()
    assert not partial.exists()


def test_startup_removes_orphan_recordings(make_client, settings):
    stray = settings.recordings_dir / "u_x" / "rec_y.webm"
    stray.parent.mkdir(parents=True)
    stray.write_bytes(b"x")
    make_client(settings)
    assert not stray.exists()
