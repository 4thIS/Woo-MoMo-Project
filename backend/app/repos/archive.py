"""archive SQL (spec 4.2). 대화·리포트는 해석하지 않고 JSON 문자열 그대로 둔다."""

import sqlite3
from dataclasses import dataclass

from app.db import transaction
from app.ids import new_id

ARCHIVE_LIMIT = 5


@dataclass(frozen=True)
class NewArchive:
    interviewer_id: str
    premium: bool
    premium_interview_id: str | None
    track: str
    field: str | None
    job: str | None
    name: str | None
    age: int | None
    university: str | None
    department: str | None
    question_count: int
    started_at: str
    ended_at: str
    messages_json: str
    report_json: str
    report_raw: str


@dataclass(frozen=True)
class ArchiveSummary:
    id: str
    interviewer_id: str
    premium: bool
    track: str
    field: str | None
    job: str | None
    name: str | None
    age: int | None
    university: str | None
    department: str | None
    question_count: int
    started_at: str
    ended_at: str
    has_recording: bool


@dataclass(frozen=True)
class ArchiveRecord:
    summary: ArchiveSummary
    messages_json: str
    report_json: str
    report_raw: str
    recordings: list[tuple[int, str]]


@dataclass(frozen=True)
class SaveResult:
    archive_id: str
    evicted: list[str]
    removed_paths: list[str]


class InvalidPremiumInterview(Exception):
    """본인의, 끝난, 아직 저장되지 않은 벤 면접이 아니다."""


SUMMARY_SQL = """
SELECT a.*,
       EXISTS (SELECT 1 FROM recordings r WHERE r.archive_id = a.id) AS has_recording
FROM archive a
"""

INSERT_SQL = """
INSERT INTO archive (
    id, user_id, interviewer_id, premium, premium_interview_id, track,
    field, job, name, age, university, department, question_count,
    started_at, ended_at, messages_json, report_json, report_raw
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
"""

USABLE_INTERVIEW_SQL = """
SELECT 1 FROM premium_interviews p
WHERE p.id = ? AND p.user_id = ? AND p.status = 'done'
  AND NOT EXISTS (SELECT 1 FROM archive a WHERE a.premium_interview_id = p.id)
"""


def _summary(row: sqlite3.Row) -> ArchiveSummary:
    return ArchiveSummary(
        id=row["id"],
        interviewer_id=row["interviewer_id"],
        premium=bool(row["premium"]),
        track=row["track"],
        field=row["field"],
        job=row["job"],
        name=row["name"],
        age=row["age"],
        university=row["university"],
        department=row["department"],
        question_count=row["question_count"],
        started_at=row["started_at"],
        ended_at=row["ended_at"],
        has_recording=bool(row["has_recording"]),
    )


def _delete_many(conn: sqlite3.Connection, user_id: str, archive_ids: list[str]) -> list[str]:
    """기록과 녹음 행을 지우고, 커밋 뒤 지울 파일 경로를 돌려준다."""
    paths: list[str] = []
    for archive_id in archive_ids:
        rows = conn.execute(
            "SELECT path FROM recordings WHERE archive_id = ? AND user_id = ?",
            (archive_id, user_id),
        )
        paths.extend(r["path"] for r in rows)
        conn.execute(
            "DELETE FROM recordings WHERE archive_id = ? AND user_id = ?", (archive_id, user_id)
        )
        conn.execute("DELETE FROM archive WHERE id = ? AND user_id = ?", (archive_id, user_id))
    return paths


def save_archive(conn: sqlite3.Connection, *, user_id: str, new: NewArchive) -> SaveResult:
    archive_id = new_id("a")
    interview_id = new.premium_interview_id if new.premium else None
    with transaction(conn):
        if new.premium:
            usable = (
                interview_id is not None
                and conn.execute(USABLE_INTERVIEW_SQL, (interview_id, user_id)).fetchone()
            )
            if not usable:
                raise InvalidPremiumInterview
        conn.execute(
            INSERT_SQL,
            (
                archive_id,
                user_id,
                new.interviewer_id,
                int(new.premium),
                interview_id,
                new.track,
                new.field,
                new.job,
                new.name,
                new.age,
                new.university,
                new.department,
                new.question_count,
                new.started_at,
                new.ended_at,
                new.messages_json,
                new.report_json,
                new.report_raw,
            ),
        )
        rows = conn.execute(
            "SELECT id FROM archive WHERE user_id = ? AND premium = 0"
            " ORDER BY started_at DESC, id DESC LIMIT -1 OFFSET ?",
            (user_id, ARCHIVE_LIMIT),
        )
        evicted = [r["id"] for r in rows]
        removed = _delete_many(conn, user_id, evicted)
    return SaveResult(archive_id=archive_id, evicted=evicted, removed_paths=removed)


def list_archive(conn: sqlite3.Connection, user_id: str) -> list[ArchiveSummary]:
    rows = conn.execute(
        SUMMARY_SQL + " WHERE a.user_id = ? ORDER BY a.started_at DESC, a.id DESC", (user_id,)
    )
    return [_summary(r) for r in rows]


def get_archive(conn: sqlite3.Connection, *, user_id: str, archive_id: str) -> ArchiveRecord | None:
    row = conn.execute(
        SUMMARY_SQL + " WHERE a.id = ? AND a.user_id = ?", (archive_id, user_id)
    ).fetchone()
    if row is None:
        return None
    recs = conn.execute(
        "SELECT turn, id FROM recordings WHERE archive_id = ? ORDER BY turn", (archive_id,)
    )
    return ArchiveRecord(
        summary=_summary(row),
        messages_json=row["messages_json"],
        report_json=row["report_json"],
        report_raw=row["report_raw"],
        recordings=[(r["turn"], r["id"]) for r in recs],
    )


def delete_archive(conn: sqlite3.Connection, *, user_id: str, archive_id: str) -> list[str] | None:
    """없거나 남의 것이면 None. 지웠으면 커밋 뒤 지울 녹음 파일 경로."""
    with transaction(conn):
        found = conn.execute(
            "SELECT 1 FROM archive WHERE id = ? AND user_id = ?", (archive_id, user_id)
        ).fetchone()
        if found is None:
            return None
        return _delete_many(conn, user_id, [archive_id])
