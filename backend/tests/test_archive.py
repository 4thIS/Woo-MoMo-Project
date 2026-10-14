import pytest

from tests.helpers import (
    archive_body,
    insert_premium_interview,
    insert_recording,
    logout,
    open_db,
    signup,
)

URL = "/api/archive"
ENTRY_KEYS = {
    "id",
    "interviewerId",
    "premium",
    "track",
    "startedAt",
    "endedAt",
    "questionCount",
    "hasRecording",
}


def _at(hour: int) -> str:
    return f"2026-10-13T{hour:02d}:00:00.000Z"


def test_requires_login(client):
    assert client.get(URL).status_code == 401
    assert client.post(URL, json=archive_body()).status_code == 401


def test_save_company_entry(client):
    signup(client)
    res = client.post(
        URL, json=archive_body(hasRecording=True, recordings=[{"turn": 1, "url": "x"}])
    )
    assert res.status_code == 201
    body = res.json()
    assert body["evicted"] == []
    entry = body["entry"]
    assert entry["id"].startswith("a_")
    assert set(entry) == ENTRY_KEYS | {"field", "job"}  # score 없음, 대입 칸 없음
    assert entry["hasRecording"] is False  # 보낸 값은 무시하고 서버가 계산한다
    assert (entry["field"], entry["job"], entry["questionCount"]) == ("it", "백엔드 개발자", 5)


def test_started_at_is_normalized_to_utc(client):
    signup(client)
    res = client.post(URL, json=archive_body(startedAt="2026-10-13T13:00:00+09:00"))
    assert res.json()["entry"]["startedAt"] == "2026-10-13T04:00:00.000Z"


def test_admission_entry_keeps_only_admission_fields(client):
    signup(client)
    body = archive_body(
        track="admission",
        interviewerId="f3",
        name="홍길동",
        age=19,
        university="한국대학교",
        department="컴퓨터공학과",
    )
    entry = client.post(URL, json=body).json()["entry"]
    assert set(entry) == ENTRY_KEYS | {"name", "age", "university", "department"}


@pytest.mark.parametrize(
    ("over", "field"),
    [
        ({"job": None}, "job"),
        ({"field": "  "}, "field"),
        ({"track": "admission", "name": "홍길동", "age": 19, "department": "컴공"}, "university"),
    ],
)
def test_missing_track_fields(client, over, field):
    signup(client)
    res = client.post(URL, json=archive_body(**over))
    assert res.status_code == 422
    assert res.json() == {"error": "missing_field", "field": field}


def test_detail_round_trip(client):
    signup(client)
    sent = archive_body()
    aid = client.post(URL, json=sent).json()["entry"]["id"]
    detail = client.get(f"{URL}/{aid}").json()
    assert detail["messages"] == sent["messages"]
    assert detail["report"] == sent["report"]
    assert detail["reportRaw"] == sent["reportRaw"]
    assert detail["recordings"] == []
    assert detail["id"] == aid


def test_sixth_free_save_evicts_oldest(client):
    signup(client)
    ids = [
        client.post(URL, json=archive_body(startedAt=_at(h))).json()["entry"]["id"]
        for h in range(1, 6)
    ]
    res = client.post(URL, json=archive_body(startedAt=_at(6)))
    assert res.json()["evicted"] == [ids[0]]
    listed = client.get(URL).json()
    assert len(listed) == 5
    assert [e["startedAt"] for e in listed] == [_at(h) for h in range(6, 1, -1)]
    assert client.get(f"{URL}/{ids[0]}").status_code == 404


def test_premium_entries_need_a_done_interview_and_skip_the_limit(client, settings):
    me = signup(client)
    with open_db(settings) as conn:
        done = insert_premium_interview(conn, me["userId"])
        active = insert_premium_interview(conn, me["userId"], status="active")
    ok = client.post(
        URL, json=archive_body(premium=True, premiumInterviewId=done, interviewerId="m2")
    )
    assert ok.status_code == 201
    assert ok.json()["entry"]["premium"] is True
    for bad in ({"premiumInterviewId": done}, {"premiumInterviewId": active}, {}):
        res = client.post(URL, json=archive_body(premium=True, **bad))
        assert res.status_code == 422
        assert res.json() == {"error": "invalid_premium_interview"}
    for h in range(1, 6):
        assert client.post(URL, json=archive_body(startedAt=_at(h))).json()["evicted"] == []
    assert len(client.get(URL).json()) == 6


def test_other_users_interview_is_rejected(client, settings):
    first = signup(client)
    with open_db(settings) as conn:
        theirs = insert_premium_interview(conn, first["userId"])
    logout(client)
    signup(client, email="b@b.com")
    res = client.post(URL, json=archive_body(premium=True, premiumInterviewId=theirs))
    assert res.json() == {"error": "invalid_premium_interview"}


def test_delete_removes_recording_files(client, settings):
    me = signup(client)
    with open_db(settings) as conn:
        done = insert_premium_interview(conn, me["userId"])
    aid = client.post(URL, json=archive_body(premium=True, premiumInterviewId=done)).json()[
        "entry"
    ]["id"]
    rel = f"recordings/{me['userId']}/rec_test.webm"
    file = settings.storage_dir / rel
    file.parent.mkdir(parents=True, exist_ok=True)
    file.write_bytes(b"audio")
    with open_db(settings) as conn:
        rec_id = insert_recording(conn, archive_id=aid, user_id=me["userId"], turn=1, path=rel)
    assert client.get(URL).json()[0]["hasRecording"] is True
    detail = client.get(f"{URL}/{aid}").json()
    assert detail["recordings"] == [{"turn": 1, "url": f"/api/recordings/{rec_id}"}]
    assert client.delete(f"{URL}/{aid}").status_code == 204
    assert not file.exists()
    assert client.get(f"{URL}/{aid}").status_code == 404


def test_other_users_entry_is_404(client):
    signup(client)
    aid = client.post(URL, json=archive_body()).json()["entry"]["id"]
    logout(client)
    signup(client, email="b@b.com")
    assert client.get(URL).json() == []
    assert client.get(f"{URL}/{aid}").json() == {"error": "not_found"}
    assert client.delete(f"{URL}/{aid}").status_code == 404
