"""admin_audit SQL (spec 2026-10-17 5절). 관리자 조작 기록."""

import json
import sqlite3

from app.ids import new_id

_SELECT = (
    "SELECT a.at, a.action, a.target_user_id, a.detail_json,"
    " adm.email AS admin_email, tgt.email AS target_email"
    " FROM admin_audit a"
    " LEFT JOIN users adm ON adm.id = a.admin_user_id"
    " LEFT JOIN users tgt ON tgt.id = a.target_user_id"
)


def record_tickets(
    conn: sqlite3.Connection,
    *,
    at: str,
    admin_user_id: str,
    target_user_id: str,
    delta: int,
    reason: str,
) -> None:
    conn.execute(
        "INSERT INTO admin_audit (id, at, admin_user_id, action, target_user_id, detail_json)"
        " VALUES (?, ?, ?, 'tickets', ?, ?)",
        (
            new_id("ad"),
            at,
            admin_user_id,
            target_user_id,
            json.dumps({"delta": delta, "reason": reason}, ensure_ascii=False),
        ),
    )


def page(conn: sqlite3.Connection, *, page: int, size: int = 50) -> tuple[int, list[dict]]:
    total = conn.execute("SELECT COUNT(*) AS n FROM admin_audit").fetchone()["n"]
    rows = conn.execute(
        _SELECT + " ORDER BY a.at DESC, a.id DESC LIMIT ? OFFSET ?",
        (size, (max(page, 1) - 1) * size),
    ).fetchall()
    items = []
    for r in rows:
        detail = json.loads(r["detail_json"])
        items.append(
            {
                "at": r["at"],
                "adminEmail": r["admin_email"],
                "action": r["action"],
                "targetUserId": r["target_user_id"],
                "targetEmail": r["target_email"],
                "delta": detail.get("delta"),
                "reason": detail.get("reason"),
            }
        )
    return total, items


def ticket_log(conn: sqlite3.Connection, *, target_user_id: str, limit: int = 50) -> list[dict]:
    rows = conn.execute(
        _SELECT + " WHERE a.target_user_id = ? AND a.action = 'tickets'"
        " ORDER BY a.at DESC, a.id DESC LIMIT ?",
        (target_user_id, limit),
    ).fetchall()
    out = []
    for r in rows:
        detail = json.loads(r["detail_json"])
        out.append(
            {
                "at": r["at"],
                "adminEmail": r["admin_email"],
                "delta": detail.get("delta"),
                "reason": detail.get("reason"),
            }
        )
    return out
