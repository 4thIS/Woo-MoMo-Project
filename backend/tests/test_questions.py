import pytest


@pytest.mark.parametrize("field", ["general", "it", "finance", "manufacturing", "retail"])
def test_known_field_returns_its_set(client, field):
    res = client.get(f"/api/questions/{field}")
    assert res.status_code == 200
    body = res.json()
    assert body["field"] == field
    assert len(body["questions"]) == 5


def test_unknown_field_falls_back_to_general_with_200(client):
    res = client.get("/api/questions/aerospace")
    assert res.status_code == 200
    assert res.json()["field"] == "general"


def test_field_lookup_is_case_insensitive(client):
    assert client.get("/api/questions/IT").json()["field"] == "it"
