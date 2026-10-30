import json

from app.llm import report_v2
from app.llm.baze import StoredVoice
from app.llm.delivery import AnswerMetrics, judge, render


def met(answer, speech=60.0, syl=300, pauses=1, longest=2.5, first=1.5, filler="normal", **kw):
    return AnswerMetrics(
        answer=answer,
        speech_sec=speech,
        syllables=syl,
        long_pauses=pauses,
        longest_pause_sec=longest,
        first_word_sec=first,
        filler_level=filler,
        **kw,
    )


def voice():
    return StoredVoice.model_validate(
        {
            "syllables": 400,
            "fillers": {"count": 12, "examples": ["음", "그", "abc", "어"]},
            "confidence": {"level": "low", "reason": "목소리가 (작음) [떨림]"},
            "tone": {"level": "calm", "reason": ""},
            "tremor": {"present": True, "reason": "떨림"},
            "trailingOff": {"present": False, "reason": ""},
            "clarity": {"level": "good", "reason": "또렷"},
        }
    )


def item(answer, kind="main", **kw):
    d = {
        "answer": answer,
        "kind": kind,
        "question": f"q{answer}",
        "answerSummary": f"s{answer}",
        "feedback": f"f{answer}",
        "delivery": f"d{answer}",
        "contentLevel": 3,
        "contentComment": f"c{answer}",
    }
    d.update(kw)
    return d


def summary(**kw):
    d = {
        "strengths": [{"point": "a", "answers": [2, 1, 2]}],
        "improvements": [{"point": "b", "answers": [3]}],
        "delivery": "sd",
        "postingFit": {"met": ["x"], "gaps": ["y"]},
    }
    d.update(kw)
    return d


def obj(kinds=("main", "follow", "follow", "main", "follow"), **kw):
    return {
        "items": [item(i + 1, k) for i, k in enumerate(kinds)],
        "summary": summary(**kw),
    }


def walk(node):
    if isinstance(node, dict):
        yield node
        for v in node.values():
            yield from walk(v)
    elif isinstance(node, list):
        for v in node:
            yield from walk(v)


def test_schema_strict():
    banned = {"minimum", "maximum", "minLength", "maxLength", "maxItems", "minItems"}
    objs = [n for n in walk(report_v2.REPORT_V2_SCHEMA) if n.get("type") == "object"]
    assert len(objs) >= 5
    for o in objs:
        assert o["additionalProperties"] is False
        assert set(o["required"]) == set(o["properties"])
    for n in walk(report_v2.REPORT_V2_SCHEMA):
        assert not banned & set(n)
    item_props = report_v2.REPORT_V2_SCHEMA["properties"]["items"]["items"]["properties"]
    assert item_props["kind"]["enum"] == ["main", "follow"]
    assert {"anyOf": [{"type": "string"}, {"type": "null"}]} == item_props["delivery"]


def test_answer_count():
    msgs = [
        {"role": "model", "text": "Q"},
        {"role": "user", "text": "a"},
        {"role": "model", "text": "Q"},
        {"role": "user", "text": "b"},
    ]
    assert report_v2.answer_count(msgs) == 2
    assert report_v2.answer_count([]) == 0


def test_parse():
    assert report_v2.parse('{"a": 1}') == {"a": 1}
    assert report_v2.parse("[1]") is None
    assert report_v2.parse("{broken") is None
    assert report_v2.parse("") is None


def test_validate_ok():
    assert report_v2.validate(obj(), 5) is None


def test_validate_answers():
    o = obj()
    del o["items"][2]
    assert report_v2.validate(o, 5) == "answers"
    o = obj()
    o["items"][2]["answer"] = 2
    assert report_v2.validate(o, 5) == "answers"
    o = obj()
    o["items"][0], o["items"][1] = o["items"][1], o["items"][0]
    assert report_v2.validate(o, 5) == "answers"
    assert report_v2.validate(obj(), 4) == "answers"


def test_validate_first_kind():
    assert report_v2.validate(obj(kinds=("follow", "main")), 2) == "first_kind"


def test_validate_refs():
    assert report_v2.validate(obj(strengths=[{"point": "a", "answers": [6]}]), 5) == "refs"
    assert report_v2.validate(obj(improvements=[{"point": "a", "answers": [0]}]), 5) == "refs"


def test_numbering_and_refs():
    out = report_v2.build(obj(), [], has_delivery=True, has_posting=True)
    assert out["version"] == 2
    assert [i["id"] for i in out["items"]] == ["Q1", "Q1-1", "Q1-2", "Q2", "Q2-1"]
    assert [i["parent"] for i in out["items"]] == [None, "Q1", "Q1", None, "Q2"]
    assert list(out["items"][0]) == [
        "id", "parent", "answer", "kind", "question", "answerSummary",
        "feedback", "delivery", "measurements", "profile",
    ]  # fmt: skip
    # answers [2,1,2] -> dedup, sorted -> Q1-1... answer 1=Q1, 2=Q1-1
    assert out["summary"]["strengths"] == [{"point": "a", "refs": ["Q1", "Q1-1"]}]
    assert out["summary"]["improvements"] == [{"point": "b", "refs": ["Q1-2"]}]
    assert list(out["summary"]) == ["strengths", "improvements", "delivery", "postingFit"]


def test_summary_trimmed_to_three():
    s = [{"point": str(i), "answers": [1]} for i in range(4)]
    out = report_v2.build(obj(strengths=s), [], has_delivery=True, has_posting=True)
    assert [x["point"] for x in out["summary"]["strengths"]] == ["0", "1", "2"]


def test_null_overrides():
    out = report_v2.build(obj(), [], has_delivery=False, has_posting=False)
    assert all(i["delivery"] is None for i in out["items"])
    assert out["summary"]["delivery"] is None
    assert out["summary"]["postingFit"] is None
    out = report_v2.build(obj(), [met(1)], has_delivery=True, has_posting=True)
    assert out["items"][0]["delivery"] == "d1"
    assert out["summary"]["postingFit"] == {"met": ["x"], "gaps": ["y"]}


def test_measurements_browser_only():
    out = report_v2.build(
        obj(kinds=("main", "main"), improvements=[{"point": "b", "answers": [2]}]),
        [met(1)],
        has_delivery=True,
        has_posting=False,
    )
    assert out["items"][1]["measurements"] is None
    assert out["items"][0]["measurements"] == {
        "syllablesPerMin": 300,
        "speed": "보통",
        "longPauses": 1,
        "pausesPerMin": 1.0,
        "pause": "적음",
        "longestPauseSec": 2.5,
        "firstWordSec": 1.5,
        "firstWord": "보통",
        "filler": {"level": "보통", "count": None, "examples": []},
        "voice": None,
        "insufficient": False,
    }


def test_measurements_no_filler_info():
    j = judge(met(1, filler=None))
    assert j["filler"] is None


def test_measurements_with_voice():
    from app.llm.delivery import with_voice

    j = judge(with_voice(met(1, speech=60.0, pauses=5, first=4.2, longest=4.5), voice()))
    assert j["syllablesPerMin"] == 400 and j["speed"] == "빠름"
    assert j["pausesPerMin"] == 5.0 and j["pause"] == "잦음"
    assert j["firstWord"] == "망설임 긺" and j["firstWordSec"] == 4.2
    assert j["filler"] == {"level": "잦은 경향", "count": 12, "examples": ["음", "그", "어"]}
    v = j["voice"]
    assert v["confidence"] == {"level": "low", "reason": "목소리가 작음 떨림"}
    assert v["tone"] == {"level": "calm", "reason": ""}
    assert v["tremor"] == {"present": True, "reason": "떨림"}
    assert v["trailingOff"]["present"] is False
    assert v["clarity"] == {"level": "good", "reason": "또렷"}
    assert j["insufficient"] is False
    json.dumps(j)


def test_measurements_insufficient():
    for mm in (met(1, speech=3.0), met(1, syl=0)):
        j = judge(mm)
        assert j["insufficient"] is True
        assert all(v is None for k, v in j.items() if k != "insufficient")
        assert set(j) == set(judge(met(1)))


def test_judge_matches_line():
    mm = met(1, speech=20.0, syl=100, pauses=2, first=4.0)
    j = judge(mm)
    line = render([mm]).splitlines()[1]
    assert f"({j['speed']})" in line and f"({j['pause']})" in line
    assert f"({j['firstWord']})" in line
    assert f"군말 {j['filler']['level']}" in line


def test_parse_deep_json():
    assert report_v2.parse("[" * 100000) is None


def test_validate_shape():
    def bad(mutate, n=5):
        o = obj()
        mutate(o)
        return report_v2.validate(o, n)

    assert report_v2.validate([], 1) == "shape"  # type: ignore[arg-type]
    assert bad(lambda o: o["items"][1].__setitem__("answer", 2.0)) == "shape"
    assert bad(lambda o: o["items"][1].__setitem__("answer", True)) == "shape"
    assert bad(lambda o: o["items"][0].pop("question")) == "shape"
    assert bad(lambda o: o["items"][3].__setitem__("kind", "other")) == "shape"
    assert bad(lambda o: o["items"][2].__setitem__("feedback", 3)) == "shape"
    assert bad(lambda o: o["items"][2].__setitem__("delivery", 3)) == "shape"
    assert bad(lambda o: o["items"].__setitem__(1, "x")) == "shape"
    assert bad(lambda o: o.__setitem__("items", "x")) == "shape"
    assert bad(lambda o: o["summary"].pop("strengths")) == "shape"
    assert bad(lambda o: o["summary"].__setitem__("delivery", 1)) == "shape"
    assert bad(lambda o: o["summary"]["strengths"].append({"point": "x"})) == "shape"
    assert bad(lambda o: o["summary"]["strengths"].append("x")) == "shape"
    assert bad(lambda o: o["summary"]["strengths"][0].__setitem__("answers", [1.5])) == "shape"
    assert bad(lambda o: o["summary"]["strengths"][0].__setitem__("answers", [True])) == "shape"
    assert bad(lambda o: o["summary"].__setitem__("postingFit", {"met": ["a"]})) == "shape"
    assert (
        bad(lambda o: o["summary"].__setitem__("postingFit", {"met": [1], "gaps": []})) == "shape"
    )
    assert bad(lambda o: o["summary"].__setitem__("postingFit", None)) is None
    assert report_v2.validate({"items": [], "summary": summary()}, 0) == "answers"


def test_item_delivery_null_unless_answer_measurable():
    metrics = [met(1), met(2, speech=3.0), met(3, syl=0)]
    o = obj(kinds=("main", "follow", "follow", "main", "follow"))
    out = report_v2.build(o, metrics, has_delivery=True, has_posting=False)
    got = [i["delivery"] for i in out["items"]]
    assert got == ["d1", None, None, None, None]  # 2: 5초 미만, 3: 음절 0, 4~5: 측정 없음
    assert out["summary"]["delivery"] == "sd"
