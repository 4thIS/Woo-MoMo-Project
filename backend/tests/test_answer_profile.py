import pytest

from app.llm import prompts, report_v2
from app.llm.baze import StoredVoice
from app.llm.delivery import profile_axes
from tests.test_report_v2 import met, obj

KEYS = ["content", "speed", "fluency", "response", "confidence", "clarity"]
LABELS = ["답변 내용", "말 속도", "쉼·유창성", "순발력", "자신감", "발음·명료도"]


def voice(conf="high", clar="good", conf_reason="", clar_reason=""):
    return StoredVoice.model_validate(
        {
            "syllables": 300,
            "fillers": {"count": 0, "examples": []},
            "confidence": {"level": conf, "reason": conf_reason},
            "tone": {"level": "calm", "reason": ""},
            "tremor": {"present": False, "reason": ""},
            "trailingOff": {"present": False, "reason": ""},
            "clarity": {"level": clar, "reason": clar_reason},
        }
    )


def axis(axes, key):
    return next(a for a in axes if a["key"] == key)


def prof(m, level=4, comment="근거가 좋아요"):
    return profile_axes(m, level, comment)


def test_six_axes_fixed_order_and_labels():
    for m in (None, met(1), met(1, speech=2.0)):
        axes = prof(m)
        assert [a["key"] for a in axes] == KEYS
        assert [a["label"] for a in axes] == LABELS
        assert all(set(a) == {"key", "label", "level", "comment"} for a in axes)


def test_content_always_filled_and_comment_sanitized():
    a = axis(prof(None, 5, "  [좋은]   (근거)\n있음 " + "가" * 60), "content")
    assert a["level"] == 5
    assert a["comment"].startswith("좋은 근거 있음 가")
    assert len(a["comment"]) == 40
    assert not set("[]()") & set(a["comment"])


def test_no_metrics_nulls_other_axes():
    for a in prof(None)[1:]:
        assert a["level"] is None and a["comment"] is None


@pytest.mark.parametrize(
    ("syl", "level", "text"),
    [
        (249, 3, "분당 249음절로 조금 느려요"),
        (250, 5, "분당 250음절로 보통이에요"),
        (330, 5, "분당 330음절로 보통이에요"),
        (331, 3, "분당 331음절로 조금 빨라요"),
    ],
)
def test_speed(syl, level, text):
    a = axis(prof(met(1, speech=60.0, syl=syl)), "speed")
    assert (a["level"], a["comment"]) == (level, text)


@pytest.mark.parametrize(
    ("pauses", "level", "text"),
    [
        (1, 5, "2초 넘는 쉼이 말한 1분당 1.0회예요"),
        (2, 4, "2초 넘는 쉼이 말한 1분당 2.0회예요"),
        (3, 2, "2초 넘는 쉼이 말한 1분당 3.0회예요"),
    ],
)
def test_fluency_levels(pauses, level, text):
    a = axis(prof(met(1, pauses=pauses, filler="normal")), "fluency")
    assert (a["level"], a["comment"]) == (level, text)


def test_fluency_filler_step_down_with_floor():
    a = axis(prof(met(1, pauses=1, filler="high")), "fluency")
    assert a["level"] == 4
    assert a["comment"] == "2초 넘는 쉼이 말한 1분당 1.0회예요, 군말이 잦은 편이에요"
    assert axis(prof(met(1, pauses=3, filler="high")), "fluency")["level"] == 1
    # 군말 수가 있으면 그 판정을 따른다(분당 6회 초과 -> 잦은 경향)
    a = axis(prof(met(1, pauses=1, filler=None, filler_count=7)), "fluency")
    assert a["level"] == 4 and a["comment"].endswith("군말이 잦은 편이에요")
    assert axis(prof(met(1, pauses=1, filler="low")), "fluency")["level"] == 5
    assert axis(prof(met(1, pauses=1, filler=None)), "fluency")["level"] == 5


@pytest.mark.parametrize(
    ("sec", "level"),
    [(0.5, 5), (1.5, 5), (1.6, 4), (3.0, 4), (3.1, 2), (6.0, 2), (6.1, 1), (20, 1)],
)
def test_response(sec, level):
    a = axis(prof(met(1, first=sec)), "response")
    assert a["level"] == level
    assert a["comment"] == f"첫마디까지 {round(sec, 1):.1f}초 걸렸어요"


def test_voice_axes_levels_and_reasons():
    for conf, cl, cv, clv in [("high", "good", 5, 5), ("mid", "ok", 3, 3), ("low", "poor", 2, 2)]:
        axes = prof(met(1, voice=voice(conf, cl, "목소리가 (작음) [떨림]", "  발음이   흐림")))
        assert (axis(axes, "confidence")["level"], axis(axes, "clarity")["level"]) == (cv, clv)
        assert axis(axes, "confidence")["comment"] == "목소리가 작음 떨림"
        assert axis(axes, "clarity")["comment"] == "발음이 흐림"


def test_voice_axes_fallback_comments():
    texts = {
        ("high", "good"): ("자신감이 높게 들렸어요", "발음이 또렷하게 들렸어요"),
        ("mid", "ok"): ("자신감이 보통으로 들렸어요", "발음이 보통으로 들렸어요"),
        ("low", "poor"): ("자신감이 낮게 들렸어요", "발음이 흐리게 들렸어요"),
    }
    for (conf, cl), (ct, clt) in texts.items():
        axes = prof(met(1, voice=voice(conf, cl)))
        assert axis(axes, "confidence")["comment"] == ct
        assert axis(axes, "clarity")["comment"] == clt


def test_no_voice_nulls_voice_axes():
    axes = prof(met(1))
    for k in ("confidence", "clarity"):
        assert axis(axes, k)["level"] is None and axis(axes, k)["comment"] is None
    assert axis(axes, "speed")["level"] is not None


def test_insufficient_nulls_all_measured_axes():
    # 측정 부족이면 표(judge)처럼 목소리 축도 비운다 — 5초 미만 말로는 목소리 판정도 믿기 어렵다
    m = met(1, speech=3.0, voice=voice("mid", "ok"))
    axes = prof(m)
    for k in ("speed", "fluency", "response", "confidence", "clarity"):
        assert axis(axes, k)["level"] is None and axis(axes, k)["comment"] is None
    for m in (met(1, speech=3.0), met(1, syl=0)):
        axes = prof(m)
        assert [a["level"] for a in axes[1:]] == [None] * 5


def test_profile_never_disagrees_with_measurements():
    out = report_v2.build(
        obj(), [met(1, syl=200), met(2, syl=400)], has_delivery=True, has_posting=False
    )
    for it in out["items"][:2]:
        speed = axis(it["profile"], "speed")
        assert (speed["level"] == 5) == (it["measurements"]["speed"] == "보통")
    assert [a["key"] for a in out["items"][0]["profile"]] == KEYS
    assert all(len(it["profile"]) == 6 for it in out["items"])
    assert axis(out["items"][4]["profile"], "speed")["level"] is None  # 측정 없는 답변
    assert axis(out["items"][4]["profile"], "content")["comment"] == "c5"
    keys = list(out["items"][0])
    assert keys.index("profile") == keys.index("measurements") + 1


@pytest.mark.parametrize("bad", [0, 6, 2.5, True, False, "3", None])
def test_content_level_validation(bad):
    o = obj()
    o["items"][1]["contentLevel"] = bad
    assert report_v2.validate(o, 5) == "shape"


def test_content_fields_missing_or_bad_type():
    o = obj()
    o["items"][0].pop("contentLevel")
    assert report_v2.validate(o, 5) == "shape"
    o = obj()
    o["items"][0].pop("contentComment")
    assert report_v2.validate(o, 5) == "shape"
    o = obj()
    o["items"][2]["contentComment"] = 3
    assert report_v2.validate(o, 5) == "shape"
    o = obj()
    for lvl in (1, 2, 3, 4, 5):
        o["items"][0]["contentLevel"] = lvl
        assert report_v2.validate(o, 5) is None


def test_schema_has_content_fields_required():
    item = report_v2.REPORT_V2_SCHEMA["properties"]["items"]["items"]
    assert item["properties"]["contentLevel"] == {"type": "integer", "enum": [1, 2, 3, 4, 5]}
    assert item["properties"]["contentComment"] == {"type": "string"}
    assert {"contentLevel", "contentComment"} <= set(item["required"])


def test_instruction_line_added_and_v1_unchanged():
    line = (
        "- contentLevel은 그 답변의 내용(구체성·근거·본인 기여)을 1~5로 매기고(5가 가장 좋음), "
        "contentComment에는 그 이유를 40자 이내 한 문장으로 쓰세요."
    )
    assert line in prompts.REPORT_INSTRUCTION_V2
    assert "contentLevel" not in prompts.REPORT_INSTRUCTION
