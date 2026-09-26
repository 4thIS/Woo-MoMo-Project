from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

MODELS_PREFIX = "/models/"
HF_PREFIX = "https://huggingface.co/"
# 자체 서빙(/models/, nginx 볼륨)과 Hugging Face 직접 다운로드만 허용한다.
# 전환·복귀 절차: docs/specs/backend/2026-09-17-model-hosting-hf-design.md
ALLOWED_URL_PREFIXES = (MODELS_PREFIX, HF_PREFIX)


def _validate_model_url(url: str) -> str:
    if not url.startswith(ALLOWED_URL_PREFIXES):
        raise ValueError(f"model url must start with one of {ALLOWED_URL_PREFIXES!r}")
    return url


def _validate_relative_path(v: str) -> str:
    if v.startswith("/"):
        raise ValueError("tts file path must be relative")
    # 세그먼트 단위 검사: "onnx/../x"는 거부, "a..b.onnx" 같은 파일명은 허용
    if ".." in v.split("/"):
        raise ValueError("tts file path must not contain '..'")
    return v


class ChatTemplate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    turnStart: str
    turnEnd: str
    roles: dict[str, str]


class ModelRef(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1)
    url: str
    size: Annotated[int, Field(gt=0)]

    @field_validator("url")
    @classmethod
    def _url(cls, v: str) -> str:
        return _validate_model_url(v)


class TtsFile(BaseModel):
    model_config = ConfigDict(extra="forbid")

    path: str = Field(min_length=1)
    size: Annotated[int, Field(gt=0)]

    @field_validator("path")
    @classmethod
    def _relative_and_safe(cls, v: str) -> str:
        return _validate_relative_path(v)


class TtsVoice(BaseModel):
    """받을 수 있는 목소리 하나. 파일 URL = TtsManifest.baseUrl + path"""

    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1)
    path: str = Field(min_length=1)
    size: Annotated[int, Field(gt=0)]

    @field_validator("path")
    @classmethod
    def _relative_and_safe(cls, v: str) -> str:
        return _validate_relative_path(v)


class TtsManifest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1)
    baseUrl: str
    files: Annotated[list[TtsFile], Field(min_length=1)]
    voice: str = Field(min_length=1)
    lang: str = Field(min_length=1)
    # 면접관별 목소리(2026-09-26, additive). 엔진 = files − voices 경로.
    # docs/specs/backend/2026-09-26-tts-voices-design.md
    voices: list[TtsVoice] | None = None

    @field_validator("baseUrl")
    @classmethod
    def _base_url(cls, v: str) -> str:
        if not v.endswith("/"):
            raise ValueError("tts baseUrl must end with '/'")
        return _validate_model_url(v)

    @model_validator(mode="after")
    def _voices_consistent(self) -> "TtsManifest":
        if self.voices is None:
            return self
        if not self.voices:
            raise ValueError("tts voices must not be empty")
        ids = [v.id for v in self.voices]
        if len(set(ids)) != len(ids):
            raise ValueError("tts voice ids must be unique")
        if self.voice not in ids:
            raise ValueError(f"default tts voice {self.voice!r} must be listed in voices")
        return self


class Manifest(ModelRef):
    template: ChatTemplate
    systemPromptOverride: str | None = None
    fallback: ModelRef | None = None
    tts: TtsManifest | None = None


class QuestionSet(BaseModel):
    model_config = ConfigDict(extra="forbid")

    field: str = Field(min_length=1)
    questions: Annotated[list[str], Field(min_length=5, max_length=5)]

    @field_validator("questions")
    @classmethod
    def _non_blank(cls, v: list[str]) -> list[str]:
        if any(not q.strip() for q in v):
            raise ValueError("questions must not be blank")
        return v
