"""프리미엄: 목업 결제(관리자 전용)와 벤 면접 (spec 4.4)."""

from fastapi import APIRouter, Request

from app import db
from app.deps import Db, LoggedInUser, PremiumUser
from app.errors import ApiError
from app.presenters import to_session
from app.repos import premium, users
from app.schemas import InterviewStart, InterviewStarted, Session
from app.timefmt import iso, kst_day_start

router = APIRouter()


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
