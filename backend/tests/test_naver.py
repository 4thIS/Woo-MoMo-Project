import httpx

from app.llm.naver import Doc, NaverSearch

NEWS = {
    "items": [
        {
            "title": "<b>토스</b>, 오프라인 결제 &amp; 단말 출시",
            "description": "토스페이먼츠가 <b>단말</b>을",
            "originallink": "https://news.example.com/1",
            "link": "https://n.news.naver.com/1",
            "pubDate": "Mon, 03 Nov 2026 09:00:00 +0900",
        },
    ]
}


def _client(handler):
    return NaverSearch("id", "secret", transport=httpx.MockTransport(handler))


def test_news_strips_tags_and_dates():
    seen = {}

    def handler(req):
        seen["url"] = req.url
        seen["id"] = req.headers["x-naver-client-id"]
        return httpx.Response(200, json=NEWS)

    got = _client(handler).news("토스")
    assert got == [
        Doc(
            kind="news",
            title="토스, 오프라인 결제 & 단말 출시",
            text="토스페이먼츠가 단말을",
            url="https://news.example.com/1",
            date="2026-11-03",
        )
    ]
    assert seen["url"].path == "/v1/search/news.json"
    assert dict(seen["url"].params) == {"query": "토스", "display": "5", "sort": "date"}
    assert seen["id"] == "id"


def test_web_uses_webkr():
    body = {
        "items": [{"title": "토스 채용", "description": "인재상", "link": "https://toss.im/career"}]
    }
    seen = {}

    def handler(req):
        seen["path"] = req.url.path
        seen["params"] = dict(req.url.params)
        return httpx.Response(200, json=body)

    got = _client(handler).web("토스 백엔드 개발자")
    assert got == [Doc(kind="web", title="토스 채용", text="인재상", url="https://toss.im/career")]
    assert seen == {
        "path": "/v1/search/webkr.json",
        "params": {"query": "토스 백엔드 개발자", "display": "5"},
    }


def test_errors_are_empty():
    assert _client(lambda r: httpx.Response(401, json={})).news("토스") == []
    assert _client(lambda r: httpx.Response(200, text="not json")).web("토스") == []

    def boom(req):
        raise httpx.ConnectTimeout("t")

    assert _client(boom).news("토스") == []


def test_bad_date_is_blank():
    body = {"items": [{**NEWS["items"][0], "pubDate": "어제"}]}
    assert _client(lambda r: httpx.Response(200, json=body)).news("토스")[0].date == ""
