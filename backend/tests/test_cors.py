import pytest


def test_vite_dev_origin_is_allowed_with_credentials(client):
    res = client.get("/api/health", headers={"Origin": "http://localhost:5173"})
    assert res.headers.get("access-control-allow-origin") == "http://localhost:5173"
    assert res.headers.get("access-control-allow-credentials") == "true"


@pytest.mark.parametrize("origin", ["https://momo.ssenu.cloud", "https://demomo.ssenu.cloud"])
def test_site_origins_are_allowed(client, origin):
    res = client.get("/api/health", headers={"Origin": origin})
    assert res.headers.get("access-control-allow-origin") == origin


def test_other_origin_is_not_allowed(client):
    res = client.get("/api/health", headers={"Origin": "https://evil.example"})
    assert "access-control-allow-origin" not in res.headers


def test_preflight_allows_post_with_credentials(client):
    res = client.options(
        "/api/auth/login",
        headers={
            "Origin": "https://demomo.ssenu.cloud",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        },
    )
    assert res.status_code == 200
    assert "POST" in res.headers["access-control-allow-methods"]
    assert res.headers["access-control-allow-credentials"] == "true"
