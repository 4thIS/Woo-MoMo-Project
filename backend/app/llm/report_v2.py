"""벤 리포트 버전 2 (spec 2026-10-23 2~3절): 출력 스키마·검증·번호·답변별 측정값.

모델은 내용만 쓰고, 번호(Q2-1)·refs·측정값·null 덮기는 서버가 한다. 순수 함수만 둔다.
리포트 원문·측정값·목소리 이유는 로그에 남기지 않는다.
"""

import json
from typing import Any

from app.llm.delivery import AnswerMetrics, _measurable, judge, profile_axes
from app.llm.prompts import Message

MAX_POINTS = 3

_STR: dict[str, Any] = {"type": "string"}
_NULLABLE_STR: dict[str, Any] = {"anyOf": [{"type": "string"}, {"type": "null"}]}


def _obj(properties: dict[str, Any]) -> dict[str, Any]:
    return {
        "type": "object",
        "properties": properties,
        "required": list(properties),
        "additionalProperties": False,
    }


_POINT = _obj(
    {"point": _STR, "answers": {"type": "array", "items": {"type": "integer"}}},
)

REPORT_V2_SCHEMA: dict[str, Any] = _obj(
    {
        "items": {
            "type": "array",
            "items": _obj(
                {
                    "answer": {"type": "integer"},
                    "kind": {"type": "string", "enum": ["main", "follow"]},
                    "question": _STR,
                    "answerSummary": _STR,
                    "feedback": _STR,
                    "delivery": _NULLABLE_STR,
                    "contentLevel": {"type": "integer", "enum": [1, 2, 3, 4, 5]},
                    "contentComment": _STR,
                }
            ),
        },
        "summary": _obj(
            {
                "strengths": {"type": "array", "items": _POINT},
                "improvements": {"type": "array", "items": _POINT},
                "delivery": _NULLABLE_STR,
                "postingFit": {
                    "anyOf": [
                        _obj(
                            {
                                "met": {"type": "array", "items": _STR},
                                "gaps": {"type": "array", "items": _STR},
                            }
                        ),
                        {"type": "null"},
                    ]
                },
            }
        ),
    }
)


def answer_count(messages: list[Message]) -> int:
    """지원자 답변 수. KICKOFF는 `_history`가 붙이므로 저장된 messages에는 없다."""
    return sum(1 for m in messages if m.get("role") == "user")


def parse(raw: str) -> dict[str, Any] | None:
    try:
        obj = json.loads(raw)
    except (ValueError, RecursionError):
        return None
    return obj if isinstance(obj, dict) else None


def _is_int(v: Any) -> bool:
    return isinstance(v, int) and not isinstance(v, bool)


def _is_str_list(v: Any) -> bool:
    return isinstance(v, list) and all(isinstance(x, str) for x in v)


def _opt_str(v: Any) -> bool:
    return v is None or isinstance(v, str)


def _item_ok(it: Any) -> bool:
    return (
        isinstance(it, dict)
        and _is_int(it.get("answer"))
        and it.get("kind") in ("main", "follow")
        and all(isinstance(it.get(k), str) for k in ("question", "answerSummary", "feedback"))
        and "delivery" in it
        and _opt_str(it["delivery"])
        and _is_int(it.get("contentLevel"))
        and 1 <= it["contentLevel"] <= 5
        and isinstance(it.get("contentComment"), str)
    )


def _points_ok(points: Any) -> bool:
    return isinstance(points, list) and all(
        isinstance(p, dict)
        and isinstance(p.get("point"), str)
        and isinstance(p.get("answers"), list)
        and all(_is_int(a) for a in p["answers"])
        for p in points
    )


def _shape_ok(obj: Any) -> bool:
    if not isinstance(obj, dict):
        return False
    items, summary = obj.get("items"), obj.get("summary")
    if not isinstance(items, list) or not all(_item_ok(i) for i in items):
        return False
    if not isinstance(summary, dict):
        return False
    if not (_points_ok(summary.get("strengths")) and _points_ok(summary.get("improvements"))):
        return False
    if "delivery" not in summary or not _opt_str(summary["delivery"]):
        return False
    fit = summary.get("postingFit", ...)
    return fit is None or (
        isinstance(fit, dict) and _is_str_list(fit.get("met")) and _is_str_list(fit.get("gaps"))
    )


def _refs_ok(points: list[dict[str, Any]], n: int) -> bool:
    return all(1 <= a <= n for p in points for a in p["answers"])


def validate(obj: dict[str, Any], n: int) -> str | None:
    """실패 사유 코드(`shape`·`answers`·`first_kind`·`refs`), 정상이면 None.

    None이면 `build`가 예외 없이 돈다(형식을 전부 확인한다).
    """
    if not _shape_ok(obj):
        return "shape"
    items = obj["items"]
    if n < 1 or [i["answer"] for i in items] != list(range(1, n + 1)):
        return "answers"
    if items[0]["kind"] != "main":
        return "first_kind"
    summary = obj["summary"]
    if not (_refs_ok(summary["strengths"], n) and _refs_ok(summary["improvements"], n)):
        return "refs"
    return None


def _points(points: list[dict[str, Any]], ids: dict[int, str]) -> list[dict[str, Any]]:
    return [
        {"point": p["point"], "refs": [ids[a] for a in sorted(set(p["answers"]))]}
        for p in points[:MAX_POINTS]
    ]


def build(
    obj: dict[str, Any],
    metrics: list[AnswerMetrics],
    *,
    has_delivery: bool,
    has_posting: bool,
) -> dict[str, Any]:
    """검증을 통과한 모델 출력 -> `report` 이벤트 데이터."""
    by_answer = {m.answer: m for m in metrics}
    items: list[dict[str, Any]] = []
    ids: dict[int, str] = {}
    main_no = 0
    follow_no = 0
    parent: str | None = None
    for it in obj["items"]:
        if it["kind"] == "main":
            main_no += 1
            follow_no = 0
            item_id, item_parent = f"Q{main_no}", None
            parent = item_id
        else:
            follow_no += 1
            item_id, item_parent = f"{parent}-{follow_no}", parent
        ids[it["answer"]] = item_id
        m = by_answer.get(it["answer"])
        items.append(
            {
                "id": item_id,
                "parent": item_parent,
                "answer": it["answer"],
                "kind": it["kind"],
                "question": it["question"],
                "answerSummary": it["answerSummary"],
                "feedback": it["feedback"],
                "delivery": it["delivery"]
                if has_delivery and m is not None and _measurable(m)
                else None,
                "measurements": None if m is None else judge(m),
                "profile": profile_axes(m, it["contentLevel"], it["contentComment"]),
            }
        )
    s = obj["summary"]
    return {
        "version": 2,
        "items": items,
        "summary": {
            "strengths": _points(s["strengths"], ids),
            "improvements": _points(s["improvements"], ids),
            "delivery": s["delivery"] if has_delivery else None,
            "postingFit": s["postingFit"] if has_posting else None,
        },
    }
