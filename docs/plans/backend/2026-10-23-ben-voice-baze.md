# 벤 목소리 분석 BAZE 전환 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 동의한 벤 면접의 답변 녹음을 답변마다 학교 BAZE 게이트웨이의 Gemini로 보내 군말 포함 받아쓰기·목소리 인상을 분석하고, 리포트 전달력 블록에 합친다. 학교 키 여러 개를 앞에서부터 돌려 쓴다.

**Architecture:** `app/llm/baze.py`(키 풀 + Gemini 오디오 분석 클라이언트, httpx) → `app.state.baze`(키 없으면 None). 업로드 API가 임시 WAV를 저장하고 워커 스레드에서 분석해 `voice_analysis`에 저장·임시 파일 삭제. 리포트 때 `delivery.render`가 답변별 목소리 결과를 합친다. 마이그레이션 006.

**Tech Stack:** Python 3.12, FastAPI, httpx(이미 의존성), sqlite3, pytest(`httpx.MockTransport`), ruff, uv

**Spec:** `docs/specs/backend/2026-10-23-ben-voice-baze-design.md`

## Global Constraints

- 동의(`voiceAnalysisConsent`)하지 않은 면접, BAZE 키가 없는 서버는 1단계와 바이트 단위로 같다(요청·프롬프트·리포트). 기존 테스트 그대로 통과.
- 녹음·받아쓰기·키 값은 로그·응답·DB에 남기지 않는다(키는 순번 1부터만). 예외 로그는 `type(exc).__name__`만.
- 임시 녹음 `DATA_DIR/voice_tmp/{interview_id}-{answer}.wav`는 분석 성공·실패와 관계없이 지운다. 기동 시 남은 파일 삭제.
- BAZE: 기본 URL `https://factchat-cloud.mindlogic.ai/v1/gateway`, 헤더 `Authorization: Bearer <key>`, `User-Agent: woo-momo/1.0`. Gemini: `POST {base}/gemini/v1beta/models/{model}:generateContent`, 잔액: `GET {base}/credits/`.
- 설정: `BAZE_API_KEYS`(쉼표, 공백 제거, 빈 항목 제거, 순서 유지), `BAZE_VOICE_MODEL`(기본 `gemini-3.8-flash`), `BAZE_MIN_REMAINING`(기본 50).
- 키 풀 규칙: 순번이 가장 앞선 `ok` 키 → 없으면 첫 `low`. `402` → `exhausted`(`renewal_date`까지, 모르면 다음 달 1일 00:00 KST) 후 다음 키 즉시 재시도. `401` → `dead`, 다음 키. `429` → 다음 키(모두 429면 실패). `5xx`·시간 초과 → 같은 키 1회 재시도 후 실패. 상태는 메모리·잠금 보호. 잔액 확인은 기동 시와 30분마다(실패 무시).
- Gemini 요청: `contents[0].parts = [{inline_data:{mime_type:"audio/wav", data:<base64>}}, {text: VOICE_INSTRUCTION}]`, `generationConfig: {responseMimeType: "application/json", responseSchema: VOICE_SCHEMA}`, 시간 상한 60초.
- 결과 스키마(모두 필수): `transcript`(str), `fillers:{count:int≥0, examples:[str]}`, `confidence:{level: high|mid|low, reason}`, `tone:{level: calm|tense|monotone, reason}`, `tremor:{present: bool, reason}`, `trailingOff:{present: bool, reason}`, `clarity:{level: good|ok|poor, reason}`. 어긋나면 `failed`(`bad_output`).
- 업로드 API `POST /api/premium/interviews/{id}/voice/{answer}`: multipart `file`, RIFF/WAVE 머리, 최대 5MB, `answer` 1..실제 답변 수. 오류: 401·404·`403 voice_consent_required`·`409 interview_over`(done)·`413 too_large`·`415 unsupported_media`·`422 invalid(field answer)`·`429 rate_limited`(사용자당 분당 20회, 키 `voice:{user}`)·`503 voice_unavailable`. 성공 `202 {"status":"queued"}`. 같은 답변 재업로드는 덮어쓰기.
- 시작 응답 `voiceAnalysis`: 동의 안 함 `off`, 동의 + BAZE 사용 가능 `on`, 동의 + 키 없음/모두 불가 `unavailable`.
- 리포트 합치기: 동의 면접이고 결과 `done`인 답변만 — `syllables` ← `transcript`의 한글 음절 수, 군말 판정 ← `fillers.count`를 말한 1분당(`÷ max(speechSec/60, 0.5)`)으로: 2 이하 "적음", 5 이하 "보통", 초과 "잦은 경향"(예시 최대 3개), 줄 끝에 `, 목소리: 자신감 {높음|보통|낮음}·어조 {차분|긴장|단조}·떨림 {있음|없음}·끝 흐려짐 {있음|없음}·발음 {좋음|보통|낮음}`과 근거(항목당 60자 이내, ` / `로 이음). `queued`가 있으면 최대 20초 기다리며 15초마다 `: ping`(테스트에서 monkeypatch 가능한 모듈 상수).
- 목소리 결과가 하나라도 들어가면 `DELIVERY_INSTRUCTION` 뒤에 `VOICE_NOTE = "목소리 항목은 녹음을 들은 AI의 판정입니다. 단정하지 말고 근거를 들어 '~하게 들렸다'로 말하세요."`를 붙인다(없으면 지금 그대로).
- CLAUDE.md 8번 개정 문장은 spec 2절 그대로.
- 마이그레이션 번호 **006**(③ 리포트 버전 2가 007).
- 커밋: `feat(backend)` / `feat(api)` / `docs:` / `chore(infra)`(compose). 검증: `cd backend && uv run ruff format . && uv run pytest -q && uv run ruff check . && uv run ruff format --check .`

---

### Task 1: BAZE 클라이언트 — 키 풀 + Gemini 오디오 분석 (`app/llm/baze.py`)

**Files:** Create `backend/app/llm/baze.py`, `backend/tests/test_baze.py`. Modify `backend/app/config.py`(설정 3개), `backend/tests/test_config.py`.

**Interfaces — Produces:**
- `Settings.baze_api_keys: tuple[str, ...] = ()`, `baze_voice_model: str = "gemini-3.8-flash"`, `baze_min_remaining: float = 50.0`
- `VoiceResult`(pydantic, 스키마 그대로), `VOICE_SCHEMA`(Gemini responseSchema dict), `VOICE_INSTRUCTION`(지시문: 한국어 면접 답변 녹음, 내용 평가 금지·목소리와 전달만, 받아쓰기는 군말까지 들리는 그대로, 근거는 들린 것만)
- `KeyPool(keys, *, clock)`: `pick() -> int | None`(순번 0부터 내부), `mark_exhausted(i, renewal: datetime | None)`, `mark_dead(i)`, `set_remaining(i, remaining, renewal)`, `available() -> bool`, `status() -> list[dict]`(순번·상태·남은 크레딧, 키 값 없음)
- `BazeClient(settings, *, http: httpx.Client | None = None, clock=time.time)`: `analyze(wav: bytes) -> VoiceOutcome`(`result: VoiceResult | None`, `outcome: ok|error|exhausted|unavailable|bad_output`, `key_index: int | None`(1부터), `input_tokens`, `output_tokens`), `refresh_credits() -> None`, `available() -> bool`
- 응답 토큰: `usageMetadata.promptTokenCount`·`candidatesTokenCount`(+`thoughtsTokenCount`는 output에 합산)

- [ ] **Step 1: 실패 테스트**(`httpx.MockTransport`로 BAZE 흉내): 설정 파싱; 성공(요청 URL·헤더·본문 구조·스키마, 결과 파싱, 키 순번 1); 402 → 다음 키 재시도 성공·첫 키 exhausted·`renewal` 지난 뒤 다시 사용; 401 → dead; 429 → 다음 키; 모든 키 불가 → `unavailable`; 5xx 1회 재시도; 스키마 불일치 → `bad_output`; `refresh_credits`로 남은 크레딧 50 미만 키 건너뛰기; `status()`에 키 값 없음.
- [ ] **Step 2~4** — 실패 확인 → 구현 → 검증
- [ ] **Step 5: 커밋** `feat(backend): BAZE 클라이언트 — 학교 키 앞에서부터 돌려 쓰기(402·401·429), Gemini 오디오 분석 스키마`

### Task 2: 저장 — 마이그레이션 006 + `repos/voice.py` + 가짜 BAZE

**Files:** Create `backend/app/migrations/006_voice_analysis.sql`, `backend/app/repos/voice.py`, `backend/tests/test_repo_voice.py`. Modify `backend/app/repos/premium.py`(`PremiumInterview.voice_consent`, `start_interview(..., voice_consent=False)`), `backend/app/ids.py`(필요 시 접두어), `backend/tests/fakes.py`(`FakeBaze`).

```sql
-- 벤 목소리 분석(spec 2026-10-23 ②). additive.
ALTER TABLE premium_interviews ADD COLUMN voice_consent INTEGER NOT NULL DEFAULT 0;
CREATE TABLE voice_analysis (
    interview_id TEXT NOT NULL,
    answer INTEGER NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('queued', 'done', 'failed', 'unavailable')),
    result_json TEXT,
    error_code TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (interview_id, answer)
);
CREATE TABLE baze_usage (
    id TEXT PRIMARY KEY,
    at TEXT NOT NULL,
    user_id TEXT NOT NULL,
    interview_id TEXT,
    key_index INTEGER,
    model TEXT NOT NULL,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    outcome TEXT NOT NULL
);
CREATE INDEX baze_usage_at ON baze_usage (at);
```

**Interfaces — Produces:** `voice.queue(conn, *, interview_id, answer, now)`(덮어쓰기: 상태 queued·결과 비움), `voice.finish(conn, *, interview_id, answer, status, result_json, error_code, now)`, `voice.results(conn, *, interview_id) -> dict[int, (status, VoiceResult | None)]`, `voice.record_usage(conn, *, at, user_id, interview_id, key_index, model, input_tokens, output_tokens, outcome)`. `FakeBaze`: `available` 플래그, `results`(VoiceOutcome 또는 예외 목록), `calls`(wav 길이만 기록).

- [ ] **Step 1~5** — 테스트(왕복·덮어쓰기·결과 조회·사용량 기록·마이그레이션 후 칸 기본값 0) → 구현 → 검증 → 커밋 `feat(backend): 목소리 분석 저장(마이그레이션 006) — 면접 동의 칸, 답변별 결과, BAZE 사용량`

### Task 3: 계약 — 동의·업로드 API·임시 파일·compose·`docs/API.md`

**Files:** Modify `backend/app/schemas.py`(`InterviewStart.voiceAnalysisConsent`, `InterviewStarted.voiceAnalysis`), `backend/app/routers/premium.py`(시작·업로드), `backend/app/main.py`(`app.state.baze` 주입 가능: `create_app(..., baze=...)`, 키 있으면 `BazeClient`, 30분 잔액 확인 백그라운드), `backend/app/startup.py`(`voice_tmp` 생성·정리), `deploy/docker-compose.yml`(api `environment`에 `BAZE_API_KEYS: ${BAZE_API_KEYS:-}`, `BAZE_VOICE_MODEL: ${BAZE_VOICE_MODEL:-gemini-3.8-flash}`, `BAZE_MIN_REMAINING: ${BAZE_MIN_REMAINING:-50}`), `docs/API.md`, `backend/tests/conftest.py`(가짜 BAZE 주입 픽스처). Test `backend/tests/test_ben_voice.py`.

- [ ] **Step 1: 실패 테스트** — 시작 `voiceAnalysis` 세 값; 동의 저장; 업로드 성공 `202` → (워커 완료 후) `voice_analysis` `done`·결과 저장·임시 파일 없음·`baze_usage` 1행(키 순번); 동의 안 함 403; 남의 면접 404; done 면접 409; 5MB+1 → 413; WAV 아님 415; answer 0·초과 → 422; 분당 21번째 429; BAZE 없음 503; 분석 실패(`bad_output`·예외) → `failed`·임시 파일 없음; 재업로드 덮어쓰기; 기동 시 `voice_tmp` 남은 파일 삭제; 로그에 받아쓰기 문자열 없음(caplog).
- [ ] **Step 2~4** — 실패 확인 → 구현(워커는 회사 조사 워커처럼 `ThreadPoolExecutor` + 자기 DB 연결, 예외는 `failed`로 접고 `type(exc).__name__`만 경고) → 검증. `docker compose -f deploy/docker-compose.yml config -q`도 통과.
- [ ] **Step 5: 커밋** `feat(api): 벤 목소리 분석 동의·답변 녹음 업로드(202, 백그라운드 BAZE 분석, 임시 녹음 삭제)`

### Task 4: 리포트 합치기 (`app/llm/delivery.py`, `app/llm/prompts.py`, 리포트 라우트)

**Files:** Modify `backend/app/llm/delivery.py`(`AnswerMetrics.voice: VoiceResult | None = None`, `filler_count`·`filler_examples` 반영), `backend/app/llm/prompts.py`(`VOICE_NOTE`, `report_messages(..., voice=False)`), `backend/app/routers/premium.py`(`_delivery_block`이 동의 면접이면 `voice.results`로 합치기 + 대기). Tests `test_delivery.py`, `test_prompts.py`, `test_ben_report.py`.

- [ ] **Step 1: 실패 테스트** — 목소리 결과 없음 → 지금 블록과 바이트 동일; 결과 있음 → 음절 교체·군말 판정(경계 2·5, 0.5분 하한)·목소리 줄(근거 60자 자르기); 측정 부족 답변에는 목소리 줄 안 붙임; 리포트에서 `queued` 대기(모듈 상수 monkeypatch로 짧게) 후 완료분만 반영·`: ping`; 목소리 있을 때만 `VOICE_NOTE`; 동의 안 한 면접은 결과가 있어도 무시.
- [ ] **Step 2~4** — 실패 확인 → 구현 → 검증(`test_prompt_parity.py` 포함)
- [ ] **Step 5: 커밋** `feat(backend): 벤 리포트 전달력에 목소리 분석 합치기 — 받아쓰기 음절·군말 수, 자신감·어조 등 근거, 최대 20초 대기`

### Task 5: 문서 — CLAUDE.md 8번 개정, 배포 README

**Files:** Modify `CLAUDE.md`(8번에 spec 2절 문장 추가), `deploy/README.md`("목소리 분석(BAZE)" 절: `.env` 변수 3개, `read -rsp`로 키 넣기, `chmod 600 .env`, 키 순번·잔액 확인 방법, 크레딧 소진 시 동작).

- [ ] **Step 1~2** — 작성 → 커밋 `docs: CLAUDE.md 8번 개정(벤 목소리 분석 동의 시 BAZE 전송) — 공동 승인 필요, 배포 README BAZE 키`

## 마무리 (컨트롤러)

- 전체 리뷰 → PR(`feature/voice-baze` → `dev`, 리뷰어 @leemonta9482, **CLAUDE.md 개정 승인 요청 명시**) → 프론트 이슈(동의 체크박스·WAV 업로드) → 머지 후 demomo 실제 키·실제 음성으로 확인(군말 받아쓰기 여부 포함).
