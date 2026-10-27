import pytest

from app import db
from app.repos import briefings

T0 = "2026-10-15T00:00:00.000Z"
LATER = "2026-10-20T00:00:00.000Z"
SOURCES = [{"title": "토스 블로그", "url": "https://toss.tech/a"}]


@pytest.fixture
def conn(tmp_path):
    p = tmp_path / "t.sqlite3"
    db.init_db(p)
    with db.connection(p) as c:
        yield c


def test_cache_key_folds_spaces_and_case():
    assert briefings.cache_key("  Toss  (비바리퍼블리카) ", "백엔드   개발자") == (
        "toss (비바리퍼블리카)\n백엔드 개발자"
    )


def test_put_then_get_fresh(conn):
    key = briefings.cache_key("토스", "백엔드")
    briefings.put(
        conn, key=key, company="토스", job="백엔드", briefing="본문", sources=SOURCES, created_at=T0
    )
    got = briefings.get_fresh(conn, key=key, since=T0)
    assert got == briefings.CachedBriefing(briefing="본문", sources=SOURCES)


def test_stale_row_is_ignored(conn):
    key = briefings.cache_key("토스", "백엔드")
    briefings.put(
        conn, key=key, company="토스", job="백엔드", briefing="본문", sources=[], created_at=T0
    )
    assert briefings.get_fresh(conn, key=key, since=LATER) is None


def test_missing_key_is_none(conn):
    assert briefings.get_fresh(conn, key="없음\n없음", since=T0) is None


def test_put_overwrites_the_same_key(conn):
    key = briefings.cache_key("토스", "백엔드")
    briefings.put(
        conn, key=key, company="토스", job="백엔드", briefing="옛것", sources=[], created_at=T0
    )
    briefings.put(
        conn,
        key=key,
        company="토스",
        job="백엔드",
        briefing="새것",
        sources=SOURCES,
        created_at=LATER,
    )
    got = briefings.get_fresh(conn, key=key, since=LATER)
    assert got is not None and got.briefing == "새것" and got.sources == SOURCES


def test_cache_key_without_url_is_unchanged_and_with_url_differs():
    base = briefings.cache_key("토스", "백엔드")
    assert briefings.cache_key("토스", "백엔드", None) == base
    assert briefings.cache_key("토스", "백엔드", " https://a.com/1 ") == base + "\nhttps://a.com/1"
    assert briefings.cache_key("", "백엔드", "https://a.com/1") == "\n백엔드\nhttps://a.com/1"
