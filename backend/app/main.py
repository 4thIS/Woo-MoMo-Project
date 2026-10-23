import threading
import time
from collections.abc import AsyncIterator, Callable
from concurrent.futures import ThreadPoolExecutor
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
from app.llm.baze import BazeClient, VoiceAnalyzer
from app.llm.claude import AnthropicClaude, ClaudeClient
from app.middleware import OriginGuard
from app.routers import (
    admin,
    archive,
    auth,
    health,
    manifest,
    me,
    premium,
    questions,
    recordings,
    resumes,
)
from app.security import RateLimiter
from app.startup import prepare_storage


def _default_claude(cfg: Settings) -> ClaudeClient | None:
    # 키가 없으면 벤을 끈다(시작에서 503 ben_unavailable, 티켓 차감 없음)
    return AnthropicClaude(cfg.anthropic_api_key) if cfg.anthropic_api_key else None


CREDIT_REFRESH_SECONDS = 30 * 60


def _credit_loop(baze: VoiceAnalyzer, stop: threading.Event) -> None:
    """기동 직후와 30분마다 잔액을 확인한다. 실패는 무시한다(키 값은 남기지 않는다)."""
    while not stop.is_set():
        try:
            baze.refresh_credits()
        except Exception:
            pass
        stop.wait(CREDIT_REFRESH_SECONDS)


def create_app(
    data_dir: Path | None = None,
    settings: Settings | None = None,
    clock: Callable[[], float] = time.time,
    claude: ClaudeClient | None = None,
    baze: VoiceAnalyzer | None = None,
) -> FastAPI:
    base = data_dir or DATA_DIR
    cfg = settings or Settings.from_env()
    # 주입한 대역은 잔액 확인 스레드를 돌리지 않는다. 키가 있을 때만 실물을 만든다
    own_baze: BazeClient | None = BazeClient(cfg) if baze is None and cfg.baze_api_keys else None

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        # 깨진 파일은 여기서 예외를 던져 기동 자체를 실패시킨다.
        app.state.manifest = load_manifest(base / MANIFEST_FILENAME)
        app.state.question_sets = load_question_sets(base / QUESTIONS_DIRNAME)
        prepare_storage(cfg, clock())
        stop = threading.Event()
        if own_baze is not None:
            threading.Thread(
                target=_credit_loop, args=(own_baze, stop), name="baze-credits", daemon=True
            ).start()
        try:
            yield
        finally:
            stop.set()
            app.state.voice_pool.shutdown(wait=True)

    app = FastAPI(title="Woo-MoMo API", docs_url=None, redoc_url=None, lifespan=lifespan)
    app.state.settings = cfg
    app.state.clock = clock
    app.state.limiter = RateLimiter(clock)
    app.state.claude = claude if claude is not None else _default_claude(cfg)
    app.state.baze = baze if baze is not None else own_baze
    app.state.voice_pool = ThreadPoolExecutor(max_workers=2, thread_name_prefix="voice")
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
    app.include_router(premium.router, prefix="/api")
    app.include_router(recordings.router, prefix="/api")
    app.include_router(admin.router, prefix="/api")
    return app


app = create_app()
