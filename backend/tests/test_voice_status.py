"""답변별 목소리 분석 이유 voiceStatus — 라우터가 동의·분석 상태를 접지 않고 넘긴다 (이슈 #178)."""

from dataclasses import replace

import pytest

from app.llm.baze import StoredVoice
from app.routers import premium as router
from app.routers.premium import _metrics
from app.schemas import DeliveryMetric
from tests.helpers import COMPANY_START, sse_events, start_ben
from tests.test_ben_pii import _two_turns, _v2_raw
from tests.test_ben_report import METRIC, _put_voice


def _dm(answer: int, speech: float = 60.0) -> DeliveryMetric:
    return DeliveryMetric(
        answer=answer,
        speechSec=speech,
        syllables=300,
        longPauses=1,
        longestPauseSec=2.0,
        firstWordSec=1.0,
        fillerLevel="low",
    )


def _voice(syllables: int = 400) -> StoredVoice:
    return StoredVoice.model_validate(
        {
            "syllables": syllables,
            "fillers": {"count": 1, "examples": ["음"]},
            "confidence": {"level": "mid", "reason": ""},
            "tone": {"level": "calm", "reason": ""},
            "tremor": {"present": False, "reason": ""},
            "trailingOff": {"present": False, "reason": ""},
            "clarity": {"level": "good", "reason": ""},
        }
    )


def test_no_consent_marks_every_answer():
    out = _metrics([_dm(1), _dm(2)], None, consent=False)
    assert [m.voice_status for m in out] == ["no_consent", "no_consent"]


def test_consent_maps_each_stored_status():
    voices = {
        1: ("done", _voice()),
        2: ("queued", None),
        3: ("failed", None),
        4: ("unavailable", None),
        # 5: 녹음이 아예 안 올라옴(행 없음)
    }
    out = _metrics([_dm(a) for a in range(1, 6)], voices, consent=True)
    assert [m.voice_status for m in out] == [
        "ok",
        "pending",
        "failed",
        "unavailable",
        "unavailable",
    ]
    assert out[0].voice is not None


def test_done_without_hangul_transcript_is_failed():
    # 한글 없는 받아쓰기는 믿지 않아 목소리 결과를 버린다(with_voice) — 이유는 분석 실패로
    out = _metrics([_dm(1)], {1: ("done", _voice(syllables=0))}, consent=True)
    assert out[0].voice is None
    assert out[0].voice_status == "failed"


def test_default_is_no_consent_for_old_callers():
    assert _metrics([_dm(1)])[0].voice_status == "no_consent"


# ── 라우터 끝까지: 리포트 v2 report 이벤트의 measurements.voiceStatus ──

URL = "/api/premium/interviews"


@pytest.mark.parametrize(
    ("stored", "expected"),
    [("done", "ok"), ("failed", "failed"), ("unavailable", "unavailable"), (None, "unavailable")],
)
def test_v2_report_carries_voice_status(
    make_client, settings, fake_claude, monkeypatch, stored, expected
):
    monkeypatch.setattr(router, "VOICE_WAIT_SEC", 0.2)
    c = make_client(replace(settings, ben_report_v2=True))
    iid = start_ben(c, {**COMPANY_START, "voiceAnalysisConsent": True})
    _two_turns(c, iid)
    if stored is not None:
        _put_voice(settings, iid, status=stored)
    raw = _v2_raw("좋았습니다")
    fake_claude.replies = [[raw]]
    events = sse_events(c.post(f"{URL}/{iid}/report", json={"delivery": [METRIC]}).text)
    data = next(d for e, d in events if e == "report")
    assert data["items"][0]["measurements"]["voiceStatus"] == expected


def test_v2_report_pending_when_analysis_not_done(make_client, settings, fake_claude, monkeypatch):
    monkeypatch.setattr(router, "VOICE_WAIT_SEC", 0.2)
    monkeypatch.setattr(router, "VOICE_POLL_SEC", 0.05)
    c = make_client(replace(settings, ben_report_v2=True))
    iid = start_ben(c, {**COMPANY_START, "voiceAnalysisConsent": True})
    _two_turns(c, iid)
    _put_voice(settings, iid, status="queued")
    fake_claude.replies = [[_v2_raw("좋았습니다")]]
    events = sse_events(c.post(f"{URL}/{iid}/report", json={"delivery": [METRIC]}).text)
    data = next(d for e, d in events if e == "report")
    assert data["items"][0]["measurements"]["voiceStatus"] == "pending"
