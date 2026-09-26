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


HF_MODEL = "https://huggingface.co/litert-community/gemma-4-E4B-it-litert-lm/resolve/abc123/gemma-4-E4B-it-web.litertlm"


def test_manifest_allows_hugging_face_url():
    m = Manifest.model_validate(_manifest(url=HF_MODEL))
    assert m.url == HF_MODEL


@pytest.mark.parametrize(
    "url",
    [
        "https://evil.example/x.litertlm",
        "http://huggingface.co/x.litertlm",
        "https://huggingface.co.evil.example/x.litertlm",
        "//huggingface.co/x.litertlm",
    ],
)
def test_manifest_rejects_non_allowlisted_url(url):
    with pytest.raises(ValidationError):
        Manifest.model_validate(_manifest(url=url))


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


TTS = {
    "id": "supertonic-3",
    "baseUrl": "/models/tts/supertonic-3/",
    "files": [
        {"path": "onnx/text_encoder.onnx", "size": 36416150},
        {"path": "voice_styles/M2.json", "size": 292055},
    ],
    "voice": "M2",
    "lang": "ko",
}


def test_manifest_tts_defaults_to_none():
    assert Manifest.model_validate(_manifest()).tts is None


def test_manifest_parses_tts():
    m = Manifest.model_validate(_manifest(tts=TTS))
    assert m.tts is not None
    assert m.tts.voice == "M2"
    assert [f.path for f in m.tts.files] == ["onnx/text_encoder.onnx", "voice_styles/M2.json"]


HF_TTS_BASE = "https://huggingface.co/Supertone/supertonic-3/resolve/abc123/"


def test_tts_base_url_allows_hugging_face_dir():
    m = Manifest.model_validate(_manifest(tts={**TTS, "baseUrl": HF_TTS_BASE}))
    assert m.tts is not None and m.tts.baseUrl == HF_TTS_BASE


@pytest.mark.parametrize(
    "base",
    [
        "/static/tts/",
        "/models/tts",
        "https://x/models/tts/",
        "https://huggingface.co/Supertone/supertonic-3/resolve/abc123",
        "https://huggingface.co.evil.example/tts/",
    ],
)
def test_tts_base_url_must_be_allowlisted_dir(base):
    with pytest.raises(ValidationError):
        Manifest.model_validate(_manifest(tts={**TTS, "baseUrl": base}))


@pytest.mark.parametrize("path", ["../secret.json", "onnx/../x.onnx", "/onnx/a.onnx", ""])
def test_tts_file_path_rejects_traversal_and_absolute(path):
    with pytest.raises(ValidationError):
        Manifest.model_validate(_manifest(tts={**TTS, "files": [{"path": path, "size": 1}]}))


def test_tts_requires_at_least_one_file_and_positive_size():
    with pytest.raises(ValidationError):
        Manifest.model_validate(_manifest(tts={**TTS, "files": []}))
    with pytest.raises(ValidationError):
        Manifest.model_validate(_manifest(tts={**TTS, "files": [{"path": "a.onnx", "size": 0}]}))


def test_tts_rejects_unknown_keys():
    with pytest.raises(ValidationError):
        Manifest.model_validate(_manifest(tts={**TTS, "steps": 8}))


VOICES = [
    {"id": "F1", "path": "voice_styles/F1.json", "size": 292046},
    {"id": "M2", "path": "voice_styles/M2.json", "size": 292055},
]


def test_tts_voices_default_to_none():
    m = Manifest.model_validate(_manifest(tts=TTS))
    assert m.tts is not None and m.tts.voices is None


def test_tts_parses_voices():
    m = Manifest.model_validate(_manifest(tts={**TTS, "voices": VOICES}))
    assert m.tts is not None and m.tts.voices is not None
    assert [v.id for v in m.tts.voices] == ["F1", "M2"]
    assert m.tts.voices[1].path == "voice_styles/M2.json"


def test_tts_voices_reject_empty_list():
    with pytest.raises(ValidationError):
        Manifest.model_validate(_manifest(tts={**TTS, "voices": []}))


def test_tts_voices_reject_duplicate_ids():
    dup = [*VOICES, {"id": "F1", "path": "voice_styles/F1b.json", "size": 1}]
    with pytest.raises(ValidationError):
        Manifest.model_validate(_manifest(tts={**TTS, "voices": dup}))


def test_tts_voices_must_include_default_voice():
    only_f1 = [VOICES[0]]  # 기본 voice는 "M2"
    with pytest.raises(ValidationError):
        Manifest.model_validate(_manifest(tts={**TTS, "voices": only_f1}))


@pytest.mark.parametrize(
    "voice",
    [
        {"id": "M2", "path": "/voice_styles/M2.json", "size": 1},
        {"id": "M2", "path": "voice_styles/../M2.json", "size": 1},
        {"id": "M2", "path": "", "size": 1},
        {"id": "M2", "path": "voice_styles/M2.json", "size": 0},
        {"id": "", "path": "voice_styles/M2.json", "size": 1},
        {"id": "M2", "path": "voice_styles/M2.json", "size": 1, "extra": "x"},
    ],
)
def test_tts_voice_rejects_bad_entries(voice):
    with pytest.raises(ValidationError):
        Manifest.model_validate(_manifest(tts={**TTS, "voices": [voice]}))
