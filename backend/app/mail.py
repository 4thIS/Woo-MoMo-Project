"""메일 발송 — 개인 메일 API(send.ssenu.cloud). 키·주소·본문은 로그와 예외에 남기지 않는다."""

from typing import Protocol

import httpx

USER_AGENT = "woo-momo/1.0"
MAIL_TIMEOUT = 10.0


class MailError(Exception):
    """발송 실패(오류 응답·시간 초과·연결 실패). 메시지에 비밀을 싣지 않는다."""


class Mailer(Protocol):
    def send(self, *, to: str, subject: str, text: str, idempotency_key: str) -> None: ...


class HttpMailer:
    def __init__(self, url: str, api_key: str, *, client: httpx.Client | None = None) -> None:
        self._url = url
        self._api_key = api_key
        self._client = client or httpx.Client(timeout=MAIL_TIMEOUT)

    def send(self, *, to: str, subject: str, text: str, idempotency_key: str) -> None:
        headers = {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
            "Idempotency-Key": idempotency_key,
            "User-Agent": USER_AGENT,
        }
        try:
            res = self._client.post(
                self._url,
                headers=headers,
                json={"to": to, "subject": subject, "text": text},
                timeout=MAIL_TIMEOUT,
            )
        except Exception as e:
            # 예외 문자열에 URL 등이 섞일 수 있어 클래스 이름만 남긴다
            raise MailError(type(e).__name__) from None
        if not res.is_success:
            raise MailError(f"status {res.status_code}")
