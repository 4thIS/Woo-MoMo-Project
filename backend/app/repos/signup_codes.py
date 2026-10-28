"""signup_codes SQL (spec 2026-10-27). 이메일당 PIN 해시 한 줄. 원문은 저장하지 않는다."""

import hashlib
import secrets
import sqlite3
from dataclasses import dataclass

CODE_TTL_SEC = 600
CODE_MAX_ATTEMPTS = 5
CODE_RESEND_SEC = 60
CODE_HOURLY_MAX = 5
CODE_WINDOW_SEC = 3600
CODE_PER_MINUTE = 5


@dataclass(frozen=True)
class CodeRow:
    email: str
    code_hash: str
    expires_at: float
    attempts: int
    last_sent_at: float
    window_start: float
    window_count: int


def new_code() -> str:
    return f"{secrets.randbelow(1_000_000):06d}"


def hash_code(email: str, code: str) -> str:
    return hashlib.sha256(f"{email}:{code}".encode()).hexdigest()


def get(conn: sqlite3.Connection, email: str) -> CodeRow | None:
    row = conn.execute("SELECT * FROM signup_codes WHERE email = ?", (email,)).fetchone()
    return None if row is None else CodeRow(**dict(row))


def save_sent(conn: sqlite3.Connection, *, email: str, code_hash: str, now: float) -> None:
    """메일이 나간 뒤에 부른다. 새 해시로 바꾸고 오답을 0으로, 1시간 창을 갱신한다."""
    old = get(conn, email)
    if old is not None and now - old.window_start < CODE_WINDOW_SEC:
        window_start, window_count = old.window_start, old.window_count + 1
    else:
        window_start, window_count = now, 1
    conn.execute(
        "INSERT INTO signup_codes (email, code_hash, expires_at, attempts, last_sent_at,"
        " window_start, window_count) VALUES (?, ?, ?, 0, ?, ?, ?)"
        " ON CONFLICT(email) DO UPDATE SET code_hash = excluded.code_hash,"
        " expires_at = excluded.expires_at, attempts = 0, last_sent_at = excluded.last_sent_at,"
        " window_start = excluded.window_start, window_count = excluded.window_count",
        (email, code_hash, now + CODE_TTL_SEC, now, window_start, window_count),
    )


def reserve_attempt(conn: sqlite3.Connection, email: str, now: float) -> CodeRow | None:
    """확인 시도 1회를 먼저 잡는다(트랜잭션 안에서 부를 것). 줄 없음·만료·폐기면 None.

    비교 전에 원자적으로 올리므로 동시에 들어온 추측도 5번을 넘기지 못한다."""
    cur = conn.execute(
        "UPDATE signup_codes SET attempts = attempts + 1"
        " WHERE email = ? AND attempts < ? AND expires_at > ?",
        (email, CODE_MAX_ATTEMPTS, now),
    )
    return get(conn, email) if cur.rowcount == 1 else None


def delete(conn: sqlite3.Connection, email: str) -> None:
    conn.execute("DELETE FROM signup_codes WHERE email = ?", (email,))


def purge_stale(conn: sqlite3.Connection, now: float) -> None:
    """만료됐고 1시간 발송 창도 지난 줄을 지운다(창이 남은 줄은 발송 상한 때문에 둔다)."""
    conn.execute(
        "DELETE FROM signup_codes WHERE expires_at < ? AND window_start < ?",
        (now, now - CODE_WINDOW_SEC),
    )
