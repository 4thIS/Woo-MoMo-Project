import pytest

from tests.helpers import logout, signup

URL = "/api/resumes"


def _create(client, kind="company", title="백엔드 신입용", text="이력서 원문"):
    return client.post(URL, json={"kind": kind, "title": title, "text": text})


def test_requires_login(client):
    assert client.get(URL).status_code == 401
    assert _create(client).json() == {"error": "unauthorized"}


def test_create_returns_slot(client):
    signup(client)
    res = _create(client, title="  백엔드 신입용  ")
    assert res.status_code == 201
    body = res.json()
    assert body["id"].startswith("r_")
    assert body == {
        "id": body["id"],
        "kind": "company",
        "title": "백엔드 신입용",
        "text": "이력서 원문",
        "updatedAt": "2025-10-09T08:53:20.000Z",
    }


def test_slot_full_per_kind(client):
    signup(client)
    for _ in range(3):
        assert _create(client).status_code == 201
    res = _create(client)
    assert res.status_code == 409
    assert res.json() == {"error": "slot_full", "kind": "company"}
    assert _create(client, kind="admission").status_code == 201


@pytest.mark.parametrize(
    ("title", "text", "field"),
    [
        ("", "x", "title"),
        ("   ", "x", "title"),
        ("가" * 41, "x", "title"),
        ("t", "x" * 20_001, "text"),
    ],
)
def test_validation(client, title, text, field):
    signup(client)
    res = _create(client, title=title, text=text)
    assert res.status_code == 422
    assert res.json() == {"error": "invalid", "field": field}


@pytest.mark.parametrize(
    ("title", "text", "field"),
    [
        ("", "x", "title"),
        ("   ", "x", "title"),
        ("가" * 41, "x", "title"),
        ("t", "x" * 20_001, "text"),
    ],
)
def test_update_validation(client, title, text, field):
    signup(client)
    r = _create(client).json()
    res = client.put(f"{URL}/{r['id']}", json={"title": title, "text": text})
    assert res.status_code == 422
    assert res.json() == {"error": "invalid", "field": field}


def test_limits_are_inclusive(client):
    signup(client)
    assert _create(client, title="가" * 40, text="x" * 20_000).status_code == 201


def test_list_recent_first_and_update(client, clock):
    signup(client)
    a = _create(client, title="a").json()
    clock.advance(1)
    b = _create(client, title="b").json()
    assert [r["id"] for r in client.get(URL).json()] == [b["id"], a["id"]]
    clock.advance(1)
    res = client.put(f"{URL}/{a['id']}", json={"kind": "admission", "title": "새", "text": "y"})
    assert res.status_code == 200
    # kind는 바꿀 수 없다(보내도 무시)
    assert (res.json()["kind"], res.json()["title"], res.json()["text"]) == ("company", "새", "y")
    assert [r["id"] for r in client.get(URL).json()] == [a["id"], b["id"]]


def test_delete(client):
    signup(client)
    r = _create(client).json()
    assert client.delete(f"{URL}/{r['id']}").status_code == 204
    assert client.get(URL).json() == []


def test_other_users_resume_is_404(client):
    signup(client)
    r = _create(client).json()
    logout(client)
    signup(client, email="b@b.com")
    assert client.get(URL).json() == []
    res = client.put(f"{URL}/{r['id']}", json={"title": "x", "text": "y"})
    assert res.status_code == 404
    assert res.json() == {"error": "not_found"}
    assert client.delete(f"{URL}/{r['id']}").status_code == 404
