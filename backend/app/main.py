from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.data import (
    DATA_DIR,
    MANIFEST_FILENAME,
    QUESTIONS_DIRNAME,
    load_manifest,
    load_question_sets,
)
from app.routers import health, manifest, questions

DEV_ORIGINS = ["http://localhost:5173"]


def create_app(data_dir: Path | None = None) -> FastAPI:
    base = data_dir or DATA_DIR

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        # 깨진 파일은 여기서 예외를 던져 기동 자체를 실패시킨다.
        app.state.manifest = load_manifest(base / MANIFEST_FILENAME)
        app.state.question_sets = load_question_sets(base / QUESTIONS_DIRNAME)
        yield

    app = FastAPI(title="Woo-MoMo API", docs_url=None, redoc_url=None, lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=DEV_ORIGINS,
        allow_methods=["GET"],
        allow_headers=["*"],
    )
    app.include_router(health.router, prefix="/api")
    app.include_router(manifest.router, prefix="/api")
    app.include_router(questions.router, prefix="/api")
    return app


app = create_app()
