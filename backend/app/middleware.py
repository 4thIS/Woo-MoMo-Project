"""상태를 바꾸는 요청의 Origin 확인 (spec 4.1 CORS·CSRF)."""

from starlette.datastructures import Headers
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send

STATE_CHANGING = frozenset({"POST", "PUT", "PATCH", "DELETE"})


class OriginGuard:
    def __init__(self, app: ASGIApp, allowed: tuple[str, ...]) -> None:
        self.app = app
        self.allowed = frozenset(allowed)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if (
            scope["type"] == "http"
            and scope["method"] in STATE_CHANGING
            and scope["path"].startswith("/api/")
            and Headers(scope=scope).get("origin") not in self.allowed
        ):
            response = JSONResponse({"error": "bad_origin"}, status_code=403)
            await response(scope, receive, send)
            return
        await self.app(scope, receive, send)
