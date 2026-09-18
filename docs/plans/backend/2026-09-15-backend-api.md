# backend API — 구현 계획 (plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

- 생성일시: 2026-09-15
- 기준 spec: `docs/specs/backend/2026-09-15-backend-api-design.md`
- 계약 문서: `docs/API.md`
- 담당: @ssenu / 브랜치: `cw`

**Goal:** FastAPI로 `/api/manifest`, `/api/questions/{field}`, `/api/health` 세 엔드포인트를 `docs/API.md`와 일치하게 만들고, nginx + docker-compose로 라즈베리파이(arm64)에 올릴 수 있는 배포 구성을 만든다.

> **갱신 노트(2026-09-18):** 이 plan은 구현 완료(머지) 기록이다. 아래의 "매니페스트 `url`은 `/models/`로 시작하는 상대 경로만 허용" 제약과 예시 값은 2026-09-17 Hugging Face 전환으로 바뀌었다. 지금은 `/models/` 또는 `https://huggingface.co/`를 허용하고 매니페스트는 HF 커밋 고정 주소를 쓴다. 기준: `docs/specs/backend/2026-09-17-model-hosting-hf-design.md`, `docs/API.md`.

**Architecture:** `backend/app/schemas.py`가 응답 형태의 단일 정의(pydantic v2). `backend/app/data.py`가 기동 시 `backend/data/*.json`을 읽어 스키마 검증 후 `app.state`에 보관하고, 라우터는 그 객체를 그대로 반환한다. 파일이 깨지면 기동 실패. `deploy/`는 nginx(정적 + `/models/` Range 서빙 + `/api/` 프록시)와 FastAPI 두 컨테이너를 docker-compose로 묶는다.

**Tech Stack:** Python 3.12, uv, FastAPI, pydantic v2, uvicorn, pytest + httpx, ruff / nginx:alpine, docker compose

## Global Constraints

- 자기 영역(`backend/`)만. `deploy/`는 공동 영역이지만 이 plan에서 초기 생성한다(리뷰 @leemonta9482).
- 이력서·대화·리포트를 받는 엔드포인트를 만들지 않는다. GET만 존재한다.
- 데이터베이스·인증·세션 없음. 의존성은 fastapi, uvicorn, pydantic만(테스트·린트는 dev 그룹).
- `data/` 파일은 기동 시 한 번 읽고 검증한다. 깨진 파일은 기동 실패로 드러나야 한다.
- 매니페스트 `url`은 `/models/`로 시작하는 상대 경로만 허용.
- 미등록 field는 `general`로 대체하고 200을 반환한다(404 아님).
- CORS는 `http://localhost:5173`만 허용(로컬 개발용).
- 계약 변경 없음. `docs/API.md` 초기 정의를 그대로 구현한다.
- 모델 파일은 리포·이미지에 넣지 않는다.
- 커밋은 Conventional Commits: `feat(backend):`, `test(backend):`, `chore(infra):`.
- 모든 명령은 `backend/` 디렉터리에서 실행한다(별도 표기 없으면).

## 파일 구조

```
backend/
├── pyproject.toml          # uv 프로젝트, ruff·pytest 설정
├── uv.lock                 # uv sync가 생성
├── app/
│   ├── __init__.py
│   ├── main.py             # create_app(), lifespan에서 data 로드, 라우터 등록, CORS
│   ├── schemas.py          # Manifest, ModelRef, ChatTemplate, QuestionSet
│   ├── data.py             # load_manifest, load_question_sets, DATA_DIR
│   └── routers/
│       ├── __init__.py
│       ├── health.py
│       ├── manifest.py
│       └── questions.py
├── data/
│   ├── manifest.json
│   └── questions/
│       ├── general.json, it.json, finance.json, manufacturing.json, retail.json
└── tests/
    ├── conftest.py         # client fixture (실제 data/ 사용), tmp data 헬퍼
    ├── test_health.py
    ├── test_schemas.py
    ├── test_data.py
    ├── test_manifest.py
    └── test_questions.py
deploy/
├── api.Dockerfile
├── web.Dockerfile
├── nginx.conf
└── docker-compose.yml
```

---

### Task 1: 프로젝트 초기화 + `/api/health`

**Files:**
- Create: `backend/pyproject.toml`, `backend/app/__init__.py`, `backend/app/main.py`, `backend/app/routers/__init__.py`, `backend/app/routers/health.py`
- Test: `backend/tests/conftest.py`, `backend/tests/test_health.py`

**Interfaces:**
- Produces: `app.main.create_app() -> FastAPI`, `app.main.app` (uvicorn 진입점), pytest fixture `client: TestClient`

- [ ] **Step 1: pyproject 작성**

`backend/pyproject.toml`:

```toml
[project]
name = "woo-momo-backend"
version = "0.1.0"
description = "Woo-MoMo mock interview backend: manifest, fallback questions, health"
requires-python = ">=3.12"
dependencies = [
    "fastapi>=0.115",
    "uvicorn[standard]>=0.30",
    "pydantic>=2.8",
]

[dependency-groups]
dev = [
    "pytest>=8",
    "httpx>=0.27",
    "ruff>=0.7",
]

[tool.ruff]
line-length = 100
target-version = "py312"

[tool.ruff.lint]
select = ["E", "F", "I", "B", "UP"]

[tool.pytest.ini_options]
testpaths = ["tests"]
```

Run: `uv sync` → `uv.lock` 생성, `.venv` 생성.

- [ ] **Step 2: 실패하는 테스트**

`backend/tests/conftest.py`:

```python
import pytest
from fastapi.testclient import TestClient

from app.main import create_app


@pytest.fixture
def client() -> TestClient:
    with TestClient(create_app()) as c:
        yield c
```

`backend/tests/test_health.py`:

```python
def test_health_returns_ok(client):
    res = client.get("/api/health")
    assert res.status_code == 200
    assert res.json() == {"status": "ok"}
```

- [ ] **Step 3: 실패 확인**

Run: `uv run pytest -q tests/test_health.py`
Expected: FAIL — `ModuleNotFoundError: No module named 'app'`

- [ ] **Step 4: 최소 구현**

`backend/app/__init__.py`: 빈 파일.

`backend/app/routers/__init__.py`: 빈 파일.

`backend/app/routers/health.py`:

```python
from fastapi import APIRouter

router = APIRouter()


@router.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
```

`backend/app/main.py`:

```python
from fastapi import FastAPI

from app.routers import health


def create_app() -> FastAPI:
    app = FastAPI(title="Woo-MoMo API", docs_url=None, redoc_url=None)
    app.include_router(health.router, prefix="/api")
    return app


app = create_app()
```

- [ ] **Step 5: 통과 확인**

Run: `uv run pytest -q tests/test_health.py`
Expected: `1 passed`

- [ ] **Step 6: 커밋**

```bash
git add backend/pyproject.toml backend/uv.lock backend/app backend/tests
git commit -m "feat(backend): FastAPI 프로젝트 초기화 및 /api/health"
```

---

### Task 2: 응답 스키마 (pydantic)

**Files:**
- Create: `backend/app/schemas.py`
- Test: `backend/tests/test_schemas.py`

**Interfaces:**
- Produces:
  - `ChatTemplate(turnStart: str, turnEnd: str, roles: dict[str, str])`
  - `ModelRef(id: str, url: str, size: int)` — `url`은 `/models/`로 시작해야 함, `size > 0`
  - `Manifest(id, url, size, template: ChatTemplate, systemPromptOverride: str | None, fallback: ModelRef | None)` — `url`·`size` 제약 동일
  - `QuestionSet(field: str, questions: list[str])` — 질문은 정확히 5개, 빈 문자열 금지

- [ ] **Step 1: 실패하는 테스트**

`backend/tests/test_schemas.py`:

```python
import pytest
from pydantic import ValidationError

from app.schemas import ChatTemplate, Manifest, ModelRef, QuestionSet

TEMPLATE = {
    "turnStart": "<|turn>",
    "turnEnd": "<turn|>",
    "roles": {"system": "system", "user": "user", "model": "model"},
}


def _manifest(**over):
    base = {
        "id": "gemma4-e4b-it",
        "url": "/models/gemma4-e4b-it-web.litertlm",
        "size": 4400000000,
        "template": TEMPLATE,
        "systemPromptOverride": None,
        "fallback": {
            "id": "gemma4-e2b-it",
            "url": "/models/gemma4-e2b-it-web.litertlm",
            "size": 2000000000,
        },
    }
    base.update(over)
    return base


def test_manifest_parses_api_example():
    m = Manifest.model_validate(_manifest())
    assert m.id == "gemma4-e4b-it"
    assert isinstance(m.template, ChatTemplate)
    assert isinstance(m.fallback, ModelRef)
    assert m.fallback.id == "gemma4-e2b-it"


def test_manifest_allows_null_fallback_and_override():
    m = Manifest.model_validate(_manifest(fallback=None))
    assert m.fallback is None
    assert m.systemPromptOverride is None


def test_manifest_rejects_external_url():
    with pytest.raises(ValidationError):
        Manifest.model_validate(_manifest(url="https://huggingface.co/x.litertlm"))


def test_manifest_rejects_non_positive_size():
    with pytest.raises(ValidationError):
        Manifest.model_validate(_manifest(size=0))


def test_fallback_url_must_be_under_models():
    bad = {"id": "x", "url": "/static/x.litertlm", "size": 1}
    with pytest.raises(ValidationError):
        Manifest.model_validate(_manifest(fallback=bad))


def test_manifest_serializes_with_camel_case_keys():
    data = Manifest.model_validate(_manifest()).model_dump()
    assert "systemPromptOverride" in data
    assert "turnStart" in data["template"]


def test_question_set_requires_exactly_five():
    QuestionSet(field="it", questions=["q1", "q2", "q3", "q4", "q5"])
    with pytest.raises(ValidationError):
        QuestionSet(field="it", questions=["q1", "q2"])


def test_question_set_rejects_blank_question():
    with pytest.raises(ValidationError):
        QuestionSet(field="it", questions=["q1", " ", "q3", "q4", "q5"])
```

- [ ] **Step 2: 실패 확인**

Run: `uv run pytest -q tests/test_schemas.py`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.schemas'`

- [ ] **Step 3: 구현**

`backend/app/schemas.py`:

```python
from typing import Annotated

from pydantic import BaseModel, Field, field_validator

MODELS_PREFIX = "/models/"


def _validate_model_url(url: str) -> str:
    if not url.startswith(MODELS_PREFIX):
        raise ValueError(f"model url must start with {MODELS_PREFIX!r}")
    return url


class ChatTemplate(BaseModel):
    turnStart: str
    turnEnd: str
    roles: dict[str, str]


class ModelRef(BaseModel):
    id: str = Field(min_length=1)
    url: str
    size: Annotated[int, Field(gt=0)]

    @field_validator("url")
    @classmethod
    def _url(cls, v: str) -> str:
        return _validate_model_url(v)


class Manifest(ModelRef):
    template: ChatTemplate
    systemPromptOverride: str | None = None
    fallback: ModelRef | None = None


class QuestionSet(BaseModel):
    field: str = Field(min_length=1)
    questions: Annotated[list[str], Field(min_length=5, max_length=5)]

    @field_validator("questions")
    @classmethod
    def _non_blank(cls, v: list[str]) -> list[str]:
        if any(not q.strip() for q in v):
            raise ValueError("questions must not be blank")
        return v
```

- [ ] **Step 4: 통과 확인**

Run: `uv run pytest -q tests/test_schemas.py`
Expected: `8 passed`

- [ ] **Step 5: 커밋**

```bash
git add backend/app/schemas.py backend/tests/test_schemas.py
git commit -m "feat(backend): 매니페스트·질문 세트 pydantic 스키마"
```

---

### Task 3: 데이터 파일 + 로더 (기동 시 검증)

**Files:**
- Create: `backend/app/data.py`, `backend/data/manifest.json`, `backend/data/questions/general.json`, `it.json`, `finance.json`, `manufacturing.json`, `retail.json`
- Test: `backend/tests/test_data.py`

**Interfaces:**
- Consumes: `Manifest`, `QuestionSet` (Task 2)
- Produces:
  - `app.data.DATA_DIR: Path` — 기본 `backend/data`, 환경변수 `MOMO_DATA_DIR`로 재정의
  - `app.data.load_manifest(path: Path) -> Manifest` — 파일 없음·JSON 오류·검증 실패 시 예외 전파
  - `app.data.load_question_sets(dir: Path) -> dict[str, QuestionSet]` — 키는 파일명 stem. `general` 없으면 `ValueError`
  - `app.data.QUESTIONS_DIRNAME = "questions"`, `MANIFEST_FILENAME = "manifest.json"`

- [ ] **Step 1: 데이터 파일 작성**

`backend/data/manifest.json`:

```json
{
  "id": "gemma4-e4b-it",
  "url": "/models/gemma4-e4b-it-web.litertlm",
  "size": 4400000000,
  "template": {
    "turnStart": "<|turn>",
    "turnEnd": "<turn|>",
    "roles": { "system": "system", "user": "user", "model": "model" }
  },
  "systemPromptOverride": null,
  "fallback": {
    "id": "gemma4-e2b-it",
    "url": "/models/gemma4-e2b-it-web.litertlm",
    "size": 2000000000
  }
}
```

`backend/data/questions/general.json`:

```json
{
  "field": "general",
  "questions": [
    "간단히 자기소개를 해주세요.",
    "이력서에 적은 경험 중 가장 자신 있는 것을 하나 골라 설명해 주세요.",
    "협업 중 의견이 달랐던 경험과 그때 어떻게 대처했는지 말씀해 주세요.",
    "지원 직무에서 본인의 강점과 보완할 점은 무엇인가요?",
    "우리 회사에 지원한 이유는 무엇인가요?"
  ]
}
```

`backend/data/questions/it.json`:

```json
{
  "field": "it",
  "questions": [
    "간단히 자기소개를 해주세요.",
    "이력서에 적은 프로젝트 중 가장 어려웠던 기술 문제와 해결 과정을 설명해 주세요.",
    "코드 리뷰나 협업 과정에서 갈등이 있었던 경험과 대처 방법을 말씀해 주세요.",
    "최근에 새로 학습한 기술이 있다면 무엇이고, 왜 그것을 선택했나요?",
    "우리 회사와 이 직무에 지원한 이유는 무엇인가요?"
  ]
}
```

`backend/data/questions/finance.json`:

```json
{
  "field": "finance",
  "questions": [
    "간단히 자기소개를 해주세요.",
    "숫자나 데이터를 근거로 의사결정을 내렸던 경험을 말씀해 주세요.",
    "규정이나 절차를 지키는 것과 효율 사이에서 고민했던 경험이 있나요?",
    "최근 관심 있게 본 금융·경제 이슈와 그에 대한 본인의 생각은 무엇인가요?",
    "우리 회사와 이 직무에 지원한 이유는 무엇인가요?"
  ]
}
```

`backend/data/questions/manufacturing.json`:

```json
{
  "field": "manufacturing",
  "questions": [
    "간단히 자기소개를 해주세요.",
    "품질이나 안전 문제를 발견하고 개선했던 경험이 있다면 설명해 주세요.",
    "현장이나 팀에서 일정 압박 속에 우선순위를 정했던 경험을 말씀해 주세요.",
    "반복적인 업무에서 효율을 높였던 방법이 있나요?",
    "우리 회사와 이 직무에 지원한 이유는 무엇인가요?"
  ]
}
```

`backend/data/questions/retail.json`:

```json
{
  "field": "retail",
  "questions": [
    "간단히 자기소개를 해주세요.",
    "고객의 불만이나 어려운 요구를 처리했던 경험을 말씀해 주세요.",
    "매출이나 고객 만족을 높이기 위해 직접 시도해 본 것이 있나요?",
    "여러 사람과 교대·협업하며 일할 때 중요하게 생각하는 점은 무엇인가요?",
    "우리 회사와 이 직무에 지원한 이유는 무엇인가요?"
  ]
}
```

- [ ] **Step 2: 실패하는 테스트**

`backend/tests/test_data.py`:

```python
import json
from pathlib import Path

import pytest

from app.data import DATA_DIR, load_manifest, load_question_sets
from app.schemas import Manifest, QuestionSet

REPO_DATA = Path(__file__).resolve().parents[1] / "data"


def test_data_dir_defaults_to_backend_data():
    assert DATA_DIR == REPO_DATA


def test_load_manifest_reads_repo_file():
    m = load_manifest(REPO_DATA / "manifest.json")
    assert isinstance(m, Manifest)
    assert m.url.startswith("/models/")


def test_load_question_sets_reads_all_five_fields():
    sets = load_question_sets(REPO_DATA / "questions")
    assert set(sets) == {"general", "it", "finance", "manufacturing", "retail"}
    assert all(isinstance(s, QuestionSet) for s in sets.values())
    assert all(key == s.field for key, s in sets.items())


def test_load_manifest_raises_on_invalid_json(tmp_path: Path):
    bad = tmp_path / "manifest.json"
    bad.write_text("{ not json", encoding="utf-8")
    with pytest.raises(json.JSONDecodeError):
        load_manifest(bad)


def test_load_manifest_raises_on_schema_violation(tmp_path: Path):
    bad = tmp_path / "manifest.json"
    bad.write_text(json.dumps({"id": "x", "url": "/models/x", "size": -1}), encoding="utf-8")
    with pytest.raises(Exception):
        load_manifest(bad)


def test_load_question_sets_requires_general(tmp_path: Path):
    qdir = tmp_path / "questions"
    qdir.mkdir()
    (qdir / "it.json").write_text(
        json.dumps({"field": "it", "questions": ["1", "2", "3", "4", "5"]}), encoding="utf-8"
    )
    with pytest.raises(ValueError, match="general"):
        load_question_sets(qdir)


def test_load_question_sets_rejects_field_mismatch(tmp_path: Path):
    qdir = tmp_path / "questions"
    qdir.mkdir()
    (qdir / "general.json").write_text(
        json.dumps({"field": "it", "questions": ["1", "2", "3", "4", "5"]}), encoding="utf-8"
    )
    with pytest.raises(ValueError, match="field"):
        load_question_sets(qdir)
```

- [ ] **Step 3: 실패 확인**

Run: `uv run pytest -q tests/test_data.py`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.data'`

- [ ] **Step 4: 구현**

`backend/app/data.py`:

```python
import json
import os
from pathlib import Path

from app.schemas import Manifest, QuestionSet

MANIFEST_FILENAME = "manifest.json"
QUESTIONS_DIRNAME = "questions"
DEFAULT_FIELD = "general"

DATA_DIR = Path(os.environ.get("MOMO_DATA_DIR", Path(__file__).resolve().parents[1] / "data"))


def _read_json(path: Path) -> object:
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def load_manifest(path: Path) -> Manifest:
    return Manifest.model_validate(_read_json(path))


def load_question_sets(directory: Path) -> dict[str, QuestionSet]:
    sets: dict[str, QuestionSet] = {}
    for file in sorted(directory.glob("*.json")):
        qs = QuestionSet.model_validate(_read_json(file))
        if qs.field != file.stem:
            raise ValueError(f"{file.name}: field {qs.field!r} does not match filename")
        sets[file.stem] = qs
    if DEFAULT_FIELD not in sets:
        raise ValueError(f"{DEFAULT_FIELD}.json is required in {directory}")
    return sets
```

- [ ] **Step 5: 통과 확인**

Run: `uv run pytest -q tests/test_data.py`
Expected: `7 passed`

- [ ] **Step 6: 커밋**

```bash
git add backend/app/data.py backend/data backend/tests/test_data.py
git commit -m "feat(backend): 매니페스트·폴백 질문 데이터 파일과 기동 시 검증 로더"
```

---

### Task 4: `/api/manifest` + `/api/questions/{field}` + lifespan 로드

**Files:**
- Modify: `backend/app/main.py`
- Create: `backend/app/routers/manifest.py`, `backend/app/routers/questions.py`
- Modify: `backend/tests/conftest.py`
- Test: `backend/tests/test_manifest.py`, `backend/tests/test_questions.py`

**Interfaces:**
- Consumes: `load_manifest`, `load_question_sets`, `DATA_DIR`, `MANIFEST_FILENAME`, `QUESTIONS_DIRNAME`, `DEFAULT_FIELD` (Task 3)
- Produces:
  - `create_app(data_dir: Path | None = None) -> FastAPI` — `None`이면 `DATA_DIR`
  - `app.state.manifest: Manifest`, `app.state.question_sets: dict[str, QuestionSet]` (lifespan에서 채움)
  - `GET /api/manifest -> Manifest`, `GET /api/questions/{field} -> QuestionSet`

- [ ] **Step 1: 실패하는 테스트**

`backend/tests/conftest.py` 전체 교체:

```python
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import create_app

REPO_DATA = Path(__file__).resolve().parents[1] / "data"


@pytest.fixture
def client() -> TestClient:
    with TestClient(create_app()) as c:
        yield c


@pytest.fixture
def repo_manifest() -> dict:
    return json.loads((REPO_DATA / "manifest.json").read_text(encoding="utf-8"))


@pytest.fixture
def broken_data_dir(tmp_path: Path) -> Path:
    (tmp_path / "manifest.json").write_text("{ broken", encoding="utf-8")
    (tmp_path / "questions").mkdir()
    return tmp_path
```

`backend/tests/test_manifest.py`:

```python
import pytest
from fastapi.testclient import TestClient

from app.main import create_app


def test_manifest_matches_repo_file(client, repo_manifest):
    res = client.get("/api/manifest")
    assert res.status_code == 200
    assert res.json() == repo_manifest


def test_manifest_has_contract_keys(client):
    body = client.get("/api/manifest").json()
    assert set(body) == {"id", "url", "size", "template", "systemPromptOverride", "fallback"}
    assert set(body["template"]) == {"turnStart", "turnEnd", "roles"}


def test_app_fails_to_start_on_broken_data(broken_data_dir):
    with pytest.raises(Exception):
        with TestClient(create_app(data_dir=broken_data_dir)):
            pass
```

`backend/tests/test_questions.py`:

```python
import pytest


@pytest.mark.parametrize("field", ["general", "it", "finance", "manufacturing", "retail"])
def test_known_field_returns_its_set(client, field):
    res = client.get(f"/api/questions/{field}")
    assert res.status_code == 200
    body = res.json()
    assert body["field"] == field
    assert len(body["questions"]) == 5


def test_unknown_field_falls_back_to_general_with_200(client):
    res = client.get("/api/questions/aerospace")
    assert res.status_code == 200
    assert res.json()["field"] == "general"


def test_field_lookup_is_case_insensitive(client):
    assert client.get("/api/questions/IT").json()["field"] == "it"
```

- [ ] **Step 2: 실패 확인**

Run: `uv run pytest -q tests/test_manifest.py tests/test_questions.py`
Expected: FAIL — `/api/manifest` 404, `create_app() got an unexpected keyword argument 'data_dir'`

- [ ] **Step 3: 구현**

`backend/app/routers/manifest.py`:

```python
from fastapi import APIRouter, Request

from app.schemas import Manifest

router = APIRouter()


@router.get("/manifest", response_model=Manifest)
def get_manifest(request: Request) -> Manifest:
    return request.app.state.manifest
```

`backend/app/routers/questions.py`:

```python
from fastapi import APIRouter, Request

from app.data import DEFAULT_FIELD
from app.schemas import QuestionSet

router = APIRouter()


@router.get("/questions/{field}", response_model=QuestionSet)
def get_questions(field: str, request: Request) -> QuestionSet:
    sets: dict[str, QuestionSet] = request.app.state.question_sets
    return sets.get(field.lower(), sets[DEFAULT_FIELD])
```

`backend/app/main.py` 전체 교체:

```python
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
```

- [ ] **Step 4: 통과 확인**

Run: `uv run pytest -q`
Expected: `24 passed` (health 1 + schemas 8 + data 7 + manifest 3 + questions 7). `test_health.py`의 client fixture는 그대로 동작한다.

- [ ] **Step 5: 커밋**

```bash
git add backend/app backend/tests
git commit -m "feat(backend): /api/manifest, /api/questions/{field} 및 기동 시 데이터 로드"
```

---

### Task 5: 로컬 개발용 CORS

**Files:**
- Modify: `backend/app/main.py`
- Test: `backend/tests/test_cors.py`

**Interfaces:**
- Produces: `app.main.DEV_ORIGINS = ["http://localhost:5173"]`

- [ ] **Step 1: 실패하는 테스트**

`backend/tests/test_cors.py`:

```python
def test_vite_dev_origin_is_allowed(client):
    res = client.get("/api/health", headers={"Origin": "http://localhost:5173"})
    assert res.headers.get("access-control-allow-origin") == "http://localhost:5173"


def test_other_origin_is_not_allowed(client):
    res = client.get("/api/health", headers={"Origin": "https://evil.example"})
    assert "access-control-allow-origin" not in res.headers
```

- [ ] **Step 2: 실패 확인**

Run: `uv run pytest -q tests/test_cors.py`
Expected: FAIL — 첫 테스트에서 `None == "http://localhost:5173"`

- [ ] **Step 3: 구현**

`backend/app/main.py`에서 import에 `from fastapi.middleware.cors import CORSMiddleware`를 추가하고, 모듈 상단에 상수를 두고, `create_app` 안 `include_router` 앞에 미들웨어를 등록한다:

```python
DEV_ORIGINS = ["http://localhost:5173"]
```

```python
    app.add_middleware(
        CORSMiddleware,
        allow_origins=DEV_ORIGINS,
        allow_methods=["GET"],
        allow_headers=["*"],
    )
```

- [ ] **Step 4: 통과 확인**

Run: `uv run pytest -q`
Expected: `26 passed`

- [ ] **Step 5: 커밋**

```bash
git add backend/app/main.py backend/tests/test_cors.py
git commit -m "feat(backend): Vite dev 서버용 CORS 허용"
```

---

### Task 6: 배포 구성 (api.Dockerfile, web.Dockerfile, nginx.conf, docker-compose)

**Files:**
- Create: `deploy/api.Dockerfile`, `deploy/web.Dockerfile`, `deploy/nginx.conf`, `deploy/docker-compose.yml`, `deploy/placeholder/index.html`, `deploy/README.md`

**Interfaces:**
- Consumes: `app.main:app` (Task 4), 이미지 이름 `ghcr.io/4this/woo-momo-web`, `ghcr.io/4this/woo-momo-api` (`.github/workflows/ci.yml`과 일치)
- Produces: 컨테이너 `web`(80 노출), `api`(내부 8000). 호스트 `/srv/momo/models` → `web:/usr/share/nginx/models:ro`

- [ ] **Step 1: api.Dockerfile**

`deploy/api.Dockerfile` (build context = `backend/`):

```dockerfile
FROM python:3.12-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 UV_COMPILE_BYTECODE=1
WORKDIR /app

COPY --from=ghcr.io/astral-sh/uv:0.5 /uv /usr/local/bin/uv
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

COPY app ./app
COPY data ./data

ENV PATH="/app/.venv/bin:$PATH" MOMO_DATA_DIR=/app/data
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
```

- [ ] **Step 2: web.Dockerfile + 플레이스홀더**

`deploy/placeholder/index.html`:

```html
<!doctype html>
<meta charset="utf-8">
<title>Woo-MoMo</title>
<p>프론트엔드 빌드가 아직 배포되지 않았습니다. <a href="/api/health">/api/health</a></p>
```

`deploy/web.Dockerfile` (build context = 리포 루트):

```dockerfile
# 1단계: 프론트 빌드. frontend/package.json이 없으면 플레이스홀더만 복사한다.
FROM node:20-alpine AS build
WORKDIR /src
COPY deploy/placeholder /out
COPY frontend* /src/frontend/
RUN if [ -f /src/frontend/package.json ]; then \
      corepack enable && cd /src/frontend && pnpm install --frozen-lockfile && pnpm build \
      && rm -rf /out && cp -r dist /out; \
    fi

# 2단계: nginx
FROM nginx:1.27-alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /out /usr/share/nginx/html
RUN mkdir -p /usr/share/nginx/models
EXPOSE 80
```

- [ ] **Step 3: nginx.conf**

`deploy/nginx.conf`:

```nginx
server {
    listen 80;
    server_name _;
    root /usr/share/nginx/html;
    index index.html;

    # SPA 정적 파일
    location / {
        try_files $uri $uri/ /index.html;
    }

    # 모델 파일: Range 허용, 장기 캐시, 압축 없음
    location /models/ {
        alias /usr/share/nginx/models/;
        add_header Cache-Control "public, max-age=31536000, immutable";
        add_header Accept-Ranges bytes;
        gzip off;
        sendfile on;
        tcp_nopush on;
    }

    # FastAPI 프록시 (/api/... 경로 그대로 전달)
    location /api/ {
        proxy_pass http://api:8000/api/;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

- [ ] **Step 4: docker-compose.yml**

`deploy/docker-compose.yml`:

```yaml
services:
  web:
    image: ghcr.io/4this/woo-momo-web:latest
    build:
      context: ..
      dockerfile: deploy/web.Dockerfile
    ports:
      - "80:80"
    volumes:
      - /srv/momo/models:/usr/share/nginx/models:ro
    depends_on:
      - api
    restart: unless-stopped

  api:
    image: ghcr.io/4this/woo-momo-api:latest
    build:
      context: ../backend
      dockerfile: ../deploy/api.Dockerfile
    expose:
      - "8000"
    restart: unless-stopped
```

- [ ] **Step 5: README**

`deploy/README.md`:

```markdown
# 배포 (라즈베리파이, docker-compose)

## 최초 1회
1. 모델 파일을 `/srv/momo/models/`에 복사한다 (`backend/data/manifest.json`의 `url` 파일명과 일치).
2. `deploy/` 디렉터리를 파이로 복사한다.
3. `docker login ghcr.io` (읽기 토큰).

## 배포/갱신
```
cd deploy
docker compose pull
docker compose up -d
```

## 확인
```
curl -s http://localhost/api/health
curl -s http://localhost/api/manifest | head -c 200
curl -I -H "Range: bytes=0-1023" http://localhost/models/gemma4-e4b-it-web.litertlm   # 206 기대
```

## 로컬에서 직접 빌드(arm64 크로스)
```
docker buildx build --platform linux/arm64 -f deploy/api.Dockerfile -t ghcr.io/4this/woo-momo-api:latest backend
docker buildx build --platform linux/arm64 -f deploy/web.Dockerfile -t ghcr.io/4this/woo-momo-web:latest .
```
```

- [ ] **Step 6: 검증**

리포 루트에서:

Run: `docker compose -f deploy/docker-compose.yml config -q`
Expected: 출력 없음, exit 0

Run: `docker build -f deploy/api.Dockerfile -t momo-api-test backend && docker run --rm -d -p 8001:8000 --name momo-api-test momo-api-test && sleep 2 && curl -s http://localhost:8001/api/health; docker rm -f momo-api-test`
Expected: `{"status":"ok"}`

Run: `docker build -f deploy/web.Dockerfile -t momo-web-test .`
Expected: 빌드 성공 (frontend 없음 → 플레이스홀더 사용)

- [ ] **Step 7: 커밋**

```bash
git add deploy
git commit -m "chore(infra): nginx + FastAPI docker-compose 배포 구성 (arm64)"
```

---

### Task 7: 전체 게이트 + PR

- [ ] **Step 1: full 게이트**

`backend/`에서:

Run: `uv run pytest -q && uv run ruff check . && uv run ruff format --check .`
Expected: `26 passed`, `All checks passed!`, 포맷 경고 없음. 포맷 경고가 있으면 `uv run ruff format .` 후 재실행.

리포 루트에서:

Run: `docker compose -f deploy/docker-compose.yml config -q`
Expected: exit 0

- [ ] **Step 2: 푸시 + PR**

```bash
git push -u origin cw
gh pr create --base main --head cw \
  --title "feat(backend): API 3종 + 배포 구성" \
  --body-file - <<'EOF'
## 무엇을
FastAPI로 /api/manifest, /api/questions/{field}, /api/health 구현. nginx + docker-compose 배포 구성 추가.

## 왜
docs/specs/backend/2026-09-15-backend-api-design.md / docs/plans/backend/2026-09-15-backend-api.md

## 어떻게 검증했는지
- [x] 로컬에서 실제 동작 확인 (docker run 후 /api/health)
- [x] 테스트 추가 (26개)
- [x] uv run pytest -q → 26 passed / ruff check → clean / ruff format --check → clean
- [x] docker compose config -q → OK

## 체크리스트
- [x] feature 브랜치(cw)에서 작업
- [x] Conventional Commits
- [x] backend/ + deploy/(공동, 초기 생성) 수정. frontend/ 미수정
- [x] 비밀키·.env·모델 파일 미포함
- [x] pre-commit 훅 통과
- [x] 계약 변경 없음 (docs/API.md 초기 정의 그대로 구현)

## BREAKING CHANGE?
- [x] 없음
EOF
```

## 이후

- 파이에 모델 파일 복사 → `docker compose pull && up -d` → `deploy/README.md`의 확인 명령 3개.
- 프론트가 `docs/API.md`대로 붙으면 `web` 이미지만 재빌드.
- 파인튜닝 모델 준비 시 `backend/data/manifest.json` 교체 PR(계약 additive 여부 확인) → 볼륨에 파일 복사.
- RAG 범위가 확정되면 별도 spec/plan.

## Self-Review (계획 검토)

- 스펙 커버리지: 세 엔드포인트(Task 1, 4), 스키마 단일 정의 + `data/` 검증(Task 2, 3), 기동 실패(Task 3, 4), `/models/` url 제약(Task 2), general 폴백 200(Task 4), CORS 5173(Task 5), nginx Range·캐시·프록시 + compose + arm64 이미지 + 플레이스홀더(Task 6), 성공 기준의 명령 전부(Task 6 Step 6, Task 7). ✅
- Placeholder 없음: 모든 코드·설정·데이터 파일 본문 포함. ✅
- 타입 일관성: `create_app(data_dir)`·`DATA_DIR`·`MANIFEST_FILENAME`·`QUESTIONS_DIRNAME`·`DEFAULT_FIELD` 이름이 Task 3~4에서 동일. `Manifest`가 `ModelRef`를 상속해 `url`·`size` 검증을 공유. 이미지 이름이 `ci.yml`과 일치. ✅
- 함정 선제 회피: lifespan 예외가 TestClient 컨텍스트 진입 시 전파되므로 기동 실패 테스트 가능. `web.Dockerfile`의 `COPY frontend*`는 디렉터리가 없어도 빌드가 깨지지 않게 하는 glob. `proxy_pass`에 `/api/`를 명시해 경로가 그대로 전달됨. ✅
