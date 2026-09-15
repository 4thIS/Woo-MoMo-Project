# frontend 화면 4종 — 설계 (spec)

- 생성일시: 2026-09-15
- 수정일시: 2026-09-15
- 담당: @leemonta9482
- 상위 문서: `docs/superpowers/specs/2026-09-15-mock-interview-design.md` 섹션 3(프론트엔드), 4(LLM 상호작용), 6(에러 처리)
- 시각 규칙: `docs/specs/frontend/2026-09-15-design-system-design.md` (이 문서는 색·글꼴·컴포넌트 모양을 반복하지 않는다)
- 시안: https://claude.ai/artifact/L7rDzUXJGQ35Rq7As9mvuQ 1페이지 "확정 화면 (C 방향)"
- 계약 문서: `docs/API.md` (소비만)

## 0. 배경 · 위치

전체 설계서 3.1이 정한 네 화면(랜딩·준비·면접·리포트)을 시안으로 확정했다. 이 문서는 각 화면이 **무엇을 보여주고, 어떤 상태를 거치며, 무엇이 일어나면 다음으로 넘어가는지**를 고정한다. 구현 순서와 Task 분해는 plan에서 한다.

## 1. 목표 · 비목표

### 목표
- 네 화면의 상태·전환·입력·에러 처리를 관찰 가능한 문장으로 확정한다.
- 화면과 스토어·서비스 사이의 경계(무엇을 읽고 무엇을 호출하는지)를 정한다.
- 면접관 스프라이트 상태 기계(대기·질문·듣기·좋은 답변·답변 지연)의 트리거를 정한다.

### 비목표 (이번엔 안 함 / 후속)
- 시스템 프롬프트·리포트 지시문 문안(`src/prompts/`, 계층 규율 경로). 별도 spec.
- LLM 런타임 선택(LiteRT-LM JS vs MediaPipe)의 최종 결정. `docs/model-verification-2026-09-15.md` 4절을 따르며 `services/llm.ts` 뒤에 숨긴다. 화면은 런타임을 모른다.
- 모바일 대응, 라이트 테마, 계정·저장.

## 2. 데이터 · 계약

- `GET /api/manifest` (`id url size template systemPromptOverride fallback`)와 `GET /api/questions/{field}`를 소비한다. 변경 없음.
- `backend/data/manifest.json` · `/api` 응답 스키마 변경: **없음**.
- 사용자 데이터(이력서 텍스트·대화·리포트)는 어떤 요청에도 실리지 않는다. 네트워크 요청은 매니페스트·폴백 질문·모델 파일 세 가지뿐이다.

## 3. 공통 규칙

- 라우터 없음. `stores/interview.ts`의 `phase: 'landing' | 'prepare' | 'interview' | 'report'`가 화면을 고른다. 브라우저 뒤로가기는 지원하지 않는다(새로고침 = 처음부터, 단 모델 캐시는 유지).
- 재방문(Cache API에 매니페스트 `id`의 모델이 있음)이면 랜딩의 동의·장비 확인은 건너뛰지 않고 **접힌 상태로 통과 표시**만 하고 준비 화면으로 바로 간다. 이유: 면책은 매번 보여야 하고, 다운로드는 안 해도 초기화는 해야 한다.
- 실행 시 채워지는 값이 아직 없으면 요소를 숨기지 말고 `--text-3`으로 "확인 중"을 쓴다. 대괄호 문자열이 화면에 남으면 버그.
- 모델 출력은 항상 텍스트 바인딩. 리포트 강조(`**…**`)만 파서가 span으로 바꾼다.

## 4. 화면별 설계

### 4.1 LandingView

한 페이지 세로 스크롤. 창은 순서대로 펼쳐지고, 펼쳐질 때 그 창으로 `scrollIntoView`.

| 순서 | 창 | 내용 | 다음으로 넘어가는 조건 |
|---|---|---|---|
| 1 | 타이틀 | 로고 "모두의 / 모의면접", 태그 "브라우저에서 실행 · 서버 전송 없음", 한 줄 부제, 깜빡이는 "▶ 아래로 내려서 시작" | 스크롤. 히어로 진행률에 따라 로고 창이 페이드(디자인 시스템 3.5) |
| 2 | 면접관 소개 | `Avatar`(가운데 면접관) + 대사(타이핑): 무엇을 하는지, 왜 모델을 내려받는지 | 항상 표시 |
| 3 | 동의 | `KeyValueGrid`(모델 id · 용량 · 저장 위치 "이 브라우저의 캐시" · 삭제 방법) + `ChoiceMenu` ["네, 이해했고 이 브라우저에 내려받는 데 동의합니다" / "아니요, 더 알아보고 올게요"] | "네" 선택 → 창 4 펼침. "아니요" 선택 → 창 2로 스크롤 백, 아무것도 저장하지 않음 |
| 4 | 장비 확인 | `StatCard` ×3: WebGPU(`navigator.gpu` 유무) · GPU(`adapter.info`/`requestAdapterInfo` 이름, 못 읽으면 "이름 확인 불가") · 저장 공간(`navigator.storage.estimate()` 여유 vs 매니페스트 `size`). 결과 태그: 셋 다 통과 "출전 가능"(`ok`) / 저장 공간만 부족 "공간 부족"(`danger`) / WebGPU 없음 "실행 불가"(`danger`). 면책 본문(하드웨어에 따라 품질·속도 차이, GPU 메모리 부족 시 E2B 전환). `PixelButton`"확인했습니다. 내려받기 시작" | 버튼 → `navigator.storage.persist()` 요청 → 다운로드 시작 → `phase = 'prepare'`. WebGPU 없음이면 버튼 비활성 + 안내(최신 Chrome·GPU). 저장 공간 부족이면 버튼 비활성 + 필요 용량 안내 |

- 용량 표기는 매니페스트 `size`를 **1024 기준(GiB)** 소수 첫째 자리로("약 2.8GB") — 브라우저 저장 공간 표기와 같은 기준. 하드코딩 금지.
- 다운로드 창은 랜딩에 두지 않는다. 버튼을 누르는 순간 준비 화면으로 바뀌고 거기서 캐릭터가 걷기 시작한다.

### 4.2 PrepareView

같은 폭의 창 세 개가 세로로. 다운로드는 랜딩에서 이미 시작됐다.

**창 1 · 다운로드/초기화 (`PixelProgress`)**

| 스토어 상태 | 장면 | 문구(중앙) | 우측 |
|---|---|---|---|
| `downloading` 0–30% | walk_underwear, 10%부터 양복이 다가옴 | "출근 준비 중…" | 남은 시간 추정(최근 5초 속도 기준) |
| 30% | pickup_suit 1회 | "양복 챙김" | |
| 30–70% | walk_suit, 50%부터 가방 | "양복은 챙겼습니다. 가방을 찾는 중…" | |
| 70% | pickup_bag 1회 | "가방 챙김" | |
| 70–90% | walk_suit_bag, 회사가 오른쪽에서 들어옴 | "가방도 챙겼습니다. 회사가 보이기 시작했어요." | |
| 90–100% | | "회사 앞입니다" | |
| `initializing` | look_up 마지막 프레임 유지 | "출근 완료 — 자리에 앉는 중" | "초기화 약 N초" |
| `ready` | look_up 유지, 바 100% `--ok` | "면접관이 자리에 앉았습니다" | |
| `error` | 정지 프레임, 바 `--danger` | 실패 이유 한 줄 | `PixelButton 보조`"다시 시도" / 초기화 실패면 "경량 모델로 시도"(fallback) + "캐시 지우기" |

- 수신 바이트 ≠ `Content-Length`면 캐시에 저장하지 않고 `error`.
- 캐시 히트면 `downloading`을 건너뛰고 `initializing`부터, 장면은 look_up으로 시작.

**창 2 · 지원 정보** — 분야 칩 5개(`it finance manufacturing retail general` ↔ 표기 IT 금융 제조 유통 기타), 직무 텍스트(1–40자). 둘 다 채워지면 태그 "입력 완료". 분야가 정해지면 `/api/questions/{field}`를 미리 불러 스토어에 둔다(실패해도 면접은 진행, 폴백 질문 없이).

**창 3 · 이력서** — PDF 드롭/선택 → `services/pdf.ts`로 텍스트 추출 → 앞 2,000자 절단 → 미리보기 + 태그 "N자 추출". 추출 결과가 50자 미만이면 "글자를 거의 읽지 못했습니다(스캔본?)" 안내 + 직접 붙여넣기 textarea 노출. 붙여넣기도 같은 절단 규칙.

**하단** — 체크리스트 3항목(분야·직무 / 이력서 / 면접관 출근)과 `PixelButton`"면접 시작". 활성 조건: `model.status === 'ready' && profile.field && profile.job && resumeText.length >= 50`. 비활성일 때 버튼 문구가 이유를 말한다: 모델 미준비 "면접관이 자리에 앉으면 열립니다", 입력 미완료 "위 항목을 채우면 열립니다". 클릭 → 시스템 프롬프트 조립(`prompts/interviewer.ts`, 매니페스트 `systemPromptOverride` 우선) → 첫 생성 시작 → `phase = 'interview'`.

### 4.3 InterviewView

한 화면 고정(1280×900 기준, 스크롤 없음). 무대 ≈ 2/3, 하단 패널 ≈ 1/3.

**무대** — CSS 면접실 + 면접관 3인(×6) + 지원자 정수리(×6, 하단 중앙 걸침). 말풍선은 가운데 면접관 위, 최신 면접관 발화만 스트리밍 표시(이전 발화는 대화 기록으로). 좌상단 분야·직무, 우상단 `PixelButton 보조`"면접 종료". **질문 번호·잔여 질문·꼬리질문 수는 표시하지 않는다.**

**면접관 상태 기계** (`stores/interview.ts`의 `stage`, 애니 매핑은 디자인 시스템 5절)

| stage | 진입 조건 | 이탈 |
|---|---|---|
| `asking` | 모델 토큰 스트리밍 시작 | 스트리밍 끝 → `waiting` |
| `waiting` | 질문 표시 완료 | 입력 시작 → `listening` / 20초 무입력 → `watch` 1회 재생 후 `waiting` 유지(이후 30초마다 반복) |
| `listening` | 입력창에 글자가 있거나 말하기 토글 ON | 전송 → `thinking` / 입력 비움 → `waiting` |
| `thinking` | 전송 직후, 첫 토큰 전 | 첫 토큰 → `asking`. 직전 답변이 "좋은 답변" 조건이면 `react` 1회를 먼저 재생 |

- **좋은 답변** 1차 규칙: 답변이 150자 이상이고 문장이 2개 이상. 모델 판단을 쓰는 방식은 프롬프트 spec에서 결정(9절).
- 말풍선 텍스트는 `thought` 채널(`<|channel>thought … <channel|>`)을 제거한 뒤 표시. 여는 태그를 만나면 닫힐 때까지 보류.

**하단 패널** — 좌(7): 대화 기록, 역할 라벨 mono, 최신이 아래, 자동 스크롤. 우(5): 답변 textarea(Enter 전송, Shift+Enter 줄바꿈) + **말하기 토글** + 전송.

- 말하기 토글: 누르면 `services/speech.ts` 시작, 다시 누르면 종료. 듣는 동안 버튼 `--accent` 배경 + 깜빡이는 점, textarea 테두리 `--accent`, 중간 결과(interim)는 `--text-2`, 확정 결과는 `--text`로 textarea에 **덧붙인다**(기존 입력 유지). 종료해도 자동 전송하지 않는다. 권한 거부·미지원이면 버튼 비활성 + 툴팁 한 줄, 텍스트 입력은 항상 가능.
- 생성 중(`asking`·`thinking`)에는 textarea·말하기 비활성, 전송 버튼이 "중단"으로 바뀐다. 중단하면 지금까지 받은 텍스트를 면접관 발화로 확정하고 `waiting`.
- 생성 오류: 대화 기록은 유지, 말풍선에 "응답이 끊겼습니다" + `PixelButton 보조`"다시 물어보기"(마지막 user 턴 재전송).

**종료 조건** — 모델 발화에 종료 문장("면접을 마치겠습니다")이 포함되거나, 사용자가 "면접 종료"를 누르면(확인 대화창 한 번: "지금까지의 답변으로 리포트를 만들까요?") 리포트 생성 시작 → `phase = 'report'`. 대화 토큰 근사(한글 1자=1, 그 외 4자=1)가 6,500을 넘으면 입력을 막고 "면접관이 마무리하려 합니다" 안내와 함께 종료 버튼만 남긴다.

### 4.4 ReportView

- 진입 즉시 같은 세션에 리포트 지시문(`prompts/report.ts`)을 user 턴으로 보내고, 생성 중에는 총평 창 자리에 `PixelProgress` 없이 mono "리포트를 쓰는 중…" + 깜빡이는 블록 커서(면접관은 clerk_write 재생).
- 파싱: 코드 펜스(```` ```json ````) 제거 → `JSON.parse` → `[{question, answerSummary, feedback}]` 검증(배열, 각 필드 문자열). `feedback` 안의 `**…**`는 `--accent` span으로. 실패하면 문항 창 하나에 원문을 mono로 그대로.
- 상단: 제목, 태그(분야·직무, 질문 N · 꼬리질문 M — N은 카드 수, M은 대화 기록에서 모델 턴 수 − N), 버튼 [텍스트 복사][다시 면접 보기]. 하단에 버튼 쌍 반복.
- 텍스트 복사 형식: `모두의 모의면접 리포트 · {분야} · {직무}\n\nQ1. {question}\n답변 요약: {answerSummary}\n피드백: {feedback}\n\nQ2. …` (강조 별표 제거). 복사 성공 시 버튼 문구 2초간 "복사됨".
- 다시 면접 보기: 대화·프로필·이력서·리포트 초기화, 모델 세션 재생성, `phase = 'prepare'`(모델은 `ready` 유지라 다운로드 창은 완료 상태). 랜딩으로 돌아가지 않는다.
- 리포트는 메모리에만 있다. 새로고침하면 사라지며, 상단 문구로 이를 미리 알린다.

## 5. 에러 처리 (전체 설계서 6절을 화면에 배치)

| 상황 | 화면 | 처리 |
|---|---|---|
| WebGPU 없음 | 랜딩 창 4 | "실행 불가" 태그, 버튼 비활성, 최신 Chrome·전용 GPU 안내 |
| 저장 공간 부족 | 랜딩 창 4 | "공간 부족" 태그, 필요 용량 명시, 버튼 비활성 |
| 다운로드 실패·바이트 불일치 | 준비 창 1 | `error` + 다시 시도, 캐시 저장 안 함 |
| 초기화 실패(GPU 메모리 등) | 준비 창 1 | `error` + "경량 모델로 시도"(fallback 있을 때) + "캐시 지우기" |
| PDF 추출 실패·50자 미만 | 준비 창 3 | 안내 + 직접 붙여넣기 |
| 매니페스트 요청 실패 | 랜딩 | 창 3 용량 자리에 "확인 중" 유지, 5초 후 "서버에 연결할 수 없습니다 — 새로고침" |
| 폴백 질문 요청 실패 | 준비 | 조용히 무시(면접은 진행) |
| 음성 인식 실패·권한 거부 | 면접 | 말하기 비활성 + 툴팁, 텍스트 입력 유지 |
| 생성 중 오류·중단 | 면접 | 기록 유지, 마지막 턴 재시도 |
| 리포트 JSON 파싱 실패 | 리포트 | 원문 창 하나 |

## 6. 인터페이스 계약

| 대상 | 접근 | 설명 |
|---|---|---|
| `stores/model.ts` — `status: 'idle'|'downloading'|'downloaded'|'initializing'|'ready'|'error'`(`downloaded`: 다운로드 끝, 초기화 전), `received`, `total`, `error`, `manifest`, `download()`, `init()`, `retry()`, `useFallback()`, `clearCache()` | internal | 준비 창 1과 랜딩 창 3·4가 읽는다. 화면은 `services/modelCache.ts`·`services/llm.ts`를 직접 부르지 않는다 |
| `stores/interview.ts` — `phase`, `stage`, `profile {field, job}`, `resumeText`, `fallbackQuestions`, `messages[]`, `streaming`, `report`, `canStart`, `start()`, `send(text)`, `abort()`, `finish()`, `reset()` | internal | 네 화면 전부 |
| `services/api.ts` — `getManifest()`, `getQuestions(field)` | internal | `docs/API.md` 형태 그대로 반환, 변환 없음 |
| `services/pdf.ts` — `extractText(file): Promise<string>` | internal | pdf.js, 워커 로컬 번들 |
| `services/speech.ts` — `start(onInterim, onFinal)`, `stop()`, `supported` | internal | Web Speech API 래퍼, `lang: 'ko-KR'`, `continuous: true`, `interimResults: true` |
| `services/llm.ts` — `create(manifest)`, `generate(messages, onToken, signal)`, `dispose()` | internal | 런타임 은닉. 템플릿 조립은 `utils/template.ts`(MediaPipe 폴백일 때만 사용) |
| `utils/thoughts.ts` `utils/tokens.ts` `utils/reportParser.ts` `utils/endDetector.ts` | internal | 순수 함수, Vitest 대상 |
| `components/ui/*` | internal | 디자인 시스템 4절 |

## 7. 영역별 영향

- frontend: 전부 신규(`frontend/` 프로젝트 생성 포함).
- backend: 없음.
- deploy: 없음(`web.Dockerfile`이 `frontend/package.json` 존재 시 자동 빌드).
- finetune: 없음.

## 8. 무회귀 · 롤아웃

- 기존 프론트 없음. 첫 배포는 `main` 머지 → 파이에서 `docker compose up -d --build`.
- 매니페스트 `id`가 바뀌면 캐시 키가 갈리므로 재방문자도 랜딩 동의부터 다시 지나간다(의도).

## 9. 열린 결정 (plan 또는 프롬프트 spec에서 확정)

- "좋은 답변" 판정: 길이 규칙(기본) vs 모델이 발화 앞에 숨은 표식을 붙이는 방식. 후자는 프롬프트 spec에서.
- 답변 지연 임계값 20초/30초 — 리허설에서 조정.
- 리포트 강조 `**…**`를 프롬프트로 요청할지, 아니면 강조 없이 갈지 — 프롬프트 spec에서.
- 재방문 시 랜딩 창 2–4를 "접힌 통과 표시"로 보여주는 구체 모양 — plan에서 최소 형태로.
- LLM 런타임: LiteRT-LM JS 우선, D-5 안에 붙지 않으면 MediaPipe 0.10.29. `services/llm.ts` 인터페이스는 두 경우 동일.

## 10. 성공 기준

- 첫 방문: 랜딩 동의 → 장비 확인 → 준비(다운로드 진행 장면이 % 구간대로 바뀜) → 입력 → 면접 시작 활성 → 면접 1회 완주 → 리포트 카드 5개. `docs/demo-checklist.md` 시나리오 통과.
- 재방문: 다운로드 없이 초기화만 거쳐 준비 화면 도달.
- 면접 중 화면 어디에도 질문 번호·잔여 수가 없다.
- 말하기 토글 ON/OFF가 버튼·입력창 색으로 구분되고, OFF 후 자동 전송되지 않는다.
- 네트워크 탭에 매니페스트·질문·모델 파일 외 요청이 없다.
- Vitest: thought 제거, 토큰 근사, 종료 문장 감지, 리포트 파서(펜스·강조·실패 폴백), 절단, "면접 시작" 활성 조건 조합.
