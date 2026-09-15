import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import create_app

REPO_DATA = Path(__file__).resolve().parents[1] / "data"


@pytest.fixture
def client() -> TestClient:
    with TestClient(create_app()) as c:
        yield c


@pytest.fixture
def repo_manifest() -> dict:
    return json.loads((REPO_DATA / "manifest.json").read_text(encoding="utf-8"))


@pytest.fixture
def broken_data_dir(tmp_path: Path) -> Path:
    (tmp_path / "manifest.json").write_text("{ broken", encoding="utf-8")
    (tmp_path / "questions").mkdir()
    return tmp_path
