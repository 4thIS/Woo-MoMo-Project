"""기동 시 저장소 준비 (spec 3절 db, 4.2 남은 파일 정리)."""

from app import db
from app.config import Settings
from app.files import cleanup_orphan_recordings


def prepare_storage(settings: Settings, now: float) -> None:
    db.init_db(settings.db_path)
    settings.recordings_dir.mkdir(parents=True, exist_ok=True)
    with db.connection(settings.db_path) as conn:
        cleanup_orphan_recordings(conn, settings.storage_dir)
