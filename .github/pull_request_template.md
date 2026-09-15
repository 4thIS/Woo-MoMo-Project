## 무엇을

(이 변경이 한 일을 한 문장으로)

## 왜

(이슈 링크 또는 spec/plan 링크)

## 어떻게 검증했는지

- [ ] 로컬에서 실제 동작 확인
- [ ] 테스트 추가/수정 (커밋에 반영)
- [ ] 검증 명령 결과 첨부 (아래, 해당 영역만)

```
# frontend
pnpm test && pnpm lint && pnpm exec prettier --check . && pnpm exec vue-tsc --noEmit  → passed / clean
# backend
uv run pytest -q && uv run ruff check . && uv run ruff format --check .                → passed / clean
```

## 체크리스트

- [ ] `feature/` 또는 `fix/` 브랜치에서 작업 (main 직접 커밋 안 함)
- [ ] Conventional Commits 형식 (`feat(frontend)`, `fix(backend)`, `feat(api)`, `chore(infra)` 등)
- [ ] 자기 영역만 수정 — 타 영역·공유 영역 수정 시 이유 명시
- [ ] 비밀키·`.env`·모델 파일·이력서 샘플 미포함
- [ ] pre-commit 훅 통과
- [ ] 계약(`backend/data/manifest.json`, `/api` 응답 스키마) 변경이 있다면: `docs/API.md` 갱신 + 계약 PR을 **먼저** 머지·배포했는가(lockstep)
- [ ] 계층 규율 경로(`frontend/src/prompts/`, `frontend/src/services/llm.ts`, `deploy/`) 변경이 있다면: 리허설·검증 결과 첨부

## BREAKING CHANGE?

- [ ] 있음 — 무엇이 깨지는지, 어떻게 대응할지 본문에 서술
- [ ] 없음
