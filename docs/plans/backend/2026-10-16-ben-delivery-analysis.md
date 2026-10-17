# 벤 답변 전달력 분석(1단계) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 벤 리포트 요청이 브라우저가 잰 답변별 전달력 측정값을 받아, 서버 규칙으로 판정하고, 벤이 문항마다 `delivery` 피드백을 쓰게 한다.

**Architecture:** `app/llm/delivery.py`(순수 함수: 판정·측정 블록 문자열)가 숫자를 판정하고, `prompts.report_messages`가 측정 블록이 있을 때만 리포트 지시문 뒤에 벤 전용 문단을 붙인다. 라우터 `make_report`가 선택 본문을 검증해 블록을 만든다. 보관함 `ReportItem`은 선택 칸 `delivery`를 보존한다.

**Tech Stack:** Python 3.12, FastAPI, pydantic v2, pytest, ruff, uv

**Spec:** `docs/specs/backend/2026-10-16-ben-delivery-analysis-design.md`

## Global Constraints

- 모든 `/api` 변경은 additive. 측정값이 없으면(본문 없음·`{}`·`delivery: []`) 요청·프롬프트·리포트가 지금과 **바이트 단위로 같다**.
- 소리·받아쓴 텍스트를 새로 보내지 않는다. 측정값을 로그에 남기지 않는다.
- 판정 기준: 분당 음절 250 미만 "느림", 250~330 "보통", 330 초과 "빠름" / 긴 쉼 말한 1분당 `longPauses ÷ max(speechSec/60, 0.5)` 1 이하 "적음", 2 이하 "보통", 2 초과 "잦음" / 첫마디 3초 이하 "보통", 초과 "망설임 긺" / 군말 low "적음", normal "보통", high "잦은 경향", null 언급 안 함 / `speechSec` 5초 미만은 "측정 부족" / 1번 답변 기준 대비 1.5배 이상 또는 0.67배 이하이면 "기준 대비 ○배".
- 검증: 항목 0~8, `answer` 1~8·서로 다름·이 면접의 실제 답변 수 이하, `speechSec` 0~600, `syllables` 0~5,000 정수, `longPauses` 0~200 정수, `longestPauseSec` 0~600, `firstWordSec` 0~600, `fillerLevel` `low|normal|high|null`. 위반 → `422 {"error":"invalid","field":"delivery"}`, Claude 미호출, 시도 미증가.
- `done` 면접 재요청은 보관 원문 재전송(본문 무시).
- `tests/test_prompt_parity.py`는 그대로 통과해야 한다. `REPORT_INSTRUCTION`·`report_instruction()`은 바꾸지 않는다.
- 커밋: `feat(backend):`(내부), `feat(api):`(계약·`docs/API.md`).
- 검증 명령(`backend/`에서): `uv run ruff format . && uv run pytest -q && uv run ruff check . && uv run ruff format --check .`

---

### Task 1: 판정 규칙과 측정 블록 — `app/llm/delivery.py`

**Files:**
- Create: `backend/app/llm/delivery.py`
- Test: `backend/tests/test_delivery.py`

**Interfaces:**
- Produces:
  - `AnswerMetrics`(frozen dataclass): `answer: int, speech_sec: float, syllables: int, long_pauses: int, longest_pause_sec: float, first_word_sec: float, filler_level: str | None`
  - `render(metrics: list[AnswerMetrics]) -> str | None` — 측정 블록 문자열. 목록이 비면 `None`. 답변 번호 순으로 한 줄씩.
  - 상수 `MIN_SPEECH_SEC = 5.0`, `SLOW_BELOW = 250`, `FAST_ABOVE = 330`, `PAUSE_FEW_MAX = 1.0`, `PAUSE_NORMAL_MAX = 2.0`, `FIRST_WORD_MAX = 3.0`, `RATIO_HIGH = 1.5`, `RATIO_LOW = 0.67`

- [ ] **Step 1: 실패 테스트 작성** — `backend/tests/test_delivery.py`

```python
from app.llm.delivery import AnswerMetrics, render


def m(answer, speech=60.0, syl=300, pauses=1, longest=2.5, first=1.5, filler="normal"):
    return AnswerMetrics(
        answer=answer,
        speech_sec=speech,
        syllables=syl,
        long_pauses=pauses,
        longest_pause_sec=longest,
        first_word_sec=first,
        filler_level=filler,
    )


def test_empty_is_none():
    assert render([]) is None


def test_one_normal_answer_line():
    assert render([m(1)]) == (
        "[답변별 전달력 측정]\n"
        "답변 1: 분당 300음절(보통), 2초 이상 쉼 1회·말한 1분당 1.0회(적음), "
        "가장 긴 쉼 2.5초, 첫마디까지 1.5초(보통), 군말 보통"
    )


def test_speed_boundaries():
    lines = render([m(1, syl=249), m(2, syl=250), m(3, syl=330), m(4, syl=331)]).splitlines()
    assert "(느림)" in lines[1] and "(보통)" in lines[2]
    assert "분당 330음절(보통)" in lines[3] and "(빠름)" in lines[4]


def test_pause_rate_uses_at_least_half_a_minute():
    # 20초 말하고 2번 쉼 → 2 / max(0.33, 0.5) = 4.0회/분
    line = render([m(1, speech=20.0, syl=100, pauses=2)]).splitlines()[1]
    assert "말한 1분당 4.0회(잦음)" in line
    line = render([m(1, speech=60.0, pauses=2)]).splitlines()[1]
    assert "말한 1분당 2.0회(보통)" in line


def test_first_word_and_filler_labels():
    line = render([m(1, first=3.1, filler="high")]).splitlines()[1]
    assert "첫마디까지 3.1초(망설임 긺)" in line and line.endswith("군말 잦은 경향")
    assert render([m(1, filler="low")]).splitlines()[1].endswith("군말 적음")
    assert "군말" not in render([m(1, filler=None)]).splitlines()[1]


def test_too_short_is_insufficient():
    assert render([m(2, speech=4.9)]).splitlines()[1] == "답변 2: 측정 부족(말한 시간 5초 미만)"


def test_baseline_ratios_against_answer_1():
    # 기준: 300음절/분, 1.0회/분 → 답변 2: 480음절/분(1.6배), 3.0회/분(3.0배)
    lines = render([m(1), m(2, syl=480, pauses=3)]).splitlines()
    assert lines[2].endswith(", 기준 대비 말 속도 1.6배·쉼 3.0배")
    # 0.67배 이하도 표시, 사이는 표시 안 함
    lines = render([m(1), m(2, syl=180), m(3, syl=330)]).splitlines()
    assert lines[2].endswith("기준 대비 말 속도 0.6배")
    assert "기준 대비" not in lines[3]


def test_no_baseline_when_answer_1_missing_or_short_or_zero_pauses():
    assert "기준 대비" not in render([m(2, syl=600)])
    assert "기준 대비" not in render([m(1, speech=3.0), m(2, syl=600)])
    # 기준 쉼이 0이면 쉼 비율은 계산하지 않는다(말 속도는 같으므로 비교 문구 없음)
    lines = render([m(1, pauses=0), m(2, pauses=5)]).splitlines()
    assert "기준 대비" not in lines[2]


def test_lines_are_sorted_by_answer():
    lines = render([m(3), m(1)]).splitlines()
    assert lines[1].startswith("답변 1:") and lines[2].startswith("답변 3:")
```

- [ ] **Step 2: 실패 확인** — Run: `uv run pytest tests/test_delivery.py -q` → FAIL(모듈 없음)

- [ ] **Step 3: 구현** — `backend/app/llm/delivery.py`

```python
"""벤 답변 전달력 판정 (spec 2026-10-16 2.2). 숫자를 정해진 기준표로 판정해 프롬프트용 블록을 만든다.

모델이 숫자를 해석하지 않게 서버가 판정한다. 소리·텍스트는 다루지 않는다(숫자만).
"""

from dataclasses import dataclass

MIN_SPEECH_SEC = 5.0
SLOW_BELOW = 250
FAST_ABOVE = 330
PAUSE_FEW_MAX = 1.0
PAUSE_NORMAL_MAX = 2.0
FIRST_WORD_MAX = 3.0
RATIO_HIGH = 1.5
RATIO_LOW = 0.67

FILLER_LABELS = {"low": "적음", "normal": "보통", "high": "잦은 경향"}


@dataclass(frozen=True)
class AnswerMetrics:
    answer: int
    speech_sec: float
    syllables: int
    long_pauses: int
    longest_pause_sec: float
    first_word_sec: float
    filler_level: str | None


def _per_minute(m: AnswerMetrics) -> int:
    return round(m.syllables / m.speech_sec * 60)


def _pause_rate(m: AnswerMetrics) -> float:
    return m.long_pauses / max(m.speech_sec / 60, 0.5)


def _speed(spm: int) -> str:
    if spm < SLOW_BELOW:
        return "느림"
    return "빠름" if spm > FAST_ABOVE else "보통"


def _pause(rate: float) -> str:
    if rate <= PAUSE_FEW_MAX:
        return "적음"
    return "보통" if rate <= PAUSE_NORMAL_MAX else "잦음"


def _far(ratio: float) -> bool:
    return ratio >= RATIO_HIGH or ratio <= RATIO_LOW


def _line(m: AnswerMetrics, base: AnswerMetrics | None) -> str:
    if m.speech_sec < MIN_SPEECH_SEC:
        return f"답변 {m.answer}: 측정 부족(말한 시간 5초 미만)"
    spm = _per_minute(m)
    rate = _pause_rate(m)
    first = "보통" if m.first_word_sec <= FIRST_WORD_MAX else "망설임 긺"
    parts = [
        f"분당 {spm}음절({_speed(spm)})",
        f"2초 이상 쉼 {m.long_pauses}회·말한 1분당 {rate:.1f}회({_pause(rate)})",
        f"가장 긴 쉼 {m.longest_pause_sec:.1f}초",
        f"첫마디까지 {m.first_word_sec:.1f}초({first})",
    ]
    if m.filler_level is not None:
        parts.append(f"군말 {FILLER_LABELS[m.filler_level]}")
    if base is not None and base.answer != m.answer:
        notes = []
        speed_ratio = spm / _per_minute(base)
        if _far(speed_ratio):
            notes.append(f"말 속도 {speed_ratio:.1f}배")
        base_rate = _pause_rate(base)
        if base_rate > 0 and _far(rate / base_rate):
            notes.append(f"쉼 {rate / base_rate:.1f}배")
        if notes:
            parts.append("기준 대비 " + "·".join(notes))
    return f"답변 {m.answer}: " + ", ".join(parts)


def render(metrics: list[AnswerMetrics]) -> str | None:
    """측정 블록. 1번 답변(자기소개)이 충분히 측정됐으면 그것을 개인 기준으로 쓴다."""
    if not metrics:
        return None
    ordered = sorted(metrics, key=lambda x: x.answer)
    first = ordered[0]
    base = (
        first
        if first.answer == 1 and first.speech_sec >= MIN_SPEECH_SEC and first.syllables > 0
        else None
    )
    return "\n".join(["[답변별 전달력 측정]", *(_line(m, base) for m in ordered)])
```

- [ ] **Step 4: 통과 확인** — 전체 검증 명령, 전부 PASS

- [ ] **Step 5: 커밋**

```bash
git add backend/app/llm/delivery.py backend/tests/test_delivery.py
git commit -m "feat(backend): 벤 전달력 판정 규칙 — 말 속도·쉼·첫마디·군말, 자기소개 기준 비교"
```

---

### Task 2: 벤 리포트 지시문에 측정 블록 붙이기 — `prompts.report_messages`

**Files:**
- Modify: `backend/app/llm/prompts.py` (계층 규율 경로)
- Test: `backend/tests/test_prompts.py`

**Interfaces:**
- Consumes: Task 1 `render()`가 만든 블록 문자열
- Produces: `prompts.DELIVERY_INSTRUCTION: str`, `prompts.report_messages(messages, delivery_block: str | None = None)`

- [ ] **Step 1: 실패 테스트 작성** — `backend/tests/test_prompts.py` 끝에 추가

```python
BLOCK = "[답변별 전달력 측정]\n답변 1: 분당 300음절(보통)"


def test_report_messages_without_block_are_unchanged():
    assert prompts.report_messages(HISTORY, None) == prompts.report_messages(HISTORY)
    assert prompts.report_messages(HISTORY)[-1]["content"] == prompts.report_instruction()


def test_report_messages_append_delivery_after_the_instruction():
    last = prompts.report_messages(HISTORY, BLOCK)[-1]
    assert last == {
        "role": "user",
        "content": f"{prompts.report_instruction()}\n\n{prompts.DELIVERY_INSTRUCTION}\n\n{BLOCK}",
    }
    assert '"delivery"' in prompts.DELIVERY_INSTRUCTION
    assert "경향" in prompts.DELIVERY_INSTRUCTION
```

- [ ] **Step 2: 실패 확인** — `uv run pytest tests/test_prompts.py -q` → FAIL

- [ ] **Step 3: 구현** — `prompts.py`에 상수와 함수 수정

```python
# 벤 전용(로컬 리포트 지시문과 동기화하지 않는다): 브라우저가 잰 전달력 측정이 있을 때만 붙인다
DELIVERY_INSTRUCTION = (
    "아래는 녹음에서 잰 답변별 전달력 수치와 판정입니다. "
    '각 문항 객체에 "delivery" 칸을 더해, 그 문항에 속한 답변(꼬리질문 답 포함)의 전달력을 '
    "한두 문장으로 쓰세요. 판정과 숫자를 근거로 들고, 고칠 방법을 하나 제시하세요. "
    "군말은 단정하지 말고 '경향'으로만 말하세요. "
    '측정이 없는 답변만으로 된 문항에는 "delivery"를 쓰지 마세요.'
)
```

```python
def report_messages(messages: list[Message], delivery_block: str | None = None) -> list[Message]:
    instruction = report_instruction()
    if delivery_block:
        instruction = f"{instruction}\n\n{DELIVERY_INSTRUCTION}\n\n{delivery_block}"
    return [*_history(messages), {"role": "user", "content": instruction}]
```

- [ ] **Step 4: 통과 확인** — 전체 검증 명령, `test_prompt_parity.py` 포함 PASS

- [ ] **Step 5: 커밋**

```bash
git add backend/app/llm/prompts.py backend/tests/test_prompts.py
git commit -m "feat(backend): 벤 리포트 지시문 — 전달력 측정이 있으면 문항별 delivery 칸 요청"
```

---

### Task 3: 계약 — 리포트 요청 `delivery` 본문, 보관함 `delivery` 칸, `docs/API.md`

**Files:**
- Modify: `backend/app/schemas.py`, `backend/app/routers/premium.py`(`make_report`만), `docs/API.md`
- Test: `backend/tests/test_ben_report.py`, `backend/tests/test_archive.py`

**Interfaces:**
- Consumes: Task 1 `AnswerMetrics`, `render`; Task 2 `report_messages(messages, delivery_block)`
- Produces: `schemas.DeliveryMetric`, `schemas.ReportBody`; `ReportItem.delivery: str | None`(None이면 직렬화에서 빠짐)

- [ ] **Step 1: 실패 테스트 작성**

`backend/tests/test_ben_report.py`에 추가:

```python
import pytest

METRIC = {
    "answer": 1,
    "speechSec": 60,
    "syllables": 300,
    "longPauses": 1,
    "longestPauseSec": 2.5,
    "firstWordSec": 1.5,
    "fillerLevel": "normal",
}


def _answered(client, iid, n=1):
    _one_turn(client, iid)
    for i in range(n - 1):
        client.post(f"/api/premium/interviews/{iid}/turns", json={"answer": f"답 {i}"})


def test_report_with_delivery_appends_the_block(client, fake_claude):
    iid = start_ben(client)
    _answered(client, iid, 2)  # 사용자 답변 1개
    fake_claude.replies = [[REPORT_RAW]]
    res = client.post(f"/api/premium/interviews/{iid}/report", json={"delivery": [METRIC]})
    assert sse_events(res.text)[-1] == ("done", {})
    content = fake_claude.calls[-1]["messages"][-1]["content"]
    assert content.startswith(prompts.report_instruction())
    assert prompts.DELIVERY_INSTRUCTION in content
    assert content.endswith("답변 1: 분당 300음절(보통), 2초 이상 쉼 1회·말한 1분당 1.0회(적음), 가장 긴 쉼 2.5초, 첫마디까지 1.5초(보통), 군말 보통")


@pytest.mark.parametrize("body", [None, {}, {"delivery": []}])
def test_report_without_delivery_is_unchanged(client, fake_claude, body):
    iid = start_ben(client)
    _one_turn(client, iid)
    fake_claude.replies = [[REPORT_RAW]]
    url = f"/api/premium/interviews/{iid}/report"
    res = client.post(url) if body is None else client.post(url, json=body)
    assert res.status_code == 200
    assert fake_claude.calls[-1]["messages"][-1] == {
        "role": "user",
        "content": prompts.report_instruction(),
    }


@pytest.mark.parametrize(
    "delivery",
    [
        [{**METRIC, "answer": 2}],  # 실제 답변은 1개
        [METRIC, METRIC],  # 번호 중복
        [{**METRIC, "speechSec": -1}],
        [{**METRIC, "syllables": 5001}],
        [{**METRIC, "fillerLevel": "loud"}],
        [{**METRIC, "answer": i} for i in range(1, 10)],  # 9개
    ],
)
def test_bad_delivery_is_422_without_claude_or_attempt(client, fake_claude, settings, delivery):
    iid = start_ben(client)
    _answered(client, iid, 2)
    calls = len(fake_claude.calls)
    with open_db(settings) as conn:
        before = conn.execute("SELECT attempts FROM premium_interviews WHERE id = ?", (iid,)).fetchone()[0]
    res = client.post(f"/api/premium/interviews/{iid}/report", json={"delivery": delivery})
    assert res.status_code == 422
    assert res.json() == {"error": "invalid", "field": "delivery"}
    assert len(fake_claude.calls) == calls
    with open_db(settings) as conn:
        after = conn.execute("SELECT attempts FROM premium_interviews WHERE id = ?", (iid,)).fetchone()[0]
    assert after == before


def test_done_report_ignores_delivery(client, fake_claude):
    iid = start_ben(client)
    _one_turn(client, iid)
    fake_claude.replies = [[REPORT_RAW]]
    _report(client, iid)
    calls = len(fake_claude.calls)
    res = client.post(f"/api/premium/interviews/{iid}/report", json={"delivery": [METRIC]})
    assert "".join(d["text"] for e, d in sse_events(res.text) if e == "delta") == REPORT_RAW
    assert len(fake_claude.calls) == calls
```

(`_answered(client, iid, 2)`: 첫 턴(질문) + 답변 1개 → 사용자 답변 수 1. `clock` 제한(분당 6회)에 걸리면 `clock.advance(11)`을 끼운다.)

`backend/tests/test_archive.py`에 추가:

```python
def test_report_delivery_round_trips_and_is_absent_when_missing(client):
    signup(client)
    item = {"question": "q", "answerSummary": "a", "feedback": "f"}
    sent = archive_body(report=[{**item, "delivery": "쉼이 잦았습니다."}, item])
    aid = client.post(URL, json=sent).json()["entry"]["id"]
    detail = client.get(f"{URL}/{aid}").json()
    assert detail["report"] == [{**item, "delivery": "쉼이 잦았습니다."}, item]
    assert "delivery" not in detail["report"][1]


def test_report_delivery_is_at_most_2000_chars(client):
    signup(client)
    item = {"question": "q", "answerSummary": "a", "feedback": "f", "delivery": "가" * 2001}
    res = client.post(URL, json=archive_body(report=[item]))
    assert res.status_code == 422
```

(`archive_body(**over)`가 `report` 덮어쓰기를 받는지 확인하고, 아니면 dict를 만들어 바꿔 넣는다. 422 본문 형식은 기존 보관함 검증 테스트와 맞춘다.)

- [ ] **Step 2: 실패 확인** — `uv run pytest tests/test_ben_report.py tests/test_archive.py -q` → FAIL

- [ ] **Step 3: 구현**

`backend/app/schemas.py` — `ReportItem` 수정(직렬화에서 None이면 빠지게), 새 모델 둘:

```python
class ReportItem(BaseModel):
    question: str
    answerSummary: str
    feedback: str
    # 벤 전달력 피드백(2026-10-16). 없으면 칸 자체를 내보내지 않는다 — 예전 기록과 같은 모양
    delivery: str | None = Field(default=None, max_length=2000)

    @model_serializer(mode="wrap")
    def _omit_missing_delivery(self, handler: SerializerFunctionWrapHandler) -> dict[str, Any]:
        data = handler(self)
        if data.get("delivery") is None:
            data.pop("delivery", None)
        return data
```

```python
class DeliveryMetric(BaseModel):
    """브라우저가 잰 답변 하나의 전달력(spec 2026-10-16 2.1). 숫자만."""

    answer: int = Field(ge=1, le=8)
    speechSec: float = Field(ge=0, le=600)
    syllables: int = Field(ge=0, le=5000)
    longPauses: int = Field(ge=0, le=200)
    longestPauseSec: float = Field(ge=0, le=600)
    firstWordSec: float = Field(ge=0, le=600)
    fillerLevel: Literal["low", "normal", "high"] | None = None


class ReportBody(BaseModel):
    delivery: list[DeliveryMetric] = Field(default_factory=list, max_length=8)

    @field_validator("delivery")
    @classmethod
    def _answers_are_unique(cls, v: list[DeliveryMetric]) -> list[DeliveryMetric]:
        if len({m.answer for m in v}) != len(v):
            raise ValueError("duplicate answer")
        return v
```

(필요한 import: `model_serializer`, `SerializerFunctionWrapHandler`, `Any`, `Literal` — 이미 있는 것은 그대로.)

검증 오류 응답의 `field`가 `delivery`로 나오는지 확인한다(`app/errors.py`는 loc에서 가장 깊은 문자열 이름을 쓴다 — 항목 안 칸 오류면 `speechSec` 등이 될 수 있다). 스펙은 `field: "delivery"`이므로, 그렇지 않으면 `make_report`에서 본문을 `dict | None`으로 받아 `ReportBody.model_validate`를 직접 부르고 `ValidationError`를 `ApiError(422, "invalid", field="delivery")`로 바꾼다.

`backend/app/routers/premium.py` — `make_report`:

```python
def make_report(
    interview_id: str,
    user: PremiumUser,
    conn: Db,
    request: Request,
    body: dict[str, Any] | None = None,
) -> StreamingResponse:
    _ben_rate_limit(request, user)
    interview = _owned(conn, user, interview_id)
    if interview.status == "done":
        ...  # 그대로(본문 무시)
    if interview.model_turns == 0:
        raise ApiError(409, "interview_not_started")
    block = _delivery_block(body, interview)
    claude = _claude(request)
    _count_attempt(conn, interview)
    system = prompts.build_system(interview.track, interview.inputs)
    messages = prompts.report_messages(interview.messages, block)
```

```python
def _delivery_block(body: dict[str, Any] | None, interview: PremiumInterview) -> str | None:
    """리포트 본문의 전달력 측정을 검증해 프롬프트 블록으로. 없으면 None(지금과 같음)."""
    try:
        parsed = ReportBody.model_validate(body or {})
    except ValidationError:
        raise ApiError(422, "invalid", field="delivery") from None
    answers = sum(1 for m in interview.messages if m["role"] == "user")
    if any(m.answer > answers for m in parsed.delivery):
        raise ApiError(422, "invalid", field="delivery")
    return delivery.render(
        [
            delivery.AnswerMetrics(
                answer=m.answer,
                speech_sec=m.speechSec,
                syllables=m.syllables,
                long_pauses=m.longPauses,
                longest_pause_sec=m.longestPauseSec,
                first_word_sec=m.firstWordSec,
                filler_level=m.fillerLevel,
            )
            for m in parsed.delivery
        ]
    )
```

(import: `from pydantic import ValidationError`, `from typing import Any`, `from app.llm import delivery`, `from app.schemas import ReportBody`. `body: dict | None = None`은 FastAPI가 JSON 본문으로 받는다 — 기존 `TurnBody | None` 패턴과 같이 본문 없는 요청도 받아야 한다. 동작이 다르면 `Body(default=None)`을 쓴다.)

`docs/API.md` — **3) 리포트** 절 첫 줄 "본문 없음."을 다음으로 바꾸고 아래 설명 추가:

```markdown
본문은 선택(2026-10-16). 없거나 `{}`이면 지금과 같다. 벤 면접에서 브라우저가 잰 답변별 전달력 측정을 보낼 수 있다(숫자만, 소리는 보내지 않는다):

```jsonc
{ "delivery": [
  { "answer": 1, "speechSec": 42.5, "syllables": 210, "longPauses": 3,
    "longestPauseSec": 4.1, "firstWordSec": 2.8, "fillerLevel": "high" }  // low|normal|high|null
] }
```
- 검증: 항목 0~8, `answer` 1~8·서로 다름·이 면접의 실제 답변 수 이하, `speechSec`·`longestPauseSec`·`firstWordSec` 0~600, `syllables` 0~5,000, `longPauses` 0~200. 위반 → `422 {"error":"invalid","field":"delivery"}`(Claude를 부르지 않고 시도도 세지 않음). 타이핑 답변·측정 불가 답변은 빼고 보낸다.
- 측정이 있으면 서버가 기준표(말 속도 250~330음절/분 보통, 2초 이상 쉼 말한 1분당 2회 이하 보통, 첫마디 3초 이하 보통, 군말은 경향, 말한 시간 5초 미만은 측정 부족, 1번 답변 대비 1.5배·0.67배)로 판정해 벤에게 주고, 벤은 리포트 문항마다 선택 칸 `delivery`(전달력 피드백 한두 문장)를 더 쓴다: `{question, answerSummary, feedback, delivery?}`.
- 이미 `done`인 면접은 보관한 원문을 다시 보내고 본문은 무시한다.
```

보관함 `ArchiveCreate`·`ArchiveDetail` 설명의 `report` 문항 형식에 `delivery?`(선택, 최대 2,000자, 없으면 칸 없음)를 추가한다.

- [ ] **Step 4: 통과 확인** — 전체 검증 명령, 전부 PASS(기존 리포트·보관함 테스트 포함)

- [ ] **Step 5: 커밋**

```bash
git add backend/app/schemas.py backend/app/routers/premium.py backend/tests/test_ben_report.py backend/tests/test_archive.py docs/API.md
git commit -m "feat(api): 벤 리포트 요청에 전달력 측정(delivery) 선택 본문, 리포트·보관함 문항 delivery 칸"
```

---

## 마무리 (컨트롤러)

- 전체 검증 후 PR `feature/delivery-analysis` → `dev`, 제목 `feat(api): 벤 답변 전달력 분석 1단계 — 측정값 받아 규칙 판정, 리포트 delivery (#91)`, 본문에 `prompts.py` 전후 비교, 리뷰어 @leemonta9482.
- 머지 → demomo 자동 배포 → curl로 측정값을 넣은 벤 리포트 1회 확인.
