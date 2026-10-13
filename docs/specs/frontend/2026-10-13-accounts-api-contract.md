# 계정·보관함·프리미엄 — API 계약 초안 (프론트 → 백엔드 요청서)

- 생성일시: 2026-10-13
- 수정일시: 2026-10-13
- 상태: **초안.** @ssenu 검토·확정 후 `docs/API.md`로 옮긴다
- 작성: @leemonta9482 (프론트가 필요로 하는 형태) / **소유자: @ssenu**
- 짝 문서: `docs/specs/frontend/2026-10-13-accounts-premium-design.md`

> 계약의 소유자는 백엔드다(`CLAUDE.md` 역할 분담). 이 문서는 **프론트가 어떤 모양을 기대하는지** 적은 요청서이지 확정된 계약이 아니다. 고쳐야 할 곳은 고치고, 확정되면 `docs/API.md`에 합쳐 주세요. 프론트는 그때까지 목업으로 같은 모양을 쓴다.

## 0. 공통

| 항목 | 값 |
|---|---|
| 접두사 | `/api` |
| 형식 | JSON (UTF-8) |
| 인증 | **세션 쿠키** (`HttpOnly`, `SameSite=Lax`, 운영은 `Secure`) |
| 인증 실패 | `401` + `{"error":"unauthorized"}` |
| 권한 부족 | `403` + `{"error":"..."}` — 예: 프리미엄 기능을 로그인만 한 계정이 부름 |
| 검증 실패 | `422` + `{"error":"...","field":"email"}` |

**쿠키를 고른 이유:** 토큰을 `localStorage`에 두면 XSS 한 번에 다 털린다. 프론트가 토큰을 들고 있지 않아도 되므로 코드도 줄어든다. CORS는 `credentials: 'include'`가 되도록 `Access-Control-Allow-Credentials: true`와 **정확한 오리진**(`momo.ssenu.cloud`, `demomo.ssenu.cloud`, 로컬 `http://localhost:5173`)이 필요하다 — 와일드카드는 쿠키와 같이 못 쓴다.

### 공통 타입

```jsonc
// Session — 로그인 상태를 한 덩어리로. 여러 엔드포인트가 이걸 돌려준다
{
  "userId": "u_01H...",
  "email": "a@b.com",
  "tier": "member",          // "member" | "premium"
  "tickets": 0,              // 프리미엄 면접 남은 횟수. member는 항상 0
  "createdAt": "2026-10-13T04:00:00Z"
}
```

`tier`에 `guest`는 없다. 비로그인은 **세션이 아예 없는 상태**(`/api/me` → `null`)이지 등급이 아니다.

## 1. 인증

### POST /api/auth/signup

```jsonc
// 요청
{ "email": "a@b.com", "password": "..." }
// 201 → Session (쿠키 설정)
// 409 { "error": "email_taken" }
// 422 { "error": "weak_password", "field": "password" }
```

이메일 인증은 하지 않는다(회의 결정). 중복 검사만.

### GET /api/auth/email-taken?email=a@b.com

```jsonc
// 200 { "taken": true }
```

회원가입 폼에서 입력을 떠날 때 부른다. **열거 공격에 열려 있다** — 데모 범위라 받아들이되, 요청 수 제한(IP당 분당 20회쯤)은 걸어 주세요.

### POST /api/auth/login

```jsonc
{ "email": "a@b.com", "password": "..." }
// 200 → Session (쿠키 설정)
// 401 { "error": "bad_credentials" }
```

계정 없음과 비밀번호 틀림을 **같은 응답**으로 주세요. 프론트도 한 문구로 합친다.

### GET /api/auth/google → 302

구글 동의 화면으로 넘긴다. 콜백(`/api/auth/google/callback`)에서 세션 쿠키를 심고 **프론트 오리진으로 되돌린다**.

- 프론트는 `window.location.href`로 이동시킨다(팝업 아님 — 팝업 차단을 안 겪는 쪽이 단순하다)
- 돌아올 주소는 `?next=` 로 넘긴다. **열린 리다이렉트가 되지 않게 같은 오리진만 허용**해 주세요
- 같은 이메일로 이미 가입돼 있으면 **그 계정에 붙인다**(계정이 둘로 갈라지지 않게)

### POST /api/auth/logout → 204 (쿠키 삭제)

### GET /api/me

```jsonc
// 200 → Session
// 200 → null   ← 비로그인. 401이 아니라 null을 주세요
```

앱이 뜰 때 한 번 부른다. 비로그인이 정상 상태이므로 `401`로 주면 콘솔이 에러로 더럽혀진다.

## 2. 내 이력서

슬롯 제한: **`admission` 3개 + `company` 3개.**

```jsonc
// ResumeSlot
{
  "id": "r_01H...",
  "kind": "company",        // "admission" | "company"
  "title": "백엔드 신입용",
  "text": "...",            // 이력서 원문
  "updatedAt": "2026-10-13T04:00:00Z"
}
```

| 메서드 | 경로 | 응답 |
|---|---|---|
| GET | `/api/resumes` | `ResumeSlot[]` (두 종류 전부) |
| POST | `/api/resumes` | `201 ResumeSlot` · 꽉 찼으면 `409 {"error":"slot_full","kind":"company"}` |
| PUT | `/api/resumes/{id}` | `200 ResumeSlot` |
| DELETE | `/api/resumes/{id}` | `204` |

한도는 **서버가 지킨다.** 프론트도 막지만 그건 안내일 뿐이다.

## 3. 보관함

```jsonc
// ArchiveEntry — 목록용 (가벼움)
{
  "id": "a_01H...",
  "interviewerId": "m1",         // 기존 id 그대로 (m1·f2·f3·m2)
  "premium": false,              // 벤으로 본 면접인가 — 한도에서 빠진다
  "field": "it",
  "job": "백엔드 개발자",
  "score": 82,                   // 없으면 null
  "startedAt": "2026-10-13T04:00:00Z",
  "endedAt": "2026-10-13T04:21:00Z"
}

// ArchiveDetail — 상세용 (= Entry + 아래)
{
  "messages": [{ "role": "model", "text": "...", "at": 1760000000000 }],
  "report": [{ "question": "...", "answerSummary": "...", "feedback": "..." }],
  "reportRaw": "...",
  "recordings": [{ "turn": 3, "url": "/api/recordings/rec_01H..." }]  // 프리미엄만
}
```

`report` 항목의 모양은 **프론트의 `utils/reportParser.ts`가 이미 쓰는 그대로**다(`question` · `answerSummary` · `feedback`). 서버는 저장·반환만 하고 해석하지 않는다.

| 메서드 | 경로 | 응답 |
|---|---|---|
| GET | `/api/archive` | `ArchiveEntry[]` — **최신순** |
| GET | `/api/archive/{id}` | `ArchiveDetail` |
| POST | `/api/archive` | `201 { "entry": ArchiveEntry, "evicted": ["a_..."] }` |
| DELETE | `/api/archive/{id}` | `204` |

### 한도는 서버가 집행한다

POST 할 때 **무료 기록(`premium:false`)이 5개를 넘으면 가장 오래된 것을 지우고**, 지운 id를 `evicted`로 돌려주세요. 프리미엄 기록은 세지 않는다.

프론트가 "곧 하나가 사라집니다"를 미리 보여 주지만, **지우는 주체는 서버다.** 두 곳에서 세면 어긋난다.

## 4. 프리미엄

### POST /api/premium/purchase

```jsonc
// 요청 바디 없음
// 200 → Session (tier: "premium", tickets: 10)
```

**목업 결제다.** 토스 연동은 없고, 프론트가 결제창 흉내를 낸 뒤 이걸 부른다. 이미 프리미엄이면 **티켓 10장을 더한다**(소진 후 재결제).

### POST /api/premium/spend

```jsonc
// 200 → Session (tickets 하나 줄어든 상태)
// 409 { "error": "no_tickets" }
```

벤으로 면접을 **시작할 때** 부른다. 차감은 서버가 한다 — 프론트 숫자는 표시용이다.

### 벤(프리미엄 면접관)의 대화

벤은 로컬 LLM이 아니라 Claude API다. 이 엔드포인트의 모양은 **cw가 정한다** — 프롬프트·RAG가 전부 서버에 있기 때문이다. 프론트가 필요한 것만 적는다.

- 스트리밍이면 좋다(지금 로컬 LLM도 토큰 단위로 흘려 화면에 찍는다). SSE든 청크든 cw 편한 쪽으로
- 응답 텍스트만 주면 된다. 프론트의 `ThoughtFilter`·종료 감지·리포트 파서를 그대로 태운다
- 실패하면 **무료 면접관으로 떨어지지 않는다.** 티켓을 썼으니 에러를 보이고 재시도를 준다

> cw: 이 부분은 형태가 정해지면 알려 주세요. 프론트는 `services/llm.ts`와 같은 인터페이스로 감쌀 계획입니다.

## 5. 녹음 (프리미엄)

### POST /api/recordings

`multipart/form-data` — `archiveId`, `turn`(몇 번째 답변인지), `clip`(오디오)

```jsonc
// 201 { "id": "rec_01H...", "url": "/api/recordings/rec_01H..." }
// 413 { "error": "too_large" }
```

### GET /api/recordings/{id} → 오디오 바이트 (본인만, `Range` 지원)

**짚을 것:** 브라우저 `MediaRecorder`는 보통 `audio/webm;codecs=opus`를 낸다. 20분 면접이면 답변 전체가 대략 5~15MB다. 파이 디스크를 생각하면 **한 기록당 상한**(예: 30MB)과 **보관함에서 기록이 지워질 때 녹음도 같이 지우는 것**이 필요하다. 상한 값은 cw가 정해 주세요.

## 6. 프론트가 기다리지 않는 방법

프론트는 위 모양을 그대로 구현한 **목업**(`localStorage` 기반)으로 전 화면을 먼저 만든다. API가 나오면 `services/account.ts`의 구현만 갈아 끼우고 화면 코드는 건드리지 않는다. 자세한 것은 짝 문서 8절.

**그래서 중요한 것은 "언제 되느냐"가 아니라 "모양이 이대로냐"다.** 바꿀 곳이 있으면 구현 전에 알려 주세요 — 늦게 바뀌면 목업과 화면을 같이 고쳐야 한다.

## 7. cw에게 묻는 것

1. **대입 면접에 입력이 더 필요한가요?** 학교·학과·전형 같은 것을 받아야 하면 준비 화면에 칸을 더해야 합니다. 페르소나 설계하면서 정해지면 알려 주세요
2. **벤의 대화 엔드포인트** 모양 (4절 끝)
3. **녹음 상한** (5절)
4. `CLAUDE.md` **절대 하지 말 것 8번 개정** 승인 — 공동 영역입니다 (짝 문서 2절)
