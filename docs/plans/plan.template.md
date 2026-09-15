# {기능명} — 구현 계획 (plan)

<!-- 배치: docs/plans/YYYY-MM-DD-{feature-slug}.md -->
<!-- writing-plans 스킬로 작성. spec을 "어떻게"로 옮긴 작업지시서. Task 단위로 쪼갠다. -->
<!-- 각 Task는 그대로 실행 가능해야 한다: 파일·인터페이스·실패테스트·구현·커밋까지 명시. -->

- 생성일시: YYYY-MM-DD
- 기준 spec: `docs/specs/YYYY-MM-DD-{feature-slug}-design.md`

**Goal:** (한 문장)

**Architecture:** (구현 방식 요약. 기존 무엇을 재사용, 무엇이 신규.)

**Tech Stack:** frontend: Vue 3 + TS + Vite + Pinia + Vitest / backend: FastAPI + uv + pytest

## Global Constraints

- (전 Task 공통 제약. 예: 계약 변경 없음 / 있음 → `docs/API.md` + backend PR 먼저(lockstep).)
- 자기 영역(`frontend/` 또는 `backend/`)만. 공유 영역 변경은 별도 Task로 분리하고 상대방 리뷰.
- 이력서·대화·리포트를 서버로 보내지 않는다.

---

### Task 1: {작업 제목}

**Files:**
- Create/Modify: `frontend/src/...` 또는 `backend/app/...`
- Test: `frontend/src/.../*.test.ts` 또는 `backend/tests/test_*.py`

**Interfaces:**
- Produces: `함수 시그니처 / 엔드포인트 / 컴포넌트 props`

- [ ] **Step 1: 실패하는 테스트**

```ts
// 실패하는 테스트 코드
```

Run: `pnpm test -- {selector}` 또는 `uv run pytest -q tests/test_x.py` → FAIL.

- [ ] **Step 2: 구현**

```ts
// 구현 코드
```

- [ ] **Step 3: 통과 + 커밋**

Run: `pnpm test` 또는 `uv run pytest -q` → PASS.

```bash
git add {files}
git commit -m "feat(frontend): {작업 제목}"
```

---

### Task 2: {작업 제목}

(Task 1과 동일 구조로 반복)

---

### Task N: 전체 게이트 + 변경 제안

- [ ] **Step 1: full 게이트**

frontend: `pnpm test && pnpm lint && pnpm exec prettier --check . && pnpm exec vue-tsc --noEmit` → 전부 PASS·clean.
backend: `uv run pytest -q && uv run ruff check . && uv run ruff format --check .` → 전부 PASS·clean.

- [ ] **Step 2: 변경 제안**

- 제목: `feat(frontend): {기능명}` 또는 `feat(backend): {기능명}`
- 본문: Task 요약 + 게이트 결과 + (계약 변경 시) **lockstep 필요 명시**.

## 이후

- (배포 순서, 후속 작업, 타 영역 연계.)

## Self-Review (계획 검토)

- 스펙 커버리지: spec의 각 목표 → 어느 Task가 담당하는지. ✅
- Placeholder 없음(실제 코드로 채워짐). ✅
- 함정 선제 회피: (매니페스트 필드 additive 여부·재사용 헬퍼 실존·GPU 의존 코드의 테스트 분리 등 미리 점검한 것.)
