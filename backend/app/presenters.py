"""저장소 객체 → 응답 스키마."""

from app.repos.users import User
from app.schemas import Profile, Session


def to_session(user: User) -> Session:
    return Session(
        userId=user.id,
        email=user.email,
        tier=user.tier,
        tickets=user.tickets,
        isAdmin=user.is_admin,
        profile=Profile(name=user.name, age=user.age),
        createdAt=user.created_at,
    )
