"""테스트 공용 도우미. 화면 흐름(가입·로그인·벤 시작)과 SQL 직접 삽입을 짧게 부른다."""

import json
import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

from fastapi.testclient import TestClient

from app import db
from app.config import Settings
from app.ids import new_id

ORIGIN = "http://localhost:5173"
PASSWORD = "password123"
ADMIN_LOGIN = "admin"
ADMIN_PASSWORD = "admin-pass-1234"
T0 = "2026-10-13T04:00:00.000Z"

COMPANY_START = {
    "track": "company",
    "resumeText": "백엔드 3년차, 결제 시스템 개발",
    "company": {"field": "it", "job": "백엔드 개발자"},
}
ADMISSION_START = {
    "track": "admission",
    "resumeText": "로봇 동아리에서 자율주행을 탐구했습니다",
    "admission": {
        "name": "홍길동",
        "age": 19,
        "university": "한국대학교",
        "department": "컴퓨터공학과",
    },
}


@contextmanager
def open_db(settings: Settings) -> Iterator[sqlite3.Connection]:
    with db.connection(settings.db_path) as conn:
        yield conn


def signup(
    client: TestClient, email: str = "a@b.com", name: str = "이우진", password: str = PASSWORD
) -> dict[str, Any]:
    body = {"email": email, "password": password, "name": name, "consent": True}
    res = client.post("/api/auth/signup", json=body)
    assert res.status_code == 201, res.text
    return res.json()


def logout(client: TestClient) -> None:
    assert client.post("/api/auth/logout").status_code == 204


def login_admin(client: TestClient) -> dict[str, Any]:
    res = client.post("/api/auth/login", json={"email": ADMIN_LOGIN, "password": ADMIN_PASSWORD})
    assert res.status_code == 200, res.text
    return res.json()


def make_premium(settings: Settings, user_id: str, tickets: int = 10) -> None:
    with open_db(settings) as conn:
        conn.execute(
            "UPDATE users SET tier = 'premium', tickets = ? WHERE id = ?", (tickets, user_id)
        )


def start_ben(client: TestClient, body: dict[str, Any] | None = None) -> str:
    login_admin(client)
    assert client.post("/api/premium/purchase").status_code == 200
    res = client.post("/api/premium/interviews", json=body or COMPANY_START)
    assert res.status_code == 201, res.text
    return res.json()["interviewId"]


def archive_body(**over: Any) -> dict[str, Any]:
    body: dict[str, Any] = {
        "interviewerId": "m1",
        "premium": False,
        "track": "company",
        "startedAt": T0,
        "endedAt": "2026-10-13T04:21:00.000Z",
        "questionCount": 5,
        "hasRecording": False,
        "field": "it",
        "job": "백엔드 개발자",
        "messages": [{"role": "model", "text": "자기소개를 해 주세요.", "at": 1760000000000}],
        "report": [{"question": "자기소개", "answerSummary": "요약", "feedback": "**구체적으로**"}],
        "reportRaw": '[{"question": "자기소개"}]',
        "recordings": [],
    }
    body.update(over)
    return body


def insert_premium_interview(
    conn: sqlite3.Connection, user_id: str, *, status: str = "done", track: str = "company"
) -> str:
    interview_id = new_id("pi")
    conn.execute(
        "INSERT INTO premium_interviews (id, user_id, track, inputs_json, status, created_at)"
        " VALUES (?, ?, ?, '{}', ?, ?)",
        (interview_id, user_id, track, status, T0),
    )
    return interview_id


def insert_recording(
    conn: sqlite3.Connection,
    *,
    archive_id: str,
    user_id: str,
    turn: int,
    path: str,
    size: int = 10,
    mime: str = "audio/webm",
) -> str:
    recording_id = new_id("rec")
    conn.execute(
        "INSERT INTO recordings (id, archive_id, user_id, turn, path, mime, bytes, created_at)"
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (recording_id, archive_id, user_id, turn, path, mime, size, T0),
    )
    return recording_id


def sse_events(body: str) -> list[tuple[str, dict[str, Any]]]:
    events = []
    for block in body.strip().split("\n\n"):
        lines = [line for line in block.splitlines() if not line.startswith(":")]
        if not lines:  # 주석(": ping")만 있는 블록
            continue
        fields = dict(line.split(": ", 1) for line in lines)
        events.append((fields["event"], json.loads(fields["data"])))
    return events
