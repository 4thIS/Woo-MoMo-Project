import json

from app.llm import posting_text as pt

LONG = "결제 시스템 백엔드를 설계하고 운영합니다. " * 20


def _page(head="", body=""):
    return f"<html><head>{head}</head><body>{body}</body></html>"


def test_json_ld_job_posting_wins():
    ld = {
        "@context": "https://schema.org",
        "@type": "JobPosting",
        "title": "백엔드 개발자",
        "hiringOrganization": {"@type": "Organization", "name": "토스"},
        "description": f"<p>{LONG}</p>",
        "qualifications": "Kotlin 3년 이상",
    }
    html = _page(
        f'<script type="application/ld+json">{json.dumps(ld, ensure_ascii=False)}</script>',
        "<nav>메뉴</nav><p>다른 본문 " + "x" * 300 + "</p>",
    )
    got = pt.extract(html)
    assert got.startswith("백엔드 개발자")
    assert "토스" in got and "Kotlin 3년 이상" in got and "<p>" not in got
    assert "다른 본문" not in got


def test_json_ld_in_graph_list():
    ld = {
        "@graph": [
            {"@type": "WebPage"},
            {"@type": ["JobPosting"], "title": "T", "description": LONG},
        ]
    }
    html = _page(
        f'<script type="application/ld+json">{json.dumps(ld, ensure_ascii=False)}</script>'
    )
    assert pt.extract(html).startswith("T")


def test_broken_json_ld_falls_back_to_body():
    html = _page('<script type="application/ld+json">{oops</script>', f"<main><p>{LONG}</p></main>")
    assert pt.extract(html).startswith("결제 시스템")


def test_body_skips_noise_tags():
    html = _page(
        "<style>.a{}</style>",
        f"<header>로그인</header><nav>메뉴</nav><script>var a=1</script><p>{LONG}</p><footer>회사소개</footer>",
    )
    got = pt.extract(html)
    assert (
        "로그인" not in got and "메뉴" not in got and "var a" not in got and "회사소개" not in got
    )


def test_meta_description_is_last():
    html = _page(f'<meta property="og:description" content="{LONG}">', "<p>짧음</p>")
    assert pt.extract(html).startswith("결제 시스템")


def test_too_short_is_empty():
    assert pt.extract(_page(body="<p>짧은 공고</p>")) == ""


def test_capped_and_whitespace_folded():
    html = _page(body="<p>" + ("가  나\n\n다 " * 3000) + "</p>")
    got = pt.extract(html)
    assert len(got) == pt.MAX_CHARS
    assert "  " not in got


def test_saramin_view_goes_to_detail():
    assert pt.detail_url(
        "https://www.saramin.co.kr/zf_user/jobs/relay/view?view_type=list&rec_idx=123"
    ) == ("https://www.saramin.co.kr/zf_user/jobs/relay/view-detail?rec_idx=123")
    assert pt.detail_url("https://www.saramin.co.kr/zf_user/jobs/view?rec_idx=9") == (
        "https://www.saramin.co.kr/zf_user/jobs/relay/view-detail?rec_idx=9"
    )


def test_other_urls_unchanged():
    url = "https://www.wanted.co.kr/wd/1"
    assert pt.detail_url(url) == url
