# 벤 리포트 버전 2 — 설계 (spec, 백엔드)

- 생성일시: 2026-10-23
- 수정일시: 2026-10-23
- 선행: 전달력 1단계(#100·#101), ① 모집공고(`2026-10-23-ben-job-posting-design.md`), ② 목소리 분석(`2026-10-23-ben-voice-baze-design.md`)
- 구현 순서: ① → ② → ③(이 문서). ②보다 먼저 배포되면 측정값에는 브라우저 숫자만 들어간다.

## 0. 배경 · 위치

지금 리포트는 문항 배열 `[{question, answerSummary, feedback, delivery?}]`이고 꼬리질문을 본질문에 합친다. 그래서 Q1 안에 질문이 여럿 섞이고, 답변마다 나오는 측정값(전달력·목소리 분석)을 "문항에 속한 답변들"로 뭉뚱그려 평가한다.
벤 리포트를 **답변 하나 = 항목 하나**로 바꾸고(Q1, Q2, Q2-1…), 측정값을 그 항목에 정확히 붙이며, 맨 위에 종합(강점·개선점·전달력·공고 적합도)을 둔다.

## 1. 목표 · 비목표

### 목표
- 벤 리포트 버전 2: 답변별 항목(본질문/꼬리질문 구분) + 종합.
- 번호(Q1·Q2-1), 측정값 연결, 검증은 **서버가** 한다. 모델은 내용만 쓴다.
- 구조화 출력(JSON 스키마 강제)으로 파싱 실패를 없앤다.
- 예전 프론트·예전 기록이 깨지지 않는다(설정으로 단계적 전환).

### 비목표
- 로컬 면접관(Gemma) 리포트 — 지금 형식·지시문 그대로(프론트 계층 규율 경로 미변경).
- 종합 점수·등급(근거가 약하고 흔들림).
- 리포트 화면 구현(프론트 이슈).

## 2. 벤 출력 형식 (모델이 쓰는 것)

구조화 출력 스키마(모두 `additionalProperties: false`):
```jsonc
{
  "items": [
    { "answer": 1, "kind": "main" | "follow",
      "question": "질문 원문", "answerSummary": "답변 요약 한두 문장",
      "feedback": "피드백 두세 문장(가장 중요한 구절 하나 **강조**)",
      "delivery": "전달력 한두 문장" | null }
  ],
  "summary": {
    "strengths":    [{ "point": "…", "answers": [2, 3] }],   // 2~3개
    "improvements": [{ "point": "…(고칠 방법 포함)", "answers": [4] }],  // 2~3개
    "delivery":   "전달력 종합 2~3문장" | null,
    "postingFit": { "met": ["…"], "gaps": ["…"] } | null
  }
}
```
- `answer`: 지원자 답변 순번(1부터, `면접을 시작해 주세요.` 이후). 답변마다 정확히 한 항목.
- `kind`: 그 답변이 받은 질문이 새 본질문이면 `main`, 앞 질문을 파고든 꼬리질문이면 `follow`. 첫 항목은 `main`.
- `delivery`·`summary.delivery`: 측정 블록이 있을 때만 쓰고 없으면 `null`.
- `postingFit`: 브리핑에 "모집공고 요구사항"이 있고 "공고를 확인하지 못함"이 아닐 때만, 공고 요구사항을 근거로. 아니면 `null`.

## 3. 서버 처리 (`app/llm/report_v2.py` 신규)

- **검증:** `items[].answer` 집합 = `{1..답변 수}`(빠짐·중복 없음), 순서 오름차순, 첫 항목 `main`, `summary.*.answers`는 그 범위 안. 위반 → 같은 요청으로 **한 번 다시 생성**(시도 수에 포함). 다시 실패하면 SSE `error {"code":"bad_report"}`, 면접 상태는 그대로(재요청 가능).
- **번호:** `main`마다 `Q1, Q2, …`. `follow`는 바로 앞 `main` 아래 `Q{n}-1, Q{n}-2, …`, `parent`에 그 `main`의 id. `summary`의 `answers`를 `refs: ["Q2", "Q2-1"]`로 바꾼다.
- **측정값 연결:** 답변마다 `measurements`(없으면 `null`):
```jsonc
{ "syllablesPerMin": 352, "speed": "빠름",
  "longPauses": 4, "pausesPerMin": 3.1, "pause": "잦음", "longestPauseSec": 4.5,
  "firstWordSec": 4.2, "firstWord": "망설임 긺",
  "filler": { "level": "잦은 경향", "count": 6, "examples": ["음", "그"] } | null,
  "voice": { "confidence": {"level":"low","reason":"…"}, "tone": {...}, "tremor": {...},
             "trailingOff": {...}, "clarity": {...} } | null,
  "insufficient": false }
```
  값은 1단계 판정 규칙(`app/llm/delivery.py`)과 ② 결과를 그대로 쓴다(모델이 만든 숫자 아님). 측정 부족이면 `insufficient: true`에 나머지 `null`.

## 4. 계약 (`docs/API.md`, additive)

### 4.1 리포트 SSE
- 기존 `delta`(원문 조각)를 그대로 흘린 뒤, 버전 2가 켜져 있으면 **`event: report`** 한 번, 그다음 `done`.
```jsonc
event: report
data: { "version": 2,
        "items": [{ "id": "Q2-1", "parent": "Q2", "answer": 3, "kind": "follow",
                    "question": "…", "answerSummary": "…", "feedback": "…",
                    "delivery": "…" | null, "measurements": { … } | null }],
        "summary": { "strengths": [{ "point": "…", "refs": ["Q2","Q2-1"] }],
                     "improvements": [...], "delivery": "…" | null,
                     "postingFit": { "met": [...], "gaps": [...] } | null } }
```
- 검증 실패로 다시 생성할 때는 그 전에 **`event: reset`**(`{}`)을 보낸다 — 프론트는 그때까지 받은 원문 조각을 버린다.
- `done` 면접 재요청: 저장한 원문 `delta` + 저장한 `report` + `done`(Claude 미호출).
- 버전 2가 꺼져 있으면 지금과 똑같다(`report` 이벤트 없음).

### 4.2 설정 `BEN_REPORT_V2`
- 기본 `false`. 프론트가 버전 2 표시를 배포한 뒤 서버 `.env`에서 켠다. 켜지면 벤 리포트 지시문이 버전 2로 바뀌고 원문은 JSON 객체가 되므로 **예전 파서로는 읽을 수 없다** — 그래서 프론트 배포 뒤에만 켠다.

### 4.3 저장
- `premium_interviews.report_v2_json TEXT`(마이그레이션). 원문 `report_raw`는 지금처럼.
- 보관함 `ArchiveCreate`·`ArchiveDetail`에 선택 칸 `reportV2`(위 `report` 이벤트 데이터 그대로, 최대 200KB). 버전 2 기록은 `report` 배열을 빈 배열로 보내도 된다(지금은 최대 50개 — 0개 허용 유지 확인).

## 5. 벤 리포트 지시문 (`app/llm/prompts.py`, 계층 규율 경로)

- 버전 2가 켜졌을 때만 새 지시문(`REPORT_INSTRUCTION_V2`)을 쓴다. 꺼져 있으면 지금 지시문 그대로(프론트 동기화 테스트 대상은 그대로 지금 지시문).
- 요지: 답변마다 한 항목, 꼬리질문 구분, 압박 면접관 말투(칭찬 생략, 근거·수치 부족 직설), 측정 블록이 있으면 `delivery`·`summary.delivery`(목소리 인상은 "~하게 들렸다"), 공고 요구사항이 있으면 `postingFit`, 형식은 스키마가 강제.
- 리포트 시스템 프롬프트에 브리핑을 넣는 것은 **공고 적합도 판단 근거로서만** 허용(이전 결정 "리포트에 회사 정보 반영 안 함"의 예외). 브리핑이 없으면 지금처럼 2블록.
- 구조화 출력: Claude Sonnet 5.5 `output_config.format = {"type": "json_schema", ...}`(스트리밍 그대로), 폴백·effort(medium) 기존과 같음.

## 6. 영역별 영향

- backend: 2~5절, `docs/API.md`, 마이그레이션 1개, `deploy/README.md`(`BEN_REPORT_V2`).
- frontend(@leemonta9482에게 이슈로 요청): 버전 2 표시 — 맨 위 종합(강점·개선점 Q 번호 링크, 전달력 종합, 공고 적합도), 항목 목록(꼬리질문 들여쓰기 Q2-1), 항목별 측정값 표와 `delivery`, 보관함 상세·PDF·복사 텍스트, 예전 리포트(버전 1) 계속 표시. 보관 시 `reportV2` 전송.
- 로컬 면접관: 변경 없음.

## 7. 무회귀 · 롤아웃

- `BEN_REPORT_V2=false`면 리포트 요청·지시문·출력이 지금과 바이트 단위로 같다(기존 테스트 통과).
- 순서: 백엔드 PR(꺼진 채) → dev → 프론트 이슈(버전 2 표시) → demomo `.env`에서 켜기 → 벤 면접 1회 확인.

## 8. 성공 기준

- 테스트: 꺼짐 = 지금과 동일, 켜짐 = 구조화 출력 요청(스키마 포함), 검증(빠짐·중복·순서·첫 항목 main·refs 범위)과 재생성 1회·`bad_report`, 번호(Q2-1 parent), 측정값 연결(브라우저만 / ② 포함 / 측정 부족), `postingFit` 조건, `report` 이벤트·재요청 재전송, 보관함 `reportV2` 왕복.
- demomo: 꼬리질문이 있는 벤 면접 1회 → Q2-1 형식, 답변별 측정값, 종합(강점·개선점에 Q 번호), 공고를 넣었으면 공고 적합도.
