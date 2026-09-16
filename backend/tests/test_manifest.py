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
    assert set(body) == {"id", "url", "size", "template", "systemPromptOverride", "fallback", "tts"}
    assert set(body["template"]) == {"turnStart", "turnEnd", "roles"}


def test_manifest_includes_tts_contract(client):
    body = client.get("/api/manifest").json()
    tts = body["tts"]
    assert tts["id"] == "supertonic-3"
    assert tts["baseUrl"] == "/models/tts/supertonic-3/"
    assert tts["voice"] == "M2" and tts["lang"] == "ko"
    paths = [f["path"] for f in tts["files"]]
    assert paths == [
        "onnx/text_encoder.onnx",
        "onnx/duration_predictor.onnx",
        "onnx/vector_estimator.onnx",
        "onnx/vocoder.onnx",
        "onnx/tts.json",
        "onnx/unicode_indexer.json",
        "voice_styles/M2.json",
    ]
    assert all(f["size"] > 0 for f in tts["files"])


def test_app_fails_to_start_on_broken_data(broken_data_dir):
    with pytest.raises(json.JSONDecodeError):
        with TestClient(create_app(data_dir=broken_data_dir)):
            pass
