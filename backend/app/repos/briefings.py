"""company_briefings SQL (spec 2026-10-15 2.4). 회사·직무별 브리핑을 7일 동안 사용자 간에 공유한다.

브리핑은 회사명·직무와 공개 웹 정보로만 만든다 — 개인정보가 없어 공유할 수 있다.
"""

import json
import sqlite3
from dataclasses import dataclass

FRESH_SECONDS = 7 * 24 * 3600


@dataclass(frozen=True)
class CachedBriefing:
    briefing: str
    sources: list[dict[str, str]]


def _fold(value: str) -> str:
    return " ".join(value.split()).lower()


def cache_key(company: str, job: str) -> str:
    return f"{_fold(company)}\n{_fold(job)}"


def get_fresh(conn: sqlite3.Connection, *, key: str, since: str) -> CachedBriefing | None:
    row = conn.execute(
        "SELECT briefing, sources_json FROM company_briefings WHERE key = ? AND created_at >= ?",
        (key, since),
    ).fetchone()
    if row is None:
        return None
    return CachedBriefing(briefing=row["briefing"], sources=json.loads(row["sources_json"]))


def put(
    conn: sqlite3.Connection,
    *,
    key: str,
    company: str,
    job: str,
    briefing: str,
    sources: list[dict[str, str]],
    created_at: str,
) -> None:
    conn.execute(
        "INSERT INTO company_briefings (key, company, job, briefing, sources_json, created_at)"
        " VALUES (?, ?, ?, ?, ?, ?)"
        " ON CONFLICT(key) DO UPDATE SET company = excluded.company, job = excluded.job,"
        " briefing = excluded.briefing, sources_json = excluded.sources_json,"
        " created_at = excluded.created_at",
        (key, company, job, briefing, json.dumps(sources, ensure_ascii=False), created_at),
    )
