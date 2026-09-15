from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI

from app.data import (
    DATA_DIR,
    MANIFEST_FILENAME,
    QUESTIONS_DIRNAME,
    load_manifest,
    load_question_sets,
)
from app.routers import health, manifest, questions


def create_app(data_dir: Path | None = None) -> FastAPI:
    base = data_dir or DATA_DIR

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        # 깨진 파일은 여기서 예외를 던져 기동 자체를 실패시킨다.
        app.state.manifest = load_manifest(base / MANIFEST_FILENAME)
        app.state.question_sets = load_question_sets(base / QUESTIONS_DIRNAME)
        yield

    app = FastAPI(title="Woo-MoMo API", docs_url=None, redoc_url=None, lifespan=lifespan)
    app.include_router(health.router, prefix="/api")
    app.include_router(manifest.router, prefix="/api")
    app.include_router(questions.router, prefix="/api")
    return app


app = create_app()
