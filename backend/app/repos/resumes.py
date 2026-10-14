"""resumes 테이블 SQL (spec 4.2). 종류(kind)마다 3개까지."""

import sqlite3
from dataclasses import dataclass

from app.db import transaction
from app.ids import new_id

RESUME_SLOTS = 3


@dataclass(frozen=True)
class Resume:
    id: str
    kind: str
    title: str
    text: str
    updated_at: str


class SlotFull(Exception):
    def __init__(self, kind: str) -> None:
        super().__init__(kind)
        self.kind = kind


def _resume(row: sqlite3.Row) -> Resume:
    return Resume(
        id=row["id"],
        kind=row["kind"],
        title=row["title"],
        text=row["text"],
        updated_at=row["updated_at"],
    )


def list_resumes(conn: sqlite3.Connection, user_id: str) -> list[Resume]:
    rows = conn.execute(
        "SELECT * FROM resumes WHERE user_id = ? ORDER BY updated_at DESC, id DESC", (user_id,)
    )
    return [_resume(r) for r in rows]


def create_resume(
    conn: sqlite3.Connection, *, user_id: str, kind: str, title: str, text: str, now: str
) -> Resume:
    resume_id = new_id("r")
    with transaction(conn):
        count = conn.execute(
            "SELECT COUNT(*) FROM resumes WHERE user_id = ? AND kind = ?", (user_id, kind)
        ).fetchone()[0]
        if count >= RESUME_SLOTS:
            raise SlotFull(kind)
        conn.execute(
            "INSERT INTO resumes (id, user_id, kind, title, text, updated_at)"
            " VALUES (?, ?, ?, ?, ?, ?)",
            (resume_id, user_id, kind, title, text, now),
        )
    return Resume(id=resume_id, kind=kind, title=title, text=text, updated_at=now)


def update_resume(
    conn: sqlite3.Connection, *, user_id: str, resume_id: str, title: str, text: str, now: str
) -> Resume | None:
    cur = conn.execute(
        "UPDATE resumes SET title = ?, text = ?, updated_at = ? WHERE id = ? AND user_id = ?",
        (title, text, now, resume_id, user_id),
    )
    if cur.rowcount == 0:
        return None
    return _resume(conn.execute("SELECT * FROM resumes WHERE id = ?", (resume_id,)).fetchone())


def delete_resume(conn: sqlite3.Connection, *, user_id: str, resume_id: str) -> bool:
    cur = conn.execute("DELETE FROM resumes WHERE id = ? AND user_id = ?", (resume_id, user_id))
    return cur.rowcount > 0
