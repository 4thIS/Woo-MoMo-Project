import json
import os
from pathlib import Path

from app.schemas import Manifest, QuestionSet

MANIFEST_FILENAME = "manifest.json"
QUESTIONS_DIRNAME = "questions"
DEFAULT_FIELD = "general"

DATA_DIR = Path(os.environ.get("MOMO_DATA_DIR", Path(__file__).resolve().parents[1] / "data"))


def _read_json(path: Path) -> object:
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def load_manifest(path: Path) -> Manifest:
    return Manifest.model_validate(_read_json(path))


def load_question_sets(directory: Path) -> dict[str, QuestionSet]:
    sets: dict[str, QuestionSet] = {}
    for file in sorted(directory.glob("*.json")):
        qs = QuestionSet.model_validate(_read_json(file))
        if qs.field != file.stem:
            raise ValueError(f"{file.name}: field {qs.field!r} does not match filename")
        sets[file.stem] = qs
    if DEFAULT_FIELD not in sets:
        raise ValueError(f"{DEFAULT_FIELD}.json is required in {directory}")
    return sets
