"""네이버 검색 API (spec 2026-11-08 4절). 보내는 것은 회사명·직무뿐. 실패는 빈 목록."""

import html as htmllib
import re
from dataclasses import dataclass
from email.utils import parsedate_to_datetime

import httpx

BASE = "https://openapi.naver.com/v1/search"
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
        self._headers = {"X-Naver-Client-Id": client_id, "X-Naver-Client-Secret": client_secret}
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
        items = self._items("news.json", {"query": query, "display": str(COUNT), "sort": "date"})
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
        items = self._items("webkr.json", {"query": query, "display": str(COUNT)})
        return [
            Doc(
                "web",
                _plain(i.get("title")),
                _plain(i.get("description")),
                i.get("link", ""),
            )
            for i in items
        ]
