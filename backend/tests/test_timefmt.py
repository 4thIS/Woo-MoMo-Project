from datetime import datetime

from app.timefmt import KST, format_utc, iso, kst_day_start


def test_iso_matches_js_to_iso_string():
    assert iso(0) == "1970-01-01T00:00:00.000Z"
    assert iso(1_760_000_000.5) == "2025-10-09T08:53:20.500Z"


def test_format_utc_converts_timezone():
    assert format_utc(datetime(2026, 10, 13, 13, 0, tzinfo=KST)) == "2026-10-13T04:00:00.000Z"


def test_kst_day_start_is_midnight_in_korea():
    # 1_760_000_000 = 2025-10-09 17:53:20 KST → 그날 0시(KST) = 전날 15:00 UTC
    assert kst_day_start(1_760_000_000) == "2025-10-08T15:00:00.000Z"
