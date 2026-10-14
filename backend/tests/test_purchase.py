from app.repos.users import TICKETS_PER_PURCHASE
from tests.helpers import login_admin, signup

URL = "/api/premium/purchase"


def test_ten_tickets_per_purchase():
    assert TICKETS_PER_PURCHASE == 10


def test_requires_login(client):
    res = client.post(URL)
    assert res.status_code == 401
    assert res.json() == {"error": "unauthorized"}


def test_member_cannot_purchase(client):
    signup(client)
    res = client.post(URL)
    assert res.status_code == 403
    assert res.json() == {"error": "purchase_disabled"}
    me = client.get("/api/me").json()
    assert (me["tier"], me["tickets"]) == ("member", 0)


def test_admin_gets_ten_tickets_each_time(client):
    login_admin(client)
    first = client.post(URL)
    assert first.status_code == 200
    body = first.json()
    assert (body["tier"], body["tickets"], body["isAdmin"]) == ("premium", 10, True)
    assert client.post(URL).json()["tickets"] == 20
