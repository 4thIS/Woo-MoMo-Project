"""voice_analysis·baze_usage SQL (spec 2026-10-23 ②). 녹음·키 값은 두지 않는다."""

import sqlite3

from pydantic import ValidationError

from app.ids import new_id
from app.llm.baze import VoiceResult


def queue(conn: sqlite3.Connection, *, interview_id: str, answer: int, now: str) -> None:
    """답변 하나를 분석 대기로 둔다. 같은 답변이면 덮어쓴다(결과·오류 비움)."""
    conn.execute(
        "INSERT INTO voice_analysis (interview_id, answer, status, created_at, updated_at)"
        " VALUES (?, ?, 'queued', ?, ?)"
        " ON CONFLICT (interview_id, answer) DO UPDATE SET status = 'queued',"
        " result_json = NULL, error_code = NULL, updated_at = excluded.updated_at",
        (interview_id, answer, now, now),
    )


def finish(
    conn: sqlite3.Connection,
    *,
    interview_id: str,
    answer: int,
    status: str,
    result_json: str | None,
    error_code: str | None,
    now: str,
) -> None:
    conn.execute(
        "UPDATE voice_analysis SET status = ?, result_json = ?, error_code = ?, updated_at = ?"
        " WHERE interview_id = ? AND answer = ?",
        (status, result_json, error_code, now, interview_id, answer),
    )


def results(
    conn: sqlite3.Connection, *, interview_id: str
) -> dict[int, tuple[str, VoiceResult | None]]:
    out: dict[int, tuple[str, VoiceResult | None]] = {}
    rows = conn.execute(
        "SELECT answer, status, result_json FROM voice_analysis WHERE interview_id = ?"
        " ORDER BY answer",
        (interview_id,),
    ).fetchall()
    for row in rows:
        status, parsed = row["status"], None
        if status == "done":
            try:
                parsed = VoiceResult.model_validate_json(row["result_json"] or "")
            except ValidationError:
                status = "failed"  # 저장된 결과가 깨졌으면 쓰지 않는다
        out[row["answer"]] = (status, parsed)
    return out


def record_usage(
    conn: sqlite3.Connection,
    *,
    at: str,
    user_id: str,
    interview_id: str | None,
    key_index: int | None,
    model: str,
    input_tokens: int,
    output_tokens: int,
    outcome: str,
) -> None:
    conn.execute(
        "INSERT INTO baze_usage (id, at, user_id, interview_id, key_index, model, input_tokens,"
        " output_tokens, outcome) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            new_id("bu"),
            at,
            user_id,
            interview_id,
            key_index,
            model,
            input_tokens,
            output_tokens,
            outcome,
        ),
    )
