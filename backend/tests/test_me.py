import pytest

from tests.helpers import signup

TAKEN = "/api/auth/email-taken"


def test_email_taken(client):
    assert client.get(TAKEN, params={"email": "a@b.com"}).json() == {"taken": False}
    signup(client)
    assert client.get(TAKEN, params={"email": " A@B.com "}).json() == {"taken": True}


def test_email_taken_is_rate_limited(client, clock):
    for _ in range(20):
        assert client.get(TAKEN, params={"email": "x@b.com"}).status_code == 200
    res = client.get(TAKEN, params={"email": "x@b.com"})
    assert res.status_code == 429
    assert res.json() == {"error": "rate_limited"}
    clock.advance(60)
    assert client.get(TAKEN, params={"email": "x@b.com"}).status_code == 200


def test_put_profile(client):
    signup(client)
    res = client.put("/api/profile", json={"name": "  홍길동 ", "age": 19})
    assert res.status_code == 200
    assert res.json()["profile"] == {"name": "홍길동", "age": 19}
    assert client.get("/api/me").json()["profile"] == {"name": "홍길동", "age": 19}
    res = client.put("/api/profile", json={"name": None, "age": None})
    assert res.json()["profile"] == {"name": None, "age": None}


def test_blank_name_becomes_null(client):
    signup(client)
    res = client.put("/api/profile", json={"name": "   ", "age": 20})
    assert res.json()["profile"] == {"name": None, "age": 20}


@pytest.mark.parametrize("age", [0, 121])
def test_put_profile_rejects_age_out_of_range(client, age):
    signup(client)
    res = client.put("/api/profile", json={"name": "홍길동", "age": age})
    assert res.status_code == 422
    assert res.json() == {"error": "invalid", "field": "age"}


def test_put_profile_requires_login(client):
    res = client.put("/api/profile", json={"name": "홍길동", "age": 19})
    assert res.status_code == 401
    assert res.json() == {"error": "unauthorized"}
