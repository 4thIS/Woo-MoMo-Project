import time
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import Settings
from app.data import (
    DATA_DIR,
    MANIFEST_FILENAME,
    QUESTIONS_DIRNAME,
    load_manifest,
    load_question_sets,
)
from app.errors import install_error_handlers
from app.middleware import OriginGuard
from app.routers import archive, auth, health, manifest, me, questions, resumes
from app.security import RateLimiter
from app.startup import prepare_storage


def create_app(
    data_dir: Path | None = None,
    settings: Settings | None = None,
    clock: Callable[[], float] = time.time,
) -> FastAPI:
    base = data_dir or DATA_DIR
    cfg = settings or Settings.from_env()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        # 깨진 파일은 여기서 예외를 던져 기동 자체를 실패시킨다.
        app.state.manifest = load_manifest(base / MANIFEST_FILENAME)
        app.state.question_sets = load_question_sets(base / QUESTIONS_DIRNAME)
        prepare_storage(cfg, clock())
        yield

    app = FastAPI(title="Woo-MoMo API", docs_url=None, redoc_url=None, lifespan=lifespan)
    app.state.settings = cfg
    app.state.clock = clock
    app.state.limiter = RateLimiter(clock)
    install_error_handlers(app)
    # 마지막에 넣은 미들웨어가 가장 바깥: CORS(프리플라이트) → Origin 확인 → 라우터
    app.add_middleware(OriginGuard, allowed=cfg.cors_origins)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(cfg.cors_origins),
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "DELETE"],
        allow_headers=["Content-Type"],
    )
    app.include_router(health.router, prefix="/api")
    app.include_router(manifest.router, prefix="/api")
    app.include_router(questions.router, prefix="/api")
    app.include_router(auth.router, prefix="/api")
    app.include_router(me.router, prefix="/api")
    app.include_router(resumes.router, prefix="/api")
    app.include_router(archive.router, prefix="/api")
    return app


app = create_app()
