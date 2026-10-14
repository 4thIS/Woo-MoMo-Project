"""비밀번호 해시, 세션 토큰, 메모리 요청 수 제한 (spec 4.1)."""

import hashlib
import secrets
import time
from collections import deque
from collections.abc import Callable
from functools import cache

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from fastapi import Request

_hasher = PasswordHasher()


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    try:
        return _hasher.verify(password_hash, password)
    except (VerificationError, InvalidHashError):
        return False


@cache
def _dummy_hash() -> str:
    return _hasher.hash("momo-dummy-password-for-timing")


def burn_password_check(password: str) -> None:
    """계정이 없어도 같은 시간 동안 검증한다(응답 시간으로 가입 여부를 흘리지 않게)."""
    verify_password(_dummy_hash(), password)


def new_session_token() -> str:
    return secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


class RateLimiter:
    """키마다 최근 window초의 요청 시각을 든다. 워커 1개라 메모리로 충분하다."""

    def __init__(self, clock: Callable[[], float] = time.monotonic) -> None:
        self._clock = clock
        self._hits: dict[str, deque[float]] = {}

    def allow(self, key: str, limit: int, window: float = 60.0) -> bool:
        now = self._clock()
        hits = self._hits.get(key, deque())
        while hits and hits[0] <= now - window:
            hits.popleft()
        allowed = len(hits) < limit
        if allowed:
            hits.append(now)
        if hits:
            self._hits[key] = hits
        else:
            self._hits.pop(key, None)
        if len(self._hits) > 1024:
            self._sweep(now, window)
        return allowed

    def _sweep(self, now: float, window: float) -> None:
        """최근 요청이 창 밖으로 나간 키를 모두 지운다(드물게만 실행)."""
        stale = [k for k, hits in self._hits.items() if hits[-1] <= now - window]
        for k in stale:
            del self._hits[k]


def client_ip(request: Request) -> str:
    forwarded = request.headers.get("cf-connecting-ip")
    if forwarded and forwarded.strip():
        return forwarded.strip()
    return request.client.host if request.client else "unknown"
