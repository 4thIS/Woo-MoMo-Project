"""녹음 파일 정리 (spec 4.2). 파일은 커밋 뒤에 지우고, 남은 것은 기동 때 정리한다."""

import contextlib
import sqlite3
from collections.abc import Iterable
from pathlib import Path


def remove_files(storage_dir: Path, relative_paths: Iterable[str]) -> None:
    for rel in relative_paths:
        with contextlib.suppress(OSError):
            (storage_dir / rel).unlink(missing_ok=True)


def cleanup_orphan_recordings(conn: sqlite3.Connection, storage_dir: Path) -> int:
    """DB에 없는 녹음 파일(삭제 실패·업로드 중단 .part)을 지운다."""
    root = storage_dir / "recordings"
    if not root.is_dir():
        return 0
    known = {row["path"] for row in conn.execute("SELECT path FROM recordings")}
    removed = 0
    for file in list(root.rglob("*")):
        if file.is_file() and file.relative_to(storage_dir).as_posix() not in known:
            with contextlib.suppress(OSError):
                file.unlink()
                removed += 1
    return removed
