# 계정·보관함·프리미엄 — 백엔드 설계 (spec)

- 생성일시: 2026-10-13
- 수정일시: 2026-10-14 (목업 결제를 관리자 계정 전용으로)
- 상태: 초안 (브레인스토밍 완료, 리뷰 대기)
- 담당: @ssenu (백엔드·계약 소유) / 리뷰 @leemonta9482
- 짝 문서
  - 프론트 설계: `docs/specs/frontend/2026-10-13-accounts-premium-design.md` (@leemonta9482)
  - 계약 초안(프론트 요청서): `docs/specs/frontend/2026-10-13-accounts-api-contract.md` → 이 spec 2절대로 고쳐 `docs/API.md`로 확정

## 0. 배경 · 위치

PR #73(2026-10-13 회의록)으로 로그인·내 이력서·보관함·프리미엄 면접관(벤, Claude API)이 정해졌다. 프론트는 목업(`localStorage`)으로 화면을 먼저 만들고, 백엔드가 계약대로 API를 낸다. 지금 백엔드는 매니페스트·예비 질문·헬스체크뿐이고 DB가 없다. 이 spec은 그 위에 계정·저장·프리미엄을 얹는 백엔드 몫을 정한다.

## 1. 결정 사항 (2026-10-13 브레인스토밍)

| 항목 | 결정 |
|---|---|
| 개인정보 원칙 | **등급으로 가른다.** 비로그인은 지금처럼 기기를 떠나지 않는다. 로그인 사용자는 동의를 받고 서버에 저장한다. 벤은 외부 AI(Claude)임을 시작 전에 알린다. `CLAUDE.md` 절대 하지 말 것 8번을 이렇게 개정한다(공동 승인) |
| 녹음 상한 | **기록 하나당 30MB.** 답변 하나 = 파일 하나(`turn`별) |
| 녹음 형식 | 받은 그대로 **webm/opus** 저장(변환 없음) |
| 벤 대화 API | **서버가 면접 세션을 들고 있다.** 시작(티켓 차감) → 턴(SSE) → 리포트. `/premium/spend`는 시작에 합친다 |
| 구글 로그인 | **다음 단계.** 이번엔 이메일·비밀번호만. 프론트 구글 버튼은 "준비 중" |
| 구현 방식 | 표준 `sqlite3` + 얇은 저장소 계층(ORM·인증 라이브러리 없음), 비밀번호 `argon2-cffi` |
| 목업 결제 | **관리자 계정만.** 일반 계정은 막는다. 관리자 계정은 서버 기동 시 `.env`의 아이디·비밀번호로 만든다(2026-10-14) |

## 2. 계약 (초안에서 바뀌는 것)

초안을 기준으로 아래만 바꿔 `docs/API.md`에 확정한다. 나머지 모양(`Session`, `Profile`, `ResumeSlot`, `ArchiveEntry`·`ArchiveDetail`, 오류 형식, 쿠키 인증)은 초안 그대로다.

1. **`ArchiveEntry.score` 삭제.** 프론트 설계의 "점수 없음"과 맞춘다.
2. **가입에 동의 필드:** `POST /api/auth/signup` 본문에 `"consent": true` 필수. 없으면 `422 {"error":"consent_required","field":"consent"}`.
3. **보관함 프리미엄 기록 검증:** `POST /api/archive`에 `premium:true`를 주려면 `"premiumInterviewId"`(본인의 완료된 벤 면접)가 있어야 한다. 없거나 남의 것이면 `premium:false`로 저장하지 않고 `422 {"error":"invalid_premium_interview"}`.
4. **`/api/premium/spend` 삭제 → 벤 면접 3단계** (4.2절).
5. **목업 결제는 관리자만:** `Session`에 `"isAdmin": boolean`을 더한다(프론트는 이 값으로 결제 버튼을 켜고, 일반 계정은 "준비 중"으로 막는다). `POST /api/premium/purchase`는 관리자가 아니면 `403 {"error":"purchase_disabled"}`.
6. **녹음:** `clip`은 `audio/webm`·`audio/ogg`만(아니면 `415 {"error":"unsupported_media"}`), 기록당 합계 30MB 초과 시 `413 {"error":"too_large"}`, 같은 `turn` 재업로드는 교체.
7. **구글 로그인**(`/api/auth/google`, 콜백)은 "다음 단계"로 표시하고 이번엔 만들지 않는다.
8. **요청 수 초과:** `429 {"error":"rate_limited"}`.

`backend/data/manifest.json`은 바뀌지 않는다. 새 엔드포인트만 추가된다(additive).

## 3. 구조

```
backend/app/
├── main.py         # 라우터 등록, CORS(정확한 오리진 + credentials)
├── db.py           # sqlite3 연결, 기동 시 마이그레이션 적용, 트랜잭션 헬퍼
├── migrations/     # 001_init.sql …, schema_version 테이블로 순서 관리
├── security.py     # argon2 해시·검증, 세션 토큰 생성·해시, 메모리 요청 수 제한
├── deps.py         # current_session(선택) / require_user / require_premium
├── repos/          # SQL 전담: users, sessions, resumes, archive, recordings, premium
├── routers/        # auth, me, resumes, archive, premium, recordings (+기존 manifest·questions·health)
└── llm/            # 벤: Claude 호출, 프롬프트 조립, 스트리밍
```

- 라우터는 HTTP, repos는 SQL, llm은 외부 호출만 맡는다. 서로의 일을 하지 않는다.
- 설정은 환경변수: `DATA_DIR`(DB·녹음 위치), `CORS_ORIGINS`, `COOKIE_SECURE`, `ANTHROPIC_API_KEY`, `ADMIN_LOGIN`, `ADMIN_PASSWORD`, `BEN_DAILY_LIMIT`.

### 3.1 테이블

| 테이블 | 주요 칼럼 | 규칙 |
|---|---|---|
| users | id, email(유니크·소문자), password_hash, tier(`member`/`premium`), tickets, is_admin, name, age, created_at | 관리자는 `.env`로 만든 한 계정 |
| sessions | token_hash(PK), user_id, expires_at | 30일. 로그아웃·만료 시 삭제 |
| resumes | id, user_id, kind(`company`/`admission`), title, text, updated_at | kind별 3개 |
| archive | id, user_id, interviewer_id, premium, premium_interview_id, track, field, job, name, age, university, department, started_at, ended_at, messages_json, report_json, report_raw | 무료 5개 초과 시 오래된 것부터 삭제 |
| recordings | id, archive_id, user_id, turn, path, mime, bytes, created_at | (archive_id, turn) 유니크. 기록당 합계 30MB |
| premium_interviews | id, user_id, track, inputs_json, messages_json, model_turns, status(`active`/`done`), created_at | 티켓 1장 = 1행 |

- id는 접두사 + ULID: `u_`, `r_`, `a_`, `rec_`, `pi_`.
- 대화·리포트는 해석하지 않고 JSON 그대로 저장한다.
- 녹음 파일: `DATA_DIR/recordings/{user_id}/{rec_id}.webm`(또는 `.ogg`). 파일명은 서버가 만든다.

## 4. 기능

### 4.1 인증·세션·보안

- **가입:** 이메일은 앞뒤 공백 제거·소문자, 간단한 형식 검사. 비밀번호 8자 이상(`422 weak_password`). 중복은 `409 email_taken`. 이메일 인증 없음.
- **로그인:** 계정 없음·비밀번호 틀림을 같은 `401 bad_credentials`로. 계정이 없어도 더미 해시를 검증해 응답 시간을 맞춘다.
- **세션:** `secrets.token_urlsafe(32)` → 쿠키 `momo_session`(`HttpOnly`, `SameSite=Lax`, `Path=/api`, 30일, `COOKIE_SECURE`면 `Secure`). DB에는 SHA-256 해시만.
- **`GET /api/me`:** 세션 없거나 만료면 `200 null`(만료 세션은 이때 삭제). 있으면 `Session` + `profile`.
- **`PUT /api/profile`:** `{name, age}`(둘 다 null 가능, age 1~120) → `200 Session`.
- **권한:** `require_user` 없으면 `401 unauthorized`, `require_premium` 아니면 `403 premium_required`. 이력서·보관함·녹음·벤 면접은 항상 `user_id`로 걸러 조회하고, 남의 id는 `404 not_found`(존재 여부를 숨긴다).
- **요청 수 제한(메모리):** `email-taken` IP당 분당 20회, `login`·`signup` IP당 분당 10회. IP는 `CF-Connecting-IP` → 없으면 연결 주소.
- **CORS·CSRF:** `CORS_ORIGINS` 기본값 `https://momo.ssenu.cloud,https://demomo.ssenu.cloud,http://localhost:5173`, `allow_credentials=True`, 와일드카드 금지. 상태를 바꾸는 요청은 `Origin`이 허용 목록인지 확인(`403 bad_origin`).
- **로그:** 비밀번호·이력서·대화 본문을 로그에 남기지 않는다.

### 4.2 이력서·보관함

- **이력서:** `POST`는 개수 확인과 삽입을 한 트랜잭션으로(kind별 3개 초과 시 `409 slot_full`). `title` 1~40자, `text` 최대 20,000자. `GET`은 두 종류 전부 최근 수정 순.
- **보관함 저장:** 본문 = `ArchiveDetail`에서 `id`·`recordings`를 뺀 모양 + 선택 `premiumInterviewId`. 트랙별 필수 필드 검사(`company`: field·job / `admission`: name·age·university·department).
- **5개 한도:** 저장 뒤 무료 기록이 5개를 넘으면 `started_at`이 오래된 것부터 지우고 그 녹음 행도 지운 뒤 id를 `evicted`로 돌려준다. 한 트랜잭션으로 처리하고, 파일 삭제는 커밋 뒤에 한다(실패해 남은 파일은 기동 시 정리).
- **목록:** 가벼운 항목, 최신순. **상세:** `messages`·`report`·`reportRaw`·`recordings[{turn,url}]`. **삭제:** 녹음 파일도 같이.

### 4.3 녹음

- `POST /api/recordings`(multipart `archiveId`, `turn`, `clip`): 프리미엄 사용자가 본인의 프리미엄 기록에만. 스트리밍으로 받으며 크기를 세서 기록 누적 30MB를 넘는 순간 `413`. 같은 `turn`은 교체.
- `GET /api/recordings/{id}`: 본인만, `Range` 지원, 저장한 MIME 그대로.

### 4.4 프리미엄 티켓과 벤

**티켓**
- `POST /api/premium/purchase`: **관리자 계정만**(`is_admin`). 다른 계정은 `403 purchase_disabled`. 관리자는 `tier=premium`, 티켓 +10 → `200 Session`.
- **관리자 계정 만들기:** 서버 기동 시 `ADMIN_LOGIN`·`ADMIN_PASSWORD`가 둘 다 있으면 그 계정을 만들거나(없을 때) 비밀번호·`is_admin`을 맞춘다(있을 때). 하나라도 없으면 관리자 계정은 없고 목업 결제는 아무도 못 쓴다.
  - 로그인 아이디는 이메일 형식이 아니어도 된다(예: `admin`). 이 예외는 `ADMIN_LOGIN`과 정확히 같을 때만이고, 일반 가입은 여전히 이메일 형식·8자 규칙을 따른다.
  - 관리자 비밀번호는 **리포에 커밋하지 않는다**(`.env`만). 공개 사이트라 추측하기 쉬운 비밀번호(예: `admin`)면 누구나 티켓을 충전해 Claude 비용을 쓸 수 있다 — 하루 상한 `BEN_DAILY_LIMIT`가 마지막 방어선이다.
- 공개 사이트에서 아무나 Claude 비용을 쓰지 않도록 **하루 전체 상한 `BEN_DAILY_LIMIT`**(기본 30회)을 둔다. 넘으면 시작에서 `503 {"error":"daily_limit"}`, 티켓 차감 없음.

**면접 3단계**

| 단계 | 엔드포인트 | 동작 |
|---|---|---|
| 시작 | `POST /api/premium/interviews` | 본문 `{track, resumeText, company:{field,job} \| admission:{name,age,university,department}}`. 티켓 확인·차감·행 생성을 한 트랜잭션으로 → `201 {"interviewId","session"}`. 티켓 없음 `409 no_tickets` |
| 턴 | `POST /api/premium/interviews/{id}/turns` | 본문 `{answer?}`(처음엔 비워 첫 질문). 응답 SSE: `event: delta {text}` … `event: done {ended}` 또는 `event: error {code}` |
| 리포트 | `POST /api/premium/interviews/{id}/report` | 리포트 원문을 SSE(`delta`·`done`)로 보내고 `status=done`. 프론트는 원문을 기존 리포트 파서에 넣고 `interviewId`를 `premiumInterviewId`로 보관함에 저장 |

- 대화 기록은 서버가 가진다. 클라이언트는 답변만 보낸다.
- 면접관 응답 최대 9번(2026-10-15: 15번에서 줄임 — 본질문 5, 꼬리질문은 면접 전체 합쳐 최대 3, 끝맺음 1), 답변 한 번 2,000자. 넘거나 끝난 면접이면 `409 interview_over`.
- Claude 호출이 실패하면 `error` 이벤트를 보내고 그 턴은 기록하지 않는다(같은 요청으로 재시도 가능). 티켓은 돌려주지 않되 면접은 이어 갈 수 있다. 무료 면접관으로 떨어지지 않는다.

**프롬프트** (`app/llm/`, 백엔드 계층 규율로 다룬다)
- 회사 트랙·대입 트랙을 따로 둔다. 대입은 이름·나이·지원 대학·학과·자기소개서로 전공 적합성·탐구 경험·자기소개서 근거를 묻는다.
- 질문 5개·꼬리질문 규칙·**종료 문장은 로컬 면접과 같은 문구**로 둬 프론트의 종료 감지를 그대로 쓴다.
- 리포트 지시문은 프론트 `frontend/src/prompts/report.ts`의 JSON 형식과 같게 두고, 둘이 같은지 테스트로 묶는다.

**Claude 호출**
- 모델 `claude-sonnet-5-5`, 스트리밍. 키는 `ANTHROPIC_API_KEY`(서버 `.env`).
- 대화 effort `low`, 리포트 `medium`. 시스템 프롬프트·이력서에 프롬프트 캐시.
- 안전 분류기 거절 시 서버 측 폴백(`fallbacks: "default"`)을 켠다.
- Claude 클라이언트는 주입받는다(테스트에서 가짜로 교체).

## 5. 비목표 (다음 단계)

- 구글 로그인, 계정 삭제(데이터 일괄 삭제), 녹음을 이용한 말투 분석, 기업 브리핑(#71), 실제 결제 연동, DB 백업 자동화(README에 수동 방법만).

## 6. 배포 영향 (`deploy/`, 공동 영역)

- api 컨테이너에 `DATA_DIR` 볼륨: 운영 `/srv/momo/data`, demomo `/srv/momo-dev/data`(dev 쪽은 `deploy/.env`·override로).
- **nginx 업로드 크기:** 지금 `client_max_body_size` 설정이 없어 기본 1MB다. 녹음 한 건이 들어가도록 `/api/recordings`에 6MB를 준다.
- `.env` 항목: `ANTHROPIC_API_KEY`, `ADMIN_LOGIN`, `ADMIN_PASSWORD`, `BEN_DAILY_LIMIT`, `CORS_ORIGINS`, `COOKIE_SECURE`. `.env`는 커밋하지 않는다.
- demomo에 먼저 반영한다. 운영(momo)은 지시 전까지 건드리지 않는다.

## 7. 작업 순서

작업 브랜치는 `cw`에서 기능별로 따고 PR base는 `dev`.

| PR | 내용 | 선행 |
|---|---|---|
| 0 | 계약 확정(문서): `docs/API.md`에 2절 반영, `CLAUDE.md` 8번 개정. 공동 승인 | — |
| 1 | DB 기반 + 계정(가입·로그인·로그아웃·`/me`·프로필·이메일 중복 확인·요청 수 제한·CORS·Origin 확인) | 0 |
| 2 | 이력서 슬롯 + 보관함(5개 한도·자동 삭제·프리미엄 검증) | 1 |
| 3 | 관리자 계정·티켓(관리자 전용 목업 결제·하루 상한) + 벤 면접 3단계 | 1 |
| 4 | 녹음(업로드·Range·30MB·같이 삭제) | 2, 3 |
| 5 | 배포(볼륨·nginx·`.env`) → demomo 반영 | 1~4 |

## 8. 테스트

- pytest + httpx, TDD. 테스트마다 임시 `DATA_DIR`에 새 DB.
- 계정: 가입·로그인 성공·실패, 같은 오류 문구, 동의 없음, 세션 만료, `/me`가 `null`, 요청 수 제한, Origin 거부.
- 이력서: 슬롯 한도와 동시 요청. 보관함: 5개 초과 자동 삭제·`evicted`, 프리미엄 위조 거부, 남의 리소스 404.
- 프리미엄: 티켓 차감 원자성, 하루 상한, 일반 계정 목업 결제 403·관리자만 충전, 관리자 계정 기동 시 생성·갱신·`.env` 없으면 없음. 벤: SSE 순서, 9번 상한, 실패 턴 미기록(가짜 Claude 클라이언트).
- 녹음: 413·415, Range 응답, 기록 삭제 시 파일 삭제.
- 리포트 지시문: 프론트 `report.ts`와 같은지.
- CI는 지금처럼 `pytest`·`ruff`. Claude 실제 호출은 하지 않는다.
- 수동(demomo): 가입 → 이력서 저장 → 보관함 6번째에 자동 삭제 → 관리자 로그인 → 목업 결제 → 벤 1회 완주(실제 Claude) → 리포트 → 보관함 → 녹음 재생.
