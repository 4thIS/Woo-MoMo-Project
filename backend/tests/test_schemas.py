import pytest
from pydantic import ValidationError

from app.schemas import ChatTemplate, Manifest, ModelRef, QuestionSet

TEMPLATE = {
    "turnStart": "<|turn>",
    "turnEnd": "<turn|>",
    "roles": {"system": "system", "user": "user", "model": "model"},
}


def _manifest(**over):
    base = {
        "id": "gemma4-e4b-it",
        "url": "/models/gemma4-e4b-it-web.litertlm",
        "size": 4400000000,
        "template": TEMPLATE,
        "systemPromptOverride": None,
        "fallback": {
            "id": "gemma4-e2b-it",
            "url": "/models/gemma4-e2b-it-web.litertlm",
            "size": 2000000000,
        },
    }
    base.update(over)
    return base


def test_manifest_parses_api_example():
    m = Manifest.model_validate(_manifest())
    assert m.id == "gemma4-e4b-it"
    assert isinstance(m.template, ChatTemplate)
    assert isinstance(m.fallback, ModelRef)
    assert m.fallback.id == "gemma4-e2b-it"


def test_manifest_allows_null_fallback_and_override():
    m = Manifest.model_validate(_manifest(fallback=None))
    assert m.fallback is None
    assert m.systemPromptOverride is None


def test_manifest_rejects_external_url():
    with pytest.raises(ValidationError):
        Manifest.model_validate(_manifest(url="https://huggingface.co/x.litertlm"))


def test_manifest_rejects_non_positive_size():
    with pytest.raises(ValidationError):
        Manifest.model_validate(_manifest(size=0))


def test_fallback_url_must_be_under_models():
    bad = {"id": "x", "url": "/static/x.litertlm", "size": 1}
    with pytest.raises(ValidationError):
        Manifest.model_validate(_manifest(fallback=bad))


def test_manifest_serializes_with_camel_case_keys():
    data = Manifest.model_validate(_manifest()).model_dump()
    assert "systemPromptOverride" in data
    assert "turnStart" in data["template"]


def test_question_set_requires_exactly_five():
    QuestionSet(field="it", questions=["q1", "q2", "q3", "q4", "q5"])
    with pytest.raises(ValidationError):
        QuestionSet(field="it", questions=["q1", "q2"])


def test_question_set_rejects_blank_question():
    with pytest.raises(ValidationError):
        QuestionSet(field="it", questions=["q1", " ", "q3", "q4", "q5"])


def test_manifest_rejects_unknown_keys():
    with pytest.raises(ValidationError):
        Manifest.model_validate(_manifest(sytemPromptOverride="typo"))


def test_question_set_rejects_unknown_keys():
    with pytest.raises(ValidationError):
        QuestionSet.model_validate(
            {"field": "it", "questions": ["q1", "q2", "q3", "q4", "q5"], "extra": "nope"}
        )
