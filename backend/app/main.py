from fastapi import FastAPI

from app.routers import health


def create_app() -> FastAPI:
    app = FastAPI(title="Woo-MoMo API", docs_url=None, redoc_url=None)
    app.include_router(health.router, prefix="/api")
    return app


app = create_app()
