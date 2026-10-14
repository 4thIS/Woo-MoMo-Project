"""시각 문자열: UTC ISO 8601 밀리초 + Z (JS toISOString과 같은 모양)."""

from datetime import UTC, datetime, timedelta, timezone

KST = timezone(timedelta(hours=9))


def format_utc(dt: datetime) -> str:
    u = dt.astimezone(UTC)
    return u.strftime("%Y-%m-%dT%H:%M:%S.") + f"{u.microsecond // 1000:03d}Z"


def iso(ts: float) -> str:
    return format_utc(datetime.fromtimestamp(ts, UTC))


def kst_day_start(ts: float) -> str:
    """ts가 속한 한국 날짜의 0시. 벤 하루 상한의 경계."""
    local = datetime.fromtimestamp(ts, KST)
    return format_utc(local.replace(hour=0, minute=0, second=0, microsecond=0))
