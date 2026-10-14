from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import BaseModel, Field

from app.errors import ApiError, install_error_handlers
from app.main import create_app


def test_post_with_foreign_origin_is_rejected(client):
    res = client.post("/api/health", headers={"Origin": "https://evil.example"})
    assert res.status_code == 403
    assert res.json() == {"error": "bad_origin"}


def test_post_without_origin_is_rejected(client):
    del client.headers["origin"]
    res = client.post("/api/health")
    assert res.status_code == 403
    assert res.json() == {"error": "bad_origin"}


def test_post_with_allowed_origin_reaches_router(client):
    # /api/health는 GET뿐이라 405 — Origin 확인은 통과했다는 뜻
    assert client.post("/api/health").status_code == 405


def test_get_is_not_origin_checked(client):
    assert client.get("/api/health", headers={"Origin": "https://evil.example"}).status_code == 200


def test_startup_creates_database_and_recordings_dir(client, settings):
    assert settings.db_path.exists()
    assert settings.recordings_dir.is_dir()


def test_create_app_reads_settings_from_env(monkeypatch, tmp_path):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    app = create_app()
    assert app.state.settings.storage_dir == tmp_path


def test_error_shapes():
    app = FastAPI()
    install_error_handlers(app)

    class Body(BaseModel):
        title: str = Field(max_length=3)

    @app.post("/x")
    def x(body: Body) -> dict:
        return {}

    @app.get("/boom")
    def boom() -> dict:
        raise ApiError(409, "slot_full", kind="company")

    c = TestClient(app)
    res = c.post("/x", json={"title": "toolong"})
    assert res.status_code == 422
    assert res.json() == {"error": "invalid", "field": "title"}
    res = c.get("/boom")
    assert res.status_code == 409
    assert res.json() == {"error": "slot_full", "kind": "company"}
