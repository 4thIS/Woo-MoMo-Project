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
  "isAdmin": false,              // true면 목업 결제 버튼을 켠다. 일반 계정은 "준비 중"
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
  "report": [{ "question": "...", "answerSummary": "...", "feedback": "..." }],
  "reportRaw": "...",
  "recordings": [{ "turn": 3, "url": "/api/recordings/rec_01J9ZQ..." }]   // turn 오름차순
}
```

### 인증

#### POST /api/auth/signup

```jsonc
// 요청
{ "email": "a@b.com", "password": "...", "name": "이우진", "consent": true }
// 201 → Session (쿠키 설정)
// 409 { "error": "email_taken" }
// 422 { "error": "invalid_email", "field": "email" }        // 앞뒤 공백 제거·소문자 뒤 형식 검사
// 422 { "error": "weak_password", "field": "password" }     // 8자 미만
// 422 { "error": "missing_name", "field": "name" }          // 앞뒤 공백 제거 뒤 빈 값
// 422 { "error": "invalid", "field": "name" }               // 100자 초과
// 422 { "error": "consent_required", "field": "consent" }   // true가 아니거나 없음
// 429 { "error": "rate_limited" }                           // IP당 분당 10회
```

이메일 인증은 하지 않는다. `name`은 `Session.profile.name`에 들어간다.

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

### 프리미엄

#### POST /api/premium/purchase — 목업 결제(관리자 전용)

본문 없음 → `200 Session`(`tier: "premium"`, `tickets` +10). 관리자가 아니면 `403 {"error":"purchase_disabled"}`. `401 unauthorized`.

#### 벤 면접 3단계

대화 기록은 서버가 가진다. 클라이언트는 답변만 보낸다. 벤은 외부 AI(Claude)이므로 시작 전에 사용자에게 알린다.

**1) 시작 — POST /api/premium/interviews**

```jsonc
// 요청 (track에 맞는 쪽 하나만)
{ "track": "company", "resumeText": "...", "company": { "field": "it", "job": "백엔드 개발자", "name": "토스(비바리퍼블리카)" } }
{ "track": "admission", "resumeText": "...(자기소개서)",
  "admission": { "name": "홍길동", "age": 19, "university": "한국대학교", "department": "컴퓨터공학과" } }
// 201 { "interviewId": "pi_01J9ZQ...", "session": Session }   // 티켓 1장 차감된 Session
// 403 premium_required
// 409 { "error": "no_tickets" }
// 422 { "error": "missing_field", "field": "company" }       // track에 맞는 묶음이 없음
// 422 invalid                                                // resumeText 1~20,000자, 각 칸 1~100자, age 1~120, company.name 0~100자(비면 없음)
// 503 { "error": "daily_limit" }                             // 서버 전체 하루 상한(BEN_DAILY_LIMIT, 한국 날짜). 티켓 차감 없음
// 503 { "error": "ben_unavailable" }                         // 서버에 Claude 키가 없음. 티켓 차감 없음
```

- `company.name`(선택, 2026-10-15): 실제 지원 회사. 공백 제거 후 1~100자, 비면 없는 것으로 친다. 있으면 첫 턴에 벤이 **회사명·직무만으로** 웹을 검색해 최신 정보 브리핑을 만들고 면접 내내 질문 근거로 쓴다(이력서는 검색에 쓰지 않는다). 같은 회사·직무 브리핑은 서버가 7일 동안 재사용한다. `track: "admission"`이면 무시.

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

SSE `error` 이벤트 `code` 전체(턴·리포트 공통): `claude_error`, `refused`, `turn_conflict`(턴만), `server_error`.

**3) 리포트 — POST /api/premium/interviews/{id}/report**

본문 없음. 스트림 전 오류: `404`, `403 premium_required`, `409 interview_over`(Claude 호출 시도 상한 21번을 넘음), `409 interview_not_started`(턴이 하나도 없음), `429 rate_limited`(턴과 합쳐 사용자당 분당 6회), `503 ben_unavailable`.
SSE(맨 앞 `: ping` 주석)로 리포트 원문을 `delta`로 보내고 `event: done` / `data: {}`로 끝난다. 이때 면접은 `done`이 되고 서버가 원문을 보관한다. 실패하면 `error` 이벤트(면접은 그대로, 재시도 가능).
**이미 리포트를 받은(`done`) 면접에 다시 요청하면** Claude를 부르지 않고 보관한 원문을 그대로 다시 보낸다(`delta` 한 번 + `done`). 리포트 스트림이 끊겼거나 새로 고친 뒤 원문을 다시 받을 때 쓴다. 요청 수 제한(`429`)은 똑같이 센다.
프론트는 원문을 기존 리포트 파서(`parseReport`)에 넣고, 보관함에 `premium: true`, `premiumInterviewId: <interviewId>`로 저장한다.

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

## 참고

`tts`는 additive로 추가됨(2026-09-17). 기존 필드 불변.

2026-09-17: `url`·`fallback.url`·`tts.baseUrl` 값을 파이(`/models/`)에서 Hugging Face로 전환. 응답 형태 불변, 허용 접두사만 확장. 이유와 파이 서빙 복귀 절차(파인튜닝 모델 포함): `docs/specs/backend/2026-09-17-model-hosting-hf-design.md`

2026-09-26: `tts.voices` additive 추가(면접관별 목소리). 기존 필드 불변. `docs/specs/backend/2026-09-26-tts-voices-design.md`

2026-10-13: 계정·이력서·보관함·프리미엄·녹음 엔드포인트 additive 추가. 기존 엔드포인트·매니페스트 불변. `docs/specs/backend/2026-10-13-accounts-backend-design.md`

2026-10-14(최종 리뷰 반영): 벤 턴·리포트 `429`(사용자당 분당 6회)·시도 상한 `409 interview_over`, `done` 면접 리포트 재요청은 `409` 대신 보관 원문 재전송, SSE `: ping` 주석·`server_error` 코드, 턴 본문 생략 허용, 보관함 크기 상한, 녹음 0바이트 `422`.

## 하지 않는 것

- 비로그인 사용자의 이력서·대화·리포트를 받는 엔드포인트는 없다. 사용자 데이터는 로그인하고 가입 때 동의(`consent`)한 계정의 것만 저장한다.
- 구글 로그인, 계정 삭제(데이터 일괄 삭제), 실제 결제, 녹음을 이용한 말투 분석은 다음 단계다.
