"""녹음 업로드·재생 (spec 4.3). 받은 그대로(webm/opus·ogg) 저장한다."""

import sqlite3
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Form, Request, UploadFile
from fastapi.responses import FileResponse

from app.deps import Db, LoggedInUser, PremiumUser
from app.errors import ApiError
from app.files import remove_files
from app.ids import new_id
from app.presenters import recording_url
from app.repos import recordings
from app.schemas import RecordingCreated
from app.timefmt import iso

router = APIRouter()

CHUNK_BYTES = 64 * 1024


def _receive(clip: UploadFile, target: Path, budget: int) -> int:
    """스풀된 본문을 조각마다 세며 .part에 쓰고 남은 한도를 넘으면 413.

    본문은 FastAPI가 이미 받은 뒤라 네트워크 상한은 nginx `client_max_body_size 6m`이 맡는다.
    """
    part = target.with_name(target.name + ".part")
    size = 0
    try:
        with part.open("wb") as out:
            while chunk := clip.file.read(CHUNK_BYTES):
                size += len(chunk)
                if size > budget:
                    raise ApiError(413, "too_large")
                out.write(chunk)
        if size == 0:
            raise ApiError(422, "invalid", field="clip")
        part.replace(target)
    except BaseException:
        part.unlink(missing_ok=True)
        raise
    return size


@router.post("/recordings", status_code=201, response_model=RecordingCreated)
def upload_recording(
    archive_id: Annotated[str, Form(alias="archiveId")],
    turn: Annotated[int, Form(ge=0)],
    clip: UploadFile,
    user: PremiumUser,
    conn: Db,
    request: Request,
) -> RecordingCreated:
    mime = (clip.content_type or "").split(";", 1)[0].strip().lower()
    ext = recordings.MIME_EXTENSIONS.get(mime)
    if ext is None:
        raise ApiError(415, "unsupported_media")
    if not recordings.is_own_premium_archive(conn, user_id=user.id, archive_id=archive_id):
        raise ApiError(404, "not_found")
    limit = recordings.RECORDING_LIMIT_BYTES
    budget = limit - recordings.used_bytes(conn, archive_id=archive_id, excluding_turn=turn)
    storage = request.app.state.settings.storage_dir
    recording_id = new_id("rec")
    relative = f"recordings/{user.id}/{recording_id}.{ext}"
    target = storage / relative
    # 경로는 서버가 만들지만, 저장소 밖으로 나가지 않는지 한 번 더 확인한다.
    if not target.resolve().is_relative_to(storage.resolve()):
        raise ApiError(404, "not_found")
    target.parent.mkdir(parents=True, exist_ok=True)
    size = _receive(clip, target, budget)
    rec = recordings.Recording(
        id=recording_id,
        archive_id=archive_id,
        user_id=user.id,
        turn=turn,
        path=relative,
        mime=mime,
        size=size,
    )
    try:
        old = recordings.replace_recording(
            conn, recording=rec, created_at=iso(request.app.state.clock()), limit=limit
        )
    except recordings.TooLarge:
        target.unlink(missing_ok=True)
        raise ApiError(413, "too_large") from None
    except sqlite3.IntegrityError:
        # 소유 확인 뒤 저장 전에 기록이 지워졌다(FK 실패)
        target.unlink(missing_ok=True)
        raise ApiError(404, "not_found") from None
    except BaseException:
        target.unlink(missing_ok=True)
        raise
    if old is not None:
        remove_files(storage, [old])
    return RecordingCreated(id=recording_id, url=recording_url(recording_id))


@router.get("/recordings/{recording_id}")
def get_recording(
    recording_id: str, user: LoggedInUser, conn: Db, request: Request
) -> FileResponse:
    rec = recordings.get_recording(conn, user_id=user.id, recording_id=recording_id)
    if rec is None:
        raise ApiError(404, "not_found")
    path = request.app.state.settings.storage_dir / rec.path
    if not path.is_file():
        raise ApiError(404, "not_found")
    # FileResponse가 Range(206)·Accept-Ranges를 처리한다
    return FileResponse(path, media_type=rec.mime)
