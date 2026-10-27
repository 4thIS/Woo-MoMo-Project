"""오류 응답 형식 하나: {"error": code, ...추가 필드} (docs/API.md 공통)."""

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse


class ApiError(Exception):
    def __init__(self, status: int, code: str, **extra: object) -> None:
        super().__init__(code)
        self.status = status
        self.code = code
        self.extra = extra


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def _api_error(_: Request, exc: ApiError) -> JSONResponse:
        return JSONResponse({"error": exc.code, **exc.extra}, status_code=exc.status)

    @app.exception_handler(RequestValidationError)
    async def _validation(_: Request, exc: RequestValidationError) -> JSONResponse:
        errors = exc.errors()
        loc = errors[0].get("loc", ()) if errors else ()
        names = [str(p) for p in reversed(loc) if isinstance(p, str) and p != "body"]
        body: dict[str, object] = {"error": "invalid"}
        if names:
            body["field"] = names[0]
        return JSONResponse(body, status_code=422)
