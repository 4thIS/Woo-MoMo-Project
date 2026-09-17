from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, field_validator

MODELS_PREFIX = "/models/"
HF_PREFIX = "https://huggingface.co/"
# 자체 서빙(/models/, nginx 볼륨)과 Hugging Face 직접 다운로드만 허용한다.
# 전환·복귀 절차: docs/specs/backend/2026-09-17-model-hosting-hf-design.md
ALLOWED_URL_PREFIXES = (MODELS_PREFIX, HF_PREFIX)


def _validate_model_url(url: str) -> str:
    if not url.startswith(ALLOWED_URL_PREFIXES):
        raise ValueError(f"model url must start with one of {ALLOWED_URL_PREFIXES!r}")
    return url


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
        if v.startswith("/"):
            raise ValueError("tts file path must be relative")
        # 세그먼트 단위 검사: "onnx/../x"는 거부, "a..b.onnx" 같은 파일명은 허용
        if ".." in v.split("/"):
            raise ValueError("tts file path must not contain '..'")
        return v


class TtsManifest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1)
    baseUrl: str
    files: Annotated[list[TtsFile], Field(min_length=1)]
    voice: str = Field(min_length=1)
    lang: str = Field(min_length=1)

    @field_validator("baseUrl")
    @classmethod
    def _base_url(cls, v: str) -> str:
        if not v.endswith("/"):
            raise ValueError("tts baseUrl must end with '/'")
        return _validate_model_url(v)


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
