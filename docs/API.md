# 백엔드 계약 (API)

> 소유: backend (@ssenu). 이 문서와 `backend/app/schemas.py`는 항상 일치해야 한다.
> 변경은 additive만. 변경 PR을 먼저 머지·배포한 뒤 frontend가 새 필드를 사용한다(lockstep).

## GET /api/manifest

현재 서빙 중인 모델과 채팅 템플릿. 프론트는 모델 URL·템플릿 토큰을 하드코딩하지 않고 여기서 받는다.

```json
{
  "id": "gemma4-e4b-it",
  "url": "https://huggingface.co/litert-community/gemma-4-E4B-it-litert-lm/resolve/2eee7ac325f20eb8c9ac1d0e972f7c84663062da/gemma-4-E4B-it-web.litertlm",
  "size": 2969059328,
  "template": {
    "turnStart": "<|turn>",
    "turnEnd": "<turn|>",
    "roles": { "system": "system", "user": "user", "model": "model" }
  },
  "systemPromptOverride": null,
  "fallback": {
    "id": "gemma4-e2b-it",
    "url": "https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm/resolve/b3ca0d2f076785a8f4b2219ddbd2bdb99954eae1/gemma-4-E2B-it-web.litertlm",
    "size": 2008432640
  },
  "tts": {
    "id": "supertonic-3",
    "baseUrl": "https://huggingface.co/Supertone/supertonic-3/resolve/3cadd1ee6394adea1bd021217a0e650ede09a323/",
    "files": [
      { "path": "onnx/text_encoder.onnx", "size": 36416150 },
      { "path": "onnx/duration_predictor.onnx", "size": 3700147 },
      { "path": "onnx/vector_estimator.onnx", "size": 256534781 },
      { "path": "onnx/vocoder.onnx", "size": 101424195 },
      { "path": "onnx/tts.json", "size": 8253 },
      { "path": "onnx/unicode_indexer.json", "size": 277676 },
      { "path": "voice_styles/M2.json", "size": 292055 }
    ],
    "voice": "M2",
    "lang": "ko",
    "voices": [
      { "id": "F1", "path": "voice_styles/F1.json", "size": 292046 },
      { "id": "F2", "path": "voice_styles/F2.json", "size": 292423 },
      { "id": "F3", "path": "voice_styles/F3.json", "size": 290794 },
      { "id": "F4", "path": "voice_styles/F4.json", "size": 291808 },
      { "id": "F5", "path": "voice_styles/F5.json", "size": 291479 },
      { "id": "M1", "path": "voice_styles/M1.json", "size": 291748 },
      { "id": "M2", "path": "voice_styles/M2.json", "size": 292055 },
      { "id": "M3", "path": "voice_styles/M3.json", "size": 290198 },
      { "id": "M4", "path": "voice_styles/M4.json", "size": 291522 },
      { "id": "M5", "path": "voice_styles/M5.json", "size": 291469 }
    ]
  }
}
```

| 필드 | 타입 | 설명 |
|---|---|---|
| `id` | string | 모델 식별자. Cache API 키에 포함되어 모델 교체 시 캐시가 갈린다 |
| `url` | string | 모델 파일 주소. `/models/`(파이 nginx 자체 서빙, Range 지원) 또는 `https://huggingface.co/`(커밋 해시 고정 `resolve/<sha>/`)로 시작. 프론트는 이 값을 그대로 `fetch`한다 |
| `size` | number | 바이트. 진행률 표시와 수신 무결성 확인에 사용 |
| `template` | object | 채팅 템플릿 토큰. 실제 토크나이저와 대조해 확정 (D-6 검증 항목) |
| `systemPromptOverride` | string \| null | null이면 프론트 내장 시스템 프롬프트 사용. 파인튜닝 모델은 짧은 프롬프트로 대체 가능 |
| `fallback` | object \| null | 초기화 실패 시 재시도할 경량 모델. 없으면 null |
| `tts` | object \| null | 면접관 음성(TTS) 모델. null이면 프론트는 음성 단계를 건너뛴다. `id`(캐시 키), `baseUrl`(`/models/` 또는 `https://huggingface.co/`로 시작·`/`로 끝), `files[]`(`path` 상대경로·`size` 바이트), `voice`(프리셋명), `lang`(언어 코드). 파일 URL = `baseUrl + path` |
| `tts.voices` | array \| null | 받을 수 있는 목소리 목록(2026-09-26 추가). 항목 `{ id, path, size }`, 파일 URL = `baseUrl + path`. **엔진 파일 = `files` 중 경로가 `voices[].path`에 없는 것**이다. 새 프론트는 엔진 + 고른 목소리 하나만 받는다. `files` 안의 기본 목소리 파일은 `voices`를 모르는 옛 프론트 호환용이다. 있으면 1개 이상이고 id·path는 각각 겹치지 않으며, 기본 `voice`는 항상 이 목록에 있다. `files`에 들어가는 목소리 파일은 기본 `voice` 하나뿐이다(엔진 파일과 경로가 겹치지 않게). null이면 기본 `voice`만 쓴다 |

## GET /api/questions/{field}

분야별 폴백 질문 5개. 모델이 질문 생성에 실패했을 때 시스템 프롬프트에 참고용으로 끼워 넣는다.
미등록 `field`는 `general` 세트를 반환한다 (404 아님). `field`는 대소문자를 구분하지 않는다(소문자로 정규화).

```json
{
  "field": "it",
  "questions": [
    "자기소개를 1분 내로 해주세요.",
    "이력서에 적은 프로젝트 중 가장 어려웠던 문제와 해결 과정을 말씀해 주세요.",
    "협업 중 의견 충돌이 있었던 경험과 대처 방법은 무엇인가요?",
    "지원 직무에서 본인의 강점과 보완할 점은 무엇인가요?",
    "우리 회사에 지원한 이유는 무엇인가요?"
  ]
}
```

등록 분야: `it`, `finance`, `manufacturing`, `retail`, `general`.

## GET /api/health

```json
{ "status": "ok" }
```

## 계정·이력서·보관함·프리미엄 (2026-10-13 확정)

> 설계: `docs/specs/backend/2026-10-13-accounts-backend-design.md`. 초안(`docs/specs/frontend/2026-10-13-accounts-api-contract.md`)에서 바뀐 것: `ArchiveEntry.score` 삭제, 가입 `consent` 필수, 보관함 프리미엄 검증(`premiumInterviewId`), `/api/premium/spend` 삭제 → 벤 면접 3단계, 목업 결제는 관리자만(`Session.isAdmin`), 녹음 형식·크기 규칙, 구글 로그인은 다음 단계, `429 rate_limited`.
> 새 엔드포인트만 추가된다. 위 세 엔드포인트와 `backend/data/manifest.json`은 바뀌지 않는다.

### 공통

| 항목 | 값 |
|---|---|
| 형식 | JSON(UTF-8). 녹음 업로드만 `multipart/form-data`, 벤 대화·리포트는 SSE(`text/event-stream`) |
| 인증 | 세션 쿠키 `momo_session` — `HttpOnly`, `SameSite=Lax`, `Path=/api`, 30일, 운영은 `Secure`. 프론트는 `fetch(..., { credentials: 'include' })` |
| CORS | 정확한 오리진만(기본 `https://momo.ssenu.cloud`, `https://demomo.ssenu.cloud`, `http://localhost:5173`), `Access-Control-Allow-Credentials: true`. 와일드카드 없음 |
| CSRF | 상태를 바꾸는 요청(`POST`·`PUT`·`PATCH`·`DELETE`)은 `Origin` 헤더가 허용 목록에 있어야 한다. 없거나 다르면 `403 {"error":"bad_origin"}` |
| 오류 | `{"error": "<code>"}`. 입력 오류는 `"field"`를 더한다. 그 밖의 추가 필드는 엔드포인트마다 적는다 |
| 남의 리소스 | 이력서·보관함·녹음·벤 면접의 남의 id는 없는 id와 똑같이 `404 {"error":"not_found"}` |
| 시각 | UTC ISO 8601 밀리초 `Z`(`Date.prototype.toISOString()`과 같은 모양) |
| 요청 본문 | 모르는 키는 무시한다 |

공통 오류

| 상태 | `error` | 뜻 |
|---|---|---|
| 401 | `unauthorized` | 로그인이 필요하다 |
| 403 | `premium_required` | 프리미엄 계정만 쓸 수 있다 |
| 403 | `bad_origin` | 허용되지 않은 `Origin` |
| 404 | `not_found` | 없거나 남의 것 |
| 422 | `invalid` (+`field`) | 형식 검사 실패(길이·범위·타입). `field`는 문제된 필드 이름 |
| 429 | `rate_limited` | 요청 수 초과 |

### 공통 타입

```jsonc
// Session — 여러 엔드포인트가 돌려준다
{
  "userId": "u_01J9ZQ3V7K8M2N4P6R8T0W2Y4A",
  "email": "a@b.com",            // 관리자는 ADMIN_LOGIN 값(이메일 형식이 아닐 수 있다)
  "tier": "member",              // "member" | "premium"
  "tickets": 0,                  // 벤 면접 남은 횟수
  "isAdmin": false,              // true면 목업 결제 버튼을 켠다. 일반 계정은 "준비 중". 비상용 ADMIN_LOGIN 또는 ADMIN_EMAILS 목록의 이메일 계정이 true
  "profile": { "name": "이우진", "age": null },
  "createdAt": "2026-10-13T04:00:00.000Z"
}

// Profile — 대입 면접에서 미리 채울 값
{ "name": "홍길동", "age": 19 }   // 둘 다 null 가능, age 1~120

// ResumeSlot
{
  "id": "r_01J9ZQ...",
  "kind": "company",             // "company"(이력서) | "admission"(자기소개서)
  "title": "백엔드 신입용",        // 1~40자
  "text": "...",                 // 최대 20,000자
  "updatedAt": "2026-10-13T04:00:00.000Z"
}

// ArchiveEntry — 목록용(가볍다). score는 없다
{
  "id": "a_01J9ZQ...",
  "interviewerId": "m1",         // m1·f2·f3·m2(벤)
  "premium": false,              // 벤으로 본 면접인가 — 5개 한도에서 빠진다
  "track": "company",            // "company" | "admission"
  "startedAt": "2026-10-13T04:00:00.000Z",
  "endedAt": "2026-10-13T04:21:00.000Z",
  "questionCount": 5,
  "hasRecording": false,         // 서버가 계산한다(녹음이 하나라도 있으면 true)
  "field": "it", "job": "백엔드 개발자",          // track이 company일 때만(아니면 키가 없다)
  "name": "홍길동", "age": 19,                    // track이 admission일 때만
  "university": "한국대학교", "department": "컴퓨터공학과"
}

// ArchiveDetail = ArchiveEntry + 아래
{
  "messages": [{ "role": "model", "text": "...", "at": 1760000000000 }],  // role: "user" | "model", at은 선택
  "report": [{ "question": "...", "answerSummary": "...", "feedback": "...", "delivery": "..." }],  // delivery는 선택(최대 2,000자, 없으면 칸 없음)
  "reportRaw": "...",
  "recordings": [{ "turn": 3, "url": "/api/recordings/rec_01J9ZQ..." }]   // turn 오름차순
}
```

### 인증

#### POST /api/auth/signup

```jsonc
// 요청
{ "email": "a@b.com", "password": "...", "name": "이우진", "consent": true, "code": "123456" }
// 201 → Session (쿠키 설정)
// 409 { "error": "email_taken" }
// 422 { "error": "invalid_email", "field": "email" }        // 앞뒤 공백 제거·소문자 뒤 형식 검사
// 422 { "error": "weak_password", "field": "password" }     // 8자 미만
// 422 { "error": "missing_name", "field": "name" }          // 앞뒤 공백 제거 뒤 빈 값
// 422 { "error": "invalid", "field": "name" }               // 100자 초과
// 422 { "error": "consent_required", "field": "consent" }   // true가 아니거나 없음
// 429 { "error": "rate_limited" }                           // IP당 분당 10회
// 아래 셋은 SIGNUP_EMAIL_VERIFY가 켜져 있을 때만 (칸 검사 다음, 이메일 중복 409 이전)
// 422 { "error": "code_required", "field": "code" }         // code가 비었음
// 422 { "error": "code_expired", "field": "code" }          // 받은 인증번호 없음·10분 만료·오답 5회로 폐기 → 다시 받기
// 422 { "error": "code_invalid", "field": "code", "attemptsLeft": 3 }  // 틀림(남은 시도 수)
```

`code`(기본 빈 문자열)는 `POST /api/auth/signup/code`로 메일에 받은 6자리 PIN이다(앞뒤 공백 제거). `SIGNUP_EMAIL_VERIFY`가 꺼져 있으면 `code`는 무시되고 동작은 이전과 같다. 켜져 있으면 PIN이 맞을 때만 계정이 만들어지고 PIN은 한 번 쓰면 지워진다(재사용 불가). 5번째 오답은 PIN을 폐기하고 `code_expired`로 답한다. 인증 사용 여부는 `GET /api/auth/signup/config`의 `emailVerify`로 안다. `name`은 `Session.profile.name`에 들어간다.

#### POST /api/auth/signup/code — 가입 인증번호 받기

`SIGNUP_EMAIL_VERIFY`가 켜져 있을 때만 쓴다. 메일로 6자리 PIN(10분 유효)을 보낸다. PIN은 서버에 해시로만 둔다.

```jsonc
{ "email": "me@example.com" }
// 202 { "expiresInSec": 600, "resendInSec": 60 }
// 404 { "error": "verify_disabled" }                         // 인증 기능이 꺼져 있음
// 422 { "error": "invalid_email", "field": "email" }
// 409 { "error": "email_taken" }                             // 이미 가입한 이메일(메일 안 보냄)
// 429 { "error": "rate_limited" }                            // IP당 분당 5회
// 429 { "error": "code_cooldown", "retryAfterSec": 40 }     // 같은 이메일 60초 안에 다시 요청
// 429 { "error": "code_limit" }                              // 같은 이메일 1시간 5통 초과
// 503 { "error": "mail_unavailable" }                        // 켜졌는데 메일 키 없음
// 502 { "error": "mail_failed" }                             // 메일 서버 오류·시간 초과(대기·횟수에 안 셈)
```

새로 보내면 이전 PIN은 즉시 무효다. 메일이 나간 뒤에만 새 PIN을 저장한다.

#### GET /api/auth/signup/config

`200 { "emailVerify": true | false }`. 프론트가 가입 화면의 PIN 칸 표시를 정한다.

#### GET /api/auth/email-taken?email=a@b.com

`200 { "taken": true }` · `429 rate_limited`(IP당 분당 20회). 이메일은 앞뒤 공백 제거·소문자로 비교한다.

#### POST /api/auth/login

```jsonc
{ "email": "a@b.com", "password": "..." }
// 200 → Session (쿠키 설정)
// 401 { "error": "bad_credentials" }   // 계정 없음·비밀번호 틀림·이메일 형식 아님 모두 같은 응답
// 429 { "error": "rate_limited" }      // IP당 분당 10회
```

`email` 칸은 이메일 형식이어야 한다. 예외는 서버 `.env`의 `ADMIN_LOGIN`과 같은 값(관리자 아이디, 예: `admin`)뿐이다.

#### POST /api/auth/logout → 204

세션을 지우고 쿠키를 지운다. 로그인하지 않았어도 204.

#### GET /api/me

`200 → Session` · `200 → null`(비로그인·만료. 만료 세션은 이때 지운다).

#### PUT /api/profile

`{ "name": "홍길동" | null, "age": 19 | null }` → `200 Session`. `name`은 앞뒤 공백 제거(빈 값은 null, 100자 이하), `age` 1~120(`422 invalid`, `field: "age"`). `401 unauthorized`.

#### 구글 로그인 — 다음 단계

`/api/auth/google`, `/api/auth/google/callback`은 이번에 만들지 않는다. 프론트 구글 버튼은 "준비 중".

### 내 이력서

슬롯: **`company` 3개 + `admission` 3개.** 한도는 서버가 지킨다.

| 메서드 | 경로 | 응답 |
|---|---|---|
| GET | `/api/resumes` | `ResumeSlot[]` — 두 종류 전부, 최근 수정 순 |
| POST | `/api/resumes` | 본문 `{kind, title, text}` → `201 ResumeSlot` · 꽉 찼으면 `409 {"error":"slot_full","kind":"company"}` |
| PUT | `/api/resumes/{id}` | 본문 `{title, text}` → `200 ResumeSlot`. `kind`는 바꿀 수 없다(보내도 무시) · `404` |
| DELETE | `/api/resumes/{id}` | `204` · `404` |

`title` 1~40자·`text` 20,000자 초과는 `422 invalid`(`field`).

### 보관함

| 메서드 | 경로 | 응답 |
|---|---|---|
| GET | `/api/archive` | `ArchiveEntry[]` — 최신순(`startedAt` 내림차순) |
| GET | `/api/archive/{id}` | `ArchiveDetail` · `404` |
| POST | `/api/archive` | `201 { "entry": ArchiveEntry, "evicted": ["a_..."] }` |
| DELETE | `/api/archive/{id}` | `204`(녹음 파일도 같이 지운다) · `404` |

POST 본문 = `ArchiveDetail`에서 `id`·`recordings`를 뺀 모양(`hasRecording`·`recordings`를 보내도 무시) + 선택 `"premiumInterviewId"`.

- 트랙별 필수: `company` → `field`·`job`, `admission` → `name`·`age`·`university`·`department`. 빠지면 `422 {"error":"missing_field","field":"job"}`. 다른 트랙의 칸은 저장하지 않는다.
- `premium:true`면 `premiumInterviewId`가 **본인의, 리포트까지 끝난(`done`), 아직 보관함에 저장되지 않은** 벤 면접이어야 한다. 아니면 저장하지 않고 `422 {"error":"invalid_premium_interview"}`.
- **5개 한도는 서버가 집행한다.** 저장 뒤 무료 기록(`premium:false`)이 5개를 넘으면 `startedAt`이 오래된 것부터 지우고 그 id를 `evicted`로 돌려준다. 프리미엄 기록은 세지 않는다.
  - 새 기록의 `startedAt`이 기존 무료 기록 5개보다 모두 오래됐으면 **방금 저장한 기록 자신**이 지워져 `evicted`에 들어갈 수 있다(`entry.id`가 `evicted`에 있으면 저장되지 않은 것과 같다).
- 크기 상한(넘으면 `422 invalid` + `field`): `messages` 200개, 메시지 `text` 20,000자, `report` 50개, `reportRaw` 100,000자.
- 선택 `reportV2`(객체, 2026-10-23): 벤 리포트 버전 2의 `report` 이벤트 데이터를 그대로 담는다. 직렬화(JSON, UTF-8) 200,000바이트 초과면 `422 {"error":"invalid","field":"reportV2"}`. 저장은 받은 그대로라 서버가 문자열을 정리하지 않는다 — 클라이언트는 텍스트를 이스케이프해서 그려야 한다(HTML로 넣지 않는다). `ArchiveDetail`은 저장된 객체를 그대로, 없으면 `null`로 돌려준다(목록 `ArchiveEntry`에는 없다). 버전 2 리포트는 `report`를 `[]`로 보내도 된다. 키를 안 보내는 기존 요청은 그대로 통과한다.

### 프리미엄

#### POST /api/premium/purchase — 목업 결제(관리자 전용)

본문 없음 → `200 Session`(`tier: "premium"`, `tickets` +10). 관리자가 아니면 `403 {"error":"purchase_disabled"}`. `401 unauthorized`.

#### 벤 면접 3단계

대화 기록은 서버가 가진다. 클라이언트는 답변만 보낸다. 벤은 외부 AI(Claude)이므로 시작 전에 사용자에게 알린다.

**1) 시작 — POST /api/premium/interviews**

```jsonc
// 요청 (track에 맞는 쪽 하나만)
{ "track": "company", "resumeText": "...", "company": { "field": "it", "job": "백엔드 개발자", "name": "토스(비바리퍼블리카)",
               "postingUrl": "https://…" } }   // name·postingUrl은 선택
{ "track": "admission", "resumeText": "...(자기소개서)",
  "admission": { "name": "홍길동", "age": 19, "university": "한국대학교", "department": "컴퓨터공학과" } }
// 선택 "voiceAnalysisConsent": true   // 목소리 분석 동의(기본 false, 2026-10-23)
// 201 { "interviewId": "pi_01J9ZQ...", "session": Session, "voiceAnalysis": "on" }   // 티켓 1장 차감된 Session
// 403 premium_required
// 409 { "error": "no_tickets" }
// 422 { "error": "missing_field", "field": "company" }       // track에 맞는 묶음이 없음
// 422 invalid                                                // resumeText 1~20,000자, 각 칸 1~100자, age 1~120, company.name 0~100자(비면 없음), company.postingUrl 500자 이하 http(s) 절대 URL(위반 시 field: "postingUrl")
// 503 { "error": "daily_limit" }                             // 서버 전체 하루 상한(BEN_DAILY_LIMIT, 한국 날짜). 티켓 차감 없음
// 503 { "error": "ben_unavailable" }                         // 서버에 Claude 키가 없음. 티켓 차감 없음
```

- `company.name`(선택, 2026-10-15): 실제 지원 회사. 공백 제거 후 1~100자, 비면 없는 것으로 친다. 있으면 첫 턴에 벤이 **회사명·직무만으로** 웹을 검색해 최신 정보 브리핑을 만들고 면접 내내 질문 근거로 쓴다(이력서는 검색에 쓰지 않는다). 같은 회사·직무 브리핑은 서버가 7일 동안 재사용한다. `track: "admission"`이면 무시.
- `company.postingUrl`(선택, 2026-10-23): 모집공고 링크. 공백 제거 후 1~500자, ASCII 문자만(한글 경로는 퍼센트 인코딩된 주소), `http`/`https` 스킴과 호스트가 있는 절대 URL이어야 하고 비면 없는 것으로 친다(위반은 `422 invalid`, `field: "postingUrl"`). 회사명 **또는** 공고 링크가 있으면 첫 턴에 조사를 시작한다(둘 다 없으면 지금처럼 조사 없음). 조사에 보내는 것은 회사명·직무·공고 URL뿐이며 이력서·대화는 보내지 않는다. `track: "admission"`이면 무시하고 저장하지 않는다.

- `voiceAnalysisConsent`(선택, 2026-10-23, additive): 답변 녹음을 학교 AI 게이트웨이(BAZE, Gemini)로 보내 목소리를 분석하는 데 동의했는지. 기본 `false`이며 `false`이거나 서버에 BAZE 키가 없으면 동작은 이전과 같다. 응답 `voiceAnalysis`는 `"off"`(동의 안 함) / `"on"`(동의 + 분석 가능) / `"unavailable"`(동의했지만 키가 없거나 모두 쓸 수 없음 - 프론트는 업로드하지 않는다). 동의 여부는 면접에 저장된다.

**2) 턴 — POST /api/premium/interviews/{id}/turns**

본문 `{ "answer": "..." }`. 첫 요청은 본문 없이(또는 `{}`, `answer`는 무시됨) 보내 첫 질문을 받는다. 이후에는 `answer`가 필요하다.

스트림 전 오류(JSON): `404 not_found`, `403 premium_required`, `409 interview_over`(끝났거나 면접관 응답 9번을 다 씀, 또는 이 면접의 Claude 호출 시도가 21번(`2 × 9 + 3`, 실패한 시도 포함)을 넘음), `422 missing_answer`(`field: "answer"`), `422 answer_too_long`(2,000자 초과, `field: "answer"`), `429 rate_limited`(사용자당 턴·리포트 요청 합쳐 분당 6회), `503 ben_unavailable`.

응답은 SSE다. 스트림 맨 앞에 주석 줄 `: ping`이 먼저 온다(Cloudflare 첫 바이트 100초 제한 대비). `:`로 시작하는 줄은 SSE 주석이므로 파서는 무시한다.

```
: ping

event: delta
data: {"text":"자기소개를 "}

event: delta
data: {"text":"해 주세요."}

event: done
data: {"ended":false}
```

- **회사 브리핑 `status` 이벤트(2026-10-15, 회사명이 있는 면접의 첫 턴만):** `: ping` 다음, 첫 `delta` 앞에 온다.
  ```
  event: status
  data: {"phase":"researching"}      ← 조사 시작(캐시가 있으면 생략). 20~40초 걸릴 수 있고 그동안 `: ping`이 15초마다 온다

  event: status
  data: {"phase":"briefing","ok":true}
  ```
  `ok: false`면 조사에 실패한 것이다. 면접은 브리핑 없이 이어진다 — "회사 최신 정보를 찾지 못해 이력서 중심으로 진행해요"를 보여 준다. 조사 결과는 첫 질문 전에 저장되므로, 첫 질문이 `error`로 끝나 같은 요청을 다시 보내면 `briefing` 이벤트만 다시 오고 조사는 반복되지 않는다. 조사도 Claude 호출 시도 1번으로 센다. 조사는 약 90초 안에 끝나지 않으면 포기하고 `ok: false`로 알린다(늦게 끝난 결과는 7일 캐시에만 들어간다). 브리핑은 면접 질문에만 쓰이고 리포트에는 쓰이지 않는다. 두 번째 턴부터는 `status` 이벤트가 없다. 모르는 이벤트는 무시해도 된다.

- `done.ended`가 `true`면 면접이 끝났다(종료 문장 "면접을 마치겠습니다"가 나왔거나 면접관 응답 9번 — 본질문 5 + 면접 전체 꼬리질문 최대 3 + 끝맺음 1, 2026-10-15). 다음 턴은 `409 interview_over`. 리포트를 부른다.
- Claude 호출이 실패하면 `event: error` / `data: {"code":"claude_error"}`(안전 분류기 거절이면 `"refused"`)를 보내고 끝난다. 그 턴은 기록하지 않으므로 **같은 요청을 다시 보내면 된다**. 이미 받은 `delta`는 버린다. 티켓은 돌려주지 않고 면접은 이어 갈 수 있다. 무료 면접관으로 떨어지지 않는다.
- SSE `error` 코드 `turn_conflict`: 같은 면접에 턴 요청이 겹쳐 뒤의 것을 기록하지 않음. 새로 고쳐 이어 가면 된다.
- SSE `error` 코드 `server_error`: 서버 내부 오류. 그 턴은 기록되지 않았을 수 있으니 `claude_error`처럼 같은 요청으로 다시 시도한다.

SSE `error` 이벤트 `code` 전체(턴·리포트 공통): `claude_error`, `refused`, `turn_conflict`(턴만), `bad_report`·`too_long`(리포트 버전 2만), `server_error`.

**3) 리포트 — POST /api/premium/interviews/{id}/report**

본문은 선택(2026-10-16). 없거나 `{}`이면 지금과 같다. 벤 면접에서 브라우저가 잰 답변별 전달력 측정을 보낼 수 있다(숫자만, 소리는 보내지 않는다):

```jsonc
{ "delivery": [
  { "answer": 1, "speechSec": 42.5, "syllables": 210, "longPauses": 3,
    "longestPauseSec": 4.1, "firstWordSec": 2.8, "fillerLevel": "high" }  // low|normal|high|null
  // firstWordSec: 답변 녹음 조각의 시작(면접관 음성이 끝나 답변 차례가 된 시각)부터 첫 말소리까지(초)
] }
```
- 검증: 항목 0~8, `answer` 1~8·서로 다름·이 면접의 실제 답변 수 이하, `speechSec`·`longestPauseSec`·`firstWordSec` 0~600, `syllables` 0~5,000, `longPauses` 0~200. 위반 → `422 {"error":"invalid","field":"delivery"}`(Claude를 부르지 않고 시도도 세지 않음). 본문이 JSON이 아니면 `field` 없는 `422 {"error":"invalid"}`. 턴이 하나도 없는 면접은 본문 검증보다 먼저 `409 interview_not_started`를 돌려준다. 타이핑 답변·측정 불가 답변은 빼고 보낸다. 요청 수 제한(`429`, 분당 6회)은 본문 검증보다 먼저 세므로 `422`를 받아도 한 번으로 친다.
- 측정이 있으면 서버가 기준표(말 속도 250~330음절/분 보통, 2초 이상 쉼 말한 1분당 2회 이하 보통, 첫마디 3초 이하 보통, 군말은 경향, 말한 시간 5초 미만·받아쓴 음절 0은 측정 부족, 1번 답변 대비 1.5배·0.67배)로 판정해 벤에게 주고, 벤은 리포트 문항마다 선택 칸 `delivery`(전달력 피드백 한두 문장)를 더 쓴다: `{question, answerSummary, feedback, delivery?}`.
- 이미 `done`인 면접은 보관한 원문을 다시 보내고 본문은 무시한다.

스트림 전 오류: `404`, `403 premium_required`, `409 interview_over`(Claude 호출 시도 상한 21번을 넘음), `409 interview_not_started`(턴이 하나도 없음), `429 rate_limited`(턴과 합쳐 사용자당 분당 6회), `503 ben_unavailable`.
SSE(맨 앞 `: ping` 주석)로 리포트 원문을 `delta`로 보내고 `event: done` / `data: {}`로 끝난다. 이때 면접은 `done`이 되고 서버가 원문을 보관한다. 실패하면 `error` 이벤트(면접은 그대로, 재시도 가능).
**이미 리포트를 받은(`done`) 면접에 다시 요청하면** Claude를 부르지 않고 보관한 원문을 그대로 다시 보낸다(`delta` 한 번 + `done`). 리포트 스트림이 끊겼거나 새로 고친 뒤 원문을 다시 받을 때 쓴다. 요청 수 제한(`429`)은 똑같이 센다.
**버전 2 (`BEN_REPORT_V2`, 기본 꺼짐 — 2026-10-23)**: 서버 환경변수 `BEN_REPORT_V2=true`이면 벤이 구조화 JSON 객체를 쓴다(원문은 `{"items":[…],"summary":{…}}` 형태라 예전 `parseReport`로는 읽을 수 없다 — 프론트 버전 2 화면을 배포한 뒤 켠다). 꺼져 있으면 위의 설명 그대로다. 켜면 SSE 순서는 `delta…` → (검증 실패 시 `reset` → `delta…`) → `report` → `done`이다.
첫 응답이 비어 있으면 재생성 없이 `claude_error`로 끝난다(검증 실패가 아니다).
- `event: reset` / `data: {}` — 첫 시도의 결과가 형식 검증(JSON 파싱·답변 번호 1..n 오름차순·첫 항목 `main`·`summary` 참조 범위)에 실패해 서버가 같은 요청으로 한 번 더 만든다. 프론트는 지금까지 받은 `delta` 원문 버퍼를 비운다. 재생성은 Claude 호출 시도로 한 번 더 센다(상한에 닿았으면 재생성 없이 `bad_report`).
- `event: report` — 서버가 검증·정리한 리포트(`delta` 원문과 별개로 이것을 그린다):
```jsonc
{ "version": 2,
  "items": [{
    "id": "Q1",                // main: Q1, Q2… / follow: 앞 main 아래 Q1-1, Q1-2…
    "parent": null,            // follow면 "Q1"
    "answer": 1, "kind": "main",   // main | follow
    "question": "...", "answerSummary": "...", "feedback": "...",
    "delivery": "..." ,        // 그 답변의 측정이 없거나 측정 부족이면 null
    "measurements": {          // 측정이 없으면 null. 값은 서버 판정(모델 숫자 아님)
      "syllablesPerMin": 300, "speed": "느림|보통|빠름",
      "longPauses": 1, "pausesPerMin": 1.0, "pause": "적음|보통|잦음",
      "longestPauseSec": 2.5, "firstWordSec": 1.5, "firstWord": "보통|망설임 긺",
      "filler": { "level": "적음|보통|잦은 경향", "count": 3, "examples": ["음"] },   // 또는 null. count는 number|null(브라우저 판정만 있으면 null)
      "voice": { "confidence": {"level": "...", "reason": "..."}, "tone": {"level": "...", "reason": "..."},
                 "tremor": {"present": false, "reason": "..."}, "trailingOff": {"present": false, "reason": "..."},
                 "clarity": {"level": "...", "reason": "..."} },                        // 목소리 결과 없으면 null
      "insufficient": false    // 측정 부족(말한 시간 5초 미만·음절 0)이면 true이고 나머지 키는 모두 null
    } }],
  "summary": {
    "strengths":    [{ "point": "...", "refs": ["Q1", "Q1-1"] }],   // 최대 3개, refs는 항목 id(답변 순)
    "improvements": [{ "point": "...", "refs": ["Q2"] }],
    "delivery": "..." ,        // 측정이 없으면 null
    "postingFit": { "met": ["..."], "gaps": ["..."] }               // 모집공고가 있는 회사 면접만, 아니면 null
  } }
```
- `error` 코드 `too_long` — 구조화 출력이 길이 한도(`max_tokens`)에서 잘렸다. 다시 만들어도 같아 재생성하지 않고 바로 끝낸다. 면접은 `active` 그대로다.
- `409 no_answers`(버전 2만, 스트림 전) — 지원자의 답변이 하나도 없다(첫 질문만 받은 상태). Claude를 부르지 않고 시도도 세지 않는다.
- `error` 코드 `bad_report` — 두 번 만들어도 형식 검증을 통과하지 못했다. 면접은 `active` 그대로라 같은 요청으로 다시 시도할 수 있다(`claude_error`·`refused`는 이전과 같다).
- 저장·재요청: 성공하면 원문과 `report` 데이터를 함께 보관한다. `done` 면접에 다시 요청하면 `delta`(보관 원문) → `report`(보관본이 있을 때만) → `done`이며 Claude를 부르지 않는다. 이 재요청은 플래그가 꺼져 있어도 같다.
- 로그에는 리포트 원문·측정값·목소리 이유를 남기지 않는다.

`BEN_REPORT_V2`가 꺼져 있으면 프론트는 원문을 기존 리포트 파서(`parseReport`)에 넣고, 보관함에 `premium: true`, `premiumInterviewId: <interviewId>`로 저장한다.

**목소리 분석 업로드 — POST /api/premium/interviews/{id}/voice/{answer}** (2026-10-23)

`multipart/form-data`, 칸 `file`(WAV, 16kHz 모노 PCM 16비트 권장, RIFF/WAVE 머리 확인, 최대 5MB). `answer`는 1부터, 이 면접의 실제 답변 수 이하. 동의한(`voiceAnalysisConsent: true`) 면접만.

```jsonc
// 202 { "status": "queued" }   // 분석은 백그라운드. 같은 답변을 다시 보내면 이전 결과를 지우고 다시 분석한다
// 401 unauthorized · 403 premium_required
// 403 { "error": "voice_consent_required" }   // 동의 안 한 면접
// 404 not_found                                // 없거나 남의 면접
// 409 { "error": "interview_over" }            // 리포트까지 끝난 면접
// 413 { "error": "too_large" } · 415 { "error": "unsupported_media" }   // WAV 아님
// 422 { "error": "invalid", "field": "answer" }
// 429 rate_limited                             // 사용자당 분당 20회(벤 분당 6회와 별개). 요청 수 제한은 검증보다 먼저 세므로 4xx를 받아도 한 번으로 친다
// 429 { "error": "voice_limit" }              // 면접당 분석 상한 16회(답변 최대 8 x 2). BAZE를 부르지 않고 파일도 남기지 않는다
// 503 { "error": "voice_unavailable" }         // BAZE 키 없음·모두 사용 불가
```
서버는 녹음을 임시 파일로만 두고 분석이 끝나면(성공·실패 모두) 지운다. 받아쓰기 본문은 저장하지 않고 한글 음절 수와 등급·근거만 `voice_analysis`에 둔다. 서버가 재시작되면 아직 `queued`였던 분석은 `failed`(`restart`)로 닫힌다.

**리포트 합치기**: 동의한 면접의 `POST …/report`는 `delivery`의 답변 중 분석이 `queued`인 것이 있으면 최대 20초 기다린 뒤(기다리는 동안 15초마다 SSE `: ping`) 결과가 `done`인 답변에 한해 브라우저 숫자와 합친다. 음절 수는 받아쓰기 기준으로 바꾸고, 군말은 말한 1분당 횟수로 판정하며, 전달력 줄 끝에 목소리 등급과 근거를 덧붙인다. 끝나지 않았거나 실패한 답변은 브라우저 숫자만 쓴다. 동의하지 않은 면접의 리포트는 이전과 같다.

### 녹음(프리미엄)

#### POST /api/recordings

`multipart/form-data` — `archiveId`, `turn`(0 이상 정수, 몇 번째 답변인지), `clip`(오디오).

```jsonc
// 201 { "id": "rec_01J9ZQ...", "url": "/api/recordings/rec_01J9ZQ..." }
// 403 premium_required
// 404 not_found              // 본인의 프리미엄 기록이 아님
// 413 { "error": "too_large" }          // 기록 하나의 녹음 합계 30MB 초과(같은 turn의 옛 파일은 빼고 센다)
// 415 { "error": "unsupported_media" }  // clip이 audio/webm·audio/ogg가 아님(;codecs=... 허용)
// 422 { "error": "invalid", "field": "clip" }  // clip이 0바이트
```

업로드 도중 그 기록이 삭제되면 `404 not_found`(받은 파일은 지운다).

같은 `turn`을 다시 올리면 교체된다. 받은 그대로(변환 없이) 저장한다. 요청 하나가 6MB를 넘으면 nginx가 먼저 `413`으로 막는다(이때 본문은 JSON이 아닐 수 있으니 상태 코드로 판단한다).

#### GET /api/recordings/{id}

본인만. 오디오 바이트(저장한 MIME 그대로), `Range` 지원(`206`). `404 not_found`.

## 관리자 (2026-10-17)

> 설계: `docs/specs/backend/2026-10-17-admin-dashboard-design.md`. 새 엔드포인트만 추가된다. 기존 엔드포인트·`backend/data/manifest.json`은 바뀌지 않는다.

### 권한

- 모든 `/api/admin/*`는 로그인 + 관리자만. 비로그인 `401 {"error":"unauthorized"}`, 관리자가 아니면 `403 {"error":"admin_required"}`.
- 관리자 = 비상용 `ADMIN_LOGIN` 계정 ∪ 환경변수 `ADMIN_EMAILS`(쉼표 구분, 공백 제거·소문자)에 있는 이메일로 가입한 계정. 목록 밖 계정은 기동 때 관리자에서 해제되고 세션이 지워진다. 목록은 api 기동 때에만 반영된다 — 가입만으로는 관리자가 되지 않는다(이메일 인증이 없어, 즉시 승격하면 아직 가입 안 한 이메일을 남이 선점할 수 있다). `Session.isAdmin`이 이 값을 따른다.
- 시각은 UTC ISO 문자열, "오늘"·일별 묶음은 한국 날짜(KST, 벤 하루 상한과 같은 기준).
- 이력서·대화·리포트·녹음 **본문은 어떤 관리자 응답에도 없다**(개수·메타데이터만). 계정 등급(`tier`)도 보여 주거나 바꾸지 않는다.

### GET /api/admin/overview

```jsonc
{
  "users": { "total": 42, "last7Days": 5, "last30Days": 18, "withTickets": 7, "admins": 3 },  // withTickets: 티켓 1장 이상
  "tickets": { "outstanding": 61 },                 // 모든 사용자 남은 티켓 합
  "ben": { "today": 4, "dailyLimit": 30,
           "byDay": [{ "date": "2026-10-17", "count": 4 }] },  // 최근 30일(오래된 날부터), 없는 날은 0
  "archive": { "entries": 120, "ben": 15 },         // ben: 벤(프리미엄 면접관) 기록
  "recordings": { "count": 33, "bytes": 51200000 },
  "briefings": { "cached": 6 },                     // 7일 안의 회사 브리핑 캐시 행
  "weakEmergencyPassword": true                     // ADMIN_PASSWORD가 설정돼 있고 12자 미만(로그인은 막지 않는다)
}
```

### GET /api/admin/users?q=&page=

`q`: 이메일·이름 부분 일치(대소문자 무시, 최대 100자). `page`: 1부터, 한 페이지 50명, 가입 최신순. `page` < 1 또는 `q` 101자 이상은 `422 invalid`.

```jsonc
{ "page": 1, "pageSize": 50, "total": 42,
  "items": [{ "id": "u_…", "email": "…", "name": "…" | null, "createdAt": "…",
              "tickets": 3, "isAdmin": false,
              "archiveCount": 4, "benCount": 2, "lastActiveAt": "…" | null }] }
```

`lastActiveAt`: 가장 최근 세션 생성·보관 기록·벤 면접 시각 중 최댓값(세션 시각은 만료 시각에서 거꾸로 계산).

### GET /api/admin/users/{id}

```jsonc
{ "user": { /* 위 items 항목과 같은 칸 */ },
  "ben": [{ "id": "pi_…", "createdAt": "…", "track": "company", "status": "active" | "done",
            "modelTurns": 9, "briefingStatus": "ok" }],                // 최신순 최대 50
  "archive": [{ "id": "…", "startedAt": "…", "interviewerId": "m2", "premium": true,
                "track": "company", "questionCount": 5, "hasRecording": true }],  // 최신순 최대 50
  "ticketLog": [{ "at": "…", "adminEmail": "…", "delta": 5, "reason": "…" }] }     // 최신순 최대 50
```

없는 사용자 `404 {"error":"not_found"}`.

### POST /api/admin/users/{id}/tickets

본문 `{ "delta": 5, "reason": "이벤트 보상" }` — `delta` 정수 −100~100(0 불가), `reason` 공백 제거 후 1~200자. 위반은 `422 invalid`(+`field`).

```jsonc
// 200 { "tickets": 8 }                       // 조정 뒤 남은 티켓
// 404 { "error": "not_found" }               // 없는 사용자
// 409 { "error": "insufficient_tickets" }    // 결과가 0 미만 — 바꾸지 않고 감사 로그도 남기지 않는다
```

티켓 변경과 감사 로그 기록은 한 트랜잭션이다.

### GET /api/admin/usage?days=30

`days` 1~90(기본 30), 범위 밖은 `422 invalid`.

```jsonc
{ "pricing": { "model": "claude-sonnet-5-5", "inputPerMTok": 2.0, "outputPerMTok": 10.0,
               "cacheReadPerMTok": 0.2, "cacheWritePerMTok": 2.5, "webSearch": 0.01 },
  "since": "2026-10-17" | null,                     // 사용량을 기록하기 시작한 한국 날짜(기록 없으면 null)
  "byDay": [{ "date": "…", "calls": 40, "inputTokens": 0, "outputTokens": 0,
              "cacheReadTokens": 0, "cacheWriteTokens": 0, "webSearches": 3,
              "errors": 1, "refusals": 0, "costUsd": 0.42 }],   // days개, 오래된 날부터
  "byKind": [{ "kind": "turn" | "report" | "research", "calls": 0, "costUsd": 0.0 }],  // 기록 있는 종류만
  "topInterviews": [{ "interviewId": "pi_…", "userEmail": "…" | null, "calls": 12, "costUsd": 0.31 }] }  // 비용 상위 10 (면접 id 없는 행 제외)
```

비용은 저장하지 않고 **조회할 때** `pricing` 요금표(USD, 100만 토큰당; 웹 검색은 회당)로 계산한다: `(입력×inputPerMTok + 출력×outputPerMTok + 캐시읽기×cacheReadPerMTok + 캐시쓰기×cacheWritePerMTok) / 1,000,000 + 웹검색×webSearch`. 요금표가 바뀌면 지난 기록의 비용도 새 요금으로 다시 계산된다. 프롬프트·응답 본문은 기록하지 않는다. 합계는 행별 비용을 더한 뒤 한 번만 반올림한다. 비용은 **하한 추정치**다 — 클라이언트 연결이 끊기거나 호출이 중도 포기되면 기록되지 않을 수 있다.

### GET /api/admin/audit?page=

최신순 50개. `page` 1부터(`< 1`은 `422 invalid`).

```jsonc
{ "page": 1, "pageSize": 50, "total": 3,
  "items": [{ "at": "…", "adminEmail": "…", "action": "tickets", "targetUserId": "u_…",
              "targetEmail": "…", "delta": 5, "reason": "…" }] }
```

## 참고

`tts`는 additive로 추가됨(2026-09-17). 기존 필드 불변.

2026-09-17: `url`·`fallback.url`·`tts.baseUrl` 값을 파이(`/models/`)에서 Hugging Face로 전환. 응답 형태 불변, 허용 접두사만 확장. 이유와 파이 서빙 복귀 절차(파인튜닝 모델 포함): `docs/specs/backend/2026-09-17-model-hosting-hf-design.md`

2026-09-26: `tts.voices` additive 추가(면접관별 목소리). 기존 필드 불변. `docs/specs/backend/2026-09-26-tts-voices-design.md`

2026-10-13: 계정·이력서·보관함·프리미엄·녹음 엔드포인트 additive 추가. 기존 엔드포인트·매니페스트 불변. `docs/specs/backend/2026-10-13-accounts-backend-design.md`

2026-10-14(최종 리뷰 반영): 벤 턴·리포트 `429`(사용자당 분당 6회)·시도 상한 `409 interview_over`, `done` 면접 리포트 재요청은 `409` 대신 보관 원문 재전송, SSE `: ping` 주석·`server_error` 코드, 턴 본문 생략 허용, 보관함 크기 상한, 녹음 0바이트 `422`.

2026-10-17: 관리자 대시보드 엔드포인트(`/api/admin/*`) additive 추가, `ADMIN_EMAILS`. 기존 엔드포인트 불변. `docs/specs/backend/2026-10-17-admin-dashboard-design.md`

## 하지 않는 것

- 비로그인 사용자의 이력서·대화·리포트를 받는 엔드포인트는 없다. 사용자 데이터는 로그인하고 가입 때 동의(`consent`)한 계정의 것만 저장한다.
- 구글 로그인, 계정 삭제(데이터 일괄 삭제), 실제 결제, 녹음을 이용한 말투 분석은 다음 단계다.
