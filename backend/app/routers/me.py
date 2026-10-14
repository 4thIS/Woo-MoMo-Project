"""로그인 상태 (spec 4.1). 비로그인은 오류가 아니라 null이다."""

from fastapi import APIRouter

from app.deps import CurrentUser
from app.presenters import to_session
from app.schemas import Session

router = APIRouter()


@router.get("/me", response_model=Session | None)
def me(user: CurrentUser) -> Session | None:
    return to_session(user) if user is not None else None
