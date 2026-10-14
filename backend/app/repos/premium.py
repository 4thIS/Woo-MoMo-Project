"""premium_interviews SQL (spec 4.4). 티켓 1장 = 1행. 대화 기록은 서버가 가진다."""

import json
import sqlite3
from dataclasses import dataclass
from typing import Any

from app.db import transaction
from app.ids import new_id

MAX_MODEL_TURNS = 15


@dataclass(frozen=True)
class PremiumInterview:
    id: str
    user_id: str
    track: str
    inputs: dict[str, Any]
    messages: list[dict[str, Any]]
    model_turns: int
    status: str
    created_at: str


class NoTickets(Exception):
    """남은 티켓이 없다."""


class DailyLimitReached(Exception):
    """오늘(한국 날짜) 서버 전체 벤 면접 수가 상한에 닿았다."""


class TurnConflict(Exception):
    """다른 요청이 먼저 턴을 기록했거나, 면접이 이미 끝났거나, 15번을 채웠다."""


def _interview(row: sqlite3.Row) -> PremiumInterview:
    return PremiumInterview(
        id=row["id"],
        user_id=row["user_id"],
        track=row["track"],
        inputs=json.loads(row["inputs_json"]),
        messages=json.loads(row["messages_json"]),
        model_turns=row["model_turns"],
        status=row["status"],
        created_at=row["created_at"],
    )


def start_interview(
    conn: sqlite3.Connection,
    *,
    user_id: str,
    track: str,
    inputs: dict[str, Any],
    created_at: str,
    day_start: str,
    daily_limit: int,
) -> str:
    """하루 상한 확인 → 티켓 차감 → 행 생성을 한 트랜잭션으로."""
    interview_id = new_id("pi")
    with transaction(conn):
        used = conn.execute(
            "SELECT COUNT(*) FROM premium_interviews WHERE created_at >= ?", (day_start,)
        ).fetchone()[0]
        if used >= daily_limit:
            raise DailyLimitReached
        cur = conn.execute(
            "UPDATE users SET tickets = tickets - 1 WHERE id = ? AND tickets > 0", (user_id,)
        )
        if cur.rowcount == 0:
            raise NoTickets
        conn.execute(
            "INSERT INTO premium_interviews (id, user_id, track, inputs_json, created_at)"
            " VALUES (?, ?, ?, ?, ?)",
            (interview_id, user_id, track, json.dumps(inputs, ensure_ascii=False), created_at),
        )
    return interview_id


def get_interview(
    conn: sqlite3.Connection, *, user_id: str, interview_id: str
) -> PremiumInterview | None:
    row = conn.execute(
        "SELECT * FROM premium_interviews WHERE id = ? AND user_id = ?", (interview_id, user_id)
    ).fetchone()
    return _interview(row) if row is not None else None


def append_turn(
    conn: sqlite3.Connection,
    *,
    interview_id: str,
    answer: str | None,
    model_text: str,
    expected_model_turns: int,
) -> PremiumInterview:
    """성공한 턴만 기록한다: (답변) + 면접관 응답, model_turns + 1.

    낙관적 잠금: 트랜잭션 안에서 다시 읽어 사전 검사 때 본 model_turns 그대로일 때만 쓴다.
    """
    with transaction(conn):
        row = conn.execute(
            "SELECT messages_json, model_turns, status FROM premium_interviews WHERE id = ?",
            (interview_id,),
        ).fetchone()
        if (
            row is None
            or row["status"] == "done"
            or row["model_turns"] != expected_model_turns
            or row["model_turns"] >= MAX_MODEL_TURNS
        ):
            raise TurnConflict
        messages = json.loads(row["messages_json"])
        if answer is not None:
            messages.append({"role": "user", "text": answer})
        messages.append({"role": "model", "text": model_text})
        conn.execute(
            "UPDATE premium_interviews SET messages_json = ?, model_turns = model_turns + 1"
            " WHERE id = ?",
            (json.dumps(messages, ensure_ascii=False), interview_id),
        )
        updated = conn.execute(
            "SELECT * FROM premium_interviews WHERE id = ?", (interview_id,)
        ).fetchone()
    return _interview(updated)


def mark_done(conn: sqlite3.Connection, *, interview_id: str) -> None:
    conn.execute("UPDATE premium_interviews SET status = 'done' WHERE id = ?", (interview_id,))
