"""기동 시 저장소 준비 (spec 3절 db, 4.2 남은 파일 정리, 4.4 관리자 계정)."""

import sqlite3

from app import db
from app.config import Settings
from app.files import cleanup_orphan_recordings
from app.repos import users
from app.security import hash_password
from app.timefmt import iso


def prepare_storage(settings: Settings, now: float) -> None:
    db.init_db(settings.db_path)
    settings.recordings_dir.mkdir(parents=True, exist_ok=True)
    with db.connection(settings.db_path) as conn:
        cleanup_orphan_recordings(conn, settings.storage_dir)
        sync_admin(conn, settings, now)


def sync_admin(conn: sqlite3.Connection, settings: Settings, now: float) -> None:
    """ADMIN_LOGIN·ADMIN_PASSWORD가 둘 다 있을 때만 관리자 계정이 있다."""
    login: str | None = None
    password_hash: str | None = None
    if settings.admin_login and settings.admin_password:
        login = users.normalize_login(settings.admin_login)
        password_hash = hash_password(settings.admin_password)
    with db.transaction(conn):
        users.sync_admin(conn, login=login, password_hash=password_hash, created_at=iso(now))
