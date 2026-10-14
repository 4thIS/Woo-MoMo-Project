"""내 이력서 슬롯 (spec 4.2). 한도는 서버가 지킨다."""

from fastapi import APIRouter, Request, Response

from app.deps import Db, LoggedInUser
from app.errors import ApiError
from app.repos import resumes
from app.repos.resumes import Resume
from app.schemas import ResumeCreate, ResumeSlot, ResumeUpdate
from app.timefmt import iso

router = APIRouter()


def _slot(r: Resume) -> ResumeSlot:
    return ResumeSlot(id=r.id, kind=r.kind, title=r.title, text=r.text, updatedAt=r.updated_at)


@router.get("/resumes", response_model=list[ResumeSlot])
def list_resumes(user: LoggedInUser, conn: Db) -> list[ResumeSlot]:
    return [_slot(r) for r in resumes.list_resumes(conn, user.id)]


@router.post("/resumes", status_code=201, response_model=ResumeSlot)
def create_resume(body: ResumeCreate, user: LoggedInUser, conn: Db, request: Request) -> ResumeSlot:
    now = iso(request.app.state.clock())
    try:
        r = resumes.create_resume(
            conn, user_id=user.id, kind=body.kind, title=body.title, text=body.text, now=now
        )
    except resumes.SlotFull as exc:
        raise ApiError(409, "slot_full", kind=exc.kind) from None
    return _slot(r)


@router.put("/resumes/{resume_id}", response_model=ResumeSlot)
def update_resume(
    resume_id: str, body: ResumeUpdate, user: LoggedInUser, conn: Db, request: Request
) -> ResumeSlot:
    now = iso(request.app.state.clock())
    r = resumes.update_resume(
        conn, user_id=user.id, resume_id=resume_id, title=body.title, text=body.text, now=now
    )
    if r is None:
        raise ApiError(404, "not_found")
    return _slot(r)


@router.delete("/resumes/{resume_id}", status_code=204)
def delete_resume(resume_id: str, user: LoggedInUser, conn: Db) -> Response:
    if not resumes.delete_resume(conn, user_id=user.id, resume_id=resume_id):
        raise ApiError(404, "not_found")
    return Response(status_code=204)
