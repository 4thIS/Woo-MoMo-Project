"""가입·로그인·로그아웃 (spec 4.1, docs/API.md 인증)."""

import hmac
import logging
import math
import re
import secrets
import sqlite3

from fastapi import APIRouter, Request, Response

from app.db import transaction
from app.deps import COOKIE_NAME, Db
from app.errors import ApiError
from app.mail import MailError
from app.presenters import to_session
from app.repos import sessions, signup_codes, users
from app.repos.users import User, normalize_login
from app.schemas import (
    EmailTakenResponse,
    LoginBody,
    Session,
    SignupBody,
    SignupCodeBody,
    SignupCodeSent,
    SignupConfig,
)
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
log = logging.getLogger(__name__)

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
EMAIL_MAX = 254
PASSWORD_MIN = 8
NAME_MAX = 100
SIGNUP_PER_MINUTE = 10
LOGIN_PER_MINUTE = 10
EMAIL_TAKEN_PER_MINUTE = 20


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


def _check_code(request: Request, conn: sqlite3.Connection, email: str, code: str) -> None:
    """가입 PIN 확인(spec 4절 2). 시도는 비교 전에 예약·커밋해 요청이 실패해도 남는다."""
    code = code.strip()
    if not code:
        raise ApiError(422, "code_required", field="code")
    with transaction(conn):  # 시도 예약과 읽기를 한 번에 — 동시 추측은 줄을 선다
        row = signup_codes.reserve_attempt(conn, email, request.app.state.clock())
    if row is None:
        raise ApiError(422, "code_expired", field="code")
    if hmac.compare_digest(row.code_hash, signup_codes.hash_code(email, code)):
        return
    if row.attempts >= signup_codes.CODE_MAX_ATTEMPTS:
        raise ApiError(422, "code_expired", field="code")
    raise ApiError(
        422,
        "code_invalid",
        field="code",
        attemptsLeft=signup_codes.CODE_MAX_ATTEMPTS - row.attempts,
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
    verify = request.app.state.settings.signup_email_verify
    if verify:
        _check_code(request, conn, email, body.code)
    password_hash = hash_password(body.password)
    created_at = iso(request.app.state.clock())
    try:
        with transaction(conn):
            user = users.create_user(
                conn, email=email, password_hash=password_hash, name=name, created_at=created_at
            )
            if verify:
                signup_codes.delete(conn, email)
            _start_session(request, response, conn, user)
    except users.EmailTaken:
        raise ApiError(409, "email_taken") from None
    return to_session(user)


def _login_allowed(request: Request, login_id: str) -> bool:
    """일반 계정은 이메일만. 이메일이 아닌 아이디는 관리자 아이디일 때만(spec 4.4)."""
    if is_email(login_id):
        return True
    cfg = request.app.state.settings
    if not (cfg.admin_login and cfg.admin_password):
        return False
    return login_id == normalize_login(cfg.admin_login)


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


@router.get("/auth/email-taken", response_model=EmailTakenResponse)
def email_taken(request: Request, conn: Db, email: str = "") -> EmailTakenResponse:
    # 열거 공격에 열려 있다(데모 범위). 요청 수 제한으로만 막는다.
    rate_limit(request, "email-taken", EMAIL_TAKEN_PER_MINUTE)
    return EmailTakenResponse(taken=users.email_exists(conn, normalize_login(email)))


@router.get("/auth/signup/config", response_model=SignupConfig)
def signup_config(request: Request) -> SignupConfig:
    return SignupConfig(emailVerify=request.app.state.settings.signup_email_verify)


def _mail_text(code: str) -> str:
    return (
        f"인증번호: {code}\n\n10분 안에 입력해 주세요.\n"
        "가입을 요청하지 않았다면 이 메일은 무시하셔도 됩니다."
    )


@router.post("/auth/signup/code", status_code=202, response_model=SignupCodeSent)
def signup_code(body: SignupCodeBody, request: Request, conn: Db) -> SignupCodeSent:
    state = request.app.state
    if not state.settings.signup_email_verify:
        raise ApiError(404, "verify_disabled")
    rate_limit(request, "signup-code", signup_codes.CODE_PER_MINUTE)
    email = normalize_login(body.email)
    if not is_email(email):
        raise ApiError(422, "invalid_email", field="email")
    mailer = state.mailer
    if mailer is None:
        raise ApiError(503, "mail_unavailable")
    if users.email_exists(conn, email):
        raise ApiError(409, "email_taken")
    now = state.clock()
    row = signup_codes.get(conn, email)
    if row is not None:
        elapsed = now - row.last_sent_at
        if elapsed < signup_codes.CODE_RESEND_SEC:
            retry = max(1, math.ceil(signup_codes.CODE_RESEND_SEC - elapsed))
            raise ApiError(429, "code_cooldown", retryAfterSec=retry)
        if (
            now - row.window_start < signup_codes.CODE_WINDOW_SEC
            and row.window_count >= signup_codes.CODE_HOURLY_MAX
        ):
            raise ApiError(429, "code_limit")
    code = signup_codes.new_code()
    try:  # 발송은 열린 트랜잭션 밖에서. 로그엔 예외 이름만(PIN·이메일·키 금지)
        mailer.send(
            to=email,
            subject="[모두의 모의면접] 가입 인증번호",
            text=_mail_text(code),
            idempotency_key=f"signup-{secrets.token_hex(8)}",
        )
    except MailError as e:
        log.warning("signup code mail failed: %s", type(e).__name__)
        raise ApiError(502, "mail_failed") from None
    with transaction(conn):
        signup_codes.save_sent(
            conn, email=email, code_hash=signup_codes.hash_code(email, code), now=now
        )
    return SignupCodeSent(
        expiresInSec=signup_codes.CODE_TTL_SEC, resendInSec=signup_codes.CODE_RESEND_SEC
    )
