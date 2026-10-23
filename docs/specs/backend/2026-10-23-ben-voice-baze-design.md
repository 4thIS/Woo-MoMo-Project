# 벤 목소리 분석 BAZE 전환 — 설계 (spec, 백엔드)

- 생성일시: 2026-10-23
- 수정일시: 2026-10-23
- 이슈: #91 (2단계 "목소리 자신감" 포함)
- 선행: 전달력 분석 1단계(`docs/specs/backend/2026-10-16-ben-delivery-analysis-design.md`, #100·#101)
- **CLAUDE.md "절대 하지 말 것" 8번 개정이 필요하다(2절). 공동 승인 전에는 머지하지 않는다.**

## 0. 배경 · 위치

1단계는 브라우저가 녹음의 소리 크기로 말한 시간·쉼·첫마디까지를 재고, 받아쓰기(Web Speech) 글자 수로 음절을, 소리 모양으로 군말 경향을 추정한다. 벤(Claude)은 숫자를 받아 해석만 한다.
남은 한계는 두 가지다: ① 크롬 받아쓰기가 군말("음·어")을 지워 음절·군말이 부정확하다, ② 자신감·어조·떨림처럼 **소리를 들어야** 알 수 있는 것은 평가하지 못한다(Claude는 오디오를 받지 않는다).
학교가 제공하는 BAZE 게이트웨이(`factchat-cloud.mindlogic.ai`)에서 오디오를 이해하는 Gemini를 써서 이 둘을 해결한다. 숫자 측정은 정확한 브라우저 값을 그대로 쓰고, Gemini는 **들리는 그대로 받아쓰기(군말 포함)와 목소리 인상 평가**만 맡는다.

## 1. 목표 · 비목표

### 목표
- 벤 사용자가 **면접마다 동의**하면, 답변마다 녹음을 서버로 보내 BAZE Gemini로 분석한다(답변하는 동안 백그라운드).
- 분석 결과: 군말 포함 받아쓰기, 군말 횟수·예시, 자신감·어조·떨림·문장 끝 흐려짐·발음 명확성 등급 + 항목별 근거 한 줄.
- 리포트 때 브라우저 숫자와 합쳐 벤에게 준다(음절·군말은 Gemini 받아쓰기 기준으로 교체).
- 학교 키 여러 개를 돌려 쓴다(소진 시 다음 키).
- 동의하지 않았거나 BAZE를 쓸 수 없으면 지금(1단계)과 똑같이 동작한다. 면접을 막지 않는다.

### 비목표
- 리포트 구조 변경(③ 리포트 개선에서 Q1·Q2·Q2-1 구조와 함께 다시 짠다 — 이번엔 기존 `delivery` 문장에 녹인다)
- 숫자(말한 시간·쉼·첫마디) 측정을 AI로 대체 — 정확도가 떨어져 하지 않는다
- 로컬 면접관(무료) 음성 분석 — 녹음이 기기를 떠나지 않는다는 원칙 유지
- 관리자 대시보드의 BAZE 잔액·사용량 화면(9절 추후 방안)

## 2. 개인정보 — CLAUDE.md 8번 개정안

추가 문장(공동 승인 필요):

> **프리미엄 면접관(벤)** 사용자가 면접을 시작할 때 **목소리 분석에 동의한 경우에 한해**, 답변 녹음을 학교 BAZE 게이트웨이(외부 AI, Google Gemini)로 보내 분석한다. 서버의 임시 녹음은 분석이 끝나면 바로 지운다. 분석 결과(등급·근거·군말 수와 받아쓰기의 한글 음절 수)는 그 면접의 리포트 생성에만 쓴다. 받아쓰기 본문은 저장하지 않는다.

- 동의는 면접 단위(`voiceAnalysisConsent`)다. 가입 동의나 녹음 보관 동의와 별개다.
- 서버·외부로 가는 것: 그 답변의 녹음(16kHz 모노 WAV)과 분석 지시문. 이력서·다른 답변은 넣지 않는다.
- 녹음 파일·받아쓰기·키 값은 로그에 남기지 않는다.

## 3. 데이터 · 계약

`/api` 계약 변경 **있음 — additive**. `docs/API.md` 먼저, 백엔드 배포 후 프론트(lockstep).

### 3.1 `POST /api/premium/interviews` — `voiceAnalysisConsent`
- 선택 불리언, 기본 `false`. `premium_interviews`에 저장(마이그레이션으로 칸 추가, 기본 0).
- 응답 `InterviewStarted`에 `voiceAnalysis: "on" | "off" | "unavailable"` 추가 — 동의했어도 서버에 BAZE 키가 없거나 모두 쓸 수 없으면 `unavailable`(프론트는 업로드하지 않는다).

### 3.2 `POST /api/premium/interviews/{id}/voice/{answer}` (신규)
- 본문: `multipart/form-data`, 칸 `file`. `Content-Type: audio/wav`(16kHz 모노 PCM 16비트 권장), 최대 **5MB**(약 2분 40초). `answer`는 1부터, 이 면접의 실제 답변 수 이하.
- 오류: `401`(비로그인), `404`(남의/없는 면접), `403 {"error":"voice_consent_required"}`(동의 안 한 면접), `409 {"error":"interview_over"}`(리포트까지 끝난 면접), `413 too_large`, `415 unsupported_media`(WAV 아님 — RIFF/WAVE 머리 확인), `422 invalid`(`answer` 범위), `429 rate_limited`(벤 분당 6회와 별개로 사용자당 분당 20회), `429 {"error":"voice_limit"}`(면접당 분석 상한 16회 = 답변 최대 8 × 2), `503 {"error":"voice_unavailable"}`(키 없음·모두 사용 불가).
- 성공: `202 {"status":"queued"}`. 같은 답변을 다시 보내면 이전 결과를 지우고 다시 분석한다.
- 분석은 백그라운드 스레드에서 돈다(회사 조사 작업 스레드와 같은 방식, 자기 DB 연결). 결과는 `voice_analysis`에 저장하고 **임시 파일을 지운다**(성공·실패 모두).

### 3.3 저장 (마이그레이션 1개)
- `premium_interviews.voice_consent INTEGER NOT NULL DEFAULT 0`
- `voice_analysis`: `interview_id, answer, status(queued|done|failed|unavailable), result_json, error_code, created_at, updated_at`, 기본키 `(interview_id, answer)`. `result_json`은 4절 스키마에서 **`transcript`를 뺀** 것에 `syllables`(받아쓰기의 한글 음절 수)를 더한 값이다. 받아쓰기 본문과 녹음은 저장하지 않는다(데이터 최소화) — 워커가 음절 수만 세고 본문은 버린다.
- `baze_usage`: `id, at, user_id, interview_id, key_index, model, input_tokens, output_tokens, outcome(ok|error|exhausted|refused)` — 키 값이 아니라 **순번**만.
- 임시 녹음: `DATA_DIR/voice_tmp/{id}-{answer}.wav`, 분석 끝나면 삭제. 기동 시 남은 파일 정리.

### 3.4 리포트 (`POST …/report`) — 합치기
- 기존 `delivery` 본문(브라우저 숫자)은 그대로 받는다.
- 동의한 면접이면 서버가 답변별로 합친다:
  - `syllables` → 저장된 `syllables`(Gemini 받아쓰기의 한글 음절 수, 군말 포함)로 교체. 0이면 브라우저 숫자를 그대로 둔다
  - `fillerLevel` → Gemini `fillers.count`를 말한 1분당 횟수로 환산해 판정(2 이하 적음, 5 이하 보통, 초과 잦은 경향)
  - 측정 블록 줄 끝에 `자신감 높음·어조 차분·떨림 없음·끝 흐려짐 있음·발음 좋음` 과 근거(각 60자 이내로 잘라) 덧붙임
- 분석이 `queued`인 답변이 있으면 **최대 20초** 기다리며 `: ping`을 보낸다. 끝나지 않은 답변은 기존 브라우저 숫자만 쓴다.
- 리포트 출력 형식은 1단계와 같다(문항별 `delivery?`). 벤 리포트 지시문의 전달력 문단에 "목소리 인상은 근거를 들어 단정하지 말고 '~하게 들렸다'로 말한다"를 더한다(`app/llm/prompts.py`, 계층 규율 경로 — 측정이 없으면 지금과 같다).

## 4. Gemini 호출 (`app/llm/baze.py` 신규)

- 엔드포인트: `POST https://factchat-cloud.mindlogic.ai/v1/gateway/gemini/v1beta/models/{model}:generateContent` (게이트웨이 Gemini 네이티브 경로), 헤더 `Authorization: Bearer <key>`, `User-Agent` 지정(빈 값이면 Cloudflare 403).
- 모델: 설정 `BAZE_VOICE_MODEL`, 기본 `gemini-3.8-flash`.
- 본문: `contents[0].parts = [{inline_data: {mime_type: "audio/wav", data: <base64>}}, {text: <지시문>}]`, `generationConfig.responseMimeType = "application/json"`, `responseSchema` = 아래.
- 결과 스키마(모두 필수):
```jsonc
{
  "transcript": "들리는 그대로(음·어 등 군말 포함)",
  "fillers": { "count": 3, "examples": ["음", "그"] },
  "confidence": { "level": "high|mid|low", "reason": "…" },
  "tone":       { "level": "calm|tense|monotone", "reason": "…" },
  "tremor":     { "present": false, "reason": "…" },
  "trailingOff":{ "present": true,  "reason": "…" },
  "clarity":    { "level": "good|ok|poor", "reason": "…" }
}
```
- 지시문 요지: 한국어 면접 답변 녹음이다. 내용 평가는 하지 말고 목소리와 전달만 평가한다. 받아쓰기는 고치지 말고 군말까지 들리는 그대로 적는다. 근거는 녹음에서 들린 것만 쓴다.
- 서버가 스키마 검증(pydantic). 어긋나면 `failed`(`error_code = "bad_output"`).
- 시간 상한 60초, 재시도는 키 풀 규칙(5절)만.

### 4.1 0단계 검증(구현 계획 첫 Task)
- 실제 키로 `GET /v1/gateway/gemini/v1beta/models`와 짧은 WAV `generateContent`를 호출해 **오디오 입력이 되는지** 확인한다.
- 안 되면 같은 스키마로 `gpt-audio-1.5`(OpenAI 호환 `chat/completions`의 `input_audio`)를 시도한다. 둘 다 안 되면 구현을 멈추고 보고한다(spec 개정).

## 5. 학교 키 돌려 쓰기 (`app/llm/baze_keys.py` 신규)

- 설정 `BAZE_API_KEYS`: 쉼표 구분 키 목록(공백 제거, 빈 항목 제거, 순서 유지). 없으면 기능 꺼짐(`voiceAnalysis: "unavailable"`).
- 키마다 상태: `ok` / `low`(남은 크레딧이 `BAZE_MIN_REMAINING` 미만, 기본 50) / `exhausted`(다음 `renewal_date`까지) / `dead`(401 — 재기동까지).
- 잔액 확인: 기동 시와 30분마다 `GET /v1/gateway/credits/`로 키별 `total.remaining`·`monthly_allocated.renewal_date`를 읽어 상태를 갱신(백그라운드, 실패는 무시).
- 선택: 순번이 가장 앞선 `ok` 키를 쓴다(앞 키를 다 쓴 뒤 다음 키 — 사용자 요구). `ok`가 없으면 `low` 중 첫 번째.
- 호출 결과에 따라:
  - `402`("Credit balance exhausted") → 그 키 `exhausted`(만료 = `renewal_date`, 모르면 다음 달 1일 0시 KST), **다음 키로 즉시 재시도**
  - `401` → `dead`, 다음 키로 재시도
  - `429` → 다음 키로 재시도(모든 키가 429면 기다리지 않고 바로 `failed`)
  - `5xx`·시간 초과 → 같은 키로 1회 재시도 후 `failed`
- 모든 키를 쓸 수 없으면 `unavailable`. 상태는 메모리에만 둔다(재기동 시 잔액 확인으로 복구).
- 키 값은 로그·응답·DB에 남기지 않는다. 순번(1부터)으로만 표시.
- 동시성: 상태 변경은 잠금으로 보호(작업 스레드 여러 개).

## 6. 영역별 영향

- backend: 3~5절, `docs/API.md`, `deploy/README.md`(`.env`의 `BAZE_API_KEYS`·`BAZE_VOICE_MODEL`·`BAZE_MIN_REMAINING`, 키 넣는 법 — `read -rsp`).
- frontend(@leemonta9482에게 이슈로 요청): 벤 시작 전 목소리 분석 동의 체크박스(2절 문구), `voiceAnalysis`가 `on`일 때만 답변마다 녹음을 16kHz 모노 WAV로 만들어 업로드(이미 #101에서 디코드하는 단계 재사용), 업로드 실패는 조용히 넘어감(면접 계속).
- CLAUDE.md 8번 개정(2절) — 공동 승인.

## 7. 무회귀 · 롤아웃

- 동의하지 않은 면접, 키가 없는 서버는 1단계와 똑같다(요청·프롬프트·리포트). 기존 테스트 그대로 통과.
- 순서: 0단계 검증 → CLAUDE.md 개정 합의 → 백엔드 PR → dev 머지 → demomo `.env`에 키 넣기(사람) → curl로 녹음 업로드·분석 결과 확인 → 프론트 이슈.

## 8. 성공 기준

- 테스트(가짜 BAZE 클라이언트): 동의·미동의 분기, 업로드 검증(크기·WAV 머리·답변 범위·동의), 202 후 백그라운드 결과 저장과 임시 파일 삭제, 스키마 불일치 `failed`, 면접당 상한 `429 voice_limit`, 받아쓰기 본문 미저장(음절 수만), 재시작 시 `queued` 정리, 키 풀(402 다음 키·만료 후 복귀, 401 dead, 429 다음 키, 전부 불가 `unavailable`, 잔액 기준 건너뛰기), 리포트 합치기(음절·군말 교체, 등급 덧붙임, 20초 대기·미완료 제외), 키 값 비노출.
- demomo: 실제 키로 벤 면접 1회 — 답변마다 `voice_analysis`가 `done`, 리포트 `delivery`에 자신감·어조 등 근거가 들어감, 임시 녹음이 남지 않음.

## 9. 추후 방안

- Soniox(`stt-async-v5`)로 구간 시각이 있는 받아쓰기 — 정밀 시각이 필요해지면.
- 관리자 대시보드에 BAZE 키별 잔액·사용량(`baze_usage`) 화면.
- ③ 리포트 개선에서 목소리 분석을 문항별 표·요약으로 표시.
