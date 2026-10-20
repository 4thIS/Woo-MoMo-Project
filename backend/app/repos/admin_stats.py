"""관리자 대시보드 조회 SQL (spec 2026-10-17 3절). 개수·메타데이터만 읽는다(본문 칸 제외)."""

import sqlite3
from collections import defaultdict
from datetime import datetime

from app.llm.pricing import MODEL_PRICING, cost_usd_raw
from app.repos import audit, sessions, usage
from app.timefmt import KST, iso, kst_day_start

PAGE_SIZE = 50
DAY = 86400
BRIEFING_FRESH_SECONDS = 7 * DAY


def _count(conn: sqlite3.Connection, sql: str, *args: object) -> int:
    return conn.execute(sql, args).fetchone()[0]


def _kst_date(iso_text: str) -> str:
    dt = datetime.fromisoformat(iso_text.replace("Z", "+00:00"))
    return dt.astimezone(KST).strftime("%Y-%m-%d")


def _kst_dates(now: float, days: int) -> list[str]:
    """오늘까지 days개의 한국 날짜, 오래된 것부터."""
    return [
        datetime.fromtimestamp(now - i * DAY, KST).strftime("%Y-%m-%d")
        for i in range(days - 1, -1, -1)
    ]


def overview(
    conn: sqlite3.Connection, *, now: float, daily_limit: int, emergency_password: str | None
) -> dict:
    dates = _kst_dates(now, 30)
    window_start = kst_day_start(now - 29 * DAY)
    per_day: dict[str, int] = defaultdict(int)
    for row in conn.execute(
        "SELECT created_at FROM premium_interviews WHERE created_at >= ?", (window_start,)
    ):
        per_day[_kst_date(row["created_at"])] += 1
    rec = conn.execute(
        "SELECT COUNT(*) AS n, COALESCE(SUM(bytes), 0) AS b FROM recordings"
    ).fetchone()
    return {
        "users": {
            "total": _count(conn, "SELECT COUNT(*) FROM users"),
            "last7Days": _count(
                conn, "SELECT COUNT(*) FROM users WHERE created_at >= ?", iso(now - 7 * DAY)
            ),
            "last30Days": _count(
                conn, "SELECT COUNT(*) FROM users WHERE created_at >= ?", iso(now - 30 * DAY)
            ),
            "withTickets": _count(conn, "SELECT COUNT(*) FROM users WHERE tickets >= 1"),
            "admins": _count(conn, "SELECT COUNT(*) FROM users WHERE is_admin = 1"),
        },
        "tickets": {"outstanding": _count(conn, "SELECT COALESCE(SUM(tickets), 0) FROM users")},
        "ben": {
            "today": per_day[dates[-1]],
            "dailyLimit": daily_limit,
            "byDay": [{"date": d, "count": per_day[d]} for d in dates],
        },
        "archive": {
            "entries": _count(conn, "SELECT COUNT(*) FROM archive"),
            "ben": _count(conn, "SELECT COUNT(*) FROM archive WHERE premium = 1"),
        },
        "recordings": {"count": rec["n"], "bytes": rec["b"]},
        "briefings": {
            "cached": _count(
                conn,
                "SELECT COUNT(*) FROM company_briefings WHERE created_at >= ?",
                iso(now - BRIEFING_FRESH_SECONDS),
            )
        },
        "weakEmergencyPassword": emergency_password is not None and len(emergency_password) < 12,
    }


_USER_SELECT = (
    "SELECT u.id, u.email, u.name, u.created_at, u.tickets, u.is_admin,"
    " (SELECT COUNT(*) FROM archive a WHERE a.user_id = u.id) AS archive_count,"
    " (SELECT COUNT(*) FROM premium_interviews p WHERE p.user_id = u.id) AS ben_count,"
    " (SELECT MAX(expires_at) FROM sessions s WHERE s.user_id = u.id) AS session_expires,"
    " (SELECT MAX(started_at) FROM archive a WHERE a.user_id = u.id) AS last_archive,"
    " (SELECT MAX(created_at) FROM premium_interviews p WHERE p.user_id = u.id) AS last_ben"
    " FROM users u"
)


def _user_item(row: sqlite3.Row) -> dict:
    # sessions에는 생성 시각 칸이 없어 만료 시각에서 거꾸로 센다
    session_at = (
        iso(row["session_expires"] - sessions.SESSION_SECONDS) if row["session_expires"] else None
    )
    latest = [t for t in (session_at, row["last_archive"], row["last_ben"]) if t]
    return {
        "id": row["id"],
        "email": row["email"],
        "name": row["name"],
        "createdAt": row["created_at"],
        "tickets": row["tickets"],
        "isAdmin": bool(row["is_admin"]),
        "archiveCount": row["archive_count"],
        "benCount": row["ben_count"],
        "lastActiveAt": max(latest) if latest else None,
    }


def _like(q: str) -> str:
    escaped = q.lower().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


def users_page(conn: sqlite3.Connection, *, q: str, page: int) -> dict:
    where, args = "", []
    if q:
        where = (
            " WHERE lower(u.email) LIKE ? ESCAPE '\\'"
            " OR lower(COALESCE(u.name, '')) LIKE ? ESCAPE '\\'"
        )
        args = [_like(q), _like(q)]
    total = _count(conn, "SELECT COUNT(*) FROM users u" + where, *args)
    rows = conn.execute(
        _USER_SELECT + where + " ORDER BY u.created_at DESC, u.id DESC LIMIT ? OFFSET ?",
        (*args, PAGE_SIZE, (page - 1) * PAGE_SIZE),
    ).fetchall()
    return {
        "page": page,
        "pageSize": PAGE_SIZE,
        "total": total,
        "items": [_user_item(r) for r in rows],
    }


def user_detail(conn: sqlite3.Connection, user_id: str) -> dict | None:
    row = conn.execute(_USER_SELECT + " WHERE u.id = ?", (user_id,)).fetchone()
    if row is None:
        return None
    ben = conn.execute(
        "SELECT id, created_at, track, status, model_turns, briefing_status"
        " FROM premium_interviews WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 50",
        (user_id,),
    ).fetchall()
    arch = conn.execute(
        "SELECT a.id, a.started_at, a.interviewer_id, a.premium, a.track, a.question_count,"
        " EXISTS (SELECT 1 FROM recordings r WHERE r.archive_id = a.id) AS has_rec"
        " FROM archive a WHERE a.user_id = ? ORDER BY a.started_at DESC, a.id DESC LIMIT 50",
        (user_id,),
    ).fetchall()
    return {
        "user": _user_item(row),
        "ben": [
            {
                "id": b["id"],
                "createdAt": b["created_at"],
                "track": b["track"],
                "status": b["status"],
                "modelTurns": b["model_turns"],
                "briefingStatus": b["briefing_status"],
            }
            for b in ben
        ],
        "archive": [
            {
                "id": a["id"],
                "startedAt": a["started_at"],
                "interviewerId": a["interviewer_id"],
                "premium": bool(a["premium"]),
                "track": a["track"],
                "questionCount": a["question_count"],
                "hasRecording": bool(a["has_rec"]),
            }
            for a in arch
        ],
        "ticketLog": audit.ticket_log(conn, target_user_id=user_id),
    }


def _cost(row: sqlite3.Row) -> float:
    return cost_usd_raw(
        row["input_tokens"],
        row["output_tokens"],
        row["cache_read_tokens"],
        row["cache_write_tokens"],
        row["web_searches"],
    )


def usage_report(conn: sqlite3.Connection, *, now: float, days: int) -> dict:
    dates = _kst_dates(now, days)
    rows = usage.rows_since(conn, kst_day_start(now - (days - 1) * DAY))
    day_rows: dict[str, list[sqlite3.Row]] = defaultdict(list)
    kinds: dict[str, list[float]] = {}
    interviews: dict[str, list] = {}
    for r in rows:
        day_rows[_kst_date(r["at"])].append(r)
        cost = _cost(r)
        k = kinds.setdefault(r["kind"], [0, 0.0])
        k[0] += 1
        k[1] += cost
        if r["interview_id"]:
            i = interviews.setdefault(r["interview_id"], [r["user_id"], 0, 0.0])
            i[1] += 1
            i[2] += cost
    by_day = []
    for d in dates:
        rs = day_rows[d]
        by_day.append(
            {
                "date": d,
                "calls": len(rs),
                "inputTokens": sum(r["input_tokens"] for r in rs),
                "outputTokens": sum(r["output_tokens"] for r in rs),
                "cacheReadTokens": sum(r["cache_read_tokens"] for r in rs),
                "cacheWriteTokens": sum(r["cache_write_tokens"] for r in rs),
                "webSearches": sum(r["web_searches"] for r in rs),
                "errors": sum(1 for r in rs if r["outcome"] == "error"),
                "refusals": sum(1 for r in rs if r["outcome"] == "refused"),
                "costUsd": round(sum(_cost(r) for r in rs), 4),
            }
        )
    top = sorted(interviews.items(), key=lambda kv: (-kv[1][2], kv[0]))[:10]
    emails = {
        uid: conn.execute("SELECT email FROM users WHERE id = ?", (uid,)).fetchone()
        for uid in {v[0] for _, v in top}
    }
    first = usage.first_at(conn)
    return {
        "pricing": dict(MODEL_PRICING),
        "since": _kst_date(first) if first else None,
        "byDay": by_day,
        "byKind": [
            {"kind": k, "calls": int(v[0]), "costUsd": round(v[1], 4)}
            for k, v in sorted(kinds.items())
        ],
        "topInterviews": [
            {
                "interviewId": iid,
                "userEmail": emails[v[0]]["email"] if emails[v[0]] else None,
                "calls": v[1],
                "costUsd": round(v[2], 4),
            }
            for iid, v in top
        ],
    }
