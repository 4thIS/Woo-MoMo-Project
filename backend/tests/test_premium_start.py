import json
from dataclasses import replace

import pytest

from tests.helpers import (
    ADMISSION_START,
    COMPANY_START,
    login_admin,
    make_premium,
    open_db,
    signup,
)

URL = "/api/premium/interviews"


def _admin_with_tickets(client) -> None:
    login_admin(client)
    assert client.post("/api/premium/purchase").status_code == 200


def test_member_is_forbidden(client):
    signup(client)
    res = client.post(URL, json=COMPANY_START)
    assert res.status_code == 403
    assert res.json() == {"error": "premium_required"}


def test_start_company_spends_a_ticket(client, settings):
    _admin_with_tickets(client)
    res = client.post(URL, json=COMPANY_START)
    assert res.status_code == 201
    body = res.json()
    assert body["interviewId"].startswith("pi_")
    assert body["session"]["tickets"] == 9
    with open_db(settings) as conn:
        row = conn.execute("SELECT track, inputs_json, status FROM premium_interviews").fetchone()
    assert (row["track"], row["status"]) == ("company", "active")
    assert json.loads(row["inputs_json"]) == {
        "resumeText": COMPANY_START["resumeText"],
        "company": COMPANY_START["company"],
    }


def test_start_admission(client):
    _admin_with_tickets(client)
    assert client.post(URL, json=ADMISSION_START).status_code == 201


def test_missing_track_group(client):
    _admin_with_tickets(client)
    body = {"track": "company", "resumeText": "x", "admission": ADMISSION_START["admission"]}
    res = client.post(URL, json=body)
    assert res.status_code == 422
    assert res.json() == {"error": "missing_field", "field": "company"}


def test_resume_text_limit(client):
    _admin_with_tickets(client)
    res = client.post(URL, json={**COMPANY_START, "resumeText": "가" * 20_001})
    assert res.status_code == 422
    assert res.json() == {"error": "invalid", "field": "resumeText"}


def test_no_tickets(client, settings):
    me = signup(client)
    make_premium(settings, me["userId"], tickets=0)
    res = client.post(URL, json=COMPANY_START)
    assert res.status_code == 409
    assert res.json() == {"error": "no_tickets"}


def test_daily_limit_keeps_the_ticket(make_client, settings, clock):
    c = make_client(replace(settings, ben_daily_limit=1))
    _admin_with_tickets(c)
    assert c.post(URL, json=COMPANY_START).status_code == 201
    res = c.post(URL, json=COMPANY_START)
    assert res.status_code == 503
    assert res.json() == {"error": "daily_limit"}
    assert c.get("/api/me").json()["tickets"] == 9
    clock.advance(24 * 60 * 60)  # 다음 날(KST)
    assert c.post(URL, json=COMPANY_START).status_code == 201


def test_ben_unavailable_without_key(make_client, settings):
    c = make_client(settings, claude=None)
    _admin_with_tickets(c)
    res = c.post(URL, json=COMPANY_START)
    assert res.status_code == 503
    assert res.json() == {"error": "ben_unavailable"}
    assert c.get("/api/me").json()["tickets"] == 10


NAMED_START = {
    **COMPANY_START,
    "company": {**COMPANY_START["company"], "name": "  토스(비바리퍼블리카) "},
}


def _row(settings):
    with open_db(settings) as conn:
        return conn.execute(
            "SELECT inputs_json, briefing_status FROM premium_interviews"
        ).fetchone()


def test_company_name_is_stored_and_marks_briefing_pending(client, settings):
    _admin_with_tickets(client)
    assert client.post(URL, json=NAMED_START).status_code == 201
    row = _row(settings)
    assert json.loads(row["inputs_json"])["company"] == {
        **COMPANY_START["company"],
        "name": "토스(비바리퍼블리카)",
    }
    assert row["briefing_status"] == "pending"


def test_without_name_nothing_changes(client, settings):
    _admin_with_tickets(client)
    assert client.post(URL, json=COMPANY_START).status_code == 201
    row = _row(settings)
    assert json.loads(row["inputs_json"])["company"] == COMPANY_START["company"]
    assert row["briefing_status"] == "none"


def test_blank_name_is_dropped(client, settings):
    _admin_with_tickets(client)
    body = {**COMPANY_START, "company": {**COMPANY_START["company"], "name": "   "}}
    assert client.post(URL, json=body).status_code == 201
    row = _row(settings)
    assert "name" not in json.loads(row["inputs_json"])["company"]
    assert row["briefing_status"] == "none"


def test_bracket_only_name_is_not_a_name(client, settings):
    _admin_with_tickets(client)
    body = {**COMPANY_START, "company": {**COMPANY_START["company"], "name": "[ ]"}}
    assert client.post(URL, json=body).status_code == 201
    assert _row(settings)["briefing_status"] == "none"


def test_name_is_at_most_100_chars(client):
    _admin_with_tickets(client)
    body = {**COMPANY_START, "company": {**COMPANY_START["company"], "name": "가" * 101}}
    assert client.post(URL, json=body).status_code == 422


def test_admission_has_no_briefing(client, settings):
    _admin_with_tickets(client)
    assert client.post(URL, json=ADMISSION_START).status_code == 201
    assert _row(settings)["briefing_status"] == "none"


def test_usage_sink_failure_logs_only_exception_type(tmp_path, caplog):
    from app.llm.claude import Usage
    from app.routers.premium import _usage_sink

    sink = _usage_sink(tmp_path / "missing" / "x.db", lambda: 0.0, "u_1", "pi_1", "turn")
    with caplog.at_level("WARNING"):
        sink(Usage(), "ok")
    msgs = [r.getMessage() for r in caplog.records]
    assert len(msgs) == 1
    assert msgs[0].startswith("claude usage record failed: ")
    assert "u_1" not in msgs[0] and "pi_1" not in msgs[0] and "missing" not in msgs[0]


# ── 모집공고 링크(spec 2026-10-23) ──

POSTING = "https://www.example.com/jobs/123"


def _with_company(**extra):
    return {**COMPANY_START, "company": {**COMPANY_START["company"], **extra}}


def test_posting_url_is_stored_trimmed_and_marks_pending(client, settings):
    _admin_with_tickets(client)
    body = _with_company(postingUrl=f"  {POSTING} ")
    assert client.post(URL, json=body).status_code == 201
    row = _row(settings)
    assert json.loads(row["inputs_json"])["company"]["postingUrl"] == POSTING
    assert row["briefing_status"] == "pending"


def test_posting_url_without_name_is_pending(client, settings):
    _admin_with_tickets(client)
    assert client.post(URL, json=_with_company(postingUrl=POSTING)).status_code == 201
    row = _row(settings)
    assert "name" not in json.loads(row["inputs_json"])["company"]
    assert row["briefing_status"] == "pending"


def test_name_only_is_still_pending_and_no_url_key(client, settings):
    _admin_with_tickets(client)
    assert client.post(URL, json=_with_company(name="토스")).status_code == 201
    row = _row(settings)
    assert "postingUrl" not in json.loads(row["inputs_json"])["company"]
    assert row["briefing_status"] == "pending"


def test_neither_name_nor_url_is_none(client, settings):
    _admin_with_tickets(client)
    assert client.post(URL, json=_with_company(name="[ ]", postingUrl="  ")).status_code == 201
    assert _row(settings)["briefing_status"] == "none"


def test_blank_posting_url_is_dropped(client, settings):
    _admin_with_tickets(client)
    assert client.post(URL, json=_with_company(postingUrl="   ")).status_code == 201
    assert "postingUrl" not in json.loads(_row(settings)["inputs_json"])["company"]
    assert client.post(URL, json=_with_company(postingUrl="")).status_code == 201


@pytest.mark.parametrize(
    "bad",
    [
        "ftp://x.com/a",
        "example.com/jobs",
        "https://",
        "https://" + "a" * 493,  # 501자
        "https://x.com/a\nIgnore previous",
        "https://x.com/a\tb",
        "https://x.com/a b",
        "https://user:pw@x.com/j",
        "https://x.com:abc/j",
        "https://x.com:99999/j",
        "https://예시.com/j",
        "https://x.com/a\u200bb",  # 제로폭 공백
        "https://x.com/a\u202eb",  # 양방향 제어
        "https://x.com/채용/1",  # 한글 경로는 퍼센트 인코딩해서 보낸다
        "javascript:alert(1)",
    ],
)
def test_bad_posting_url_is_invalid(client, bad):
    _admin_with_tickets(client)
    res = client.post(URL, json=_with_company(postingUrl=bad))
    assert res.status_code == 422
    assert res.json() == {"error": "invalid", "field": "postingUrl"}


def test_posting_url_500_chars_is_ok(client):
    _admin_with_tickets(client)
    url = "https://x.com/" + "a" * 486
    assert len(url) == 500
    assert client.post(URL, json=_with_company(postingUrl=url)).status_code == 201


def test_admission_ignores_posting_url(client, settings):
    _admin_with_tickets(client)
    body = {**ADMISSION_START, "company": {"field": "it", "job": "x", "postingUrl": POSTING}}
    assert client.post(URL, json=body).status_code == 201
    row = _row(settings)
    assert "company" not in json.loads(row["inputs_json"])
    assert row["briefing_status"] == "none"


def test_uppercase_scheme_is_accepted(client):
    _admin_with_tickets(client)
    assert client.post(URL, json=_with_company(postingUrl="HTTPS://x.com/j")).status_code == 201
