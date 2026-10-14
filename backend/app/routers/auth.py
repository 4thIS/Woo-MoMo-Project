"""가입·로그인·로그아웃 (spec 4.1, docs/API.md 인증)."""

import re
import sqlite3

from fastapi import APIRouter, Request, Response

from app.db import transaction
from app.deps import COOKIE_NAME, Db
from app.errors import ApiError
from app.presenters import to_session
from app.repos import sessions, users
from app.repos.users import User, normalize_login
from app.schemas import LoginBody, Session, SignupBody
from app.security import (
    burn_password_check,
    client_ip,
    hash_password,
    hash_token,
    new_session_token,
    verify_password,
)
from app.timefmt import iso

router = APIRouter()

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
EMAIL_MAX = 254
PASSWORD_MIN = 8
NAME_MAX = 100
SIGNUP_PER_MINUTE = 10
LOGIN_PER_MINUTE = 10


def rate_limit(request: Request, bucket: str, per_minute: int) -> None:
    key = f"{bucket}:{client_ip(request)}"
    if not request.app.state.limiter.allow(key, per_minute):
        raise ApiError(429, "rate_limited")


def is_email(value: str) -> bool:
    return len(value) <= EMAIL_MAX and EMAIL_RE.match(value) is not None


def _cookie_args(request: Request) -> dict[str, object]:
    secure = request.app.state.settings.cookie_secure
    return {"path": "/api", "httponly": True, "samesite": "lax", "secure": secure}


def _start_session(
    request: Request, response: Response, conn: sqlite3.Connection, user: User
) -> None:
    token = new_session_token()
    now = request.app.state.clock()
    sessions.create_session(conn, token_hash=hash_token(token), user_id=user.id, now=now)
    response.set_cookie(
        COOKIE_NAME, token, max_age=sessions.SESSION_SECONDS, **_cookie_args(request)
    )


@router.post("/auth/signup", status_code=201, response_model=Session)
def signup(body: SignupBody, request: Request, response: Response, conn: Db) -> Session:
    rate_limit(request, "signup", SIGNUP_PER_MINUTE)
    email = normalize_login(body.email)
    if not is_email(email):
        raise ApiError(422, "invalid_email", field="email")
    if len(body.password) < PASSWORD_MIN:
        raise ApiError(422, "weak_password", field="password")
    name = body.name.strip()
    if not name:
        raise ApiError(422, "missing_name", field="name")
    if len(name) > NAME_MAX:
        raise ApiError(422, "invalid", field="name")
    if body.consent is not True:
        raise ApiError(422, "consent_required", field="consent")
    password_hash = hash_password(body.password)
    created_at = iso(request.app.state.clock())
    try:
        with transaction(conn):
            user = users.create_user(
                conn, email=email, password_hash=password_hash, name=name, created_at=created_at
            )
            _start_session(request, response, conn, user)
    except users.EmailTaken:
        raise ApiError(409, "email_taken") from None
    return to_session(user)


def _login_allowed(request: Request, login_id: str) -> bool:
    return is_email(login_id)


@router.post("/auth/login", response_model=Session)
def login(body: LoginBody, request: Request, response: Response, conn: Db) -> Session:
    rate_limit(request, "login", LOGIN_PER_MINUTE)
    login_id = normalize_login(body.email)
    user = users.get_by_email(conn, login_id) if _login_allowed(request, login_id) else None
    if user is None:
        burn_password_check(body.password)
        raise ApiError(401, "bad_credentials")
    if not verify_password(user.password_hash, body.password):
        raise ApiError(401, "bad_credentials")
    _start_session(request, response, conn, user)
    return to_session(user)


@router.post("/auth/logout", status_code=204)
def logout(request: Request, conn: Db) -> Response:
    token = request.cookies.get(COOKIE_NAME)
    if token:
        sessions.delete_session(conn, hash_token(token))
    response = Response(status_code=204)
    response.delete_cookie(COOKIE_NAME, **_cookie_args(request))
    return response
