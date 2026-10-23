import re
from typing import Annotated, Any, Literal
from urllib.parse import urlsplit

from pydantic import (
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    SerializerFunctionWrapHandler,
    StringConstraints,
    field_validator,
    model_serializer,
    model_validator,
)

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
        paths = [v.path for v in self.voices]
        if len(set(paths)) != len(paths):
            raise ValueError("tts voice paths must be unique")
        # 엔진 = files − voices 경로. files에 둘 수 있는 목소리는 옛 프론트용 기본 목소리뿐
        default_path = next(v.path for v in self.voices if v.id == self.voice)
        stray = ({f.path for f in self.files} & set(paths)) - {default_path}
        if stray:
            raise ValueError(f"tts files may only hold the default voice file, not {sorted(stray)}")
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


# ── 계정 (2026-10-13, docs/API.md "계정·이력서·보관함·프리미엄") ──

Tier = Literal["member", "premium"]


class Profile(BaseModel):
    name: str | None
    age: int | None


class Session(BaseModel):
    userId: str
    email: str
    tier: Tier
    tickets: int
    isAdmin: bool
    profile: Profile
    createdAt: str


class SignupBody(BaseModel):
    # 기본값을 둬서 빠진 칸도 라우터가 정해진 오류 코드로 답하게 한다
    email: str = ""
    password: str = ""
    name: str = ""
    consent: bool | None = None


class LoginBody(BaseModel):
    email: str = ""
    password: str = ""


class ProfileBody(BaseModel):
    name: str | None = Field(default=None, max_length=100)
    age: int | None = Field(default=None, ge=1, le=120)


class EmailTakenResponse(BaseModel):
    taken: bool


# ── 내 이력서 ──

ResumeKind = Literal["company", "admission"]
ResumeTitle = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=40)]
ResumeText = Annotated[str, Field(max_length=20_000)]


class ResumeSlot(BaseModel):
    id: str
    kind: ResumeKind
    title: str
    text: str
    updatedAt: str


class ResumeCreate(BaseModel):
    kind: ResumeKind
    title: ResumeTitle
    text: ResumeText


class ResumeUpdate(BaseModel):
    # kind는 바꿀 수 없다. 프론트 ResumeDraft가 kind를 실어 보내도 무시된다.
    title: ResumeTitle
    text: ResumeText


# ── 보관함 ──

Track = Literal["company", "admission"]
ShortText = Annotated[str, Field(max_length=100)]


class ChatMessage(BaseModel):
    role: Literal["user", "model"]
    text: str = Field(max_length=20_000)
    at: int | None = None


class ReportItem(BaseModel):
    question: str
    answerSummary: str
    feedback: str
    # 벤 전달력 피드백(2026-10-16). 없으면 칸 자체를 내보내지 않는다 — 예전 기록과 같은 모양
    delivery: str | None = Field(default=None, max_length=2000)

    # delivery가 없으면 키를 뺀다. 부작용: 직렬화 JSON 스키마(OpenAPI)가 일반형이 된다(런타임 무관).
    @model_serializer(mode="wrap")
    def _omit_missing_delivery(self, handler: SerializerFunctionWrapHandler) -> dict[str, Any]:
        data = handler(self)
        if data.get("delivery") is None:
            data.pop("delivery", None)
        return data


class DeliveryMetric(BaseModel):
    """브라우저가 잰 답변 하나의 전달력(spec 2026-10-16 2.1). 숫자만."""

    answer: int = Field(ge=1, le=8)
    speechSec: float = Field(ge=0, le=600)
    syllables: int = Field(ge=0, le=5000)
    longPauses: int = Field(ge=0, le=200)
    longestPauseSec: float = Field(ge=0, le=600)
    firstWordSec: float = Field(ge=0, le=600)
    fillerLevel: Literal["low", "normal", "high"] | None = None


class ReportBody(BaseModel):
    delivery: list[DeliveryMetric] = Field(default_factory=list, max_length=8)

    @field_validator("delivery")
    @classmethod
    def _answers_are_unique(cls, v: list[DeliveryMetric]) -> list[DeliveryMetric]:
        if len({m.answer for m in v}) != len(v):
            raise ValueError("duplicate answer")
        return v


class RecordingRef(BaseModel):
    turn: int
    url: str


class ArchiveEntry(BaseModel):
    id: str
    interviewerId: str
    premium: bool
    track: Track
    startedAt: str
    endedAt: str
    questionCount: int
    hasRecording: bool
    field: str | None = None
    job: str | None = None
    name: str | None = None
    age: int | None = None
    university: str | None = None
    department: str | None = None


class ArchiveDetail(ArchiveEntry):
    messages: list[ChatMessage]
    report: list[ReportItem]
    reportRaw: str
    recordings: list[RecordingRef]


class ArchiveCreate(BaseModel):
    # 프론트 ArchiveDraft의 hasRecording·recordings는 서버가 정하므로 무시된다
    interviewerId: str = Field(min_length=1, max_length=20)
    premium: bool
    track: Track
    startedAt: AwareDatetime
    endedAt: AwareDatetime
    questionCount: int = Field(default=0, ge=0)
    field: ShortText | None = None
    job: ShortText | None = None
    name: ShortText | None = None
    age: int | None = Field(default=None, ge=1, le=120)
    university: ShortText | None = None
    department: ShortText | None = None
    messages: list[ChatMessage] = Field(max_length=200)
    report: list[ReportItem] = Field(max_length=50)
    reportRaw: str = Field(max_length=100_000)
    premiumInterviewId: str | None = None


class ArchiveSaved(BaseModel):
    entry: ArchiveEntry
    evicted: list[str]


# ── 벤 면접 ──

NonBlank100 = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
OptionalText100 = Annotated[str, StringConstraints(strip_whitespace=True, max_length=100)]


class CompanyInputs(BaseModel):
    field: NonBlank100
    job: NonBlank100
    # 벤 회사 브리핑(spec 2026-10-15): 실제 지원 회사. 비면 없는 것으로 친다
    name: OptionalText100 | None = None

    @field_validator("name")
    @classmethod
    def _blank_name_is_none(cls, v: str | None) -> str | None:
        return v or None

    # 모집공고 링크(spec 2026-10-23): 비면 없음, 1~500자 http(s) 절대 URL
    postingUrl: str | None = None

    @field_validator("postingUrl")
    @classmethod
    def _posting_url(cls, v: str | None) -> str | None:
        v = (v or "").strip()
        if not v:
            return None
        if len(v) > 500:
            raise ValueError("too long")
        if not v.isascii() or re.search(r"[\s\x00-\x1f\x7f]", v):
            raise ValueError("whitespace or control character")
        try:
            parts = urlsplit(v)
            _ = parts.port  # 잘못된 포트는 ValueError
            host = parts.hostname or ""
            ok = (
                parts.scheme in {"http", "https"}
                and bool(host)
                and host.isascii()
                and parts.username is None
                and parts.password is None
            )
        except ValueError:
            ok = False
        if not ok:
            raise ValueError("not an http(s) url")
        return v


class AdmissionInputs(BaseModel):
    name: NonBlank100
    age: int = Field(ge=1, le=120)
    university: NonBlank100
    department: NonBlank100


class InterviewStart(BaseModel):
    track: Track
    resumeText: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=20_000)
    ]
    company: CompanyInputs | None = None
    admission: AdmissionInputs | None = None
    # 목소리 분석 동의(2026-10-23, additive). 안 하면 1단계와 같다
    voiceAnalysisConsent: bool = False


class InterviewStarted(BaseModel):
    interviewId: str
    session: Session
    voiceAnalysis: Literal["on", "off", "unavailable"] = "off"


class TurnBody(BaseModel):
    answer: str | None = None


# ── 녹음 ──


class RecordingCreated(BaseModel):
    id: str
    url: str


# ── 관리자 (spec 2026-10-17 3절). 본문(이력서·대화·리포트·녹음)은 어떤 모델에도 없다 ──


class AdminUsers(BaseModel):
    total: int
    last7Days: int
    last30Days: int
    withTickets: int
    admins: int


class AdminDayCount(BaseModel):
    date: str
    count: int


class AdminBen(BaseModel):
    today: int
    dailyLimit: int
    byDay: list[AdminDayCount]


class AdminOverview(BaseModel):
    users: AdminUsers
    tickets: dict[str, int]
    ben: AdminBen
    archive: dict[str, int]
    recordings: dict[str, int]
    briefings: dict[str, int]
    weakEmergencyPassword: bool


class AdminUserItem(BaseModel):
    id: str
    email: str
    name: str | None
    createdAt: str
    tickets: int
    isAdmin: bool
    archiveCount: int
    benCount: int
    lastActiveAt: str | None


class AdminUserPage(BaseModel):
    page: int
    pageSize: int
    total: int
    items: list[AdminUserItem]


class AdminBenItem(BaseModel):
    id: str
    createdAt: str
    track: str
    status: str
    modelTurns: int
    briefingStatus: str


class AdminArchiveItem(BaseModel):
    id: str
    startedAt: str
    interviewerId: str
    premium: bool
    track: str
    questionCount: int
    hasRecording: bool


class AdminTicketLogItem(BaseModel):
    at: str
    adminEmail: str | None
    delta: int
    reason: str


class AdminUserDetail(BaseModel):
    user: AdminUserItem
    ben: list[AdminBenItem]
    archive: list[AdminArchiveItem]
    ticketLog: list[AdminTicketLogItem]


class TicketAdjust(BaseModel):
    delta: Annotated[int, Field(strict=True, ge=-100, le=100)]
    reason: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]

    @field_validator("delta")
    @classmethod
    def _not_zero(cls, v: int) -> int:
        if v == 0:
            raise ValueError("delta must not be 0")
        return v


class TicketsResult(BaseModel):
    tickets: int


class AdminPricing(BaseModel):
    model: str
    inputPerMTok: float
    outputPerMTok: float
    cacheReadPerMTok: float
    cacheWritePerMTok: float
    webSearch: float


class AdminUsageDay(BaseModel):
    date: str
    calls: int
    inputTokens: int
    outputTokens: int
    cacheReadTokens: int
    cacheWriteTokens: int
    webSearches: int
    errors: int
    refusals: int
    costUsd: float


class AdminUsageKind(BaseModel):
    kind: str
    calls: int
    costUsd: float


class AdminTopInterview(BaseModel):
    interviewId: str
    userEmail: str | None
    calls: int
    costUsd: float


class AdminUsage(BaseModel):
    pricing: AdminPricing
    since: str | None
    byDay: list[AdminUsageDay]
    byKind: list[AdminUsageKind]
    topInterviews: list[AdminTopInterview]


class AdminAuditItem(BaseModel):
    at: str
    adminEmail: str | None
    action: str
    targetUserId: str | None
    targetEmail: str | None
    delta: int | None
    reason: str | None


class AdminAuditPage(BaseModel):
    page: int
    pageSize: int
    total: int
    items: list[AdminAuditItem]
