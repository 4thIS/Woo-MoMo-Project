"""벤 리포트 버전 2 (spec 2026-10-23 2~3절): 출력 스키마·검증·번호·답변별 측정값.

모델은 내용만 쓰고, 번호(Q2-1)·refs·측정값·null 덮기는 서버가 한다. 순수 함수만 둔다.
리포트 원문·측정값·목소리 이유는 로그에 남기지 않는다.
"""

import json
from typing import Any

from app.llm.delivery import AnswerMetrics, judge
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
    except ValueError:
        return None
    return obj if isinstance(obj, dict) else None


def _refs_ok(points: Any, n: int) -> bool:
    for p in points:
        for a in p["answers"]:
            if not 1 <= a <= n:
                return False
    return True


def validate(obj: dict[str, Any], n: int) -> str | None:
    """실패 사유 코드(`answers`·`first_kind`·`refs`), 정상이면 None. 형태가 어긋나도 `answers`."""
    try:
        items = obj["items"]
        if [i["answer"] for i in items] != list(range(1, n + 1)):
            return "answers"
        if items[0]["kind"] != "main":
            return "first_kind"
        summary = obj["summary"]
        if not (_refs_ok(summary["strengths"], n) and _refs_ok(summary["improvements"], n)):
            return "refs"
    except (KeyError, TypeError, IndexError):
        return "answers"
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
                "delivery": it["delivery"] if has_delivery else None,
                "measurements": None if m is None else judge(m),
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
