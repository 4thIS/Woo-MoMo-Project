import json
import re

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
    assert tts["baseUrl"].endswith("/")
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


HF_REVISION = re.compile(r"^https://huggingface\.co/[^/]+/[^/]+/resolve/[0-9a-f]{40}/")


def test_repo_manifest_pins_hugging_face_revisions(repo_manifest):
    # HF 항목은 브랜치명(main)이 아닌 커밋 해시로 고정한다(매니페스트 size와 어긋나지 않게).
    # /models/(파이 자체 서빙) 항목은 검사하지 않는다 — 복귀는 manifest.json 수정만으로 끝난다.
    urls = [repo_manifest["url"], repo_manifest["tts"]["baseUrl"]]
    if repo_manifest["fallback"]:
        urls.append(repo_manifest["fallback"]["url"])
    hf = [u for u in urls if u.startswith("https://huggingface.co/")]
    assert all(HF_REVISION.match(u) for u in hf), hf


EXPECTED_VOICE_IDS = ["F1", "F2", "F3", "F4", "F5", "M1", "M2", "M3", "M4", "M5"]


def test_manifest_tts_lists_all_voices(client):
    tts = client.get("/api/manifest").json()["tts"]
    voices = tts["voices"]
    assert [v["id"] for v in voices] == EXPECTED_VOICE_IDS
    assert all(v["path"] == f"voice_styles/{v['id']}.json" for v in voices)
    assert all(v["size"] > 0 for v in voices)


def test_manifest_default_voice_matches_files_entry(client):
    tts = client.get("/api/manifest").json()["tts"]
    by_id = {v["id"]: v for v in tts["voices"]}
    default = by_id[tts["voice"]]
    files = {f["path"]: f["size"] for f in tts["files"]}
    # 옛 프론트 호환: files에 남은 기본 목소리와 voices의 기본 목소리는 같은 파일·같은 크기
    assert files[default["path"]] == default["size"]


def test_manifest_engine_files_exclude_voices(client):
    tts = client.get("/api/manifest").json()["tts"]
    voice_paths = {v["path"] for v in tts["voices"]}
    engine = [f["path"] for f in tts["files"] if f["path"] not in voice_paths]
    assert engine == [
        "onnx/text_encoder.onnx",
        "onnx/duration_predictor.onnx",
        "onnx/vector_estimator.onnx",
        "onnx/vocoder.onnx",
        "onnx/tts.json",
        "onnx/unicode_indexer.json",
    ]
