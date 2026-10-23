"""환경변수 설정 (spec 3절). 테스트는 Settings를 직접 만들어 create_app에 넘긴다."""

import os
from collections.abc import Mapping
from dataclasses import dataclass
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


def _parse_keys(value: str | None) -> tuple[str, ...]:
    if value is None:
        return ()
    return tuple(k for k in (p.strip() for p in value.split(",")) if k)


@dataclass(frozen=True)
class Settings:
    storage_dir: Path
    cors_origins: tuple[str, ...] = DEFAULT_CORS_ORIGINS
    cookie_secure: bool = True
    anthropic_api_key: str | None = None
    admin_login: str | None = None
    admin_password: str | None = None
    ben_daily_limit: int = DEFAULT_BEN_DAILY_LIMIT
    admin_emails: tuple[str, ...] = ()
    baze_api_keys: tuple[str, ...] = ()
    baze_voice_model: str = DEFAULT_BAZE_VOICE_MODEL
    baze_min_remaining: float = DEFAULT_BAZE_MIN_REMAINING

    @property
    def db_path(self) -> Path:
        return self.storage_dir / "momo.sqlite3"

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
        )
