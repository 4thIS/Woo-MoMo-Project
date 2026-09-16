# frontend — 영역 가이드

> 루트 `../CLAUDE.md`를 먼저 읽으십시오. 이 파일은 frontend 영역 특수 규칙만 다룹니다.
> 담당: @leemonta9482

## 스택

- 언어/런타임: Vue 3 + TypeScript, Vite, Pinia. 브라우저 내 LLM은 `@litert-lm/core`(LiteRT-LM JS, WebGPU; WASM은 `public/litert-wasm/`에서 같은 오리진 서빙), 이력서는 pdf.js, 음성은 Web Speech API
- 패키지 매니저: **pnpm** (다른 매니저 사용 금지, `pnpm-lock.yaml` 커밋)
- 테스트: Vitest (+ @vue/test-utils)
- 린트·포맷: ESLint + Prettier + vue-tsc

## 폴더 규칙

```
frontend/src/
├── views/        # 화면 4개: LandingView, PrepareView, InterviewView, ReportView
├── components/   # 재사용 UI: components/ui/*, components/interview/{InterviewStage,ChatLog,AnswerInput}
├── services/     # 외부 세계 접점: llm.ts, modelCache.ts, pdf.ts, speech.ts, api.ts
├── stores/       # Pinia: model.ts(다운로드·초기화), interview.ts(단계·프로필·대화·리포트)
├── prompts/      # 시스템 프롬프트·리포트 지시문: interviewer.ts, report.ts (계층 규율 경로)
└── utils/        # 순수 함수: thoughts.ts, tokens.ts, endDetector.ts, goodAnswer.ts, reportParser.ts
```

## 계층 책임

- `utils/`는 브라우저 API·DOM·스토어를 import하지 않는 순수 함수만 둔다. 단위 테스트는 여기에 집중한다.
- `services/`는 브라우저 API(WebGPU, Cache, Speech, fetch)를 감싸고, 화면 상태를 모른다. 스토어를 import하지 않는다.
- `stores/`가 services와 utils를 조합해 상태를 만든다. `views/`와 `components/`는 스토어만 본다.
- 공통 인프라 계층은 도메인을 import하지 않는다(의존 방향 단방향 유지: views → stores → services/utils).

## 커밋 scope

- `feat(frontend):`, `fix(frontend):`, `style(frontend):`

## 테스트

- 새 코드는 테스트 동반(TDD: 실패 → 구현 → 통과).
- GPU가 필요한 코드(`services/llm.ts`)는 CI에서 실행하지 않는다. 대신 템플릿 조립·thought 제거·종료 감지·리포트 파싱을 순수 함수로 분리해 테스트한다.
- 준비 화면의 "면접 시작" 활성 조건(모델 준비 × 입력 완료)은 컴포넌트 테스트로 고정한다.
- 실제 모델 로드·면접 완주는 `docs/demo-checklist.md`의 수동 시나리오로 확인한다.

## 계약(Contract) 규칙

- 이 영역은 `/api/manifest`, `/api/questions/{field}` 응답을 **소비**한다. 형태의 소유자는 backend이며 `docs/API.md`가 기준이다.
- 응답을 임의 변환하지 않는다. 형태를 바꿔야 하면 backend 담당에게 이슈로 요청하고, `docs/API.md` 갱신 후 따라간다.
- 채팅 템플릿 토큰과 모델 URL은 하드코딩하지 않고 매니페스트에서 받는다.

## 절대 하지 말 것

- 다른 영역 디렉토리(`backend/`) 수정 금지 — 필요 시 이슈로 요청. `deploy/`·`docs/`·`finetune/`은 공동 영역이므로 상대방 리뷰를 받는다.
- 패키지 매니저·언어 버전 설정 임의 변경 금지.
- 계약(응답 스키마) 변경 시 backend 담당과 사전 협의 + 변경 제안에 BREAKING CHANGE 명시.
- 계층 규율 경로(`src/prompts/`, `src/services/llm.ts`)를 리허설 대조 없이 수정 금지.
- 이력서 텍스트·대화·리포트를 서버로 보내는 코드 작성 금지.
- 모델 출력을 `innerHTML`로 렌더링 금지 (`textContent` 또는 Vue 텍스트 바인딩만).
