# TTS 매니페스트 계약·서빙 — 구현 계획 (plan, 백엔드 몫)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

- 생성일시: 2026-09-17
- 기준 spec: `docs/specs/frontend/2026-09-17-tts-design.md` 1·2·7절
- 계약 문서: `docs/API.md`
- 담당: @ssenu / 브랜치: `feature/backend-tts-manifest` (main에서 생성)
- 프론트 이슈: #12(워커·서비스), #13(스토어·화면) — 이 plan이 머지·배포된 뒤 `tts` 필드를 소비한다

**Goal:** `/api/manifest`에 optional `tts` 필드(Supertonic 3 파일 목록·목소리·언어)를 additive로 추가하고, 파이에 파일을 배치해 `/models/tts/...`로 서빙되게 한다.

> **갱신 노트(2026-09-18):** 구현 완료(PR #14) 기록이다. "`tts.baseUrl`은 `/models/`로 시작" 제약과 baseUrl 값 `/models/tts/supertonic-3/`는 2026-09-17 Hugging Face 전환으로 바뀌었다. 지금 baseUrl은 `https://huggingface.co/Supertone/supertonic-3/resolve/<커밋>/`이고, 파이의 `/srv/momo/models/tts/` 파일은 복귀용으로 남겨 둔다. 기준: `docs/specs/backend/2026-09-17-model-hosting-hf-design.md`.

**Architecture:** `schemas.py`에 `TtsFile`·`TtsManifest`를 추가하고 `Manifest.tts: TtsManifest | None = None`으로 붙인다(기존 필드 불변, `extra="forbid"` 유지). `data/manifest.json`에 실제 값을 넣고, 기동 시 검증·응답 테스트로 고정한다. nginx 변경 없음(기존 `/models/` alias가 하위 디렉터리를 그대로 서빙). 배포 절차·라이선스는 문서로.

**Tech Stack:** Python 3.12, FastAPI, pydantic v2, pytest (기존)

## Global Constraints

- 자기 영역(`backend/`) + 공동 영역 `docs/`·`deploy/README.md`(문서만). `frontend/`·`deploy/nginx.conf`·`docker-compose.yml` 수정 없음.
- 계약 변경은 **additive**: 기존 필드·값 불변. `tts`는 `TtsManifest | None`, 기본 `None`.
- `tts.baseUrl`은 `/models/`로 시작하고 `/`로 끝나야 한다. `tts.files[].path`는 `..` 세그먼트 금지, `/`로 시작 금지, 비어 있지 않음. `size > 0`. `files`는 1개 이상. `voice`·`lang`은 비어 있지 않음.
- 실제 값(spec 2절): id `supertonic-3`, baseUrl `/models/tts/supertonic-3/`, files 7개(아래 표), voice `M2`, lang `ko`.

| path | size |
|---|---|
| onnx/text_encoder.onnx | 36416150 |
| onnx/duration_predictor.onnx | 3700147 |
| onnx/vector_estimator.onnx | 256534781 |
| onnx/vocoder.onnx | 101424195 |
| onnx/tts.json | 8253 |
| onnx/unicode_indexer.json | 277676 |
| voice_styles/M2.json | 292055 |

- 게이트(`backend/`): `uv run pytest -q && uv run ruff check . && uv run ruff format --check .`
- 커밋: `feat(api):`(계약), `docs:`. lockstep: 이 PR 머지·배포 → 프론트가 필드 사용.

## 파일 구조

```
backend/app/schemas.py            # + TtsFile, TtsManifest, Manifest.tts
backend/data/manifest.json        # + "tts": {...}
backend/tests/test_schemas.py     # + tts 검증 테스트
backend/tests/test_manifest.py    # + 응답에 tts 포함
docs/API.md                       # + tts 필드 설명
deploy/README.md                  # + TTS 파일 배치 절차
docs/licenses/SUPERTONIC-OpenRAIL-M.txt, docs/licenses/NOTICE.md
```

---

### Task 1: 스키마 `TtsFile`·`TtsManifest` + `Manifest.tts`

**Files:**
- Modify: `backend/app/schemas.py`
- Test: `backend/tests/test_schemas.py`

**Interfaces:**
- Produces:
  - `TtsFile(path: str, size: int)` — `path`: 비어 있지 않음, `/`로 시작 금지, `..` 세그먼트 금지; `size > 0`
  - `TtsManifest(id: str, baseUrl: str, files: list[TtsFile], voice: str, lang: str)` — `baseUrl`은 `/models/`로 시작하고 `/`로 끝남; `files` 1개 이상
  - `Manifest.tts: TtsManifest | None = None`

- [ ] **Step 1: 실패하는 테스트** (`test_schemas.py` 끝에 추가)

```python
TTS = {
    "id": "supertonic-3",
    "baseUrl": "/models/tts/supertonic-3/",
    "files": [
        {"path": "onnx/text_encoder.onnx", "size": 36416150},
        {"path": "voice_styles/M2.json", "size": 292055},
    ],
    "voice": "M2",
    "lang": "ko",
}


def test_manifest_tts_defaults_to_none():
    assert Manifest.model_validate(_manifest()).tts is None


def test_manifest_parses_tts():
    m = Manifest.model_validate(_manifest(tts=TTS))
    assert m.tts is not None
    assert m.tts.voice == "M2"
    assert [f.path for f in m.tts.files] == ["onnx/text_encoder.onnx", "voice_styles/M2.json"]


@pytest.mark.parametrize("base", ["/static/tts/", "/models/tts", "https://x/models/tts/"])
def test_tts_base_url_must_be_models_dir(base):
    with pytest.raises(ValidationError):
        Manifest.model_validate(_manifest(tts={**TTS, "baseUrl": base}))


@pytest.mark.parametrize("path", ["../secret.json", "onnx/../x.onnx", "/onnx/a.onnx", ""])
def test_tts_file_path_rejects_traversal_and_absolute(path):
    with pytest.raises(ValidationError):
        Manifest.model_validate(_manifest(tts={**TTS, "files": [{"path": path, "size": 1}]}))


def test_tts_requires_at_least_one_file_and_positive_size():
    with pytest.raises(ValidationError):
        Manifest.model_validate(_manifest(tts={**TTS, "files": []}))
    with pytest.raises(ValidationError):
        Manifest.model_validate(_manifest(tts={**TTS, "files": [{"path": "a.onnx", "size": 0}]}))


def test_tts_rejects_unknown_keys():
    with pytest.raises(ValidationError):
        Manifest.model_validate(_manifest(tts={**TTS, "steps": 8}))
```

- [ ] **Step 2: 실패 확인**

Run: `uv run pytest -q tests/test_schemas.py`
Expected: 새 테스트 FAIL (`tts`가 unknown key라 `test_manifest_parses_tts`부터 ValidationError 방향이 반대로 남)

- [ ] **Step 3: 구현** (`schemas.py`의 `Manifest` 위에 추가, `Manifest`에 필드 추가)

```python
class TtsFile(BaseModel):
    model_config = ConfigDict(extra="forbid")

    path: str = Field(min_length=1)
    size: Annotated[int, Field(gt=0)]

    @field_validator("path")
    @classmethod
    def _relative_and_safe(cls, v: str) -> str:
        if v.startswith("/"):
            raise ValueError("tts file path must be relative")
        if ".." in v.split("/"):
            raise ValueError("tts file path must not contain '..'")
        return v


class TtsManifest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1)
    baseUrl: str
    files: Annotated[list[TtsFile], Field(min_length=1)]
    voice: str = Field(min_length=1)
    lang: str = Field(min_length=1)

    @field_validator("baseUrl")
    @classmethod
    def _base_url(cls, v: str) -> str:
        if not v.startswith(MODELS_PREFIX) or not v.endswith("/"):
            raise ValueError(f"tts baseUrl must start with {MODELS_PREFIX!r} and end with '/'")
        return v
```

```python
class Manifest(ModelRef):
    template: ChatTemplate
    systemPromptOverride: str | None = None
    fallback: ModelRef | None = None
    tts: TtsManifest | None = None
```

- [ ] **Step 4: 통과 확인**

Run: `uv run pytest -q tests/test_schemas.py` → 전부 PASS. `uv run ruff check . && uv run ruff format --check .` clean.

- [ ] **Step 5: 커밋**

```bash
git add app/schemas.py tests/test_schemas.py
git commit -m "feat(api): 매니페스트 tts 필드(TtsManifest·TtsFile) 스키마 — additive, optional"
```

---

### Task 2: `data/manifest.json`에 실제 값 + 응답 테스트 + `docs/API.md`

**Files:**
- Modify: `backend/data/manifest.json`, `backend/tests/test_manifest.py`, `docs/API.md`

**Interfaces:**
- Consumes: `TtsManifest` (Task 1)
- Produces: `GET /api/manifest` 응답에 `tts` 객체(spec 2절 값)

- [ ] **Step 1: 실패하는 테스트** (`test_manifest.py`에 추가)

```python
def test_manifest_includes_tts_contract(client):
    body = client.get("/api/manifest").json()
    tts = body["tts"]
    assert tts["id"] == "supertonic-3"
    assert tts["baseUrl"] == "/models/tts/supertonic-3/"
    assert tts["voice"] == "M2" and tts["lang"] == "ko"
    paths = [f["path"] for f in tts["files"]]
    assert paths == [
        "onnx/text_encoder.onnx",
        "onnx/duration_predictor.onnx",
        "onnx/vector_estimator.onnx",
        "onnx/vocoder.onnx",
        "onnx/tts.json",
        "onnx/unicode_indexer.json",
        "voice_styles/M2.json",
    ]
    assert all(f["size"] > 0 for f in tts["files"])
```

기존 `test_manifest_has_contract_keys`의 키 집합에 `"tts"`를 추가한다:
```python
    assert set(body) == {"id", "url", "size", "template", "systemPromptOverride", "fallback", "tts"}
```

- [ ] **Step 2: 실패 확인**

Run: `uv run pytest -q tests/test_manifest.py` → `KeyError: 'tts'` / 키 집합 불일치로 FAIL

- [ ] **Step 3: `manifest.json` 갱신** — `"fallback": {...}` 뒤에 추가:

```json
  "tts": {
    "id": "supertonic-3",
    "baseUrl": "/models/tts/supertonic-3/",
    "files": [
      { "path": "onnx/text_encoder.onnx", "size": 36416150 },
      { "path": "onnx/duration_predictor.onnx", "size": 3700147 },
      { "path": "onnx/vector_estimator.onnx", "size": 256534781 },
      { "path": "onnx/vocoder.onnx", "size": 101424195 },
      { "path": "onnx/tts.json", "size": 8253 },
      { "path": "onnx/unicode_indexer.json", "size": 277676 },
      { "path": "voice_styles/M2.json", "size": 292055 }
    ],
    "voice": "M2",
    "lang": "ko"
  }
```

- [ ] **Step 4: `docs/API.md`** — `GET /api/manifest` 예시 JSON에 위 `tts` 블록을 그대로 추가하고, 필드 표에 행 추가:

```
| `tts` | object \| null | 면접관 음성(TTS) 모델. null이면 프론트는 음성 단계를 건너뛴다. `id`(캐시 키), `baseUrl`(`/models/`로 시작·`/`로 끝), `files[]`(`path` 상대경로·`size` 바이트), `voice`(프리셋명), `lang`(언어 코드). 파일 URL = `baseUrl + path` |
```
그리고 "하지 않는 것" 위에 한 줄: `tts`는 additive로 추가됨(2026-09-17). 기존 필드 불변.

- [ ] **Step 5: 통과 확인**

Run: `uv run pytest -q` → 전부 PASS(기존 `test_manifest_matches_repo_file`이 repo 파일과 응답을 비교하므로 함께 검증됨). ruff clean.

- [ ] **Step 6: 커밋**

```bash
git add data/manifest.json tests/test_manifest.py ../docs/API.md
git commit -m "feat(api): 매니페스트에 Supertonic 3 tts 항목(M2, ko) 추가 및 API.md 갱신"
```

---

### Task 3: 배포 절차·라이선스 문서

**Files:**
- Modify: `deploy/README.md`
- Create: `docs/licenses/SUPERTONIC-OpenRAIL-M.txt`, `docs/licenses/NOTICE.md`

- [ ] **Step 1: 라이선스 파일**

```bash
mkdir -p docs/licenses
curl -sL -o docs/licenses/SUPERTONIC-OpenRAIL-M.txt https://huggingface.co/Supertone/supertonic-3/raw/main/LICENSE
head -3 docs/licenses/SUPERTONIC-OpenRAIL-M.txt   # "BigScience Open RAIL-M License" 확인
```

`docs/licenses/NOTICE.md`:

```markdown
# 서드파티 고지

## Supertonic 3 (면접관 음성)
- 저작권: Supertone Inc. — https://huggingface.co/Supertone/supertonic-3
- 모델 라이선스: BigScience Open RAIL-M (`SUPERTONIC-OpenRAIL-M.txt`). 사용 제한(Attachment A)을 준수한다. 이 사이트는 모의면접 질문 읽기 용도로만 합성하며, 생성 음성임을 화면 문구로 밝힌다.
- 예제 코드(`web/helper.js`) 라이선스: MIT — https://github.com/supertone-inc/supertonic
- 모델 파일은 우리 서버(`/models/tts/supertonic-3/`)에서 재배포된다. 이 라이선스 사본을 함께 배포한다.

## Gemma 4 (면접관 LLM)
- Google, Gemma Terms of Use — https://ai.google.dev/gemma/terms
- 파일: https://huggingface.co/litert-community/gemma-4-E4B-it-litert-lm, gemma-4-E2B-it-litert-lm
```

- [ ] **Step 2: `deploy/README.md`** — "실제 파이 구성 → 배포" 절 뒤에 추가:

```markdown
### TTS 모델 파일 배치 (Supertonic 3, 약 398MB)
`backend/data/manifest.json`의 `tts.baseUrl`·`files[].path`와 경로가 일치해야 한다.
```
mkdir -p /srv/momo/models/tts/supertonic-3/onnx /srv/momo/models/tts/supertonic-3/voice_styles
cd /srv/momo/models/tts/supertonic-3
B=https://huggingface.co/Supertone/supertonic-3/resolve/main
for f in onnx/text_encoder.onnx onnx/duration_predictor.onnx onnx/vector_estimator.onnx onnx/vocoder.onnx onnx/tts.json onnx/unicode_indexer.json voice_styles/M2.json; do
  curl -L -o "$f" "$B/$f"
done
ls -l onnx voice_styles
curl -I -H "Range: bytes=0-1023" http://127.0.0.1:8006/models/tts/supertonic-3/onnx/vocoder.onnx   # 206
```
크기는 매니페스트 값과 같아야 한다(프론트가 수신 바이트를 대조한다). nginx 변경 없음 — 기존 `/models/` 규칙이 하위 디렉터리를 그대로 서빙한다.
```

- [ ] **Step 3: 커밋**

```bash
git add docs/licenses deploy/README.md
git commit -m "docs: Supertonic 3 라이선스 고지와 파이 TTS 파일 배치 절차"
```

---

### Task 4: 게이트 · PR · 파이 배치 · 검증

- [ ] **Step 1: 게이트** (`backend/`): `uv run pytest -q && uv run ruff check . && uv run ruff format --check .` → PASS/clean.

- [ ] **Step 2: PR**

```bash
git push -u origin feature/backend-tts-manifest
gh pr create --base main --head feature/backend-tts-manifest --title "feat(api): 매니페스트 tts 계약(Supertonic 3, M2) + 배치 절차·라이선스" --body-file - <<'EOF'
## 무엇을
`/api/manifest`에 optional `tts` 필드 추가(additive). Supertonic 3 파일 7개·목소리 M2·언어 ko. 파이 배치 절차와 OpenRAIL-M 고지 문서.

## 왜
docs/specs/frontend/2026-09-17-tts-design.md 2·7절. 프론트 #12·#13이 이 필드를 소비한다(lockstep: 이 PR 먼저).

## 어떻게 검증했는지
- [x] pytest N passed (스키마 검증 6종, 응답 계약, repo 파일 일치)
- [x] ruff check/format clean
- [ ] 파이 배치 후 `curl -I -H "Range: bytes=0-1023" https://momo.ssenu.cloud/models/tts/supertonic-3/onnx/vocoder.onnx` → 206 (배포 단계)

## 체크리스트
- [x] feature 브랜치, `feat(api):`/`docs:`
- [x] backend/ + docs/ + deploy/README.md(문서만). nginx·compose·frontend 미수정
- [x] 계약 변경: **additive** (`tts: TtsManifest | None = None`). docs/API.md 갱신. 프론트 담당(@leemonta9482) 사전 협의: spec 승인 + 이슈 #12/#13

## BREAKING CHANGE?
- [x] 없음
EOF
```

- [ ] **Step 3: 머지 후 파이 배치·배포·검증**

```
ssh admin@webPi
# README의 "TTS 모델 파일 배치" 명령 실행 (약 398MB)
cd /srv/apps/Woo-MoMo-Project && git pull && cd deploy && docker compose pull && docker compose up -d   # 또는 up -d --build
curl -s http://127.0.0.1:8006/api/manifest | python3 -c "import sys,json; t=json.load(sys.stdin)['tts']; print(t['id'], len(t['files']))"   # supertonic-3 7
for f in onnx/text_encoder.onnx onnx/vector_estimator.onnx voice_styles/M2.json; do curl -s -o /dev/null -w "$f %{http_code} %{size_download}\n" -r 0-1023 http://127.0.0.1:8006/models/tts/supertonic-3/$f; done   # 206 1024
```

## 이후

- 프론트 #12(워커·서비스) → #13(스토어·화면) → 파이 배포 → 도메인 리허설.
- 스파이크 결과(합성 시간·스텝 수)는 spec 6절 아래에 기록하고 #12 코멘트로 전달.

## Self-Review (계획 검토)

- 스펙 커버리지: 2절 계약(필드·검증 규칙·null 의미) → Task 1·2. 서빙 경로·nginx 변경 없음 → Task 3 README + Task 4 검증. 라이선스 → Task 3. lockstep 순서 → Task 4. ✅
- Placeholder 없음: 코드·JSON·명령 전부 실제 값. ✅
- 타입 일치: `TtsFile.path/size`, `TtsManifest.id/baseUrl/files/voice/lang`, `Manifest.tts`가 테스트·JSON·API.md에서 동일. `MODELS_PREFIX` 재사용. ✅
- 함정: `extra="forbid"` 때문에 `tts` 추가 전 JSON에 넣으면 기동 실패 → Task 1 다음에 Task 2(순서 고정). `test_manifest_has_contract_keys`의 키 집합을 갱신하지 않으면 실패 → Step 1에 명시. ✅
