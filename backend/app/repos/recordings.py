"""recordings SQL (spec 4.3). 기록 하나당 합계 30MB, (archive_id, turn)마다 한 파일."""

import sqlite3
from dataclasses import dataclass

from app.db import transaction

RECORDING_LIMIT_BYTES = 30 * 1024 * 1024
MIME_EXTENSIONS = {"audio/webm": "webm", "audio/ogg": "ogg"}


@dataclass(frozen=True)
class Recording:
    id: str
    archive_id: str
    user_id: str
    turn: int
    path: str
    mime: str
    size: int
    duration_sec: float | None = None


class TooLarge(Exception):
    """기록 하나의 녹음 합계가 상한을 넘는다."""


def is_own_premium_archive(conn: sqlite3.Connection, *, user_id: str, archive_id: str) -> bool:
    row = conn.execute(
        "SELECT 1 FROM archive WHERE id = ? AND user_id = ? AND premium = 1",
        (archive_id, user_id),
    ).fetchone()
    return row is not None


def used_bytes(conn: sqlite3.Connection, *, archive_id: str, excluding_turn: int) -> int:
    return conn.execute(
        "SELECT COALESCE(SUM(bytes), 0) FROM recordings WHERE archive_id = ? AND turn != ?",
        (archive_id, excluding_turn),
    ).fetchone()[0]


def replace_recording(
    conn: sqlite3.Connection, *, recording: Recording, created_at: str, limit: int
) -> str | None:
    """같은 turn이 있으면 바꾼다. 커밋 뒤 지울 옛 파일 경로를 돌려준다."""
    r = recording
    with transaction(conn):
        if used_bytes(conn, archive_id=r.archive_id, excluding_turn=r.turn) + r.size > limit:
            raise TooLarge
        old = conn.execute(
            "SELECT path FROM recordings WHERE archive_id = ? AND turn = ?", (r.archive_id, r.turn)
        ).fetchone()
        conn.execute(
            "DELETE FROM recordings WHERE archive_id = ? AND turn = ?", (r.archive_id, r.turn)
        )
        conn.execute(
            "INSERT INTO recordings (id, archive_id, user_id, turn, path, mime, bytes, created_at,"
            " duration_sec) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                r.id,
                r.archive_id,
                r.user_id,
                r.turn,
                r.path,
                r.mime,
                r.size,
                created_at,
                r.duration_sec,
            ),
        )
    return old["path"] if old is not None else None


def get_recording(conn: sqlite3.Connection, *, user_id: str, recording_id: str) -> Recording | None:
    row = conn.execute(
        "SELECT * FROM recordings WHERE id = ? AND user_id = ?", (recording_id, user_id)
    ).fetchone()
    if row is None:
        return None
    return Recording(
        id=row["id"],
        archive_id=row["archive_id"],
        user_id=row["user_id"],
        turn=row["turn"],
        path=row["path"],
        mime=row["mime"],
        size=row["bytes"],
        duration_sec=row["duration_sec"],
    )
