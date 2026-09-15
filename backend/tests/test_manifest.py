import json

import pytest
from fastapi.testclient import TestClient

from app.main import create_app


def test_manifest_matches_repo_file(client, repo_manifest):
    res = client.get("/api/manifest")
    assert res.status_code == 200
    assert res.json() == repo_manifest


def test_manifest_has_contract_keys(client):
    body = client.get("/api/manifest").json()
    assert set(body) == {"id", "url", "size", "template", "systemPromptOverride", "fallback"}
    assert set(body["template"]) == {"turnStart", "turnEnd", "roles"}


def test_app_fails_to_start_on_broken_data(broken_data_dir):
    with pytest.raises(json.JSONDecodeError):
        with TestClient(create_app(data_dir=broken_data_dir)):
            pass
