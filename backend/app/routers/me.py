"""로그인 상태·프로필 (spec 4.1). 비로그인은 오류가 아니라 null이다."""

from fastapi import APIRouter

from app.deps import CurrentUser, Db, LoggedInUser
from app.presenters import to_session
from app.repos import users
from app.schemas import ProfileBody, Session

router = APIRouter()


@router.get("/me", response_model=Session | None)
def me(user: CurrentUser) -> Session | None:
    return to_session(user) if user is not None else None


@router.put("/profile", response_model=Session)
def put_profile(body: ProfileBody, user: LoggedInUser, conn: Db) -> Session:
    name = body.name.strip() if body.name is not None else None
    updated = users.update_profile(conn, user.id, name=name or None, age=body.age)
    return to_session(updated)
