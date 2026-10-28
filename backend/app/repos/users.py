"""users 테이블 SQL (spec 3.1). 트랜잭션은 부르는 쪽이 정한다."""

import sqlite3
from dataclasses import dataclass

from app.ids import new_id

TICKETS_PER_PURCHASE = 10


@dataclass(frozen=True)
class User:
    id: str
    email: str
    password_hash: str
    tier: str
    tickets: int
    is_admin: bool
    name: str | None
    age: int | None
    created_at: str


class EmailTaken(Exception):
    """같은 이메일(로그인 아이디)이 이미 있다."""


def normalize_login(raw: str) -> str:
    """이메일·관리자 아이디 공통: 앞뒤 공백 제거 + 소문자."""
    return raw.strip().lower()


def _user(row: sqlite3.Row | None) -> User | None:
    if row is None:
        return None
    return User(
        id=row["id"],
        email=row["email"],
        password_hash=row["password_hash"],
        tier=row["tier"],
        tickets=row["tickets"],
        is_admin=bool(row["is_admin"]),
        name=row["name"],
        age=row["age"],
        created_at=row["created_at"],
    )


def _require(user: User | None) -> User:
    if user is None:
        raise LookupError("user row disappeared")
    return user


def get_by_id(conn: sqlite3.Connection, user_id: str) -> User | None:
    return _user(conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone())


def get_by_email(conn: sqlite3.Connection, email: str) -> User | None:
    return _user(conn.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone())


def email_exists(conn: sqlite3.Connection, email: str) -> bool:
    return conn.execute("SELECT 1 FROM users WHERE email = ?", (email,)).fetchone() is not None


def create_user(
    conn: sqlite3.Connection,
    *,
    email: str,
    password_hash: str,
    name: str | None,
    created_at: str,
    terms_version: str | None = None,
    terms_agreed_at: str | None = None,
) -> User:
    user_id = new_id("u")
    try:
        conn.execute(
            "INSERT INTO users (id, email, password_hash, name, created_at,"
            " terms_version, terms_agreed_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (user_id, email, password_hash, name, created_at, terms_version, terms_agreed_at),
        )
    except sqlite3.IntegrityError as exc:
        raise EmailTaken(email) from exc
    return _require(get_by_id(conn, user_id))


def update_profile(
    conn: sqlite3.Connection, user_id: str, *, name: str | None, age: int | None
) -> User:
    conn.execute("UPDATE users SET name = ?, age = ? WHERE id = ?", (name, age, user_id))
    return _require(get_by_id(conn, user_id))


def sync_admin(
    conn: sqlite3.Connection,
    *,
    login: str | None,
    password_hash: str | None,
    created_at: str,
    emails: tuple[str, ...] = (),
) -> None:
    """관리자 집합 = 비상용 ADMIN_LOGIN 계정 ∪ ADMIN_EMAILS 계정을 맞춘다(spec 4.4).

    비상용 계정은 없으면 만들고 비밀번호를 동기화한다. emails 계정은 이미 있을 때만 관리자로 올린다
    (비밀번호는 건드리지 않음). 집합 밖의 관리자와 비밀번호 해시가 바뀐 비상용 계정은 세션을 지운다.
    """
    keep: set[str] = set(emails)
    if login is not None and password_hash is not None:
        keep.add(login)
        existing = get_by_email(conn, login)
        if existing is None:
            conn.execute(
                "INSERT INTO users (id, email, password_hash, is_admin, created_at)"
                " VALUES (?, ?, ?, 1, ?)",
                (new_id("u"), login, password_hash, created_at),
            )
        else:
            if existing.password_hash != password_hash:
                conn.execute("DELETE FROM sessions WHERE user_id = ?", (existing.id,))
            conn.execute(
                "UPDATE users SET password_hash = ?, is_admin = 1 WHERE id = ?",
                (password_hash, existing.id),
            )
    if emails:
        marks = ",".join("?" * len(emails))
        conn.execute(f"UPDATE users SET is_admin = 1 WHERE email IN ({marks})", emails)
    ordered = tuple(keep)
    if ordered:
        outside = f"is_admin = 1 AND email NOT IN ({','.join('?' * len(ordered))})"
    else:
        outside = "is_admin = 1"
    conn.execute(
        f"DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE {outside})", ordered
    )
    conn.execute(f"UPDATE users SET is_admin = 0 WHERE {outside}", ordered)


def grant_tickets(
    conn: sqlite3.Connection, user_id: str, count: int = TICKETS_PER_PURCHASE
) -> User:
    conn.execute(
        "UPDATE users SET tier = 'premium', tickets = tickets + ? WHERE id = ?", (count, user_id)
    )
    return _require(get_by_id(conn, user_id))
