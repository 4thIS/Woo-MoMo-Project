"""sqlite3 연결·트랜잭션·마이그레이션 (spec 3절). ORM 없음."""

import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

MIGRATIONS_DIR = Path(__file__).resolve().parent / "migrations"


def connect(path: Path) -> sqlite3.Connection:
    # isolation_level=None: 자동 커밋. 여러 문장은 transaction()으로 묶는다.
    # check_same_thread=False: 스트리밍 응답이 스레드풀에서 돈다.
    conn = sqlite3.connect(path, timeout=10, isolation_level=None, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


@contextmanager
def connection(path: Path) -> Iterator[sqlite3.Connection]:
    conn = connect(path)
    try:
        yield conn
    finally:
        conn.close()


@contextmanager
def transaction(conn: sqlite3.Connection) -> Iterator[sqlite3.Connection]:
    # IMMEDIATE: 시작하자마자 쓰기 잠금 — "세고 넣기"가 섞이지 않는다
    conn.execute("BEGIN IMMEDIATE")
    try:
        yield conn
    except BaseException:
        if conn.in_transaction:  # sqlite가 이미 롤백했으면 ROLLBACK이 원래 예외를 가린다
            conn.execute("ROLLBACK")
        raise
    conn.execute("COMMIT")


def migrate(conn: sqlite3.Connection, directory: Path = MIGRATIONS_DIR) -> int:
    conn.execute("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)")
    current = conn.execute("SELECT COALESCE(MAX(version), 0) FROM schema_version").fetchone()[0]
    for file in sorted(directory.glob("*.sql")):
        version = int(file.name.split("_", 1)[0])
        if version <= current:
            continue
        sql = file.read_text(encoding="utf-8")
        conn.executescript(
            f"BEGIN;\n{sql}\nINSERT INTO schema_version (version) VALUES ({version});\nCOMMIT;"
        )
        current = version
    return current


def init_db(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with connection(path) as conn:
        conn.execute("PRAGMA journal_mode = WAL")
        migrate(conn)
