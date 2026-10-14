"""기동 시 저장소 준비 (spec 3절 db)."""

from app import db
from app.config import Settings


def prepare_storage(settings: Settings, now: float) -> None:
    db.init_db(settings.db_path)
    settings.recordings_dir.mkdir(parents=True, exist_ok=True)
