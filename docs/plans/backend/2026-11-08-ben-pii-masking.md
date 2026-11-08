# 벤 개인정보 가림 — 작업지시서

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 벤이 Claude로 보내는 시스템 프롬프트·메시지에서 직접 식별 정보를 `[종류N]` 표시로 바꾸고, Claude 응답(스트리밍·리포트 JSON)을 사용자에게 보내거나 저장하기 전에 원래 값으로 되돌린다.

**Architecture:** `app/llm/pii.py`의 `Masker`가 한 요청 동안 표시↔원래 값 짝을 쥔다(저장 안 함). 라우터가 Claude 호출 세 곳 앞에서 `mask_system`·`mask_messages`로 가리고, `Masker.stream()`으로 조각을 되돌리며 SSE·DB로 보낸다. 가림이 켜져 있으면 `build_system`이 이력서 블록에 알림 한 줄을 더한다.

**Tech Stack:** Python 3.12 표준 `re`·`json`, FastAPI, pytest, ruff. 새 의존성 없음.

- spec: `docs/specs/backend/2026-11-08-ben-pii-masking-design.md`
- 브랜치: `feature/ben-pii-mask` (base `dev`)
- 명령은 모두 `backend/`에서 실행한다.

## Global Constraints

- 가리는 것: 이름·전화·이메일·주소·생년월일·주민번호·계좌/카드·개인 링크. 표시 `[이름N]` `[전화N]` `[이메일N]` `[주소N]` `[생년월일N]` `[주민번호N]` `[계좌N]` `[링크N]`.
- 가리지 않는 것: 학교·회사·프로젝트 이름, 나이, 지원 회사·직무, 성향 설정, 회사 브리핑의 의미.
- 처리 순서: 주민번호 → 카드·계좌 → 전화 → 이메일 → 링크 → 생년월일 → 주소 → 이름. 겹치면 먼저 잡은 쪽. 이미 있는 표시 안은 건드리지 않는다.
- 같은 값은 같은 표시(숫자류는 숫자만, `+82`는 `0`으로, 이메일·링크는 소문자·스킴/`www.` 제거로 비교).
- 번호는 한 요청 안에서 시스템 블록 → 메시지 순서, 글 안에서는 앞에서부터 처음 나온 차례.
- 리포트(버전 1·2) 되돌리기는 JSON 문자열 이스케이프. 모르는 표시는 그대로.
- 가리기 예외 → Claude를 부르지 않고 `claude_error`. 원문을 보내지 않는다.
- 설정 `BEN_PII_MASK`: 환경변수 기본 켜짐(`Settings.from_env` 기본 True). `Settings` 직접 생성 기본값은 False(기존 테스트의 프롬프트 비교 유지 — 새 테스트는 `replace(settings, ben_pii_mask=True)`).
- 꺼져 있으면 프롬프트·동작이 지금과 글자까지 같다.
- 로그: 종류별 개수만. 값·이력서·대화 본문 금지.
- `/api`·SSE·DB 스키마·`docs/API.md`·`frontend/` 변경 없음.

## 파일 지도

| 파일 | 책임 |
|---|---|
| `app/llm/pii.py` (새) | 찾기 규칙, `Masker`(가리기·되돌리기·스트림), `names_in` |
| `app/llm/prompts.py` (수정) | `MASK_NOTICE`, `build_system(..., masked=False)`, `report_system(..., masked=False)` |
| `app/config.py` (수정) | `ben_pii_mask` |
| `app/routers/premium.py` (수정) | `_masker`, `_masked`, 턴·리포트 1·2에서 가리고 되돌리기 |
| `deploy/docker-compose.yml`·`deploy/README.md` (수정) | `BEN_PII_MASK` |

---

### Task 1: 찾기 규칙과 가리기 (`pii.py`)

**Files:**
- Create: `backend/app/llm/pii.py`
- Test: `backend/tests/test_pii_mask.py`

**Interfaces:**
- Produces: `Masker(names: Iterable[str] = ())` — `.mask(text: str) -> str`, `.counts: Counter[str]`(종류별 가린 횟수), 내부 `_values: dict[str, str]`(표시 → 원래 값); `names_in(text: str) -> list[str]`; `PLACEHOLDER: re.Pattern`

- [ ] **Step 1: 실패 테스트**

```python
# backend/tests/test_pii_mask.py
import pytest

from app.llm.pii import Masker, names_in

RESUME = """이름: 홍길동
생년월일: 1999.03.15
연락처: 010-1234-5678 / gildong@Example.com
주소: 서울특별시 강남구 테헤란로 123, 101동 1203호
GitHub: https://github.com/gildong-hong
블로그: gildong.tistory.com
학력: 한국대학교 컴퓨터공학과 (2018.03 ~ 2024.02)
프로젝트: 결제 서비스 데모 https://pay-demo.example.com (2023.05.20 수상)
"""


def test_resume_is_masked_in_order():
    m = Masker(["홍길동"])
    got = m.mask(RESUME)
    assert got.splitlines()[:6] == [
        "이름: [이름1]",
        "생년월일: [생년월일1]",
        "연락처: [전화1] / [이메일1]",
        "주소: [주소1]",
        "GitHub: [링크1]",
        "블로그: [링크2]",
    ]
    # 학교·라벨 없는 날짜·회사/데모 링크는 남는다
    assert "한국대학교 컴퓨터공학과 (2018.03 ~ 2024.02)" in got
    assert "https://pay-demo.example.com (2023.05.20 수상)" in got
    assert m.counts == {"이름": 1, "생년월일": 1, "전화": 1, "이메일": 1, "주소": 1, "링크": 2}


def test_same_value_same_placeholder_across_texts():
    m = Masker(["홍길동"])
    assert m.mask("010-1234-5678") == "[전화1]"
    assert m.mask("01012345678로 연락") == "[전화1]로 연락"
    assert m.mask("+82 10-1234-5678") == "[전화1]"
    assert m.mask("GILDONG@example.com") == "[이메일1]"
    assert m.mask("gildong@example.com, a@b.co") == "[이메일1], [이메일2]"


@pytest.mark.parametrize(
    "text",
    [
        "매출 2,000,000원, 사용자 1234-5678명",
        "2023.05.20에 배포",
        "서울 거주, 경기도 성남시 근무",
        "https://www.toss.im/career",
        "지원자로서 지원 동기",
        "주문번호 2023-1234-5678",
    ],
)
def test_things_that_must_stay(text):
    assert Masker(["지원"]).mask(text) == text


def test_two_letter_name_not_inside_words():
    m = Masker(["이산"])
    assert m.mask("이산이 말했다") == "[이름1]이 말했다"
    assert m.mask("분산이산화") == "분산이산화"


def test_given_name_only_with_honorific():
    m = Masker(["홍길동"])
    assert m.mask("길동님, 자기소개 부탁드립니다") == "[이름1]님, 자기소개 부탁드립니다"
    assert m.mask("길동씨") == "[이름1]씨"
    assert m.mask("길동 프로젝트") == "길동 프로젝트"


def test_english_name_word_boundary_case_insensitive():
    m = Masker(["Gildong Hong"])
    assert m.mask("I am GILDONG HONG.") == "I am [이름1]."
    assert m.mask("Gildong Hongkong") == "Gildong Hongkong"


def test_rrn_card_account():
    m = Masker()
    assert m.mask("주민번호 990315-1234567") == "주민번호 [주민번호1]"
    assert m.mask("카드 1234-5678-9012-3456") == "카드 [계좌1]"
    assert m.mask("입금 계좌: 국민은행 123456-01-234567") == "입금 계좌: 국민은행 [계좌2]"
    assert m.mask("학번 123456-01-234567") == "학번 123456-01-234567"


def test_landline_needs_hyphens():
    m = Masker()
    assert m.mask("02-123-4567") == "[전화1]"
    assert m.mask("021234567") == "021234567"


def test_birth_and_address_need_labels():
    m = Masker()
    assert m.mask("생일 99년 3월 15일") == "생일 [생년월일1]"
    assert m.mask("Birth: 1999-03-15") == "Birth: [생년월일2]"
    assert m.mask("거주지: 부산 해운대구 우동 1408") == "거주지: [주소1]"
    assert m.mask("부산광역시 해운대구 센텀중앙로 79 근처") == "[주소2] 근처"


def test_existing_placeholders_are_untouched():
    m = Masker(["홍길동"])
    assert m.mask("[이름1]님 010-1234-5678") == "[이름1]님 [전화1]"


def test_personal_link_kinds():
    m = Masker()
    for url in [
        "github.com/abc", "https://velog.io/@abc/post", "blog.naver.com/abc",
        "https://www.linkedin.com/in/abc-1", "abc.notion.site/Resume-1", "abc.github.io",
        "https://brunch.co.kr/@abc", "medium.com/@abc", "instagram.com/abc", "gitlab.com/abc",
    ]:
        assert m.mask(url).startswith("[링크"), url


def test_names_in_resume_labels():
    assert names_in("이름: 홍길동\n성명 : 김철수\nName: Gildong Hong\n이름 없음") == [
        "홍길동", "김철수", "Gildong Hong",
    ]
```

- [ ] **Step 2: 실패 확인** — `uv run pytest tests/test_pii_mask.py -q` → ModuleNotFoundError

- [ ] **Step 3: 구현**

```python
# backend/app/llm/pii.py
"""벤 개인정보 가림 (spec 2026-11-08). Claude로 보낼 때만 가리고 응답에서 되돌린다.

확실한 것만 가린다: 모양이 정해진 정보는 규칙, 이름은 이미 아는 이름. 짝은 한 요청 동안만 쥔다."""

import json
import re
from collections import Counter
from collections.abc import Iterable, Iterator
from typing import Any

PLACEHOLDER = re.compile(r"\[(이름|전화|이메일|주소|생년월일|주민번호|계좌|링크)(\d+)\]")
_PARTIAL = re.compile(r"\[[가-힣]{0,4}\d{0,3}$")
HOLD_MAX = 10

_RRN = re.compile(r"(?<!\d)\d{6}\s?-\s?[1-8]\d{6}(?!\d)")
_CARD = re.compile(r"(?<!\d)\d{4}[- ]\d{4}[- ]\d{4}[- ]\d{4}(?!\d)")
_ACCOUNT_LABEL = re.compile(r"계좌|은행|입금")
_ACCOUNT = re.compile(r"(?<![\d-])\d[\d-]{8,18}\d(?![\d-])")
_MOBILE = re.compile(r"(?<![\d+])(?:\+82[ -]?|0)1[016789][ .-]?\d{3,4}[ .-]?\d{4}(?!\d)")
_LANDLINE = re.compile(r"(?<!\d)0(?:2|[3-6][1-5]|70)-\d{3,4}-\d{4}(?!\d)")
_EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}")
_LINK = re.compile(
    r"(?:https?://)?(?:www\.)?(?:"
    r"(?:github\.com|gitlab\.com|instagram\.com|blog\.naver\.com)/[A-Za-z0-9_.-]+"
    r"|linkedin\.com/in/[A-Za-z0-9_%.-]+"
    r"|(?:velog\.io|brunch\.co\.kr|medium\.com)/@[A-Za-z0-9_.-]+"
    r"|notion\.so/[A-Za-z0-9_.-]+"
    r"|[A-Za-z0-9-]+\.(?:tistory\.com|notion\.site|github\.io)"
    r")[^\s)\]>\"',]*",
    re.I,
)
_BIRTH_LABEL = re.compile(r"생년월일|생일|출생|birth|dob", re.I)
_DATE = re.compile(r"(?<!\d)(?:19|20)?\d{2}\s*[./년-]\s*\d{1,2}\s*[./월-]\s*\d{1,2}(?:\s*일)?(?!\d)")
_ROAD = re.compile(
    r"[가-힣]{2,}(?:특별시|광역시|특별자치시|특별자치도|시|도)\s+[가-힣]+(?:시|군|구)"
    r"(?:\s+[가-힣]+구)?\s+[가-힣0-9]+(?:로|길)\s*\d+(?:-\d+)?"
    r"(?:[ ,]+[^\n,]{0,20}?\d+동\s*\d+호)?"
)
_ADDRESS_LABEL = re.compile(r"(?:주소|거주지|address)\s*[:：]\s*(\S[^\n]*?)\s*$", re.I | re.M)
_NAME_LABEL = re.compile(
    r"(?:이름|성명|name)\s*[:：]\s*([가-힣]{2,4}|[A-Za-z]+(?: [A-Za-z]+){1,2})(?![가-힣A-Za-z])",
    re.I,
)
_LINE = re.compile(r"[^\n]+")

Span = tuple[int, int, str, str, str]  # 시작, 끝, 종류, 비교 키, 원래 값


def names_in(text: str) -> list[str]:
    """이력서의 "이름·성명·Name:" 줄에서 이름을 꺼낸다(나온 순서, 중복 제거)."""
    return list(dict.fromkeys(m.group(1) for m in _NAME_LABEL.finditer(text or "")))


def _name_patterns(name: str) -> list[re.Pattern[str]]:
    if re.fullmatch(r"[가-힣]{2,4}", name):
        pats = [re.compile(("(?<![가-힣])" if len(name) == 2 else "") + re.escape(name))]
        if len(name) == 3:  # 성 뺀 이름은 "님·씨"가 붙을 때만
            pats.append(re.compile(r"(?<![가-힣])" + re.escape(name[1:]) + r"(?=\s?(?:님|씨))"))
        return pats
    if re.fullmatch(r"[A-Za-z]+(?: [A-Za-z]+){1,2}", name):
        return [re.compile(r"(?<![A-Za-z])" + re.escape(name) + r"(?![A-Za-z])", re.I)]
    return []


def _digits(value: str) -> str:
    d = re.sub(r"\D", "", value)
    return "0" + d[2:] if d.startswith("82") else d


def _link_key(value: str) -> str:
    return re.sub(r"^(?:https?://)?(?:www\.)?", "", value.lower()).rstrip("/")


class Masker:
    """한 요청 동안 표시↔원래 값 짝을 쥔다. 같은 순서로 부르면 같은 번호가 나온다."""

    def __init__(self, names: Iterable[str] = ()) -> None:
        clean = dict.fromkeys(n.strip() for n in names if n and n.strip())
        self._names = [(n, p) for n in clean for p in _name_patterns(n)]
        self._placeholders: dict[tuple[str, str], str] = {}
        self._values: dict[str, str] = {}
        self._next: Counter[str] = Counter()
        self.counts: Counter[str] = Counter()

    # ── 찾기 ──

    def _spans(self, text: str) -> list[Span]:
        taken: list[tuple[int, int]] = [m.span() for m in PLACEHOLDER.finditer(text)]
        out: list[Span] = []

        def add(start: int, end: int, kind: str, key: str) -> None:
            if any(start < e and s < end for s, e in taken):
                return
            taken.append((start, end))
            out.append((start, end, kind, key, text[start:end]))

        for m in _RRN.finditer(text):
            add(*m.span(), "주민번호", _digits(m.group()))
        for m in _CARD.finditer(text):
            add(*m.span(), "계좌", _digits(m.group()))
        for line in _LINE.finditer(text):
            if _ACCOUNT_LABEL.search(line.group()):
                for m in _ACCOUNT.finditer(line.group()):
                    if 10 <= len(_digits(m.group())) <= 16:
                        s = line.start() + m.start()
                        add(s, s + len(m.group()), "계좌", _digits(m.group()))
        for rx in (_MOBILE, _LANDLINE):
            for m in rx.finditer(text):
                add(*m.span(), "전화", _digits(m.group()))
        for m in _EMAIL.finditer(text):
            add(*m.span(), "이메일", m.group().lower())
        for m in _LINK.finditer(text):
            add(*m.span(), "링크", _link_key(m.group()))
        for line in _LINE.finditer(text):
            if _BIRTH_LABEL.search(line.group()):
                for m in _DATE.finditer(line.group()):
                    s = line.start() + m.start()
                    add(s, s + len(m.group()), "생년월일", re.sub(r"\D", "", m.group()))
        for m in _ROAD.finditer(text):
            add(*m.span(), "주소", m.group())
        for m in _ADDRESS_LABEL.finditer(text):
            add(*m.span(1), "주소", m.group(1))
        for name, pat in self._names:
            for m in pat.finditer(text):
                add(*m.span(), "이름", name)
        return sorted(out)

    def _placeholder(self, kind: str, key: str, value: str) -> str:
        found = self._placeholders.get((kind, key))
        if found is None:
            self._next[kind] += 1
            found = f"[{kind}{self._next[kind]}]"
            self._placeholders[(kind, key)] = found
            # 이름은 성 뺀 꼴로 처음 나와도 되돌릴 때 전체 이름을 쓴다
            self._values[found] = key if kind == "이름" else value
        return found

    def mask(self, text: str) -> str:
        if not text:
            return text
        parts: list[str] = []
        last = 0
        for start, end, kind, key, value in self._spans(text):
            parts.append(text[last:start])
            parts.append(self._placeholder(kind, key, value))
            self.counts[kind] += 1
            last = end
        parts.append(text[last:])
        return "".join(parts)
```

- [ ] **Step 4: 통과 확인** — `uv run pytest tests/test_pii_mask.py -q`. 실패하는 경우 정규식을 고치되 테스트의 기대값(spec 3절)은 바꾸지 않는다. 기대값이 spec과 어긋난다고 판단되면 멈추고 보고한다.

- [ ] **Step 5: 커밋**

```bash
uv run ruff check . && uv run ruff format .
git add app/llm/pii.py tests/test_pii_mask.py
git commit -m "feat(backend): 개인정보 찾기 규칙과 가리기 — 이름·전화·이메일·주소·생년월일·주민번호·계좌·개인 링크"
```

---

### Task 2: 되돌리기·스트림·요청 단위 가리기

**Files:**
- Modify: `backend/app/llm/pii.py`
- Test: `backend/tests/test_pii_unmask.py`

**Interfaces:**
- Consumes: `Masker`, `PLACEHOLDER`, `_PARTIAL`, `HOLD_MAX` (Task 1)
- Produces: `Masker.unmask(text: str, *, json_escape: bool = False) -> str`, `Masker.stream(*, json_escape: bool = False) -> StreamUnmask` (`.feed(chunk: str) -> str`, `.flush() -> str`), `Masker.mask_system(blocks: list[dict]) -> list[dict]`, `Masker.mask_messages(messages: list[dict]) -> list[dict]`

- [ ] **Step 1: 실패 테스트**

```python
# backend/tests/test_pii_unmask.py
import json

from app.llm.pii import Masker


def _m():
    m = Masker(["홍길동"])
    m.mask('홍길동 010-1234-5678 주소: 서울 "우리"동 3')
    return m


def test_unmask_plain_and_unknown():
    m = _m()
    assert m.unmask("[이름1]님, [전화1]로 연락드릴게요. [이름3]") == (
        "홍길동님, 010-1234-5678로 연락드릴게요. [이름3]"
    )


def test_unmask_json_escapes_values():
    m = _m()
    raw = '[{"feedback": "[주소1]에서 오셨군요"}]'
    got = m.unmask(raw, json_escape=True)
    assert json.loads(got) == [{"feedback": '서울 "우리"동 3에서 오셨군요'}]


def test_stream_joins_split_placeholders():
    m = _m()
    s = m.stream()
    out = [s.feed("안녕하세요 [이"), s.feed("름"), s.feed("1]님. 다음 [전"), s.feed("화1] 확인"), s.flush()]
    assert "".join(out) == "안녕하세요 홍길동님. 다음 010-1234-5678 확인"
    assert out[0] == "안녕하세요 "


def test_stream_releases_non_placeholder_bracket():
    s = _m().stream()
    assert s.feed("배열 [") == "배열 "
    assert s.feed("0] 값") == "[0] 값"
    assert s.flush() == ""


def test_stream_flushes_tail():
    s = _m().stream()
    assert s.feed("끝 [이름") == "끝 "
    assert s.flush() == "[이름"


def test_mask_system_and_messages_keep_shape_and_order():
    m = Masker(["홍길동"])
    system = [
        {"type": "text", "text": "규칙"},
        {"type": "text", "text": "이력서\n홍길동 010-1234-5678", "cache_control": {"type": "ephemeral"}},
    ]
    msgs = [
        {"role": "user", "content": "시작"},
        {"role": "assistant", "content": "홍길동님 소개해 주세요"},
        {"role": "user", "content": "제 메일은 a@b.co 입니다"},
    ]
    got_s = m.mask_system(system)
    got_m = m.mask_messages(msgs)
    assert got_s[1] == {
        "type": "text", "text": "이력서\n[이름1] [전화1]", "cache_control": {"type": "ephemeral"},
    }
    assert [x["content"] for x in got_m] == ["시작", "[이름1]님 소개해 주세요", "제 메일은 [이메일1] 입니다"]
    assert system[1]["text"].endswith("010-1234-5678")  # 원본은 그대로


def test_numbering_is_stable_when_history_grows():
    system = [{"type": "text", "text": "홍길동 010-1234-5678"}]
    turn1 = [{"role": "user", "content": "a@b.co"}]
    turn2 = [*turn1, {"role": "user", "content": "c@d.co 그리고 a@b.co"}]
    m1, m2 = Masker(["홍길동"]), Masker(["홍길동"])
    s1, s2 = m1.mask_system(system), m2.mask_system(system)
    assert s1 == s2
    assert m2.mask_messages(turn2)[0] == m1.mask_messages(turn1)[0]
    assert m2.mask_messages(turn2)[1]["content"] == "[이메일2] 그리고 [이메일1]"
```

- [ ] **Step 2: 실패 확인** — `uv run pytest tests/test_pii_unmask.py -q`

- [ ] **Step 3: 구현** — `Masker`에 메서드 추가, 모듈에 `StreamUnmask`:

```python
    # ── 되돌리기 ──

    def unmask(self, text: str, *, json_escape: bool = False) -> str:
        def sub(m: re.Match[str]) -> str:
            value = self._values.get(m.group(0))
            if value is None:  # Claude가 지어낸 표시는 그대로
                return m.group(0)
            return json.dumps(value, ensure_ascii=False)[1:-1] if json_escape else value

        return PLACEHOLDER.sub(sub, text)

    def stream(self, *, json_escape: bool = False) -> "StreamUnmask":
        return StreamUnmask(self, json_escape)

    # ── 요청 단위 ──

    def mask_system(self, blocks: list[dict[str, Any]]) -> list[dict[str, Any]]:
        return [{**b, "text": self.mask(b["text"])} if "text" in b else dict(b) for b in blocks]

    def mask_messages(self, messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
        out = []
        for msg in messages:
            content = msg.get("content")
            out.append({**msg, "content": self.mask(content)} if isinstance(content, str) else dict(msg))
        return out


class StreamUnmask:
    """조각 끝의 표시 앞부분(최대 HOLD_MAX자)을 붙잡아 다음 조각과 합쳐 되돌린다."""

    def __init__(self, masker: Masker, json_escape: bool) -> None:
        self._masker = masker
        self._json = json_escape
        self._buf = ""

    def feed(self, chunk: str) -> str:
        text = self._buf + chunk
        hold = _PARTIAL.search(text)
        if hold is not None and len(text) - hold.start() <= HOLD_MAX:
            self._buf, text = text[hold.start() :], text[: hold.start()]
        else:
            self._buf = ""
        return self._masker.unmask(text, json_escape=self._json)

    def flush(self) -> str:
        text, self._buf = self._buf, ""
        return self._masker.unmask(text, json_escape=self._json)
```

(`Iterator` import가 쓰이지 않으면 지운다.)

- [ ] **Step 4: 통과 확인** — `uv run pytest tests/test_pii_mask.py tests/test_pii_unmask.py -q`

- [ ] **Step 5: 커밋**

```bash
uv run ruff check . && uv run ruff format .
git add app/llm/pii.py tests/test_pii_unmask.py
git commit -m "feat(backend): 가린 표시 되돌리기 — 스트리밍 조각 합치기, 리포트 JSON 이스케이프"
```

---

### Task 3: 프롬프트 알림 줄과 설정

**Files:**
- Modify: `backend/app/llm/prompts.py` (`MASK_NOTICE`, `build_system`, `report_system`)
- Modify: `backend/app/config.py` (`ben_pii_mask`)
- Modify: `deploy/docker-compose.yml`, `deploy/README.md`
- Test: `backend/tests/test_prompts.py`(추가), `backend/tests/test_config.py`(추가)

**Interfaces:**
- Produces: `prompts.MASK_NOTICE: str`, `build_system(track, inputs, briefing=None, *, masked: bool = False)`, `report_system(track, inputs, briefing, *, masked: bool = False)`, `Settings.ben_pii_mask: bool = False`(직접 생성), `from_env` 기본 True

- [ ] **Step 1: 실패 테스트**

```python
# tests/test_prompts.py에 추가
from tests.helpers import COMPANY_START


def _company_inputs():
    return {"resumeText": COMPANY_START["resumeText"], "company": COMPANY_START["company"]}


def test_masked_adds_notice_only_to_resume_block():
    plain = prompts.build_system("company", _company_inputs())
    masked = prompts.build_system("company", _company_inputs(), masked=True)
    assert masked[:-1] == plain[:-1]
    assert masked[-1]["text"] == plain[-1]["text"].replace(
        prompts.DATA_NOTICE, f"{prompts.DATA_NOTICE}\n{prompts.MASK_NOTICE}", 1
    )
    assert masked[-1]["cache_control"] == {"type": "ephemeral"}


def test_mask_notice_text():
    assert "[이름1]" in prompts.MASK_NOTICE and "추측" in prompts.MASK_NOTICE


def test_report_system_passes_masked():
    got = prompts.report_system("company", _company_inputs(), None, masked=True)
    assert prompts.MASK_NOTICE in got[-1]["text"]
```

```python
# tests/test_config.py에 추가
def test_ben_pii_mask_defaults_on_from_env():
    assert Settings.from_env({}).ben_pii_mask is True
    assert Settings.from_env({"BEN_PII_MASK": "false"}).ben_pii_mask is False
```

- [ ] **Step 2: 실패 확인** — `uv run pytest tests/test_prompts.py tests/test_config.py -q`

- [ ] **Step 3: 구현**

`prompts.py` `DATA_NOTICE` 아래:

```python
# 벤 개인정보 가림(spec 2026-11-08): 켜져 있을 때만 이력서 블록에 붙는다
MASK_NOTICE = (
    "자료와 대화의 [이름1]·[전화1] 같은 표시는 가린 개인정보입니다. "
    "표시를 그대로 써도 되며, 원래 값을 추측하거나 묻지 마세요."
)
```

`build_system` 시그니처에 `*, masked: bool = False`를 더하고 이력서 블록을:

```python
    notice = f"{DATA_NOTICE}\n{MASK_NOTICE}" if masked else DATA_NOTICE
    blocks.append(
        {
            "type": "text",
            "text": f"{notice}\n{heading}\n{inputs['resumeText']}",
            "cache_control": {"type": "ephemeral"},
        }
    )
```

`report_system(track, inputs, briefing, *, masked: bool = False)`가 두 `build_system` 호출에 `masked=masked`를 넘긴다.

`config.py`: `ben_pii_mask: bool = False` 칸(직접 생성 기본은 꺼짐 — 주석: "운영 기본은 from_env에서 켜짐"), `from_env`에 `ben_pii_mask=_parse_bool(e.get("BEN_PII_MASK"), default=True),`.

`deploy/docker-compose.yml` api 환경 `BEN_REPORT_V2` 근처:

```yaml
      # 벤 개인정보 가림(spec 2026-11-08). 기본 켜짐, 문제 있으면 false
      BEN_PII_MASK: ${BEN_PII_MASK:-true}
```

`deploy/README.md` 환경변수 표:

```markdown
| `BEN_PII_MASK` | `true` | 벤이 Claude로 보낼 때 이름·전화·이메일·주소·생년월일·주민번호·계좌·개인 링크를 가리고 응답에서 되돌린다. `false`면 끈다 |
```

- [ ] **Step 4: 통과 확인** — `uv run pytest -q` 전체(기존 `ben_prompts_before_settings.json` 비교가 그대로 통과해야 한다 — `masked` 기본 False).

- [ ] **Step 5: 커밋**

```bash
uv run ruff check . && uv run ruff format .
git add app/llm/prompts.py app/config.py tests/test_prompts.py tests/test_config.py ../deploy/docker-compose.yml ../deploy/README.md
git commit -m "feat(backend): 가림이 켜지면 벤에게 표시 알림 한 줄, BEN_PII_MASK 설정"
```

---

### Task 4: 라우터 — 턴·리포트 1·2에서 가리고 되돌리기

**Files:**
- Modify: `backend/app/routers/premium.py`
- Test: `backend/tests/test_ben_pii.py` (새)

**Interfaces:**
- Consumes: `pii.Masker`, `pii.names_in`, `Masker.mask_system/mask_messages/stream`, `build_system(..., masked=)`, `report_system(..., masked=)`, `Settings.ben_pii_mask`
- Produces: `_masker(settings, user, interview) -> pii.Masker | None`, `_masked(masker, system, messages) -> tuple[list, list]`

- [ ] **Step 1: 실패 테스트** — 기존 라우터 테스트 도우미를 쓴다(`tests/helpers.py`의 `login_admin`, `COMPANY_START`, `ADMISSION_START`, `open_db`; SSE 파싱은 `tests/test_ben_briefing.py`나 `tests/test_premium_turns.py`에 있는 도우미를 import하거나 같은 모양으로 작성).

```python
# backend/tests/test_ben_pii.py
import json
from dataclasses import replace

from tests.fakes import FakeClaude
from tests.helpers import ADMISSION_START, COMPANY_START, login_admin, open_db

URL = "/api/premium/interviews"
PII_RESUME = "이름: 홍길동\n연락처: 010-1234-5678, gildong@example.com\nGitHub: github.com/gildong\n결제 백엔드 3년"


def _events(res):
    out = []
    for block in res.text.split("\n\n"):
        lines = dict(l.split(": ", 1) for l in block.splitlines() if ": " in l and not l.startswith(":"))
        if "event" in lines:
            out.append((lines["event"], json.loads(lines.get("data", "{}"))))
    return out


def _start(c, body):
    login_admin(c)
    assert c.post("/api/premium/purchase").status_code == 200
    res = c.post(URL, json=body)
    assert res.status_code == 201
    return res.json()["interviewId"]


def _client(make_client, settings, fake):
    return make_client(replace(settings, ben_pii_mask=True), claude=fake)


def _sent(fake):
    return json.dumps(fake.calls, ensure_ascii=False)


def test_turn_sends_masked_and_returns_original(make_client, settings):
    fake = FakeClaude()
    fake.replies = [["[이름", "1]님, ", "[전화1]이 맞나요?"]]
    c = _client(make_client, settings, fake)
    iid = _start(c, {**COMPANY_START, "resumeText": PII_RESUME})
    res = c.post(f"{URL}/{iid}/turns")
    text = "".join(d["text"] for e, d in _events(res) if e == "delta")
    assert text == "홍길동님, 010-1234-5678이 맞나요?"
    sent = _sent(fake)
    for raw in ("홍길동", "010-1234-5678", "gildong@example.com", "github.com/gildong"):
        assert raw not in sent
    assert "[이름1]" in sent and "결제 백엔드 3년" in sent
    with open_db(settings) as conn:
        stored = conn.execute("SELECT messages_json FROM premium_interviews").fetchone()[0]
    assert "홍길동님, 010-1234-5678이 맞나요?" in [m["text"] for m in json.loads(stored)]


def test_answers_are_masked_too(make_client, settings):
    fake = FakeClaude()
    c = _client(make_client, settings, fake)
    iid = _start(c, {**COMPANY_START, "resumeText": PII_RESUME})
    c.post(f"{URL}/{iid}/turns")
    c.post(f"{URL}/{iid}/turns", json={"answer": "제 번호는 010-9999-8888입니다"})
    last = fake.calls[-1]["messages"][-1]["content"]
    assert last == "제 번호는 [전화2]입니다"


def test_system_block_is_identical_across_turns(make_client, settings):
    fake = FakeClaude()
    c = _client(make_client, settings, fake)
    iid = _start(c, {**COMPANY_START, "resumeText": PII_RESUME})
    c.post(f"{URL}/{iid}/turns")
    c.post(f"{URL}/{iid}/turns", json={"answer": "a@b.co 입니다"})
    assert fake.calls[0]["system"] == fake.calls[1]["system"]


def test_admission_name_and_account_name_are_masked(make_client, settings):
    fake = FakeClaude()
    c = _client(make_client, settings, fake)
    iid = _start(c, ADMISSION_START)
    c.post(f"{URL}/{iid}/turns")
    assert ADMISSION_START["admission"]["name"] not in _sent(fake)
    assert ADMISSION_START["admission"]["university"] in _sent(fake)


def test_mask_failure_never_calls_claude(make_client, settings, monkeypatch):
    from app.llm import pii

    fake = FakeClaude()
    c = _client(make_client, settings, fake)
    iid = _start(c, {**COMPANY_START, "resumeText": PII_RESUME})

    def boom(self, text):
        raise RuntimeError("x")

    monkeypatch.setattr(pii.Masker, "mask", boom)
    events = _events(c.post(f"{URL}/{iid}/turns"))
    assert ("error", {"code": "claude_error"}) in events
    assert fake.calls == []


def test_off_sends_original(make_client, settings):
    fake = FakeClaude()
    c = make_client(settings, claude=fake)  # 테스트 Settings 기본은 꺼짐
    iid = _start(c, {**COMPANY_START, "resumeText": PII_RESUME})
    c.post(f"{URL}/{iid}/turns")
    assert "홍길동" in _sent(fake)


def test_report_v1_is_unmasked_with_json_escape(make_client, settings):
    fake = FakeClaude()
    report = '[{"question": "q", "answer": "a", "feedback": "[이름1]님은 **좋았다**", "score": 3}]'
    fake.replies = [["첫 질문"], ["면접을 마치겠습니다."], [report[:30], report[30:]]]
    c = _client(make_client, settings, fake)
    iid = _start(c, {**COMPANY_START, "resumeText": PII_RESUME})
    c.post(f"{URL}/{iid}/turns")
    c.post(f"{URL}/{iid}/turns", json={"answer": "답"})
    res = c.post(f"{URL}/{iid}/report", json={"delivery": []})
    text = "".join(d["text"] for e, d in _events(res) if e == "delta")
    assert json.loads(text)[0]["feedback"] == "홍길동님은 **좋았다**"
    assert "홍길동" not in json.dumps(fake.calls[-1], ensure_ascii=False)
```

리포트 버전 2 테스트: `tests/test_report_v2*.py`의 정상 리포트 픽스처(구조화 JSON 문자열)를 가져와 `feedback` 류 문자열 하나에 `[이름1]`을 넣고, `replace(settings, ben_pii_mask=True, ben_report_v2=True)`로 위와 같이 진행해 `report` 이벤트 데이터의 그 칸이 "홍길동"으로 되돌아왔는지, `report_raw`(DB)에 표시가 없는지, 마지막 Claude 호출에 "홍길동"이 없는지 확인한다. 리포트 본문 요청(`delivery`) 모양은 같은 파일의 기존 테스트를 따른다.

- [ ] **Step 2: 실패 확인** — `uv run pytest tests/test_ben_pii.py -q`

- [ ] **Step 3: 구현** — `routers/premium.py`

```python
from app.llm import pii

log = logging.getLogger(__name__)


def _masker(settings: Settings, user: User, interview: PremiumInterview) -> pii.Masker | None:
    """가림이 켜져 있으면 이 요청의 Masker. 아는 이름: 가입 이름, 입학 면접 이름, 이력서 이름 줄."""
    if not settings.ben_pii_mask:
        return None
    names = [user.name or ""]
    admission = interview.inputs.get("admission")
    if admission:
        names.append(admission.get("name") or "")
    names += pii.names_in(interview.inputs.get("resumeText") or "")
    return pii.Masker(names)


def _masked(
    masker: pii.Masker | None,
    system: list[dict[str, Any]],
    messages: list[prompts.Message],
) -> tuple[list[dict[str, Any]], list[prompts.Message]]:
    """시스템 블록 → 메시지 순서로 가린다(번호 고정). 개수만 로그에 남긴다."""
    if masker is None:
        return system, messages
    out = masker.mask_system(system), masker.mask_messages(messages)
    log.info("pii masked %s", " ".join(f"{k}={v}" for k, v in sorted(masker.counts.items())) or "none")
    return out
```

(`Settings`·`User` import가 없으면 `app.config`·`app.repos.users`에서 가져온다.)

`take_turn`:
- `masker = _masker(request.app.state.settings, user, interview)`를 `messages` 만든 뒤에 둔다.
- `events()` 안:

```python
        system = prompts.build_system(
            interview.track, interview.inputs, brief, masked=masker is not None
        )
        try:
            out_system, out_messages = _masked(masker, system, messages)
        except Exception as exc:  # 원문을 보내지 않는다(spec 5절)
            log.warning("pii mask failed: %s", type(exc).__name__)
            yield sse("error", {"code": "claude_error"})
            return
        un = masker.stream() if masker is not None else None
        chunks: list[str] = []
        try:
            for text in claude.stream_text(
                system=out_system,
                messages=out_messages,
                effort="low",
                max_tokens=TURN_MAX_TOKENS,
                on_usage=turn_sink,
            ):
                piece = un.feed(text) if un is not None else text
                if piece:
                    chunks.append(piece)
                    yield sse("delta", {"text": piece})
        except ClaudeError as exc:
            yield sse("error", {"code": exc.code})
            return
        if un is not None:
            tail = un.flush()
            if tail:
                chunks.append(tail)
                yield sse("delta", {"text": tail})
        reply = "".join(chunks)
```

`_generate_report_once(claude, system, msgs, sink, masker: pii.Masker | None = None)`: `un = masker.stream(json_escape=True) if masker else None`, 턴과 같은 방식으로 조각을 되돌리고 끝에 `flush`. 돌려주는 `raw`는 되돌린 글.

`_report_v2_events(..., masker: pii.Masker | None = None)`: `msgs`를 만든 뒤 루프 전에

```python
    try:
        out_system, out_msgs = _masked(masker, system, msgs)
    except Exception as exc:
        log.warning("pii mask failed: %s", type(exc).__name__)
        yield sse("error", {"code": "claude_error"})
        return
```

그리고 `_generate_report_once(claude, out_system, out_msgs, sink, masker)`.

`make_report`:
- `masker = _masker(settings, user, interview)`
- `system = prompts.report_system(..., masked=masker is not None)` / `prompts.build_system(interview.track, interview.inputs, masked=masker is not None)`
- 버전 2: `_report_v2_events(..., voice_wait=with_voice, masker=masker)`
- 버전 1 `events()`: `msgs`가 정해진 뒤 위와 같은 `_masked` + 실패 처리, 스트림은 `masker.stream(json_escape=True)`로 되돌리며 `chunks`에는 되돌린 조각, 끝에 `flush`.
- 이미 끝난 리포트 다시 보내기(`replay`)는 저장된 원문이라 손대지 않는다.

- [ ] **Step 4: 전체 확인**

```bash
uv run ruff check . && uv run ruff format --check . && uv run pytest -q
```

Expected: 모두 통과(기존 테스트는 `ben_pii_mask=False` 기본이라 프롬프트 비교가 그대로).

- [ ] **Step 5: 커밋**

```bash
git add app/routers/premium.py tests/test_ben_pii.py
git commit -m "feat(backend): 벤 턴·리포트에서 개인정보를 가려 보내고 응답에서 되돌림"
```

---

### Task 5: 전후 비교, PR, demomo 확인

- [ ] **Step 1: 전후 비교 자료** — scratchpad 스크립트로 가짜 이력서(이름·전화·이메일·주소·깃허브 포함, 실존 인물 아님)의 `build_system` 결과를 가림 끔/켬으로 출력해 PR 본문 diff로 붙인다. `Masker.counts`도 함께.
- [ ] **Step 2: PR** — `gh pr create --base dev`, 제목 `feat(backend): 벤 개인정보 가림 — Claude로 보낼 때만 가리고 응답에서 되돌림`. 본문: spec·plan, 가리는 것/안 가리는 것 표, 알려진 한계, 계약 변경 없음, 프롬프트 전후 비교, 검증. `deploy/` 변경으로 @leemonta9482 리뷰.
- [ ] **Step 3: demomo** — 머지 뒤(기본 켜짐) 같은 가짜 이력서로 벤 1회 완주 + 리포트(버전 2). 화면·리포트에 원래 값이 보이고 `[` 표시가 없는지, 질문이 자연스러운지 확인. 관리자 사용량에서 오류 증가 없음. 로그 `pii masked …` 줄에 값이 없는지 확인.
- [ ] **Step 4: 결과를 PR 댓글로, `dev → main`은 사용자 지시 후.**
