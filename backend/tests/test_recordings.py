from app.repos import recordings
from tests.helpers import (
    archive_body,
    insert_premium_interview,
    login_admin,
    logout,
    make_premium,
    open_db,
    signup,
)

URL = "/api/recordings"


def _premium_archive(client, settings) -> tuple[str, str]:
    me = login_admin(client)
    assert client.post("/api/premium/purchase").status_code == 200
    with open_db(settings) as conn:
        iid = insert_premium_interview(conn, me["userId"])
    body = archive_body(premium=True, premiumInterviewId=iid, interviewerId="m2")
    res = client.post("/api/archive", json=body)
    assert res.status_code == 201, res.text
    return me["userId"], res.json()["entry"]["id"]


def _upload(client, archive_id, turn, data, mime="audio/webm;codecs=opus"):
    return client.post(
        URL,
        data={"archiveId": archive_id, "turn": str(turn)},
        files={"clip": ("clip", data, mime)},
    )


def _files(settings) -> list[str]:
    return sorted(p.name for p in settings.recordings_dir.rglob("*") if p.is_file())


def test_limit_is_30mb_per_archive():
    assert recordings.RECORDING_LIMIT_BYTES == 30 * 1024 * 1024


def test_upload_stores_file_and_shows_in_archive(client, settings):
    uid, aid = _premium_archive(client, settings)
    res = _upload(client, aid, 1, b"webm-bytes")
    assert res.status_code == 201
    rec = res.json()
    assert rec["id"].startswith("rec_")
    assert rec["url"] == f"/api/recordings/{rec['id']}"
    stored = settings.recordings_dir / uid / f"{rec['id']}.webm"
    assert stored.read_bytes() == b"webm-bytes"
    detail = client.get(f"/api/archive/{aid}").json()
    assert detail["recordings"] == [{"turn": 1, "url": rec["url"]}]
    assert detail["hasRecording"] is True


def test_ogg_keeps_the_ogg_extension(client, settings):
    uid, aid = _premium_archive(client, settings)
    rec = _upload(client, aid, 1, b"ogg-bytes", mime="audio/ogg").json()
    assert (settings.recordings_dir / uid / f"{rec['id']}.ogg").exists()


def test_unsupported_media_is_415(client, settings):
    _, aid = _premium_archive(client, settings)
    res = _upload(client, aid, 1, b"mp3", mime="audio/mpeg")
    assert res.status_code == 415
    assert res.json() == {"error": "unsupported_media"}
    assert _files(settings) == []


def test_archive_total_over_limit_is_413_and_same_turn_replaces(client, settings, monkeypatch):
    monkeypatch.setattr(recordings, "RECORDING_LIMIT_BYTES", 1000)
    _, aid = _premium_archive(client, settings)
    first = _upload(client, aid, 1, b"a" * 600).json()
    res = _upload(client, aid, 2, b"b" * 600)
    assert res.status_code == 413
    assert res.json() == {"error": "too_large"}
    assert _files(settings) == [f"{first['id']}.webm"]  # 남은 .part 없음
    # 같은 turn은 교체 — 옛 파일 크기는 빼고 센다
    second = _upload(client, aid, 1, b"c" * 900)
    assert second.status_code == 201
    assert _files(settings) == [f"{second.json()['id']}.webm"]
    detail = client.get(f"/api/archive/{aid}").json()
    assert detail["recordings"] == [{"turn": 1, "url": second.json()["url"]}]


def test_member_is_forbidden(client):
    signup(client)
    res = _upload(client, "a_missing", 1, b"x")
    assert res.status_code == 403
    assert res.json() == {"error": "premium_required"}


def test_free_or_foreign_archive_is_404(client, settings):
    _, premium_aid = _premium_archive(client, settings)
    free_aid = client.post("/api/archive", json=archive_body()).json()["entry"]["id"]
    assert _upload(client, free_aid, 1, b"x").json() == {"error": "not_found"}
    logout(client)
    other = signup(client, email="b@b.com")
    make_premium(settings, other["userId"])
    assert _upload(client, premium_aid, 1, b"x").json() == {"error": "not_found"}


def test_get_supports_range(client, settings):
    _, aid = _premium_archive(client, settings)
    url = _upload(client, aid, 1, b"0123456789").json()["url"]
    full = client.get(url)
    assert full.status_code == 200
    assert full.content == b"0123456789"
    assert full.headers["content-type"] == "audio/webm"
    assert full.headers["accept-ranges"] == "bytes"
    part = client.get(url, headers={"Range": "bytes=2-5"})
    assert part.status_code == 206
    assert part.content == b"2345"
    assert part.headers["content-range"] == "bytes 2-5/10"


def test_get_is_owner_only(client, settings):
    _, aid = _premium_archive(client, settings)
    url = _upload(client, aid, 1, b"x").json()["url"]
    logout(client)
    assert client.get(url).status_code == 401
    signup(client, email="b@b.com")
    res = client.get(url)
    assert res.status_code == 404
    assert res.json() == {"error": "not_found"}


def test_deleting_the_archive_deletes_recordings(client, settings):
    _, aid = _premium_archive(client, settings)
    url = _upload(client, aid, 1, b"x").json()["url"]
    assert len(_files(settings)) == 1
    assert client.delete(f"/api/archive/{aid}").status_code == 204
    assert _files(settings) == []
    assert client.get(url).status_code == 404
