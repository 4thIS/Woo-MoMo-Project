"""users 테이블 SQL (spec 3.1). 트랜잭션은 부르는 쪽이 정한다."""

import sqlite3
from dataclasses import dataclass

from app.ids import new_id


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
    conn: sqlite3.Connection, *, email: str, password_hash: str, name: str | None, created_at: str
) -> User:
    user_id = new_id("u")
    try:
        conn.execute(
            "INSERT INTO users (id, email, password_hash, name, created_at) VALUES (?, ?, ?, ?, ?)",
            (user_id, email, password_hash, name, created_at),
        )
    except sqlite3.IntegrityError as exc:
        raise EmailTaken(email) from exc
    return _require(get_by_id(conn, user_id))


def update_profile(
    conn: sqlite3.Connection, user_id: str, *, name: str | None, age: int | None
) -> User:
    conn.execute("UPDATE users SET name = ?, age = ? WHERE id = ?", (name, age, user_id))
    return _require(get_by_id(conn, user_id))
