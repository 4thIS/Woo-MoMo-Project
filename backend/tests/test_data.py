import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.data import DATA_DIR, load_manifest, load_question_sets
from app.schemas import Manifest, QuestionSet

REPO_DATA = Path(__file__).resolve().parents[1] / "data"


def test_data_dir_defaults_to_backend_data():
    assert DATA_DIR == REPO_DATA


def test_load_manifest_reads_repo_file():
    m = load_manifest(REPO_DATA / "manifest.json")
    assert isinstance(m, Manifest)
    assert m.url.startswith("/models/")


def test_load_question_sets_reads_all_five_fields():
    sets = load_question_sets(REPO_DATA / "questions")
    assert set(sets) == {"general", "it", "finance", "manufacturing", "retail"}
    assert all(isinstance(s, QuestionSet) for s in sets.values())
    assert all(key == s.field for key, s in sets.items())


def test_load_manifest_raises_on_invalid_json(tmp_path: Path):
    bad = tmp_path / "manifest.json"
    bad.write_text("{ not json", encoding="utf-8")
    with pytest.raises(json.JSONDecodeError):
        load_manifest(bad)


def test_load_manifest_raises_on_schema_violation(tmp_path: Path):
    bad = tmp_path / "manifest.json"
    bad.write_text(
        json.dumps(
            {
                "id": "x",
                "url": "/models/x",
                "size": -1,
                "template": {
                    "turnStart": "<|turn>",
                    "turnEnd": "<turn|>",
                    "roles": {"system": "system", "user": "user", "model": "model"},
                },
            }
        ),
        encoding="utf-8",
    )
    with pytest.raises(ValidationError):
        load_manifest(bad)


def test_load_question_sets_requires_general(tmp_path: Path):
    qdir = tmp_path / "questions"
    qdir.mkdir()
    (qdir / "it.json").write_text(
        json.dumps({"field": "it", "questions": ["1", "2", "3", "4", "5"]}), encoding="utf-8"
    )
    with pytest.raises(ValueError, match="general"):
        load_question_sets(qdir)


def test_load_question_sets_rejects_field_mismatch(tmp_path: Path):
    qdir = tmp_path / "questions"
    qdir.mkdir()
    (qdir / "general.json").write_text(
        json.dumps({"field": "it", "questions": ["1", "2", "3", "4", "5"]}), encoding="utf-8"
    )
    with pytest.raises(ValueError, match="field"):
        load_question_sets(qdir)
