# 목소리 분석 — Gemini API 직접 호출 (BAZE 경로는 남김)

- 날짜: 2026-11-03
- 담당: 박찬우(@ssenu, backend)
- 기준: `docs/specs/backend/2026-10-23-ben-voice-baze-design.md`(목소리 분석 전체), 루트 `CLAUDE.md` 절대 하지 말 것 8번

## 1. 무엇을 · 왜

지금 벤 면접의 목소리 분석은 학교 BAZE 게이트웨이(팩트챗, `factchat-cloud.mindlogic.ai`)가 Gemini를 중계한다. 이것을 **Google Gemini API를 직접 부르는 방식**으로 바꾼다. BAZE 경로는 지우지 않고 설정 한 줄로 되돌릴 수 있게 남긴다.

- 한 번에 한 곳만 쓴다. 녹음은 언제나 고른 한 곳으로만 간다(자동 전환 없음).
- 쓸 Gemini 키는 **무료 등급**이다. 무료 등급은 구글이 입력을 서비스 개선(학습)에 쓰고 사람이 검토할 수 있으므로, 알리는 문구를 함께 고친다(5절).

## 2. 고르기 — `VOICE_PROVIDER`

| 환경변수 | 기본 | 뜻 |
|---|---|---|
| `VOICE_PROVIDER` | `gemini`(코드), compose는 `baze` | `gemini` 또는 `baze`. 다른 값이면 기동 실패(`ValueError`) |
| `GEMINI_API_KEYS` | (없음) | 쉼표로 여러 개. **서로 다른 구글 프로젝트의 키**여야 한도가 늘어난다(같은 프로젝트 키는 한도를 함께 쓴다) |
| `GEMINI_VOICE_MODEL` | `gemini-3.5-flash` | 분석 모델 이름 (2026-11-09: 3.8-flash에서 바꿈 — 응답 40~60초+로 리포트 대기 20초를 넘김, 3.5-flash 약 6초) |
| `BAZE_*` | 지금 그대로 | `VOICE_PROVIDER=baze`일 때만 쓴다 |

- `create_app`은 `VOICE_PROVIDER`가 가리키는 쪽 하나만 만든다. 그쪽 키가 없으면 분석기가 없다 → 지금처럼 `voiceAnalysis: "unavailable"`, 업로드 `503 voice_unavailable`.
- 잔액 확인 스레드는 BAZE일 때만 돈다.
- `deploy/docker-compose.yml`은 `VOICE_PROVIDER: ${VOICE_PROVIDER:-baze}`로 둔다. 프론트 문구(5절)가 나가고 서버 `.env`에 Gemini 키를 넣은 뒤 `.env`에서 `VOICE_PROVIDER=gemini`로 바꿔 켠다. 그 전에 이 변경이 배포돼도 지금 동작(BAZE)이 그대로다.
- 되돌리기: `.env`의 `VOICE_PROVIDER=baze` → 재배포(`docker compose up -d`).

## 3. 구성

- `backend/app/llm/voice_common.py`(신규): 두 경로가 함께 쓰는 것 — `VOICE_INSTRUCTION`, `VOICE_SCHEMA`, `VoiceResult`·`StoredVoice` 등 결과 모델, `VoiceOutcome`, `VoiceAnalyzer`, 요청 본문 만들기 `request_body(wav)`, 응답 파싱 `parse_response(r, idx)`. `baze.py`에서 옮기고, `baze.py`는 같은 이름을 다시 내보낸다(기존 import·테스트가 그대로 통과).
- `backend/app/llm/gemini.py`(신규): `GeminiClient` — `VoiceAnalyzer`를 그대로 만족한다. 라우터·임시 파일 삭제·DB 저장·리포트 코드는 바뀌지 않는다.
  - 주소 `https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`, 인증 `x-goog-api-key` 헤더. 본문은 BAZE와 같다.
  - `refresh_credits()`는 아무것도 하지 않는다(Gemini에는 잔액 조회가 없다).
  - 키 값은 로그·상태·예외에 남기지 않는다(순번 1부터만).
- 사용량 기록: `baze_usage` 표를 그대로 쓴다. `model` 칸에 `Settings.voice_usage_model`을 넣는다 — BAZE는 지금처럼 모델 이름, Gemini는 `gemini:` 접두어(`gemini:gemini-3.5-flash`). 마이그레이션 없음.

## 4. 오류와 한도

무료 등급 한도는 키(프로젝트)당 대략 분당 10회·하루 250회 안팎이다.

| 응답 | 처리 |
|---|---|
| 200 | 파싱. 형식이 틀리면 `bad_output`(지금과 같음) |
| 429, 분당 한도 | 그 키를 `retryDelay`(없으면 60초, 최소 1초)만큼 쉬게 하고 다른 키로 바로 보낸다. 분석 하나당 429는 키 수 x 2번까지만 받고 끝낸다(무한 반복 방지) |
| 429, 하루 한도(`quotaId`에 `PerDay`) | 그 키를 다음 날 태평양 시간 자정까지 쉬게 한다. 서머타임과 상관없이 UTC−8 고정으로 계산한다(서머타임 중에는 1시간 늦게 풀린다 — 안전한 쪽) |
| 401, 403, 400 `API_KEY_INVALID` | 그 키를 다시 쓰지 않는다(`dead`) |
| 5xx, 시간 초과 | 같은 키로 1회 재시도, 끝내 실패하면 `error`(지금과 같음) |
| 그 밖의 4xx | `error` |

- 보낼 키가 하나도 없고 가장 빨리 풀리는 쉬는 키가 **30초 안에** 풀리면, 그만큼 기다렸다가 한 번 더 돌린다(분석 하나당 기다림은 한 번). 넘으면 끝낸다.
- 끝낼 때: 모든 살아 있는 키가 하루 한도면 `exhausted`, 분당 한도로 끝났으면 `error`, 쓸 키가 없으면 `unavailable`. 어느 경우든 그 답변은 목소리 분석 없이 리포트를 만든다(지금과 같음).
- `available()`: 하루 한도로 쉬지 않고 죽지 않은 키가 하나라도 있으면 참(분당 한도로 잠깐 쉬는 키는 쓸 수 있는 것으로 본다).
- 동시 분석 수는 지금처럼 2개.

## 5. 알리는 문구

공통 문구(두 경로를 함께 덮는다 — 어느 쪽인지 알려 주는 API 필드는 두지 않는다):

> 목소리 분석에 동의한 벤 면접의 답변 녹음 → Google Gemini(직접, 또는 학교 BAZE 게이트웨이 경유). 구글이 서비스 개선에 쓰거나 사람이 검토할 수 있음. 분석 후 서버의 녹음은 바로 삭제

- 백엔드(이 작업): `docs/terms/2026-11-03-terms.md`(새 판), `TERMS_VERSION = "2026-11-03"`, `docs/API.md` 목소리 분석 설명, `deploy/README.md` 목소리 분석 절, 루트 `CLAUDE.md` 8번.
- 프론트(이슈로 요청): `frontend/src/content/terms.ts`, `frontend/src/views/PrepareView.vue` 동의 문구.
- 다시 동의받기는 하지 않는다. 실제 동의는 면접마다 받는 목소리 분석 체크이고, 그 자리에 새 문구가 보인다.
- 루트 `CLAUDE.md` 8번 개정은 공동 승인 사항이다 — PR에서 @leemonta9482 승인을 받는다.

## 6. 테스트

가짜 HTTP(`httpx.MockTransport`), 시계·`sleep` 주입.

- 정상 응답 → `ok`, 토큰 수. 요청 주소·`x-goog-api-key`·본문 확인. 키 값이 결과·상태·예외에 없음
- 분당 429 → 다음 키로 / 키가 다 쉬면 기다렸다 재시도 / 30초 넘으면 `error`
- 하루 429 → 다음 날까지 쉼, 모두 하루 한도면 `exhausted`, `available()` 거짓
- 401·403·`API_KEY_INVALID` → `dead`
- 5xx 1회 재시도
- `Settings`: `VOICE_PROVIDER` 기본·잘못된 값, `GEMINI_*` 파싱, `voice_usage_model`
- `create_app`: 고른 쪽만 만든다, 키 없으면 `None`
- 기존 BAZE·벤 목소리 테스트 그대로 통과

## 7. 하지 않는 것

- 실패 시 다른 경로로 자동 전환
- 유료 등급 전용 기능(배치, 컨텍스트 캐시)
- 어느 경로인지 프론트에 알려 주는 필드
