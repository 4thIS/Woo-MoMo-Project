import json
from collections.abc import Callable, Iterator
from contextlib import ExitStack
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.llm.claude import ClaudeClient
from app.main import create_app
from tests.fakes import FakeClaude, FakeClock
from tests.helpers import ADMIN_LOGIN, ADMIN_PASSWORD, ORIGIN

REPO_DATA = Path(__file__).resolve().parents[1] / "data"


@pytest.fixture
def clock() -> FakeClock:
    return FakeClock()


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    # 테스트마다 새 DATA_DIR. 관리자 계정은 Task 14부터 기동 때 만들어진다.
    return Settings(
        storage_dir=tmp_path / "storage",
        cookie_secure=False,
        admin_login=ADMIN_LOGIN,
        admin_password=ADMIN_PASSWORD,
    )


@pytest.fixture
def fake_claude() -> FakeClaude:
    return FakeClaude()


@pytest.fixture
def make_client(clock: FakeClock, fake_claude: FakeClaude) -> Iterator[Callable[..., TestClient]]:
    with ExitStack() as stack:

        def _make(s: Settings, claude: ClaudeClient | None = fake_claude) -> TestClient:
            # claude=None이면 설정(ANTHROPIC_API_KEY)에 맡긴다 — 테스트 설정엔 키가 없어 None
            app = create_app(settings=s, clock=clock, claude=claude)
            return stack.enter_context(TestClient(app, headers={"Origin": ORIGIN}))

        yield _make


@pytest.fixture
def client(make_client: Callable[[Settings], TestClient], settings: Settings) -> TestClient:
    return make_client(settings)


@pytest.fixture
def repo_manifest() -> dict:
    return json.loads((REPO_DATA / "manifest.json").read_text(encoding="utf-8"))


@pytest.fixture
def broken_data_dir(tmp_path: Path) -> Path:
    (tmp_path / "manifest.json").write_text("{ broken", encoding="utf-8")
    (tmp_path / "questions").mkdir()
    return tmp_path
