"""claude_usage SQL (spec 2026-10-17 4절). 토큰·횟수만 기록하고 프롬프트·응답 본문은 두지 않는다."""

import sqlite3

from app.ids import new_id


def record(
    conn: sqlite3.Connection,
    *,
    at: str,
    user_id: str,
    interview_id: str | None,
    kind: str,
    model: str,
    input_tokens: int = 0,
    output_tokens: int = 0,
    cache_read_tokens: int = 0,
    cache_write_tokens: int = 0,
    web_searches: int = 0,
    outcome: str,
) -> None:
    conn.execute(
        "INSERT INTO claude_usage (id, at, user_id, interview_id, kind, model, input_tokens,"
        " output_tokens, cache_read_tokens, cache_write_tokens, web_searches, outcome)"
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            new_id("cu"),
            at,
            user_id,
            interview_id,
            kind,
            model,
            input_tokens,
            output_tokens,
            cache_read_tokens,
            cache_write_tokens,
            web_searches,
            outcome,
        ),
    )


def rows_since(conn: sqlite3.Connection, since: str) -> list[sqlite3.Row]:
    return conn.execute(
        "SELECT * FROM claude_usage WHERE at >= ? ORDER BY at ASC, id ASC", (since,)
    ).fetchall()


def first_at(conn: sqlite3.Connection) -> str | None:
    row = conn.execute("SELECT MIN(at) AS at FROM claude_usage").fetchone()
    return row["at"] if row else None
