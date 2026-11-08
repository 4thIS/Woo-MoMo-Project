# backend/app/llm/fetch.py
"""공고 페이지 받기 (spec 2026-11-08 3절). 사용자가 넣은 링크를 서버가 연다 — SSRF를 막는다.

호스트를 IP로 풀어 모두 공개 주소일 때만, 확인한 그 IP로 접속한다(Host·SNI는 원래 이름).
리다이렉트는 직접 따라가며 매번 처음부터 다시 확인한다."""

import ipaddress
import socket
import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any
from urllib.parse import urljoin, urlsplit

import httpx

USER_AGENT = "MoMoBot/1.0"
MAX_BYTES = 2_000_000
MAX_REDIRECTS = 3
ALLOWED_PORTS = {"http": 80, "https": 443}
HTML_TYPES = ("text/html", "application/xhtml+xml")
_BLOCKED_V4 = [ipaddress.ip_network(n) for n in ("100.64.0.0/10", "0.0.0.0/8")]

_NAT64_BLOCKED = ipaddress.ip_network("64:ff9b:1::/48")
_EMBEDDED_V4 = [ipaddress.ip_network("64:ff9b::/96"), ipaddress.ip_network("::/96")]

Resolver = Callable[..., list[Any]]


class FetchError(Exception):
    """열지 않았거나 못 연 경우. 이유 문자열만 담는다(링크·본문 없음)."""


@dataclass(frozen=True)
class FetchedPage:
    url: str
    html: str


def is_public_ip(ip: str) -> bool:
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return False
    if isinstance(addr, ipaddress.IPv6Address):
        if addr in _NAT64_BLOCKED:
            return False
        if addr.ipv4_mapped is not None:
            addr = addr.ipv4_mapped
        elif any(addr in n for n in _EMBEDDED_V4) and int(addr) > 0:
            # NAT64·IPv4 호환 주소는 끝 32비트의 IPv4로 다시 판정한다
            addr = ipaddress.IPv4Address(int(addr) & 0xFFFFFFFF)
    if isinstance(addr, ipaddress.IPv4Address) and any(addr in n for n in _BLOCKED_V4):
        return False
    return addr.is_global and not addr.is_multicast


def _checked(url: str, resolver: Resolver, deadline: float) -> tuple[httpx.URL, str]:
    parts = urlsplit(url)
    scheme = (parts.scheme or "").lower()
    if scheme not in ALLOWED_PORTS or not parts.hostname:
        raise FetchError("scheme")
    try:
        port = parts.port or ALLOWED_PORTS[scheme]
    except ValueError as exc:
        raise FetchError("port") from exc
    if port != ALLOWED_PORTS[scheme]:
        raise FetchError("port")
    if parts.username is not None or parts.password is not None:
        raise FetchError("userinfo")
    try:
        host = parts.hostname.encode("idna").decode("ascii")
    except UnicodeError as exc:
        raise FetchError("host") from exc
    try:
        infos = resolver(host, port, 0, socket.SOCK_STREAM)
    except OSError as exc:
        raise FetchError("dns") from exc
    # 느린 DNS의 실제 상한은 호출한 쪽(Task 5)이 느린 작업을 버려서 지킨다.
    # 여기서는 끝난 뒤 기한이 지났는지만 확인한다
    if time.monotonic() > deadline:
        raise FetchError("timeout")
    ips = [info[4][0] for info in infos]
    if not ips or not all(is_public_ip(ip) for ip in ips):
        raise FetchError("blocked")
    ip = ips[0]
    try:
        target = httpx.URL(url).copy_with(scheme=scheme, host=ip, port=None)
    except (ValueError, httpx.InvalidURL) as exc:
        raise FetchError("url") from exc
    return target, host


def fetch_html(
    url: str,
    *,
    timeout: float = 3.0,
    resolver: Resolver = socket.getaddrinfo,
    transport: httpx.BaseTransport | None = None,
) -> FetchedPage:
    deadline = time.monotonic() + timeout
    with httpx.Client(transport=transport, follow_redirects=False, trust_env=False) as client:
        current = url
        for _ in range(MAX_REDIRECTS + 1):
            target, host = _checked(current, resolver, deadline)
            left = deadline - time.monotonic()
            if left <= 0:
                raise FetchError("timeout")
            try:
                req = client.build_request(
                    "GET",
                    target,
                    headers={
                        "Host": host,
                        "User-Agent": USER_AGENT,
                        "Accept": "text/html",
                        "Accept-Encoding": "identity",
                    },
                    extensions={"sni_hostname": host, "timeout": httpx.Timeout(left).as_dict()},
                )
            except (ValueError, httpx.HTTPError) as exc:
                raise FetchError("request") from exc
            try:
                resp = client.send(req, stream=True)
            except httpx.HTTPError as exc:
                raise FetchError("http") from exc
            try:
                if resp.is_redirect:
                    location = resp.headers.get("location")
                    if not location:
                        raise FetchError("redirect")
                    current = urljoin(current, location)
                    continue
                if resp.status_code != 200:
                    raise FetchError("status")
                ctype = resp.headers.get("content-type", "").split(";")[0].strip().lower()
                if ctype not in HTML_TYPES:
                    raise FetchError("type")
                body = bytearray()
                try:
                    for chunk in resp.iter_bytes():
                        body += chunk
                        if len(body) > MAX_BYTES:
                            raise FetchError("too_big")
                        if time.monotonic() > deadline:
                            raise FetchError("timeout")
                except httpx.HTTPError as exc:
                    raise FetchError("http") from exc
                encoding = resp.charset_encoding or "utf-8"
                try:
                    html = bytes(body).decode(encoding, errors="replace")
                except LookupError:
                    html = bytes(body).decode("utf-8", errors="replace")
                return FetchedPage(url=current, html=html)
            finally:
                resp.close()
        raise FetchError("redirects")
