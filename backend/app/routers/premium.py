"""프리미엄: 목업 결제(관리자 전용)와 벤 면접 (spec 4.4)."""

from fastapi import APIRouter

from app import db
from app.deps import Db, LoggedInUser
from app.errors import ApiError
from app.presenters import to_session
from app.repos import users
from app.schemas import Session

router = APIRouter()


@router.post("/premium/purchase", response_model=Session)
def purchase(user: LoggedInUser, conn: Db) -> Session:
    # 공개 사이트라 일반 계정은 막는다. 마지막 방어선은 BEN_DAILY_LIMIT.
    if not user.is_admin:
        raise ApiError(403, "purchase_disabled")
    with db.transaction(conn):
        updated = users.grant_tickets(conn, user.id)
    return to_session(updated)
