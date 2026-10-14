"""처음부터 끝까지: 가입·관리자 로그인 → 구매 → 벤 면접 → 리포트 → 보관함 → 녹음 → 삭제."""

from tests.helpers import (
    COMPANY_START,
    archive_body,
    login_admin,
    logout,
    signup,
    sse_events,
)

REPORT_RAW = '[{"question": "자기소개", "answerSummary": "요약", "feedback": "좋습니다."}]'


def _recording_files(settings) -> list[str]:
    return sorted(p.name for p in settings.recordings_dir.rglob("*") if p.is_file())


def test_full_flow(client, fake_claude, settings):
    # 일반 사용자: 구매도 벤 시작도 막힌다
    member = signup(client)
    assert member["isAdmin"] is False
    res = client.post("/api/premium/purchase")
    assert (res.status_code, res.json()) == (403, {"error": "purchase_disabled"})
    res = client.post("/api/premium/interviews", json=COMPANY_START)
    assert (res.status_code, res.json()) == (403, {"error": "premium_required"})
    logout(client)

    # 관리자: 구매 → 시작
    assert login_admin(client)["isAdmin"] is True
    bought = client.post("/api/premium/purchase").json()
    assert (bought["tier"], bought["tickets"]) == ("premium", 10)
    started = client.post("/api/premium/interviews", json=COMPANY_START)
    assert started.status_code == 201
    iid = started.json()["interviewId"]
    assert started.json()["session"]["tickets"] == 9

    # 턴: 첫 질문 → 답변 → 종료 문장
    fake_claude.replies = [
        ["자기소개를 ", "해 주세요."],
        ["수고하셨습니다. 면접을 마치겠습니다."],
        [REPORT_RAW[:30], REPORT_RAW[30:]],
    ]
    first = client.post(f"/api/premium/interviews/{iid}/turns")
    assert sse_events(first.text)[-1] == ("done", {"ended": False})
    last = client.post(f"/api/premium/interviews/{iid}/turns", json={"answer": "이우진입니다."})
    assert sse_events(last.text)[-1] == ("done", {"ended": True})

    # 리포트
    events = sse_events(client.post(f"/api/premium/interviews/{iid}/report").text)
    assert "".join(d["text"] for e, d in events if e == "delta") == REPORT_RAW
    assert events[-1] == ("done", {})

    # 보관함 premium 저장
    body = archive_body(
        premium=True, premiumInterviewId=iid, interviewerId="m2", reportRaw=REPORT_RAW
    )
    saved = client.post("/api/archive", json=body)
    assert saved.status_code == 201, saved.text
    archive_id = saved.json()["entry"]["id"]
    assert saved.json()["evicted"] == []

    # 녹음 업로드 → 재생(Range 206)
    clip = b"0123456789" * 10
    up = client.post(
        "/api/recordings",
        data={"archiveId": archive_id, "turn": "0"},
        files={"clip": ("clip", clip, "audio/webm;codecs=opus")},
    )
    assert up.status_code == 201, up.text
    url = up.json()["url"]
    part = client.get(url, headers={"Range": "bytes=0-9"})
    assert part.status_code == 206
    assert part.content == clip[:10]
    assert part.headers["content-type"].startswith("audio/webm")
    detail = client.get(f"/api/archive/{archive_id}").json()
    assert detail["hasRecording"] is True
    assert detail["recordings"] == [{"turn": 0, "url": url}]
    assert len(_recording_files(settings)) == 1

    # 기록 삭제 → 녹음 파일도 사라진다
    assert client.delete(f"/api/archive/{archive_id}").status_code == 204
    assert _recording_files(settings) == []
    assert client.get(url).status_code == 404
