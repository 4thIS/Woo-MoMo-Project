"""sessions 테이블 SQL (spec 4.1). DB에는 토큰의 SHA-256 해시만 둔다."""

import sqlite3

from app.repos import users
from app.repos.users import User

SESSION_DAYS = 30
SESSION_SECONDS = SESSION_DAYS * 24 * 60 * 60


def create_session(conn: sqlite3.Connection, *, token_hash: str, user_id: str, now: float) -> None:
    conn.execute(
        "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)",
        (token_hash, user_id, int(now) + SESSION_SECONDS),
    )


def user_for_token(conn: sqlite3.Connection, *, token_hash: str, now: float) -> User | None:
    row = conn.execute(
        "SELECT user_id, expires_at FROM sessions WHERE token_hash = ?", (token_hash,)
    ).fetchone()
    if row is None:
        return None
    if row["expires_at"] <= now:
        delete_session(conn, token_hash)
        return None
    return users.get_by_id(conn, row["user_id"])


def delete_session(conn: sqlite3.Connection, token_hash: str) -> None:
    conn.execute("DELETE FROM sessions WHERE token_hash = ?", (token_hash,))
