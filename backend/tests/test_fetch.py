# backend/tests/test_fetch.py
import httpx
import pytest

from app.llm import fetch

PUBLIC = "93.184.216.34"


def _resolver(mapping):
    def resolve(host, port, *args, **kwargs):
        ips = mapping[host]
        return [(2 if ":" not in ip else 10, 1, 6, "", (ip, port)) for ip in ips]

    return resolve


def _transport(handler):
    return httpx.MockTransport(handler)


@pytest.mark.parametrize(
    "ip",
    [
        "10.0.0.1",
        "172.16.0.1",
        "192.168.1.1",
        "127.0.0.1",
        "169.254.169.254",
        "100.66.116.116",
        "100.64.0.1",
        "0.0.0.0",
        "224.0.0.1",
        "240.0.0.1",
        "::1",
        "fe80::1",
        "fc00::1",
        "fd12::1",
        "::ffff:127.0.0.1",
        "::",
    ],
)
def test_private_ips_are_not_public(ip):
    assert fetch.is_public_ip(ip) is False


@pytest.mark.parametrize("ip", [PUBLIC, "8.8.8.8", "2606:4700::1111"])
def test_public_ips(ip):
    assert fetch.is_public_ip(ip) is True


def test_connects_to_the_checked_ip_with_original_host():
    seen = {}

    def handler(req):
        seen["host"] = req.url.host
        seen["header"] = req.headers["host"]
        seen["sni"] = req.extensions.get("sni_hostname")
        seen["ua"] = req.headers["user-agent"]
        seen["cookie"] = req.headers.get("cookie")
        return httpx.Response(
            200, headers={"content-type": "text/html; charset=utf-8"}, text="<p>hi</p>"
        )

    page = fetch.fetch_html(
        "https://jobs.example.com/a?b=1",
        resolver=_resolver({"jobs.example.com": [PUBLIC]}),
        transport=_transport(handler),
    )
    assert page.html == "<p>hi</p>"
    assert page.url == "https://jobs.example.com/a?b=1"
    assert seen == {
        "host": PUBLIC,
        "header": "jobs.example.com",
        "sni": "jobs.example.com",
        "ua": "MoMoBot/1.0",
        "cookie": None,
    }


def test_any_private_address_blocks():
    with pytest.raises(fetch.FetchError):
        fetch.fetch_html(
            "https://evil.example.com/",
            resolver=_resolver({"evil.example.com": [PUBLIC, "10.0.0.5"]}),
            transport=_transport(lambda r: httpx.Response(200)),
        )


@pytest.mark.parametrize("url", ["https://x.com:8443/a", "http://x.com:22/", "ftp://x.com/a"])
def test_only_http_https_on_80_443(url):
    with pytest.raises(fetch.FetchError):
        fetch.fetch_html(
            url,
            resolver=_resolver({"x.com": [PUBLIC]}),
            transport=_transport(lambda r: httpx.Response(200)),
        )


def test_redirect_is_rechecked():
    def handler(req):
        return httpx.Response(302, headers={"location": "http://inner.example.com/admin"})

    with pytest.raises(fetch.FetchError):
        fetch.fetch_html(
            "https://jobs.example.com/",
            resolver=_resolver({"jobs.example.com": [PUBLIC], "inner.example.com": ["127.0.0.1"]}),
            transport=_transport(handler),
        )


def test_follows_up_to_three_redirects_then_fails():
    hops = {"n": 0}

    def handler(req):
        hops["n"] += 1
        return httpx.Response(302, headers={"location": f"/r{hops['n']}"})

    with pytest.raises(fetch.FetchError):
        fetch.fetch_html(
            "https://jobs.example.com/",
            resolver=_resolver({"jobs.example.com": [PUBLIC]}),
            transport=_transport(handler),
        )
    assert hops["n"] == 4  # 처음 1회 + 리다이렉트 3회


def test_relative_redirect_keeps_the_final_url():
    def handler(req):
        if req.url.path == "/old":
            return httpx.Response(301, headers={"location": "/new"})
        return httpx.Response(200, headers={"content-type": "text/html"}, text="ok")

    page = fetch.fetch_html(
        "https://jobs.example.com/old",
        resolver=_resolver({"jobs.example.com": [PUBLIC]}),
        transport=_transport(handler),
    )
    assert page.url == "https://jobs.example.com/new"


@pytest.mark.parametrize("ctype", ["application/json", "image/png", ""])
def test_non_html_is_rejected(ctype):
    with pytest.raises(fetch.FetchError):
        fetch.fetch_html(
            "https://x.com/",
            resolver=_resolver({"x.com": [PUBLIC]}),
            transport=_transport(
                lambda r: httpx.Response(200, headers={"content-type": ctype}, text="{}")
            ),
        )


def test_body_over_2mb_is_rejected():
    big = "a" * (fetch.MAX_BYTES + 1)
    with pytest.raises(fetch.FetchError):
        fetch.fetch_html(
            "https://x.com/",
            resolver=_resolver({"x.com": [PUBLIC]}),
            transport=_transport(
                lambda r: httpx.Response(200, headers={"content-type": "text/html"}, text=big)
            ),
        )


def test_http_error_status_fails():
    with pytest.raises(fetch.FetchError):
        fetch.fetch_html(
            "https://x.com/",
            resolver=_resolver({"x.com": [PUBLIC]}),
            transport=_transport(
                lambda r: httpx.Response(404, headers={"content-type": "text/html"})
            ),
        )


def test_dns_failure_fails():
    def resolve(*a, **k):
        raise OSError("nx")

    with pytest.raises(fetch.FetchError):
        fetch.fetch_html(
            "https://x.com/", resolver=resolve, transport=_transport(lambda r: httpx.Response(200))
        )


def test_euc_kr_page_is_decoded():
    body = "<p>채용</p>".encode("euc-kr")
    page = fetch.fetch_html(
        "https://x.com/",
        resolver=_resolver({"x.com": [PUBLIC]}),
        transport=_transport(
            lambda r: httpx.Response(
                200, headers={"content-type": "text/html; charset=euc-kr"}, content=body
            )
        ),
    )
    assert "채용" in page.html
