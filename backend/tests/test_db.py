import sqlite3
from pathlib import Path

import pytest

from app import db


def _write(directory: Path, name: str, sql: str) -> None:
    (directory / name).write_text(sql, encoding="utf-8")


def test_migrate_applies_new_files_once_in_order(tmp_path):
    mdir = tmp_path / "m"
    mdir.mkdir()
    _write(mdir, "001_a.sql", "CREATE TABLE a (x INTEGER);")
    _write(mdir, "002_b.sql", "CREATE TABLE b (x INTEGER);")
    with db.connection(tmp_path / "t.sqlite3") as conn:
        assert db.migrate(conn, mdir) == 2
        # 다시 돌려도 CREATE를 되풀이하지 않는다
        assert db.migrate(conn, mdir) == 2
        _write(mdir, "003_c.sql", "CREATE TABLE c (x INTEGER);")
        assert db.migrate(conn, mdir) == 3
        rows = conn.execute("SELECT version FROM schema_version ORDER BY version")
        assert [r[0] for r in rows] == [1, 2, 3]


def test_broken_migration_is_not_recorded(tmp_path):
    mdir = tmp_path / "m"
    mdir.mkdir()
    _write(mdir, "001_a.sql", "CREATE TABLE a (x INTEGER);")
    _write(mdir, "002_b.sql", "CREATE TABLE b (x INTEGER);\nCREATE TABLE broken (;")
    path = tmp_path / "t.sqlite3"
    conn = db.connect(path)
    with pytest.raises(sqlite3.Error):
        db.migrate(conn, mdir)
    conn.close()  # 열린 트랜잭션은 닫을 때 버려진다
    with db.connection(path) as conn:
        assert conn.execute("SELECT MAX(version) FROM schema_version").fetchone()[0] == 1
        assert conn.execute("SELECT name FROM sqlite_master WHERE name = 'b'").fetchone() is None


def test_init_db_creates_account_tables(tmp_path):
    path = tmp_path / "nested" / "momo.sqlite3"
    db.init_db(path)
    with db.connection(path) as conn:
        rows = conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")
        names = {r["name"] for r in rows}
        assert {"schema_version", "users", "sessions"} <= names
        assert conn.execute("PRAGMA journal_mode").fetchone()[0] == "wal"


def test_transaction_rolls_back_on_error(tmp_path):
    with db.connection(tmp_path / "t.sqlite3") as conn:
        conn.execute("CREATE TABLE t (x INTEGER)")
        with pytest.raises(RuntimeError):
            with db.transaction(conn):
                conn.execute("INSERT INTO t VALUES (1)")
                raise RuntimeError("boom")
        assert conn.execute("SELECT COUNT(*) FROM t").fetchone()[0] == 0
        with db.transaction(conn):
            conn.execute("INSERT INTO t VALUES (2)")
        assert conn.execute("SELECT COUNT(*) FROM t").fetchone()[0] == 1


def test_foreign_keys_are_enforced(tmp_path):
    path = tmp_path / "momo.sqlite3"
    db.init_db(path)
    with db.connection(path) as conn, pytest.raises(sqlite3.IntegrityError):
        conn.execute(
            "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ('h', 'u_none', 0)"
        )
