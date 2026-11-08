"""벤 개인정보 가림 (spec 2026-11-08). Claude로 보낼 때만 가리고 응답에서 되돌린다.

확실한 것만 가린다: 모양이 정해진 정보는 규칙, 이름은 이미 아는 이름. 짝은 한 요청 동안만 쥔다."""

import re
from collections import Counter
from collections.abc import Iterable

PLACEHOLDER = re.compile(r"\[(이름|전화|이메일|주소|생년월일|주민번호|계좌|링크)(\d+)\]")
_PARTIAL = re.compile(r"\[[가-힣]{0,4}\d{0,3}$")
HOLD_MAX = 10

_RRN = re.compile(r"(?<!\d)\d{6}\s?-\s?[1-8]\d{6}(?!\d)")
_CARD = re.compile(r"(?<!\d)\d{4}[- ]\d{4}[- ]\d{4}[- ]\d{4}(?!\d)")
_ACCOUNT_LABEL = re.compile(r"계좌|은행|입금")
_ACCOUNT = re.compile(r"(?<![\d-])\d[\d-]{8,18}\d(?![\d-])")
_MOBILE = re.compile(r"(?<![\d+])(?:\+82[ -]?|0)1[016789][ .-]?\d{3,4}[ .-]?\d{4}(?!\d)")
_LANDLINE = re.compile(r"(?<!\d)0(?:2|[3-6][1-5]|70)-\d{3,4}-\d{4}(?!\d)")
# 앞에 같은 글자가 붙어 있으면 시작하지 않고 길이를 묶어, 긴 문자열에서도 한 번만 훑는다
_EMAIL = re.compile(
    r"(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}"
    r"(?:\.[A-Za-z0-9-]{1,63}){0,8}\.[A-Za-z]{2,24}(?![A-Za-z0-9-])"
)
_LINK = re.compile(
    r"(?<![A-Za-z0-9_-])(?:https?://)?(?:www\.)?(?:"
    r"(?:github\.com|gitlab\.com|instagram\.com|blog\.naver\.com)/[A-Za-z0-9_.-]+"
    r"|linkedin\.com/in/[A-Za-z0-9_%.-]+"
    r"|(?:velog\.io|brunch\.co\.kr|medium\.com)/@[A-Za-z0-9_.-]+"
    r"|notion\.so/[A-Za-z0-9_.-]+"
    r"|[A-Za-z0-9-]{1,63}\.(?:tistory\.com|notion\.site|github\.io)"
    r")[^\s)\]>\"',]*",
    re.I,
)
_BIRTH_LABEL = re.compile(r"생년월일|생일|출생|birth|dob", re.I)
_DATE = re.compile(
    r"(?<!\d)(?:19|20)?\d{2}\s*[./년-]\s*\d{1,2}\s*[./월-]\s*\d{1,2}(?:\s*일)?(?!\d)"
)
# 낱말 첫 글자에서만 시작하고 길이를 묶는다(긴 한글 덩어리에서 글자마다 다시 훑지 않게)
_ROAD = re.compile(
    r"(?<![가-힣])[가-힣]{2,6}(?:특별시|광역시|특별자치시|특별자치도|시|도)[ \t]{1,3}"
    r"[가-힣]{1,6}(?:시|군|구)(?:[ \t]{1,3}[가-힣]{1,6}구)?[ \t]{1,3}"
    r"[가-힣0-9]{1,15}(?:로|길)[ \t]{0,3}\d{1,5}(?:-\d{1,5})?"
    r"(?:[ ,]{1,3}[^\n,]{0,20}?\d{1,4}동[ \t]{0,3}\d{1,5}호)?"
)
_ADDRESS_LABEL = re.compile(r"(?:주소|거주지|address)\s*[:：]\s*(\S[^\n]*?)\s*$", re.I | re.M)
_NAME_LABEL = re.compile(
    r"(?:이름|성명|name)\s*[:：]\s*([가-힣]{2,4}|[A-Za-z]+(?: [A-Za-z]+){1,2})(?![가-힣A-Za-z])",
    re.I,
)
_LINE = re.compile(r"[^\n]+")
# 2글자 이름 뒤에 와도 되는 것: (띄어서) 님·씨, 조사, 문장부호·줄끝.
# 띄어 쓴 다른 낱말("지원 동기")은 안 된다
_AFTER_SHORT_NAME = (
    r"(?=[ \t]?(?:님|씨)|(?:이|가|은|는|을|를|의|에|와|과|도|만|로|랑|께|한테|아|야)"
    r"|[ \t]*(?:[^가-힣 \t]|$))"
)

Span = tuple[int, int, str, str, str]  # 시작, 끝, 종류, 비교 키, 원래 값


def names_in(text: str) -> list[str]:
    """이력서의 "이름·성명·Name:" 줄에서 이름을 꺼낸다(나온 순서, 중복 제거)."""
    return list(dict.fromkeys(m.group(1) for m in _NAME_LABEL.finditer(text or "")))


def _name_patterns(name: str) -> list[re.Pattern[str]]:
    if re.fullmatch(r"[가-힣]{2,4}", name):
        if len(name) == 2:
            # 2글자는 흔한 낱말과 겹친다: 앞에 한글이 없고 뒤가 _AFTER_SHORT_NAME일 때만
            pats = [re.compile(r"(?<![가-힣])" + re.escape(name) + _AFTER_SHORT_NAME)]
        else:
            pats = [re.compile(re.escape(name))]
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
