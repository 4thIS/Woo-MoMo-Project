import logging
import time
from collections.abc import Callable
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.llm.baze import VoiceOutcome
from tests.fakes import FakeBaze
from tests.helpers import COMPANY_START, login_admin, open_db

START = "/api/premium/interviews"
WAV = b"RIFF\x24\x00\x00\x00WAVEfmt " + b"\x00" * 200
MAX_BYTES = 5 * 1024 * 1024


def _start(client: TestClient, consent: bool = True) -> tuple[str, dict[str, Any]]:
    login_admin(client)
    assert client.post("/api/premium/purchase").status_code == 200
    body = {**COMPANY_START, "voiceAnalysisConsent": consent}
    res = client.post(START, json=body)
    assert res.status_code == 201, res.text
    return res.json()["interviewId"], res.json()


def _answer(client: TestClient, interview_id: str, text: str = "저는 개발자입니다") -> None:
    """첫 질문을 받고 답변 1개를 낸다 — 실제 답변 수 1."""
    for body in (None, {"answer": text}):
        res = client.post(f"{START}/{interview_id}/turns", json=body)
        assert res.status_code == 200, res.text


def _upload(client: TestClient, interview_id: str, answer: int = 1, data: bytes = WAV) -> Any:
    return client.post(
        f"{START}/{interview_id}/voice/{answer}",
        files={"file": ("a.wav", data, "audio/wav")},
    )


def _wait_status(settings: Settings, interview_id: str, answer: int = 1) -> str:
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        with open_db(settings) as conn:
            row = conn.execute(
                "SELECT status FROM voice_analysis WHERE interview_id = ? AND answer = ?",
                (interview_id, answer),
            ).fetchone()
        if row is not None and row["status"] != "queued":
            return row["status"]
        time.sleep(0.02)
    raise AssertionError("분석이 끝나지 않음")


def _wait_tmp_empty(settings: Settings) -> list[str]:
    # 상태를 쓴 직후 finally에서 지우므로 잠깐 기다린다
    deadline = time.monotonic() + 2
    files = _tmp_files(settings)
    while files and time.monotonic() < deadline:
        time.sleep(0.02)
        files = _tmp_files(settings)
    return files


@pytest.fixture
def voice_client(
    make_client: Callable[..., TestClient], settings: Settings, fake_baze: FakeBaze
) -> TestClient:
    return make_client(settings, baze=fake_baze)


def _tmp_files(settings: Settings) -> list[str]:
    return [p.name for p in settings.voice_tmp_dir.iterdir()]


def test_start_voice_analysis_values(
    make_client: Callable[..., TestClient], settings: Settings, fake_baze: FakeBaze
) -> None:
    on = make_client(settings, baze=fake_baze)
    assert _start(on, True)[1]["voiceAnalysis"] == "on"
    assert _start(on, False)[1]["voiceAnalysis"] == "off"
    fake_baze.available_flag = False
    assert _start(on, True)[1]["voiceAnalysis"] == "unavailable"


def test_start_without_baze_is_unavailable_and_default_off(client: TestClient) -> None:
    assert _start(client, True)[1]["voiceAnalysis"] == "unavailable"
    res = client.post(START, json=COMPANY_START)
    assert res.json()["voiceAnalysis"] == "off"


def test_consent_is_stored(voice_client: TestClient, settings: Settings) -> None:
    interview_id, _ = _start(voice_client, True)
    with open_db(settings) as conn:
        row = conn.execute(
            "SELECT voice_consent FROM premium_interviews WHERE id = ?", (interview_id,)
        ).fetchone()
    assert row["voice_consent"] == 1


def test_upload_success_runs_analysis_and_cleans_up(
    voice_client: TestClient, settings: Settings, fake_baze: FakeBaze
) -> None:
    interview_id, _ = _start(voice_client)
    _answer(voice_client, interview_id)
    res = _upload(voice_client, interview_id)
    assert res.status_code == 202
    assert res.json() == {"status": "queued"}
    assert _wait_status(settings, interview_id) == "done"
    assert fake_baze.calls == [len(WAV)]
    with open_db(settings) as conn:
        row = conn.execute("SELECT result_json FROM voice_analysis").fetchone()
        usage = conn.execute("SELECT * FROM baze_usage").fetchall()
    assert "백엔드 개발자" in row["result_json"]
    assert len(usage) == 1
    assert usage[0]["key_index"] == 1
    assert usage[0]["outcome"] == "ok"
    assert usage[0]["model"] == settings.baze_voice_model
    assert usage[0]["interview_id"] == interview_id
    assert _wait_tmp_empty(settings) == []


def test_requires_login(voice_client: TestClient) -> None:
    voice_client.cookies.clear()
    assert _upload(voice_client, "pi_x").status_code == 401


def test_other_users_interview_404(voice_client: TestClient) -> None:
    _start(voice_client)
    assert _upload(voice_client, "pi_missing").status_code == 404


def test_no_consent_403(voice_client: TestClient) -> None:
    interview_id, _ = _start(voice_client, False)
    _answer(voice_client, interview_id)
    res = _upload(voice_client, interview_id)
    assert res.status_code == 403
    assert res.json() == {"error": "voice_consent_required"}


def test_done_interview_409(voice_client: TestClient) -> None:
    interview_id, _ = _start(voice_client)
    _answer(voice_client, interview_id)
    assert voice_client.post(f"{START}/{interview_id}/report").status_code == 200
    res = _upload(voice_client, interview_id)
    assert res.status_code == 409
    assert res.json() == {"error": "interview_over"}


def test_too_large_413(voice_client: TestClient, settings: Settings) -> None:
    interview_id, _ = _start(voice_client)
    _answer(voice_client, interview_id)
    big = WAV + b"\x00" * (MAX_BYTES + 1 - len(WAV))
    assert len(big) == MAX_BYTES + 1
    res = _upload(voice_client, interview_id, data=big)
    assert res.status_code == 413
    assert res.json() == {"error": "too_large"}
    assert _tmp_files(settings) == []
    ok = WAV + b"\x00" * (MAX_BYTES - len(WAV))
    assert _upload(voice_client, interview_id, data=ok).status_code == 202


def test_not_wav_415(voice_client: TestClient, settings: Settings) -> None:
    interview_id, _ = _start(voice_client)
    _answer(voice_client, interview_id)
    for data in (b"not a wav at all, definitely", b"RIFF\x00\x00\x00\x00AVI LIST", b""):
        res = _upload(voice_client, interview_id, data=data)
        assert res.status_code == 415, data
        assert res.json() == {"error": "unsupported_media"}
    assert _tmp_files(settings) == []


def test_answer_range_422(voice_client: TestClient) -> None:
    interview_id, _ = _start(voice_client)
    _answer(voice_client, interview_id)
    for n in (0, 2, -1):
        res = _upload(voice_client, interview_id, answer=n)
        assert res.status_code == 422, n
        assert res.json() == {"error": "invalid", "field": "answer"}


def test_rate_limit_21st_429(voice_client: TestClient) -> None:
    interview_id, _ = _start(voice_client)
    _answer(voice_client, interview_id)
    codes = [_upload(voice_client, interview_id, answer=0).status_code for _ in range(21)]
    assert codes[:20] == [422] * 20
    assert codes[20] == 429


def test_no_baze_503(client: TestClient) -> None:
    interview_id, _ = _start(client)
    _answer(client, interview_id)
    res = _upload(client, interview_id)
    assert res.status_code == 503
    assert res.json() == {"error": "voice_unavailable"}


def test_all_keys_unusable_503(voice_client: TestClient, fake_baze: FakeBaze) -> None:
    interview_id, _ = _start(voice_client)
    _answer(voice_client, interview_id)
    fake_baze.available_flag = False
    assert _upload(voice_client, interview_id).status_code == 503


@pytest.mark.parametrize(
    "item",
    [VoiceOutcome("bad_output", key_index=1, input_tokens=10), RuntimeError("secret 받아쓰기")],
)
def test_analysis_failure_marks_failed_and_cleans_up(
    voice_client: TestClient,
    settings: Settings,
    fake_baze: FakeBaze,
    item: Any,
    caplog: pytest.LogCaptureFixture,
) -> None:
    caplog.set_level(logging.DEBUG)
    fake_baze.results.append(item)
    interview_id, _ = _start(voice_client)
    _answer(voice_client, interview_id)
    assert _upload(voice_client, interview_id).status_code == 202
    assert _wait_status(settings, interview_id) == "failed"
    with open_db(settings) as conn:
        row = conn.execute("SELECT error_code, result_json FROM voice_analysis").fetchone()
    assert row["error_code"]
    assert row["result_json"] is None
    assert _wait_tmp_empty(settings) == []
    assert "secret" not in caplog.text


def test_reupload_overwrites(
    voice_client: TestClient, settings: Settings, fake_baze: FakeBaze
) -> None:
    interview_id, _ = _start(voice_client)
    _answer(voice_client, interview_id)
    fake_baze.results.append(VoiceOutcome("bad_output", key_index=1))
    assert _upload(voice_client, interview_id).status_code == 202
    assert _wait_status(settings, interview_id) == "failed"
    assert _wait_tmp_empty(settings) == []
    assert _upload(voice_client, interview_id).status_code == 202
    assert _wait_status(settings, interview_id) == "done"
    with open_db(settings) as conn:
        n = conn.execute("SELECT COUNT(*) FROM voice_analysis").fetchone()[0]
    assert n == 1
    assert _wait_tmp_empty(settings) == []


def test_startup_removes_leftover_voice_tmp(
    make_client: Callable[..., TestClient], settings: Settings
) -> None:
    settings.voice_tmp_dir.mkdir(parents=True)
    (settings.voice_tmp_dir / "pi_old-1.wav").write_bytes(WAV)
    make_client(settings)
    assert settings.voice_tmp_dir.is_dir()
    assert _tmp_files(settings) == []


def test_no_transcript_in_logs(
    voice_client: TestClient, settings: Settings, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.DEBUG)
    interview_id, _ = _start(voice_client)
    _answer(voice_client, interview_id)
    assert _upload(voice_client, interview_id).status_code == 202
    assert _wait_status(settings, interview_id) == "done"
    assert "백엔드 개발자" not in caplog.text
