"""공고 HTML → 본문 텍스트 (spec 2026-11-08 3.3).

먼저 찾은 것 순서: JSON-LD JobPosting → 본문 → 메타 설명.
"""

import html as htmllib
import json
import re
from html.parser import HTMLParser
from typing import Any
from urllib.parse import parse_qs, urlsplit

MAX_CHARS = 6000
MIN_CHARS = 200
# 끝 태그가 올 때까지 무조건 건너뛸 태그
_HARD_SKIP = {"script", "style", "noscript", "svg", "template"}
# 안 닫혀도 본문 시작 태그나 </body>에서 풀리는 메뉴류 태그
_SOFT_SKIP = {"nav", "header", "footer", "aside"}
_BODY_START = {"main", "article", "section"}
_MAX_RAW = 1_000_000
_JOB_FIELDS = (
    "responsibilities",
    "qualifications",
    "skills",
    "experienceRequirements",
    "educationRequirements",
    "employmentType",
)
# `<`를 건너 뛰지 않아 되돌아가기(역추적)로 느려지지 않는다
_TAG = re.compile(r"<[^<>]*>")
_WS = re.compile(r"\s+")


def _fold(text: str) -> str:
    """공백만 접는다. 파서가 이미 태그를 걷고 엔티티를 풀어 둔 글에 쓴다."""
    return _WS.sub(" ", text).strip()


def _strip_html(text: str) -> str:
    """JSON-LD 필드용: 엔티티를 먼저 풀고 태그를 걷는다. 입력 길이를 자른다."""
    text = htmllib.unescape(text[: MAX_CHARS * 4])
    return _fold(_TAG.sub(" ", text))


class _Parser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.ld: list[str] = []
        self.meta: dict[str, str] = {}
        self.text: list[str] = []
        self._skip = 0  # 무조건 건너뛰는 태그 깊이
        self._soft = 0  # 메뉴류 태그 깊이
        self._in_ld = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        a = {k: (v or "") for k, v in attrs}
        if tag == "script" and a.get("type", "").lower() == "application/ld+json":
            self._in_ld = True
            self.ld.append("")
        if tag == "meta":
            key = (a.get("property") or a.get("name") or "").lower()
            if key in ("og:description", "description") and a.get("content"):
                self.meta.setdefault(key, a["content"])
        if tag in _BODY_START:
            self._soft = 0
        if tag in _HARD_SKIP:
            self._skip += 1
        elif tag in _SOFT_SKIP:
            self._soft += 1

    def handle_endtag(self, tag: str) -> None:
        if tag == "script":
            self._in_ld = False
        if tag in _HARD_SKIP and self._skip:
            self._skip -= 1
        elif tag in _SOFT_SKIP and self._soft:
            self._soft -= 1
        elif tag in ("body", "html"):
            self._soft = 0

    def handle_data(self, data: str) -> None:
        if self._in_ld:
            self.ld[-1] += data
        elif not self._skip and not self._soft:
            self.text.append(data)


def _is_job(node: Any) -> bool:
    t = node.get("@type") if isinstance(node, dict) else None
    return t == "JobPosting" or (isinstance(t, list) and "JobPosting" in t)


def _jobs(data: Any) -> list[dict[str, Any]]:
    if isinstance(data, list):
        return [j for d in data for j in _jobs(d)]
    if isinstance(data, dict):
        found = [data] if _is_job(data) else []
        return found + _jobs(data.get("@graph", []))
    return []


def _item_text(item: Any) -> str:
    if isinstance(item, dict):
        return str(item.get("name") or "")
    return str(item)


def _job_text(job: dict[str, Any]) -> str:
    parts = [str(job.get("title") or "")]
    org = job.get("hiringOrganization")
    if isinstance(org, list):
        org = org[0] if org else None
    name = org.get("name") if isinstance(org, dict) else org
    if isinstance(name, str) and name:
        parts.append(f"회사: {name}")
    parts.append(str(job.get("description") or ""))
    for key in _JOB_FIELDS:
        value = job.get(key)
        if isinstance(value, list):
            value = " ".join(_item_text(v) for v in value)
        elif isinstance(value, dict):
            value = _item_text(value)
        if value:
            parts.append(str(value))
    return _strip_html(" ".join(parts))


def _ok(text: str) -> str:
    return text[:MAX_CHARS] if len(text) >= MIN_CHARS else ""


def extract(html: str) -> str:
    p = _Parser()
    p.feed(html)
    p.close()
    for raw in p.ld:
        if len(raw) > _MAX_RAW:
            continue
        try:
            for job in _jobs(json.loads(raw)):
                got = _ok(_job_text(job))
                if got:
                    return got
        except (ValueError, RecursionError):
            continue
    got = _ok(_fold(" ".join(p.text)))
    if got:
        return got
    return _ok(_fold(p.meta.get("og:description") or p.meta.get("description") or ""))


def detail_url(url: str) -> str:
    """본문을 iframe으로 띄우는 사이트는 본문 주소를 바로 연다(Task 7에서 확인한 사이트만)."""
    parts = urlsplit(url)
    host = (parts.hostname or "").lower()
    if host in ("www.saramin.co.kr", "saramin.co.kr") and "/zf_user/jobs/" in parts.path:
        rec = parse_qs(parts.query).get("rec_idx", [""])[0]
        if rec.isascii() and rec.isdigit():
            return f"https://www.saramin.co.kr/zf_user/jobs/relay/view-detail?rec_idx={rec}"
    return url
