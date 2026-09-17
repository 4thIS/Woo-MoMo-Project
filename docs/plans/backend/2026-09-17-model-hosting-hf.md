# 모델·TTS 다운로드 Hugging Face 전환 — 구현 계획 (plan)

- 생성일시: 2026-09-17
- 기준 spec: `docs/specs/backend/2026-09-17-model-hosting-hf-design.md`

**Goal:** 매니페스트가 Hugging Face 커밋 고정 주소를 가리키게 하고, 파이 자체 서빙(`/models/`)으로 되돌리는 일은 매니페스트 수정만으로 끝나게 한다.

**Architecture:** URL 검증을 허용 목록(`/models/`, `https://huggingface.co/`) 하나로 모아 `ModelRef.url`과 `TtsManifest.baseUrl`이 함께 쓴다. 매니페스트 테스트는 HF 항목에만 커밋 고정을 강제한다.

**Tech Stack:** backend: FastAPI + pydantic v2 + uv + pytest

## Global Constraints

- 응답 형태 불변(필드 추가·삭제 없음). 프론트 코드 변경 없음 → 계약 PR 단독.
- `deploy/`·파이 볼륨 변경 없음(복귀용 유지).

---

### Task 1: 스키마 허용 목록

**Files:** Modify `backend/app/schemas.py`, Test `backend/tests/test_schemas.py`

- [x] **Step 1: 실패하는 테스트.** `test_manifest_allows_hugging_face_url`, `test_tts_base_url_allows_hugging_face_dir` 추가. 기존 `test_manifest_rejects_external_url`을 `test_manifest_rejects_non_allowlisted_url`로 바꾼다(`https://evil.example/`, `http://huggingface.co/`, `https://huggingface.co.evil.example/`, `//huggingface.co/`). tts baseUrl 거부 목록에 끝 `/` 없는 HF 주소와 유사 호스트를 추가한다. → 2 FAIL
- [x] **Step 2: 구현.** `ALLOWED_URL_PREFIXES = (MODELS_PREFIX, HF_PREFIX)`. `_validate_model_url`이 `startswith(ALLOWED_URL_PREFIXES)`로 검사하고, `TtsManifest._base_url`은 끝 `/` 확인 후 같은 함수를 쓴다.
- [x] **Step 3:** `uv run pytest -q` → 스키마 테스트 PASS. 커밋 `feat(api): 매니페스트 url·tts.baseUrl에 Hugging Face 주소 허용`

### Task 2: 매니페스트 전환

**Files:** Modify `backend/data/manifest.json`, `backend/tests/test_manifest.py`, `backend/tests/test_data.py`

- [x] **Step 1: 실패하는 테스트.** `test_repo_manifest_pins_hugging_face_revisions`: HF 항목은 `resolve/[0-9a-f]{40}/` 형식이어야 한다. `/models/` 항목은 건너뛴다. tts 계약 테스트는 baseUrl의 끝 `/`만 확인한다. `test_load_manifest_reads_repo_file`은 두 접두사를 모두 허용한다.
- [x] **Step 2: 구현.** `url`·`fallback.url`·`tts.baseUrl`을 spec 2절 주소로 바꾼다(HF API `sha`로 커밋 조회, 파일 크기가 매니페스트 size와 같은지 확인).
- [x] **Step 3: 검증.**
  - `uv run pytest -q` → 50 passed
  - 가드 확인: baseUrl을 `resolve/main/`으로 바꾸면 FAIL
  - 복귀 확인: `git show 50a1eaa:backend/data/manifest.json`으로 되돌리면 50 passed
  - 커밋 `feat(api): Gemma·Supertonic 다운로드를 ... Hugging Face(커밋 고정)에서 받도록 매니페스트 전환`

### Task 3: 문서

- [x] `docs/API.md` 예시·필드 설명, `docs/specs/backend/2026-09-15-backend-api-design.md` 3절 제약
- [x] 전체 설계서 5.4절(공동): 현재 HF, 파인튜닝 시 파이 복귀 링크
- [x] `deploy/README.md`: 파이 모델 파일은 복귀용으로 유지, 복귀 절차 링크
- [x] 루트 `CLAUDE.md` 개요의 모델 위치 문장

### Task 4: 게이트 + PR

- [x] `uv run pytest -q && uv run ruff check . && uv run ruff format --check .` → PASS·clean
- [ ] PR `feat(api): 모델·TTS 다운로드를 Hugging Face로 전환 (파이 서빙 복귀 절차 문서화)`

## 이후

- 머지 → 파이 api 재빌드 → 브라우저에서 다운로드·면접 확인(spec 6절)
- 프론트 후속 이슈: 매니페스트에 없는 옛 캐시 항목 정리(@leemonta9482)
- 파인튜닝 모델 배포 시 spec 7절 B

## Self-Review

- 스펙 커버리지: 목표 1 → Task 2, 목표 2(복귀는 매니페스트만) → Task 1(두 접두사 허용) + Task 2(조건부 고정 테스트·복귀 시뮬레이션) + spec 7절. ✅
- 함정: HF 작은 json이 brotli·chunked라 `Content-Length`가 없음 → 프론트가 매니페스트 size로 대조해 통과(브라우저 검증). 유사 호스트 접두사 우회 → 끝 `/` 포함 접두사와 테스트로 차단. ✅
