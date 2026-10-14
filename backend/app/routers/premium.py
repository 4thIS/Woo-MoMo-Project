"""프리미엄: 목업 결제(관리자 전용)와 벤 면접 (spec 4.4)."""

import sqlite3
from collections.abc import Iterator

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse

from app import db
from app.deps import Db, LoggedInUser, PremiumUser
from app.errors import ApiError
from app.llm import prompts
from app.llm.claude import REPORT_MAX_TOKENS, TURN_MAX_TOKENS, ClaudeClient, ClaudeError
from app.presenters import to_session
from app.repos import premium, users
from app.repos.premium import MAX_MODEL_TURNS, PremiumInterview
from app.repos.users import User
from app.schemas import InterviewStart, InterviewStarted, Session, TurnBody
from app.sse import SSE_HEADERS, sse
from app.timefmt import iso, kst_day_start

router = APIRouter()

ANSWER_MAX = 2000


@router.post("/premium/purchase", response_model=Session)
def purchase(user: LoggedInUser, conn: Db) -> Session:
    # 공개 사이트라 일반 계정은 막는다. 마지막 방어선은 BEN_DAILY_LIMIT.
    if not user.is_admin:
        raise ApiError(403, "purchase_disabled")
    with db.transaction(conn):
        updated = users.grant_tickets(conn, user.id)
    return to_session(updated)


@router.post("/premium/interviews", status_code=201, response_model=InterviewStarted)
def start_interview(
    body: InterviewStart, user: PremiumUser, conn: Db, request: Request
) -> InterviewStarted:
    if request.app.state.claude is None:
        raise ApiError(503, "ben_unavailable")
    group = body.company if body.track == "company" else body.admission
    if group is None:
        raise ApiError(422, "missing_field", field=body.track)
    inputs = {"resumeText": body.resumeText, body.track: group.model_dump()}
    now = request.app.state.clock()
    try:
        interview_id = premium.start_interview(
            conn,
            user_id=user.id,
            track=body.track,
            inputs=inputs,
            created_at=iso(now),
            day_start=kst_day_start(now),
            daily_limit=request.app.state.settings.ben_daily_limit,
        )
    except premium.DailyLimitReached:
        raise ApiError(503, "daily_limit") from None
    except premium.NoTickets:
        raise ApiError(409, "no_tickets") from None
    fresh = users.get_by_id(conn, user.id)
    if fresh is None:
        raise ApiError(401, "unauthorized")
    return InterviewStarted(interviewId=interview_id, session=to_session(fresh))


def _owned(conn: sqlite3.Connection, user: User, interview_id: str) -> PremiumInterview:
    interview = premium.get_interview(conn, user_id=user.id, interview_id=interview_id)
    if interview is None:
        raise ApiError(404, "not_found")
    return interview


def _claude(request: Request) -> ClaudeClient:
    claude = request.app.state.claude
    if claude is None:
        raise ApiError(503, "ben_unavailable")
    return claude


def is_over(interview: PremiumInterview) -> bool:
    """리포트까지 받았거나, 면접관 응답 15번이거나, 마지막 응답이 종료 문장이면 끝."""
    if interview.status == "done" or interview.model_turns >= MAX_MODEL_TURNS:
        return True
    last = interview.messages[-1] if interview.messages else None
    return last is not None and last["role"] == "model" and prompts.has_end_phrase(last["text"])


@router.post("/premium/interviews/{interview_id}/turns")
def take_turn(
    interview_id: str, body: TurnBody, user: PremiumUser, conn: Db, request: Request
) -> StreamingResponse:
    interview = _owned(conn, user, interview_id)
    if is_over(interview):
        raise ApiError(409, "interview_over")
    answer: str | None = None
    if interview.messages:  # 첫 턴은 첫 질문만 받는다(answer 무시)
        answer = (body.answer or "").strip()
        if not answer:
            raise ApiError(422, "missing_answer", field="answer")
        if len(answer) > ANSWER_MAX:
            raise ApiError(422, "answer_too_long", field="answer")
    claude = _claude(request)
    system = prompts.build_system(interview.track, interview.inputs)
    messages = prompts.turn_messages(interview.messages, answer)
    db_path = request.app.state.settings.db_path

    def events() -> Iterator[str]:
        chunks: list[str] = []
        try:
            for text in claude.stream_text(
                system=system, messages=messages, effort="low", max_tokens=TURN_MAX_TOKENS
            ):
                chunks.append(text)
                yield sse("delta", {"text": text})
        except ClaudeError as exc:
            # 실패한 턴은 기록하지 않는다 — 같은 요청으로 다시 시도한다
            yield sse("error", {"code": exc.code})
            return
        reply = "".join(chunks)
        if not reply.strip():
            yield sse("error", {"code": "claude_error"})
            return
        try:
            with db.connection(db_path) as c:
                saved = premium.append_turn(
                    c,
                    interview_id=interview.id,
                    answer=answer,
                    model_text=reply,
                    expected_model_turns=interview.model_turns,
                )
        except premium.TurnConflict:
            yield sse("error", {"code": "turn_conflict"})
            return
        yield sse("done", {"ended": is_over(saved)})

    return StreamingResponse(events(), media_type="text/event-stream", headers=SSE_HEADERS)


@router.post("/premium/interviews/{interview_id}/report")
def make_report(
    interview_id: str, user: PremiumUser, conn: Db, request: Request
) -> StreamingResponse:
    interview = _owned(conn, user, interview_id)
    if interview.status == "done":
        raise ApiError(409, "interview_over")
    if interview.model_turns == 0:
        raise ApiError(409, "interview_not_started")
    claude = _claude(request)
    system = prompts.build_system(interview.track, interview.inputs)
    messages = prompts.report_messages(interview.messages)
    db_path = request.app.state.settings.db_path

    def events() -> Iterator[str]:
        chunks: list[str] = []
        try:
            for text in claude.stream_text(
                system=system, messages=messages, effort="medium", max_tokens=REPORT_MAX_TOKENS
            ):
                chunks.append(text)
                yield sse("delta", {"text": text})
        except ClaudeError as exc:
            # 실패하면 done으로 바꾸지 않는다 — 같은 요청으로 다시 만들 수 있다
            yield sse("error", {"code": exc.code})
            return
        if not "".join(chunks).strip():
            yield sse("error", {"code": "claude_error"})
            return
        with db.connection(db_path) as c:
            premium.mark_done(c, interview_id=interview.id)
        yield sse("done", {})

    return StreamingResponse(events(), media_type="text/event-stream", headers=SSE_HEADERS)
