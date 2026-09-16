from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, field_validator

MODELS_PREFIX = "/models/"


def _validate_model_url(url: str) -> str:
    if not url.startswith(MODELS_PREFIX):
        raise ValueError(f"model url must start with {MODELS_PREFIX!r}")
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
        if not v.startswith(MODELS_PREFIX) or not v.endswith("/"):
            raise ValueError(f"tts baseUrl must start with {MODELS_PREFIX!r} and end with '/'")
        return v


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
