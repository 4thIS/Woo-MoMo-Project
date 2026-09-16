# 리포트 PDF 저장 · 소요 시간 · 말하기 자동 전송 — 설계 (spec)

- 생성일시: 2026-09-16
- 담당: @leemonta9482
- 상위 문서: `docs/superpowers/specs/2026-09-15-mock-interview-design.md` 3절(화면), `docs/specs/frontend/2026-09-15-screens-design.md` 4.3(면접)·4.4(리포트)
- 관련 구현: `frontend/src/views/ReportView.vue`, `frontend/src/stores/interview.ts`, `frontend/src/components/interview/{InterviewStage,AnswerInput}.vue`, `frontend/src/services/speech.ts`

## 0. 배경 · 위치

plan 2(PR #9)로 면접 완주·리포트가 동작한 뒤 사용자 리뷰에서 나온 추가 요청 세 가지. 모두 **프론트만으로** 되고 서버 전송·계약 변경이 없다. 구현 순서는 **③ PDF → ① 시간 → ② 자동 전송** (CSS 위주 → 순수 함수 → 실기기 리허설 필요 순).

| # | 요청 | 한 줄 결론 |
|---|---|---|
| ① | 전체 시간·질문별 걸리는 시간 | 메시지에 시각을 찍고 순수 함수로 계산. 면접 중엔 경과 시계 하나, 리포트에 총 시간 + 질문별 표 |
| ② | 말하기 켜고 말하다 멈추면 자동 입력 | 첫 마디 이후 음성 결과가 3초 없으면 자동 전송. 카운트다운을 보여 준다 |
| ③ | 리포트 PDF 저장 | `window.print()` + 인쇄 스타일. Chrome "PDF로 저장"으로 끝. 라이브러리 없음 |

## 1. 목표 · 비목표

### 목표
- ③ 리포트 완료 후 **PDF로 저장** 버튼 하나로 흰 배경·검정 글자의 읽기 좋은 PDF가 나온다. 파일명 기본값이 `모의면접 리포트 - {직무} - {YYYY-MM-DD}`.
- ① 면접 중 상단에 **경과 시간**(`mm:ss`)이 흐른다. 리포트 헤더에 **총 소요 시간**, 별도 창에 **면접관 질문(꼬리질문 포함)마다 답하는 데 걸린 시간** 표. 텍스트 복사·PDF에도 포함.
- ② 말하기 토글이 켜진 상태에서 **첫 마디가 인식된 뒤** 음성 결과가 `3초` 동안 없으면 지금까지 받아쓴 답변을 자동 전송한다. 전송 전까지 남은 시간이 눈에 보인다.

### 비목표 (이번엔 안 함 / 후속)
- 질문 번호·잔여 질문 수 표시 (확정 결정 유지 — 면접 화면엔 경과 시간만).
- 진짜 PDF 바이너리 생성(jsPDF 등). 한글 폰트 임베드가 무겁고 인쇄 스타일로 충분.
- 리포트 카드(파서 결과 5문항)와 면접관 턴의 1:1 매칭. 파서의 질문 문장은 모델이 다시 쓴 것이라 턴과 확실히 대응시킬 수 없다 → 시간은 **턴 단위** 표로만 낸다.
- 자동 전송 on/off 설정, 침묵 시간 사용자 조절. 상수 하나로 두고 리허설에서 조정.
- 답변 지연 watch(20초/30초)와의 통합 — 그대로 둔다.

## 2. 데이터 · 계약

- `backend/data/manifest.json` · `/api` 응답 스키마 변경: **없음**.
- 스토어 내부 형태 변경(프론트 전용):
  - `ChatMessage`에 `at: number`(epoch ms) 추가. 면접관 턴은 **말이 끝난 시각**(messages.push 시점), 지원자 턴은 **전송 시각**.
  - `startedAt: number | null` — `start()`에서 `phase = 'interview'`로 바뀌는 순간. `endedAt: number | null` — `ended`가 true가 되거나 `finish()`가 불린 시각 중 먼저.
- 리포트 텍스트 복사(`reportToText`)에 "소요 시간" 절이 추가된다(부가 정보, 기존 줄은 그대로).

## 3. 접근 제어 / 제약

- 서버로 나가는 요청 없음. 시각·PDF 모두 브라우저 안에서 끝난다.
- ③ 인쇄: `@media print`에서 **디자인 토큰만 재정의**한다(`--bg/--win: 흰색`, `--text/--line: 검정`, `--accent: 인쇄용 진한 색`). 색 리터럴은 `tokens.css` 안에만. 별하늘·버튼·안내문·스크롤 화살표는 인쇄에서 숨긴다. 카드는 `break-inside: avoid`.
- ① 시간 계산은 `utils/timing.ts` 순수 함수. 시각이 없는 옛 메시지(`at` 없음)는 표에서 제외하되 예외를 던지지 않는다.
- ② 침묵 판정은 **음성 인식 결과 이벤트**(`onInterim`/`onFinal`) 기준. 키보드 입력은 타이머를 건드리지 않는다. 첫 결과가 오기 전(생각 중)에는 절대 보내지 않는다. 자동 전송 시점에 받아쓴 텍스트가 공백뿐이면 보내지 않고 계속 듣는다. 토글을 손으로 끄면 타이머 취소(텍스트는 남김). `generating`/`disabled`로 잠기면 타이머 취소. Chrome 인식기가 스스로 끝나는(`onEnd`) 경우에도 타이머는 살아 있어 3초에 전송한다.
- ② 상수 `SILENCE_MS = 3000`. Chrome이 무음으로 인식을 스스로 끊는 시간(대략 5~8초)보다 짧아야 한다. 리허설에서 2.5~4초 사이로 조정 가능.
- `prefers-reduced-motion`: 카운트다운 바는 애니메이션 없이 남은 초 숫자만.

## 4. 인터페이스 계약

| 함수 / 컴포넌트 | 접근 | 설명 |
|---|---|---|
| `utils/timing.ts` `formatClock(ms): string` | internal | `mm:ss` (1시간 넘으면 `h:mm:ss`) |
| `utils/timing.ts` `formatDuration(ms): string` | internal | `12분 34초`, 60초 미만 `34초` |
| `utils/timing.ts` `turnDurations(messages, endAt): { question: string; ms: number }[]` | internal | 면접관 턴의 `at`(질문이 끝난 시각)부터 **그 다음 지원자 턴의 `at`**(답변 전송 시각)까지 = 답하는 데 쓴 시간. 답변 없이 끝났으면 `endAt`까지. `at` 없는 메시지는 건너뜀 |
| `utils/timing.ts` `totalDuration(startedAt, endedAt): number` | internal | 둘 중 하나라도 null이면 0 |
| `stores/interview.ts` `startedAt`, `endedAt`, `ChatMessage.at` | internal | 위 2절 |
| `utils/reportParser.ts` `reportToText(items, fieldLabel, job, timing?)` | internal | `timing`이 있으면 끝에 "소요 시간" 절 추가 |
| `InterviewStage` prop `elapsedMs: number` | internal | 상단바 태그 옆 `mono` 시계 |
| `ReportView` 버튼 `data-test="print"` | internal | `reportStatus === 'done'`일 때만 활성. `document.title` 교체 → `window.print()` → `afterprint`에 복원 |
| `AnswerInput` 상수 `SILENCE_MS` (export) | internal | 테스트가 참조 |
| `AnswerInput` 표시 `data-test="silence"` | internal | 타이머가 무장되면 보이는 카운트다운(바 + 남은 초) |

## 5. 영역별 영향

- frontend: `stores/interview.ts`(시각 3곳: start/push/ended), `utils/timing.ts`(신규)+테스트, `utils/reportParser.ts`(복사 텍스트), `components/interview/InterviewStage.vue`(시계), `views/InterviewView.vue`(1초 tick), `views/ReportView.vue`(총 시간·시간 표·PDF 버튼·인쇄 스타일), `styles/tokens.css`(인쇄 토큰), `styles/base.css`(인쇄 시 숨김), `components/interview/AnswerInput.vue`(침묵 타이머·카운트다운)+테스트.
- backend: 없음.
- deploy / finetune: 없음.
- 계층 규율 경로(`prompts/`, `services/llm.ts`): 수정 없음.

## 6. 무회귀 · 롤아웃

- `at`/`startedAt`/`endedAt`은 additive. 기존 테스트의 메시지 픽스처(`at` 없음)는 그대로 통과해야 한다(timing 함수가 없는 값을 건너뛰므로).
- 자동 전송은 말하기 토글이 켜졌을 때만 동작. 키보드 입력 흐름(Enter 전송)은 변화 없음.
- 인쇄 토큰은 `@media print` 안에서만 재정의 → 화면 렌더에 영향 없음.
- 한 PR로 머지 가능하나 커밋은 ③ → ① → ② 순으로 분리. 데모 체크리스트에 "PDF 저장", "경과 시계", "말하기 후 3초 침묵 자동 전송" 항목 추가.

## 7. 역할 분담

| 영역 | 담당 |
|------|------|
| frontend | @leemonta9482 |
| backend | @ssenu (리뷰) |
| deploy / docs / finetune | @ssenu @leemonta9482 |

## 8. 성공 기준

- ③ 리포트 완료 → `PDF로 저장` → Chrome 인쇄 대화상자에서 흰 배경·검정 글자, 카드가 페이지 중간에서 잘리지 않음, 버튼·별·안내문 없음, 기본 파일명이 `모의면접 리포트 - 백엔드 개발자 - 2026-09-16.pdf`. 저장 후 탭 제목이 원래대로 돌아옴.
- ① 면접 중 상단 시계가 1초마다 오름. 리포트 헤더에 `총 12분 34초`, "시간" 창에 면접관 턴별 행(질문 앞 40자 + `2분 14초`). 텍스트 복사 결과 끝에 같은 내용. 질문 번호·남은 수는 어디에도 없음.
- ② 말하기 켜고 한 문장 말한 뒤 입을 다물면 카운트다운이 보이고 3초 뒤 자동 전송·생성 시작. 말하기 켜고 아무 말 안 하면 영원히 보내지 않음. 말하는 도중(결과가 계속 오는 동안)엔 보내지 않음. 토글을 끄면 취소.
- 게이트: `pnpm test && pnpm lint && pnpm exec prettier --check . && pnpm exec vue-tsc --noEmit && pnpm build` 통과. 신규 순수 함수·컴포넌트 동작은 Vitest, 인쇄 모양과 음성 타이밍은 수동(데모 체크리스트).

## 9. 열린 결정 (plan 단계에서 확정)

- 인쇄용 `--accent` 색값(진한 황갈색 계열, 흰 배경 대비 4.5:1 이상)과 강조 표기(색 + 굵게).
- 리포트 "시간" 창의 위치: 헤더 바로 아래(총평 앞) — 기본값. 카드 뒤로 보내도 됨.
- 면접 중 시계 위치: 상단바 왼쪽 태그 옆 — 기본값.

## 10. 추가 — 질문별 답변 타이머 (2026-09-16 저녁 결정)

시안 https://claude.ai/artifact/R3282oDimv4AwZzeZLBwpc 에서 **B(게이지 바) + R2(카드 태그)** 채택.

- 제한 `ANSWER_LIMIT_MS = 60_000`, 임박 `ANSWER_WARN_MS = 10_000`. 전체 경과 시계와 별개.
- 시작 시점: 면접관 질문이 **끝난 시각**(마지막 `model` 메시지의 `at`, 시간 표와 같은 기준). 다음 질문이 오면 자동으로 60초부터 다시. 생성 중·종료 후·질문이 아직 없을 때는 표시하지 않는다.
- 표시(입력창 바로 위, `data-test="answer-timer"`): 왼쪽으로 줄어드는 게이지 바 + 오른쪽 `mm:ss`. 남은 시간 ≤ 10초면 바·숫자가 `--danger`로 바뀌고 숫자가 깜빡인다. 0을 지나면 바는 비고 숫자는 `-00:12`처럼 음수로 계속 흐른다(전송을 막지 않는다).
- 리포트: 턴 수(인사 제외)와 카드 수가 같을 때만 각 카드 제목 옆에 태그 — 60초 이내 `답변 42초`(ok), 초과 `답변 1분 30초 · 30초 초과`(danger). 개수가 다르면 태그 없음. "시간" 창은 항상 초과 행의 시간을 `--danger`로, 창 제목 옆에 `제한 60초 · 초과 N문항` 태그.
- 순수 함수(`utils/timing.ts`): `answerLeftMs(questionAt, now)`, `formatSignedClock(ms)`(`00:47` / `-00:12`), `overBy(ms)`(초과분, 없으면 0).
- 복사 텍스트·PDF는 기존 시간 절 그대로(초과 여부는 `(30초 초과)`를 줄 끝에 덧붙인다).
