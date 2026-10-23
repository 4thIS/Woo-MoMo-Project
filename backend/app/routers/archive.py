"""보관함 (spec 4.2). 5개 한도는 서버가 집행한다."""

import json

from fastapi import APIRouter, Request, Response

from app.deps import Db, LoggedInUser
from app.errors import ApiError
from app.files import remove_files
from app.presenters import recording_url
from app.repos import archive
from app.schemas import ArchiveCreate, ArchiveDetail, ArchiveEntry, ArchiveSaved, RecordingRef
from app.timefmt import format_utc

router = APIRouter()

TRACK_FIELDS = {
    "company": ("field", "job"),
    "admission": ("name", "age", "university", "department"),
}


def _entry(s: archive.ArchiveSummary) -> ArchiveEntry:
    return ArchiveEntry(
        id=s.id,
        interviewerId=s.interviewer_id,
        premium=s.premium,
        track=s.track,
        startedAt=s.started_at,
        endedAt=s.ended_at,
        questionCount=s.question_count,
        hasRecording=s.has_recording,
        field=s.field,
        job=s.job,
        name=s.name,
        age=s.age,
        university=s.university,
        department=s.department,
    )


def _to_new(body: ArchiveCreate) -> archive.NewArchive:
    needed = TRACK_FIELDS[body.track]
    for name in needed:
        value = getattr(body, name)
        if value is None or (isinstance(value, str) and not value.strip()):
            raise ApiError(422, "missing_field", field=name)

    def keep(name: str):  # 다른 트랙의 칸은 저장하지 않는다
        return getattr(body, name) if name in needed else None

    messages = [m.model_dump(exclude_none=True) for m in body.messages]
    return archive.NewArchive(
        interviewer_id=body.interviewerId,
        premium=body.premium,
        premium_interview_id=body.premiumInterviewId if body.premium else None,
        track=body.track,
        field=keep("field"),
        job=keep("job"),
        name=keep("name"),
        age=keep("age"),
        university=keep("university"),
        department=keep("department"),
        question_count=body.questionCount,
        started_at=format_utc(body.startedAt),
        ended_at=format_utc(body.endedAt),
        messages_json=json.dumps(messages, ensure_ascii=False),
        report_json=json.dumps([r.model_dump() for r in body.report], ensure_ascii=False),
        report_raw=body.reportRaw,
        report_v2_json=(
            json.dumps(body.reportV2, ensure_ascii=False) if body.reportV2 is not None else None
        ),
    )


@router.get("/archive", response_model=list[ArchiveEntry], response_model_exclude_none=True)
def list_archive(user: LoggedInUser, conn: Db) -> list[ArchiveEntry]:
    return [_entry(s) for s in archive.list_archive(conn, user.id)]


@router.get("/archive/{archive_id}", response_model=ArchiveDetail, response_model_exclude_none=True)
def get_archive(archive_id: str, user: LoggedInUser, conn: Db) -> ArchiveDetail:
    record = archive.get_archive(conn, user_id=user.id, archive_id=archive_id)
    if record is None:
        raise ApiError(404, "not_found")
    return ArchiveDetail(
        **_entry(record.summary).model_dump(),
        messages=json.loads(record.messages_json),
        report=json.loads(record.report_json),
        reportRaw=record.report_raw,
        reportV2=json.loads(record.report_v2_json) if record.report_v2_json else None,
        recordings=[RecordingRef(turn=t, url=recording_url(i)) for t, i in record.recordings],
    )


@router.post(
    "/archive", status_code=201, response_model=ArchiveSaved, response_model_exclude_none=True
)
def save_archive(
    body: ArchiveCreate, user: LoggedInUser, conn: Db, request: Request
) -> ArchiveSaved:
    new = _to_new(body)
    try:
        result = archive.save_archive(conn, user_id=user.id, new=new)
    except archive.InvalidPremiumInterview:
        raise ApiError(422, "invalid_premium_interview") from None
    remove_files(request.app.state.settings.storage_dir, result.removed_paths)
    entry = ArchiveEntry(
        id=result.archive_id,
        interviewerId=new.interviewer_id,
        premium=new.premium,
        track=new.track,
        startedAt=new.started_at,
        endedAt=new.ended_at,
        questionCount=new.question_count,
        hasRecording=False,
        field=new.field,
        job=new.job,
        name=new.name,
        age=new.age,
        university=new.university,
        department=new.department,
    )
    return ArchiveSaved(entry=entry, evicted=result.evicted)


@router.delete("/archive/{archive_id}", status_code=204)
def delete_archive(archive_id: str, user: LoggedInUser, conn: Db, request: Request) -> Response:
    paths = archive.delete_archive(conn, user_id=user.id, archive_id=archive_id)
    if paths is None:
        raise ApiError(404, "not_found")
    remove_files(request.app.state.settings.storage_dir, paths)
    return Response(status_code=204)
