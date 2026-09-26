# 매니페스트 `tts.voices` — 구현 계획 (plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

- 생성일시: 2026-09-26
- 기준 spec: `docs/specs/backend/2026-09-26-tts-voices-design.md` (상위: `docs/specs/frontend/2026-09-26-interviewer-personas-design.md`)

**Goal:** `/api/manifest`의 `tts`에 받을 수 있는 목소리 10개(`voices: [{id, path, size}]`)를 additive로 추가한다.

**Architecture:** `backend/app/schemas.py`에 `TtsVoice`와 `TtsManifest.voices`(선택)를 추가하고, 모델 검증기로 "1개 이상·id 유일·기본 `voice` 포함"을 강제한다. 경로 검증은 기존 `TtsFile`과 같은 함수를 쓴다. `backend/data/manifest.json`에 10개를 넣고 `docs/API.md`에 새 프론트의 해석 규칙을 적는다. 기존 필드는 바꾸지 않는다.

**Tech Stack:** FastAPI + pydantic v2 + uv + pytest + ruff

## Global Constraints

- 계약 변경은 **additive**만 한다. `tts.files`(M2 포함 7개)·`tts.voice`("M2")·그 밖의 기존 필드 값은 바꾸지 않는다.
- `voices` 값은 HF 고정 커밋 `3cadd1ee6394adea1bd021217a0e650ede09a323` 기준이다: F1=292046, F2=292423, F3=290794, F4=291808, F5=291479, M1=291748, M2=292055, M3=290198, M4=291522, M5=291469
- 모든 스키마 모델은 `extra="forbid"`를 유지한다.
- 이 PR은 백엔드·문서만 바꾼다. 프론트 코드는 바꾸지 않는다(lockstep: 이 PR을 배포한 뒤 프론트가 `voices`를 쓴다).
- 모든 명령은 `backend/` 디렉터리에서 실행한다.

---

### Task 1: `TtsVoice` 스키마와 `TtsManifest.voices` 검증

**Files:**
- Modify: `backend/app/schemas.py`
- Test: `backend/tests/test_schemas.py`

**Interfaces:**
- Produces:
  - `app.schemas.TtsVoice` — `id: str`(비어 있지 않음), `path: str`(상대·`..` 세그먼트 금지), `size: int > 0`
  - `app.schemas.TtsManifest.voices: list[TtsVoice] | None = None`
  - `app.schemas._validate_relative_path(v: str) -> str` (`TtsFile`·`TtsVoice` 공용)

- [ ] **Step 1: 실패하는 테스트 작성**

`backend/tests/test_schemas.py` 맨 아래에 추가한다(파일 위쪽에 이미 `TTS`, `_manifest`, `pytest`, `ValidationError`, `Manifest`가 있다).

```python
VOICES = [
    {"id": "F1", "path": "voice_styles/F1.json", "size": 292046},
    {"id": "M2", "path": "voice_styles/M2.json", "size": 292055},
]


def test_tts_voices_default_to_none():
    m = Manifest.model_validate(_manifest(tts=TTS))
    assert m.tts is not None and m.tts.voices is None


def test_tts_parses_voices():
    m = Manifest.model_validate(_manifest(tts={**TTS, "voices": VOICES}))
    assert m.tts is not None and m.tts.voices is not None
    assert [v.id for v in m.tts.voices] == ["F1", "M2"]
    assert m.tts.voices[1].path == "voice_styles/M2.json"


def test_tts_voices_reject_empty_list():
    with pytest.raises(ValidationError):
        Manifest.model_validate(_manifest(tts={**TTS, "voices": []}))


def test_tts_voices_reject_duplicate_ids():
    dup = [*VOICES, {"id": "F1", "path": "voice_styles/F1b.json", "size": 1}]
    with pytest.raises(ValidationError):
        Manifest.model_validate(_manifest(tts={**TTS, "voices": dup}))


def test_tts_voices_must_include_default_voice():
    only_f1 = [VOICES[0]]  # 기본 voice는 "M2"
    with pytest.raises(ValidationError):
        Manifest.model_validate(_manifest(tts={**TTS, "voices": only_f1}))


@pytest.mark.parametrize(
    "voice",
    [
        {"id": "M2", "path": "/voice_styles/M2.json", "size": 1},
        {"id": "M2", "path": "voice_styles/../M2.json", "size": 1},
        {"id": "M2", "path": "", "size": 1},
        {"id": "M2", "path": "voice_styles/M2.json", "size": 0},
        {"id": "", "path": "voice_styles/M2.json", "size": 1},
        {"id": "M2", "path": "voice_styles/M2.json", "size": 1, "extra": "x"},
    ],
)
def test_tts_voice_rejects_bad_entries(voice):
    with pytest.raises(ValidationError):
        Manifest.model_validate(_manifest(tts={**TTS, "voices": [voice]}))
```

- [ ] **Step 2: 실패 확인**

Run: `uv run pytest -q tests/test_schemas.py -k "voices or voice_rejects"`
Expected: FAIL. `voices`가 `extra="forbid"`에 걸려 `test_tts_parses_voices`가 실패하고, `test_tts_voices_default_to_none`은 `AttributeError: 'TtsManifest' object has no attribute 'voices'`로 실패한다.

- [ ] **Step 3: 구현**

`backend/app/schemas.py`
- import 줄을 `from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator`로 바꾼다.
- `TtsFile`의 경로 검증을 모듈 함수로 뺀다.
- `TtsVoice`를 추가하고, `TtsManifest`에 `voices` 필드와 검증기를 넣는다.

```python
def _validate_relative_path(v: str) -> str:
    if v.startswith("/"):
        raise ValueError("tts file path must be relative")
    # 세그먼트 단위 검사: "onnx/../x"는 거부, "a..b.onnx" 같은 파일명은 허용
    if ".." in v.split("/"):
        raise ValueError("tts file path must not contain '..'")
    return v


class TtsFile(BaseModel):
    model_config = ConfigDict(extra="forbid")

    path: str = Field(min_length=1)
    size: Annotated[int, Field(gt=0)]

    @field_validator("path")
    @classmethod
    def _relative_and_safe(cls, v: str) -> str:
        return _validate_relative_path(v)


class TtsVoice(BaseModel):
    """받을 수 있는 목소리 하나. 파일 URL = TtsManifest.baseUrl + path"""

    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1)
    path: str = Field(min_length=1)
    size: Annotated[int, Field(gt=0)]

    @field_validator("path")
    @classmethod
    def _relative_and_safe(cls, v: str) -> str:
        return _validate_relative_path(v)


class TtsManifest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1)
    baseUrl: str
    files: Annotated[list[TtsFile], Field(min_length=1)]
    voice: str = Field(min_length=1)
    lang: str = Field(min_length=1)
    # 면접관별 목소리(2026-09-26, additive). 엔진 = files − voices 경로.
    # docs/specs/backend/2026-09-26-tts-voices-design.md
    voices: list[TtsVoice] | None = None

    @field_validator("baseUrl")
    @classmethod
    def _base_url(cls, v: str) -> str:
        if not v.endswith("/"):
            raise ValueError("tts baseUrl must end with '/'")
        return _validate_model_url(v)

    @model_validator(mode="after")
    def _voices_consistent(self) -> "TtsManifest":
        if self.voices is None:
            return self
        if not self.voices:
            raise ValueError("tts voices must not be empty")
        ids = [v.id for v in self.voices]
        if len(set(ids)) != len(ids):
            raise ValueError("tts voice ids must be unique")
        if self.voice not in ids:
            raise ValueError(f"default tts voice {self.voice!r} must be listed in voices")
        return self
```

- [ ] **Step 4: 통과 확인**

Run: `uv run pytest -q`
Expected: 전부 PASS(기존 50 + 신규 11 = 61 passed). 기존 `test_tts_file_path_rejects_traversal_and_absolute`도 그대로 통과해야 한다(공용 함수로 옮겼을 뿐 동작 동일).

Run: `uv run ruff check . && uv run ruff format --check .`
Expected: `All checks passed!`, `… files already formatted`

- [ ] **Step 5: 커밋**

```bash
git add backend/app/schemas.py backend/tests/test_schemas.py
git commit -m "feat(api): 매니페스트 tts.voices 스키마(TtsVoice) — 선택 필드, 1개 이상·id 유일·기본 voice 포함 검증"
```

---

### Task 2: 매니페스트에 목소리 10개 + 계약 문서

**Files:**
- Modify: `backend/data/manifest.json`
- Modify: `backend/tests/test_manifest.py`
- Modify: `docs/API.md`
- Modify: `deploy/README.md` (TTS 파일 배치 절, 한 줄 + 목록)

**Interfaces:**
- Consumes: Task 1의 `TtsManifest.voices`
- Produces: `/api/manifest` 응답의 `tts.voices` 10개. 프론트 계약 규칙 "엔진 = `files` 중 `voices[].path`에 없는 경로"

- [ ] **Step 1: 실패하는 테스트 작성**

`backend/tests/test_manifest.py` 맨 아래에 추가한다.

```python
EXPECTED_VOICE_IDS = ["F1", "F2", "F3", "F4", "F5", "M1", "M2", "M3", "M4", "M5"]


def test_manifest_tts_lists_all_voices(client):
    tts = client.get("/api/manifest").json()["tts"]
    voices = tts["voices"]
    assert [v["id"] for v in voices] == EXPECTED_VOICE_IDS
    assert all(v["path"] == f"voice_styles/{v['id']}.json" for v in voices)
    assert all(v["size"] > 0 for v in voices)


def test_manifest_default_voice_matches_files_entry(client):
    tts = client.get("/api/manifest").json()["tts"]
    by_id = {v["id"]: v for v in tts["voices"]}
    default = by_id[tts["voice"]]
    files = {f["path"]: f["size"] for f in tts["files"]}
    # 옛 프론트 호환: files에 남은 기본 목소리와 voices의 기본 목소리는 같은 파일·같은 크기
    assert files[default["path"]] == default["size"]


def test_manifest_engine_files_exclude_voices(client):
    tts = client.get("/api/manifest").json()["tts"]
    voice_paths = {v["path"] for v in tts["voices"]}
    engine = [f["path"] for f in tts["files"] if f["path"] not in voice_paths]
    assert engine == [
        "onnx/text_encoder.onnx",
        "onnx/duration_predictor.onnx",
        "onnx/vector_estimator.onnx",
        "onnx/vocoder.onnx",
        "onnx/tts.json",
        "onnx/unicode_indexer.json",
    ]
```

- [ ] **Step 2: 실패 확인**

Run: `uv run pytest -q tests/test_manifest.py`
Expected: 새 3개 FAIL(`TypeError: 'NoneType' object is not iterable` — 응답의 `tts.voices`가 `null`). 기존 테스트는 PASS.

- [ ] **Step 3: 매니페스트 값 추가**

`backend/data/manifest.json`의 `tts` 객체에서 `"lang": "ko"` 뒤에 `voices`를 추가한다(다른 값은 그대로).

```json
    "voice": "M2",
    "lang": "ko",
    "voices": [
      { "id": "F1", "path": "voice_styles/F1.json", "size": 292046 },
      { "id": "F2", "path": "voice_styles/F2.json", "size": 292423 },
      { "id": "F3", "path": "voice_styles/F3.json", "size": 290794 },
      { "id": "F4", "path": "voice_styles/F4.json", "size": 291808 },
      { "id": "F5", "path": "voice_styles/F5.json", "size": 291479 },
      { "id": "M1", "path": "voice_styles/M1.json", "size": 291748 },
      { "id": "M2", "path": "voice_styles/M2.json", "size": 292055 },
      { "id": "M3", "path": "voice_styles/M3.json", "size": 290198 },
      { "id": "M4", "path": "voice_styles/M4.json", "size": 291522 },
      { "id": "M5", "path": "voice_styles/M5.json", "size": 291469 }
    ]
```

크기를 다시 확인하는 명령(HF 고정 커밋):

```bash
curl -s "https://huggingface.co/api/models/Supertone/supertonic-3/tree/3cadd1ee6394adea1bd021217a0e650ede09a323/voice_styles" | python -c "import sys,json; print({f['path']: f['size'] for f in json.load(sys.stdin)})"
```

Expected: 위 10개 값과 같다.

- [ ] **Step 4: 통과 확인**

Run: `uv run pytest -q && uv run ruff check . && uv run ruff format --check .`
Expected: 64 passed, ruff clean. `test_manifest_matches_repo_file`(응답 = 저장소 파일)도 통과해야 한다.

- [ ] **Step 5: `docs/API.md` 갱신**

- 예시 JSON의 `tts` 객체에 Step 3과 같은 `voices` 배열을 `"lang": "ko"` 뒤에 추가한다(10개 모두).
- 필드 표의 `tts` 행 바로 아래에 새 행을 추가한다.

```markdown
| `tts.voices` | array \| null | 받을 수 있는 목소리 목록(2026-09-26 추가). 항목 `{ id, path, size }`, 파일 URL = `baseUrl + path`. **엔진 파일 = `files` 중 경로가 `voices[].path`에 없는 것**이다. 새 프론트는 엔진 + 고른 목소리 하나만 받는다. `files` 안의 기본 목소리 파일은 `voices`를 모르는 옛 프론트 호환용이다. 기본 `voice`는 항상 이 목록에 있다. null이면 기본 `voice`만 쓴다 |
```

- `## 참고` 절 맨 아래에 한 줄을 추가한다.

```markdown
2026-09-26: `tts.voices` additive 추가(면접관별 목소리). 기존 필드 불변. `docs/specs/backend/2026-09-26-tts-voices-design.md`
```

- [ ] **Step 6: `deploy/README.md` 파이 복귀 절차 갱신**

"TTS 모델 파일 배치" 절의 `for f in …` 줄에 목소리 10개가 모두 들어가게 바꾼다(파이 서빙으로 복귀할 때 `voices`의 모든 경로가 있어야 한다).

```
for f in onnx/text_encoder.onnx onnx/duration_predictor.onnx onnx/vector_estimator.onnx onnx/vocoder.onnx onnx/tts.json onnx/unicode_indexer.json voice_styles/F1.json voice_styles/F2.json voice_styles/F3.json voice_styles/F4.json voice_styles/F5.json voice_styles/M1.json voice_styles/M2.json voice_styles/M3.json voice_styles/M4.json voice_styles/M5.json; do
```

그리고 그 절의 마지막 문단 뒤에 한 줄을 추가한다.

```markdown
`tts.voices`(2026-09-26)가 있으면 목소리 10개(`voice_styles/F1~F5, M1~M5.json`)가 모두 있어야 한다. 지금 파이에는 M2만 있으므로, 복귀할 때 위 반복문으로 나머지 9개를 함께 받는다.
```

- [ ] **Step 7: 커밋**

```bash
git add backend/data/manifest.json backend/tests/test_manifest.py docs/API.md deploy/README.md
git commit -m "feat(api): 매니페스트에 목소리 10개(tts.voices, HF 고정 커밋 크기) 추가, API.md 엔진=files−voices 규칙, 파이 복귀 절차 목소리 10개"
```

---

### Task 3: 전체 게이트 · PR · 배포 · 확인

**Files:** 없음(검증·배포)

- [ ] **Step 1: 전체 게이트**

Run (`backend/`): `uv run pytest -q && uv run ruff check . && uv run ruff format --check .`
Expected: 64 passed, `All checks passed!`, formatted

- [ ] **Step 2: 브라우저에서 목소리 파일 CORS·크기 확인**

Chrome에서 `https://momo.ssenu.cloud/api/health`를 열고 DevTools 콘솔에서 실행한다(프론트 `downloadModel`과 같은 방식: fetch → 전체 수신 → 크기 대조).

```js
const B = 'https://huggingface.co/Supertone/supertonic-3/resolve/3cadd1ee6394adea1bd021217a0e650ede09a323/'
const V = { F1: 292046, F2: 292423, F3: 290794, F4: 291808, F5: 291479, M1: 291748, M2: 292055, M3: 290198, M4: 291522, M5: 291469 }
const out = []
for (const [id, size] of Object.entries(V)) {
  const r = await fetch(`${B}voice_styles/${id}.json`)
  const n = (await r.arrayBuffer()).byteLength
  out.push(`${id} ${r.status} ${n === size ? 'OK' : `MISMATCH ${n}/${size}`}`)
}
out.join('\n')
```

Expected: 10줄 모두 `200 OK`

- [ ] **Step 3: PR**

- 제목: `feat(api): 매니페스트 tts.voices — 면접관별 목소리 목록(additive)`
- 본문: 템플릿 체크리스트를 모두 채운다.
  - 계약 변경 있음(additive, BREAKING 없음)
  - `docs/API.md` 갱신
  - 게이트 결과와 Step 2 출력
  - "배포 후 프론트 plan(`docs/plans/frontend/2026-09-26-interviewer-personas.md`) 진행 — lockstep"
- 리뷰어: @leemonta9482(`docs/`·`deploy/` 공유 영역 포함)

- [ ] **Step 4: 머지 후 파이 배포**

```bash
ssh admin@webPi "cd /srv/apps/Woo-MoMo-Project && git pull && cd deploy && docker compose up -d --build api && docker ps --format '{{.Names}} {{.Status}}' | grep deploy-api"
```

Expected: `deploy-api-1 Up … (healthy)`

- [ ] **Step 5: 도메인 확인**

```bash
curl -s https://momo.ssenu.cloud/api/manifest | python -c "import sys,json; t=json.load(sys.stdin)['tts']; print(t['voice'], len(t['voices']), [v['id'] for v in t['voices']])"
```

Expected: `M2 10 ['F1', 'F2', 'F3', 'F4', 'F5', 'M1', 'M2', 'M3', 'M4', 'M5']`

기존 프론트 회귀 확인: 브라우저에서 https://momo.ssenu.cloud 를 새로고침하고, 준비 화면의 목소리 준비가 전처럼 통과하는지 본다(옛 프론트는 `voices`를 무시하고 `files` 7개를 받는다).

## 이후

- 프론트 plan `docs/plans/frontend/2026-09-26-interviewer-personas.md`의 Task 3(TTS 목소리 선택)부터 이 계약을 쓴다.

## Self-Review

- 스펙 커버리지:
  - spec 2절(형태·값) → Task 2 Step 3
  - 3절(검증 규칙) → Task 1
  - 4절(인터페이스) → Task 1 Produces
  - 5절(문서·deploy) → Task 2 Step 5·6
  - 6절(롤아웃) → Task 3 Step 4·5
  - 8절(성공 기준) → Task 1·2 테스트 + Task 3 Step 2·5
- Placeholder 없음. 크기 값 10개는 HF API로 조회한 실제 값이다.
- 함정 선제 회피:
  - `response_model=Manifest`라 `voices`가 없으면 응답에 `null`이 나간다. 그래서 저장소 파일에 값을 넣은 뒤 `test_manifest_matches_repo_file`이 그대로 통과하는지 확인한다.
  - 경로 검증은 공용 함수로 빼서 기존 테스트로 회귀를 막는다.
