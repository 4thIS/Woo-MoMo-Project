"""관리자 대시보드 API (spec 2026-10-17 3절). 모든 경로가 AdminUser를 거친다."""

from typing import Annotated

from fastapi import APIRouter, Query, Request

from app.db import transaction
from app.deps import AdminUser, Db
from app.errors import ApiError
from app.repos import admin_stats, audit
from app.schemas import (
    AdminAuditPage,
    AdminOverview,
    AdminUsage,
    AdminUserDetail,
    AdminUserPage,
    TicketAdjust,
    TicketsResult,
)
from app.timefmt import iso

router = APIRouter(prefix="/admin")

Page = Annotated[int, Query(ge=1)]


@router.get("/overview", response_model=AdminOverview)
def get_overview(request: Request, _: AdminUser, conn: Db) -> dict:
    s = request.app.state.settings
    return admin_stats.overview(
        conn,
        now=request.app.state.clock(),
        daily_limit=s.ben_daily_limit,
        emergency_password=s.admin_password if s.admin_login else None,
    )


@router.get("/users", response_model=AdminUserPage)
def get_users(
    _: AdminUser, conn: Db, q: Annotated[str, Query(max_length=100)] = "", page: Page = 1
) -> dict:
    return admin_stats.users_page(conn, q=q.strip(), page=page)


@router.get("/users/{user_id}", response_model=AdminUserDetail)
def get_user(user_id: str, _: AdminUser, conn: Db) -> dict:
    detail = admin_stats.user_detail(conn, user_id)
    if detail is None:
        raise ApiError(404, "not_found")
    return detail


@router.post("/users/{user_id}/tickets", response_model=TicketsResult)
def adjust_tickets(
    user_id: str, body: TicketAdjust, request: Request, admin: AdminUser, conn: Db
) -> dict:
    with transaction(conn):
        cur = conn.execute(
            "UPDATE users SET tickets = tickets + ? WHERE id = ? AND tickets + ? >= 0",
            (body.delta, user_id, body.delta),
        )
        if cur.rowcount == 0:
            exists = conn.execute("SELECT 1 FROM users WHERE id = ?", (user_id,)).fetchone()
            if exists is None:
                raise ApiError(404, "not_found")
            raise ApiError(409, "insufficient_tickets")
        audit.record_tickets(
            conn,
            at=iso(request.app.state.clock()),
            admin_user_id=admin.id,
            target_user_id=user_id,
            delta=body.delta,
            reason=body.reason,
        )
        tickets = conn.execute("SELECT tickets FROM users WHERE id = ?", (user_id,)).fetchone()[0]
    return {"tickets": tickets}


@router.get("/usage", response_model=AdminUsage)
def get_usage(
    request: Request, _: AdminUser, conn: Db, days: Annotated[int, Query(ge=1, le=90)] = 30
) -> dict:
    return admin_stats.usage_report(conn, now=request.app.state.clock(), days=days)


@router.get("/audit", response_model=AdminAuditPage)
def get_audit(_: AdminUser, conn: Db, page: Page = 1) -> dict:
    total, items = audit.page(conn, page=page)
    return {"page": page, "pageSize": admin_stats.PAGE_SIZE, "total": total, "items": items}
