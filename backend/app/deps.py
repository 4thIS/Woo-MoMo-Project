"""요청마다 DB 연결과 로그인 사용자를 꺼낸다 (spec 3절 deps)."""

import sqlite3
from collections.abc import Iterator
from typing import Annotated

from fastapi import Depends, Request

from app import db
from app.errors import ApiError
from app.repos import sessions
from app.repos.users import User
from app.security import hash_token

COOKIE_NAME = "momo_session"


def get_db(request: Request) -> Iterator[sqlite3.Connection]:
    with db.connection(request.app.state.settings.db_path) as conn:
        yield conn


Db = Annotated[sqlite3.Connection, Depends(get_db)]


def current_user(request: Request, conn: Db) -> User | None:
    token = request.cookies.get(COOKIE_NAME)
    if not token:
        return None
    now = request.app.state.clock()
    return sessions.user_for_token(conn, token_hash=hash_token(token), now=now)


CurrentUser = Annotated[User | None, Depends(current_user)]


def require_user(user: CurrentUser) -> User:
    if user is None:
        raise ApiError(401, "unauthorized")
    return user


LoggedInUser = Annotated[User, Depends(require_user)]


def require_premium(user: LoggedInUser) -> User:
    if user.tier != "premium":
        raise ApiError(403, "premium_required")
    return user


PremiumUser = Annotated[User, Depends(require_premium)]
