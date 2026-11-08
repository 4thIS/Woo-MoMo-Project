"""네이버 검색 API (spec 2026-11-08 4절). 보내는 것은 회사명·직무뿐. 실패는 빈 목록."""

import html as htmllib
import re
from dataclasses import dataclass
from email.utils import parsedate_to_datetime

import httpx

# 옛 개발자센터(openapi.naver.com)는 검색 API 신규 발급이 막혀 NAVER API HUB를 쓴다(2026-11-09)
BASE = "https://naverapihub.apigw.ntruss.com/search/v1"
COUNT = 5
_TAG = re.compile(r"<[^>]+>")


@dataclass(frozen=True)
class Doc:
    kind: str  # "posting" | "news" | "web"
    title: str
    text: str
    url: str
    date: str = ""  # 뉴스만, YYYY-MM-DD


def _s(v: object) -> str:
    return v if isinstance(v, str) else ""


def _plain(v: object) -> str:
    return " ".join(htmllib.unescape(_TAG.sub("", _s(v))).split())


def _date(raw: object) -> str:
    try:
        return parsedate_to_datetime(_s(raw)).strftime("%Y-%m-%d")
    except (TypeError, ValueError, IndexError):
        return ""


class NaverSearch:
    def __init__(
        self,
        client_id: str,
        client_secret: str,
        *,
        timeout: float = 3.0,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        # NAVER API HUB(네이버 클라우드) 인증 헤더 — 응답은 text/plain이지만 본문은 JSON이다
        self._headers = {"X-NCP-APIGW-API-KEY-ID": client_id, "X-NCP-APIGW-API-KEY": client_secret}
        self._timeout = timeout
        self._transport = transport

    def _items(self, path: str, params: dict[str, str]) -> list[dict]:
        try:
            with httpx.Client(
                transport=self._transport, timeout=self._timeout, trust_env=False
            ) as c:
                resp = c.get(f"{BASE}/{path}", params=params, headers=self._headers)
            if resp.status_code != 200:
                return []
            data = resp.json()
        except (httpx.HTTPError, ValueError, AttributeError):
            return []
        items = data.get("items") if isinstance(data, dict) else None
        if not isinstance(items, list):
            return []
        return [i for i in items if isinstance(i, dict)][:COUNT]

    def news(self, query: str) -> list[Doc]:
        items = self._items("news", {"query": query, "display": str(COUNT), "sort": "date"})
        return [
            Doc(
                "news",
                _plain(i.get("title")),
                _plain(i.get("description")),
                _s(i.get("originallink")) or _s(i.get("link")),
                _date(i.get("pubDate")),
            )
            for i in items
        ]

    def web(self, query: str) -> list[Doc]:
        items = self._items("webkr", {"query": query, "display": str(COUNT)})
        return [
            Doc(
                "web",
                _plain(i.get("title")),
                _plain(i.get("description")),
                _s(i.get("link")),
            )
            for i in items
        ]
