"""premium_interviews SQL (spec 4.4). 티켓 1장 = 1행. 대화 기록은 서버가 가진다."""

import json
import sqlite3
from dataclasses import dataclass
from typing import Any

from app.db import transaction
from app.ids import new_id

# 본질문 5 + 면접 전체 꼬리질문 최대 3 + 끝맺음 1. 모델이 규칙을 넘겨도 서버가 여기서 끊는다
MAX_MODEL_TURNS = 9
# 면접 하나의 Claude 호출 시도(턴·리포트, 실패 포함) 상한 — 재시도 반복으로 비용이 불지 않게
MAX_ATTEMPTS = 2 * MAX_MODEL_TURNS + 3


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
    attempts: int = 0
    report_raw: str | None = None
    report_v2_json: str | None = None
    briefing: str | None = None
    briefing_status: str = "none"
    voice_consent: bool = False


class NoTickets(Exception):
    """남은 티켓이 없다."""


class DailyLimitReached(Exception):
    """오늘(한국 날짜) 서버 전체 벤 면접 수가 상한에 닿았다."""


class TurnConflict(Exception):
    """다른 요청이 먼저 턴을 기록했거나, 면접이 이미 끝났거나, 상한(MAX_MODEL_TURNS)을 채웠다."""


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
        attempts=row["attempts"],
        report_raw=row["report_raw"],
        report_v2_json=row["report_v2_json"],
        briefing=row["briefing"],
        briefing_status=row["briefing_status"],
        voice_consent=bool(row["voice_consent"]),
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
    briefing_status: str = "none",
    voice_consent: bool = False,
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
            "INSERT INTO premium_interviews"
            " (id, user_id, track, inputs_json, created_at, briefing_status, voice_consent)"
            " VALUES (?, ?, ?, ?, ?, ?, ?)",
            (
                interview_id,
                user_id,
                track,
                json.dumps(inputs, ensure_ascii=False),
                created_at,
                briefing_status,
                1 if voice_consent else 0,
            ),
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


class TooManyAttempts(Exception):
    """이 면접의 Claude 호출 시도가 MAX_ATTEMPTS를 넘었다."""


def count_attempt(conn: sqlite3.Connection, *, interview_id: str) -> int:
    """Claude를 부르기 직전에 원자적으로 +1. 상한을 넘으면 TooManyAttempts."""
    row = conn.execute(
        "UPDATE premium_interviews SET attempts = attempts + 1 WHERE id = ? RETURNING attempts",
        (interview_id,),
    ).fetchone()
    attempts = row[0] if row is not None else MAX_ATTEMPTS + 1
    if attempts > MAX_ATTEMPTS:
        raise TooManyAttempts
    return attempts


def mark_done(
    conn: sqlite3.Connection,
    *,
    interview_id: str,
    report_raw: str,
    report_v2_json: str | None = None,
) -> None:
    """리포트 성공: done으로 바꾸고 원문(+버전 2 구조)을 보관한다(재요청 때 그대로 다시 보낸다)."""
    conn.execute(
        "UPDATE premium_interviews SET status = 'done', report_raw = ?, report_v2_json = ?"
        " WHERE id = ?",
        (report_raw, report_v2_json, interview_id),
    )


def set_briefing(conn: sqlite3.Connection, *, interview_id: str, briefing: str | None) -> None:
    """첫 턴 조사 결과를 기록한다. pending일 때만 바꾼다 — 겹친 요청이 덮어쓰지 않게."""
    conn.execute(
        "UPDATE premium_interviews SET briefing = ?, briefing_status = ?"
        " WHERE id = ? AND briefing_status = 'pending'",
        (briefing, "ok" if briefing is not None else "failed", interview_id),
    )
