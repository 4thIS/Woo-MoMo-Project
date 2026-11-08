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
# 본문에서 건너뛸 태그 (메뉴·스크립트 등 잡음)
_SKIP = {"script", "style", "noscript", "nav", "header", "footer", "aside", "svg", "template"}
_JOB_FIELDS = (
    "responsibilities",
    "qualifications",
    "skills",
    "experienceRequirements",
    "educationRequirements",
    "employmentType",
)
_TAG = re.compile(r"<[^>]+>")
_WS = re.compile(r"\s+")


def _clean(text: str) -> str:
    return _WS.sub(" ", htmllib.unescape(_TAG.sub(" ", text))).strip()


class _Parser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.ld: list[str] = []
        self.meta: dict[str, str] = {}
        self.text: list[str] = []
        self._skip = 0
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
        if tag in _SKIP:
            self._skip += 1

    def handle_endtag(self, tag: str) -> None:
        if tag == "script":
            self._in_ld = False
        if tag in _SKIP and self._skip:
            self._skip -= 1

    def handle_data(self, data: str) -> None:
        if self._in_ld:
            self.ld[-1] += data
        elif not self._skip:
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


def _job_text(job: dict[str, Any]) -> str:
    org = job.get("hiringOrganization")
    parts = [str(job.get("title") or "")]
    if isinstance(org, dict) and org.get("name"):
        parts.append(f"회사: {org['name']}")
    parts.append(str(job.get("description") or ""))
    for key in _JOB_FIELDS:
        value = job.get(key)
        if isinstance(value, list):
            value = " ".join(str(v) for v in value)
        if value:
            parts.append(str(value))
    return _clean(" ".join(parts))


def _ok(text: str) -> str:
    return text[:MAX_CHARS] if len(text) >= MIN_CHARS else ""


def extract(html: str) -> str:
    p = _Parser()
    p.feed(html)
    p.close()
    for raw in p.ld:
        try:
            data = json.loads(raw)
        except ValueError:
            continue
        for job in _jobs(data):
            got = _ok(_job_text(job))
            if got:
                return got
    got = _ok(_clean(" ".join(p.text)))
    if got:
        return got
    return _ok(_clean(p.meta.get("og:description") or p.meta.get("description") or ""))


def detail_url(url: str) -> str:
    """본문을 iframe으로 띄우는 사이트는 본문 주소를 바로 연다(Task 7에서 확인한 사이트만)."""
    parts = urlsplit(url)
    host = (parts.hostname or "").lower()
    if host in ("www.saramin.co.kr", "saramin.co.kr") and "/zf_user/jobs/" in parts.path:
        rec = parse_qs(parts.query).get("rec_idx", [""])[0]
        if rec.isdigit():
            return f"https://www.saramin.co.kr/zf_user/jobs/relay/view-detail?rec_idx={rec}"
    return url
