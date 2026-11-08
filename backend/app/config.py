"""환경변수 설정 (spec 3절). 테스트는 Settings를 직접 만들어 create_app에 넘긴다."""

import os
from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Self

DEFAULT_CORS_ORIGINS = (
    "https://momo.ssenu.cloud",
    "https://demomo.ssenu.cloud",
    "http://localhost:5173",
)
DEFAULT_BEN_DAILY_LIMIT = 30
DEFAULT_BAZE_VOICE_MODEL = "gemini-3.8-flash"
DEFAULT_BAZE_MIN_REMAINING = 50.0
# 목소리 분석을 어디로 보낼지 (spec 2026-11-03). 한 번에 한 곳만 쓴다
VOICE_PROVIDERS = ("gemini", "baze")
DEFAULT_VOICE_PROVIDER = "gemini"
DEFAULT_GEMINI_VOICE_MODEL = "gemini-3.8-flash"
DEFAULT_MAIL_API_URL = "https://send.ssenu.cloud/v1/send"
# DATA_DIR = 사용자 데이터(DB·녹음). 정적 계약 데이터(MOMO_DATA_DIR)와 다르다.
DEFAULT_STORAGE_DIR = Path(__file__).resolve().parents[1] / "var"


def _stripped(value: str | None) -> str | None:
    if value is None or not value.strip():
        return None
    return value.strip()


def _parse_bool(value: str | None, default: bool) -> bool:
    if value is None or not value.strip():
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _parse_origins(value: str | None) -> tuple[str, ...]:
    if value is None or not value.strip():
        return DEFAULT_CORS_ORIGINS
    origins = tuple(o.strip().rstrip("/") for o in value.split(",") if o.strip())
    if "*" in origins:
        raise ValueError("CORS_ORIGINS must list exact origins, not '*'")
    return origins


def _parse_emails(value: str | None) -> tuple[str, ...]:
    if value is None:
        return ()
    emails = (e.strip().lower() for e in value.split(","))
    return tuple(dict.fromkeys(e for e in emails if e))


def _parse_provider(value: str | None) -> str:
    if value is None or not value.strip():
        return DEFAULT_VOICE_PROVIDER
    provider = value.strip().lower()
    if provider not in VOICE_PROVIDERS:
        raise ValueError(f"VOICE_PROVIDER must be one of {VOICE_PROVIDERS}")
    return provider


def _parse_keys(value: str | None) -> tuple[str, ...]:
    if value is None:
        return ()
    return tuple(k for k in (p.strip() for p in value.split(",")) if k)


@dataclass(frozen=True)
class Settings:
    storage_dir: Path
    cors_origins: tuple[str, ...] = DEFAULT_CORS_ORIGINS
    cookie_secure: bool = True
    anthropic_api_key: str | None = field(default=None, repr=False)
    naver_client_id: str | None = field(default=None, repr=False)
    naver_client_secret: str | None = field(default=None, repr=False)
    admin_login: str | None = None
    admin_password: str | None = field(default=None, repr=False)
    ben_daily_limit: int = DEFAULT_BEN_DAILY_LIMIT
    admin_emails: tuple[str, ...] = ()
    baze_api_keys: tuple[str, ...] = field(default=(), repr=False)
    baze_voice_model: str = DEFAULT_BAZE_VOICE_MODEL
    baze_min_remaining: float = DEFAULT_BAZE_MIN_REMAINING
    voice_provider: str = DEFAULT_VOICE_PROVIDER
    gemini_api_keys: tuple[str, ...] = field(default=(), repr=False)
    gemini_voice_model: str = DEFAULT_GEMINI_VOICE_MODEL
    ben_report_v2: bool = False
    ben_pii_mask: bool = False  # 직접 생성 기본은 꺼짐, 운영 기본은 from_env에서 켜짐
    signup_email_verify: bool = False
    signup_terms_required: bool = False
    mail_api_key: str | None = field(default=None, repr=False)
    mail_api_url: str = DEFAULT_MAIL_API_URL

    @property
    def db_path(self) -> Path:
        return self.storage_dir / "momo.sqlite3"

    @property
    def voice_usage_model(self) -> str:
        """baze_usage.model에 남길 값 — BAZE는 지금처럼 모델 이름, Gemini 직접은 gemini: 접두어."""
        if self.voice_provider == "baze":
            return self.baze_voice_model
        return f"gemini:{self.gemini_voice_model}"

    @property
    def voice_tmp_dir(self) -> Path:
        return self.storage_dir / "voice_tmp"

    @property
    def recordings_dir(self) -> Path:
        return self.storage_dir / "recordings"

    @classmethod
    def from_env(cls, env: Mapping[str, str] | None = None) -> Self:
        e = os.environ if env is None else env
        storage = _stripped(e.get("DATA_DIR"))
        limit = _stripped(e.get("BEN_DAILY_LIMIT"))
        min_remaining = _stripped(e.get("BAZE_MIN_REMAINING"))
        return cls(
            storage_dir=Path(storage) if storage else DEFAULT_STORAGE_DIR,
            cors_origins=_parse_origins(e.get("CORS_ORIGINS")),
            cookie_secure=_parse_bool(e.get("COOKIE_SECURE"), default=True),
            anthropic_api_key=_stripped(e.get("ANTHROPIC_API_KEY")),
            naver_client_id=_stripped(e.get("NAVER_CLIENT_ID")),
            naver_client_secret=_stripped(e.get("NAVER_CLIENT_SECRET")),
            admin_login=_stripped(e.get("ADMIN_LOGIN")),
            # 비밀번호는 공백도 값이다 — 비어 있을 때만 없음으로 본다
            admin_password=e.get("ADMIN_PASSWORD") or None,
            ben_daily_limit=int(limit) if limit else DEFAULT_BEN_DAILY_LIMIT,
            admin_emails=_parse_emails(e.get("ADMIN_EMAILS")),
            baze_api_keys=_parse_keys(e.get("BAZE_API_KEYS")),
            baze_voice_model=_stripped(e.get("BAZE_VOICE_MODEL")) or DEFAULT_BAZE_VOICE_MODEL,
            baze_min_remaining=float(min_remaining)
            if min_remaining
            else DEFAULT_BAZE_MIN_REMAINING,
            voice_provider=_parse_provider(e.get("VOICE_PROVIDER")),
            gemini_api_keys=_parse_keys(e.get("GEMINI_API_KEYS")),
            gemini_voice_model=_stripped(e.get("GEMINI_VOICE_MODEL")) or DEFAULT_GEMINI_VOICE_MODEL,
            ben_report_v2=_parse_bool(e.get("BEN_REPORT_V2"), default=False),
            ben_pii_mask=_parse_bool(e.get("BEN_PII_MASK"), default=True),
            signup_email_verify=_parse_bool(e.get("SIGNUP_EMAIL_VERIFY"), default=False),
            signup_terms_required=_parse_bool(e.get("SIGNUP_TERMS_REQUIRED"), default=False),
            mail_api_key=_stripped(e.get("MAIL_API_KEY")),
            mail_api_url=_stripped(e.get("MAIL_API_URL")) or DEFAULT_MAIL_API_URL,
        )
