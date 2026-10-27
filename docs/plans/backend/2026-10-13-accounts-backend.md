# 계정·보관함·프리미엄 백엔드 — 구현 계획 (plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

- 생성일시: 2026-10-14
- 기준 spec: `docs/specs/backend/2026-10-13-accounts-backend-design.md` (계약 초안: `docs/specs/frontend/2026-10-13-accounts-api-contract.md`)
- 담당: @ssenu / 리뷰 @leemonta9482

**Goal:** 지금 DB 없는 FastAPI 백엔드에 계정(이메일·비밀번호, 쿠키 세션), 이력서 슬롯, 보관함(무료 5개 한도), 관리자 전용 목업 결제·티켓, 프리미엄 면접관 벤(Claude, SSE 3단계), 녹음(기록당 30MB)을 얹고, 계약(`docs/API.md`)·개인정보 원칙(`CLAUDE.md` 8번)·배포(볼륨·nginx·`.env`)를 함께 맞춘다.

**Architecture:** 표준 `sqlite3` + 얇은 저장소 계층(`app/repos/`)을 둔다. 마이그레이션은 `app/migrations/NNN_*.sql`을 기동 때 `schema_version` 테이블 기준으로 적용한다. 기존 `create_app()`에 `settings`(환경변수 → `Settings`)·`clock`·`claude`를 주입할 수 있게 넓히고, 테스트는 임시 `DATA_DIR`·가짜 시계·가짜 Claude로 새 앱을 만든다. 라우터는 HTTP, repos는 SQL, `app/llm/`은 Claude 호출·프롬프트만 맡는다. 비밀번호는 `argon2-cffi`, 세션은 `secrets.token_urlsafe(32)` 쿠키 + DB에는 SHA-256 해시. 벤은 공식 `anthropic` SDK 스트리밍을 `ClaudeClient` 프로토콜 뒤에 두고 FastAPI `StreamingResponse`로 SSE(`delta`/`done`/`error`)를 낸다.

**Tech Stack:** Python 3.12, FastAPI 0.141 / Starlette 1.6, pydantic v2, sqlite3(표준), argon2-cffi, anthropic(공식 SDK), python-multipart(녹음 업로드), uv, pytest + httpx(TestClient), ruff(line-length 100, E/F/I/B/UP)

## Global Constraints

- 작업 브랜치는 `cw`(= 최신 `dev`를 합친 상태)에서 PR마다 따고, PR base는 `dev`다(`gh pr create --base dev`). `main`·운영(momo)은 지시 전까지 건드리지 않는다.
- 백엔드 명령은 모두 `backend/` 디렉터리에서 실행한다(`uv run pytest ...`, `uv run ruff ...`). 커밋 전에 `uv run ruff check --fix . && uv run ruff format .`을 돌리고 `uv run pytest -q` 전체 통과를 확인한다.
- 개인정보 원칙: 비로그인 사용자의 데이터는 받지 않는다. 로그인 사용자는 가입 때 `"consent": true`를 받는다. 벤의 대화는 외부 AI(Claude)로 간다. 비밀번호·이력서·대화 본문을 로그에 남기지 않는다(로그 호출을 새로 만들지 않는다).
- ORM·인증 라이브러리 금지. 새 의존성은 `argon2-cffi`, `anthropic`, `python-multipart` 셋뿐이며 `uv add`로만 넣는다(`uv.lock` 커밋).
- `backend/data/manifest.json`과 `/api/manifest`·`/api/questions/{field}`·`/api/health` 응답은 바꾸지 않는다. 새 엔드포인트만 추가(additive).
- 환경변수 이름: `DATA_DIR`(DB·녹음 위치), `CORS_ORIGINS`, `COOKIE_SECURE`, `ANTHROPIC_API_KEY`, `ADMIN_LOGIN`, `ADMIN_PASSWORD`, `BEN_DAILY_LIMIT`. 기존 `MOMO_DATA_DIR`(정적 계약 데이터 `backend/data/`)과 다르다 — 코드에서는 `Settings.storage_dir`로 부른다.
- `CORS_ORIGINS` 기본값: `https://momo.ssenu.cloud,https://demomo.ssenu.cloud,http://localhost:5173`. `allow_credentials=True`, 와일드카드(`*`) 금지.
- `COOKIE_SECURE` 기본값 켜짐(`1`). 테스트는 `cookie_secure=False`.
- `BEN_DAILY_LIMIT` 기본값 30(서버 전체·한국 날짜 기준 하루).
- 세션 쿠키: 이름 `momo_session`, `HttpOnly`, `SameSite=Lax`, `Path=/api`, `Max-Age` 30일(2,592,000초), `COOKIE_SECURE`면 `Secure`. 값은 `secrets.token_urlsafe(32)`, DB에는 SHA-256 hex만.
- 비밀번호 8자 이상(`422 weak_password`). 이메일은 앞뒤 공백 제거 + 소문자. 로그인 실패는 계정 없음·비밀번호 틀림 모두 `401 bad_credentials`(계정이 없어도 더미 해시 검증).
- 요청 수 제한(메모리, IP는 `CF-Connecting-IP` → 없으면 연결 주소): `email-taken` IP당 분당 20회, `login`·`signup` 각각 IP당 분당 10회. 초과 `429 {"error":"rate_limited"}`.
- 상태를 바꾸는 요청(`POST`·`PUT`·`PATCH`·`DELETE`, `/api/` 아래)은 `Origin`이 `CORS_ORIGINS`에 있어야 한다. 없거나 다르면 `403 {"error":"bad_origin"}`.
- 오류 형식: `{"error": "<code>"}` + 입력 오류면 `"field"`. 형식 검사 실패(pydantic)는 `422 {"error":"invalid","field":"<필드>"}`.
- 오류 코드: `unauthorized`(401), `premium_required`(403), `purchase_disabled`(403), `bad_origin`(403), `not_found`(404), `email_taken`(409), `slot_full`(409, +`kind`), `no_tickets`(409), `interview_over`(409), `interview_not_started`(409), `invalid_email`·`weak_password`·`missing_name`·`consent_required`·`missing_field`·`invalid_premium_interview`·`missing_answer`·`answer_too_long`·`invalid`(422), `too_large`(413), `unsupported_media`(415), `rate_limited`(429), `daily_limit`(503), `ben_unavailable`(503). SSE `error` 이벤트 `code`: `claude_error`, `refused`.
- 남의 이력서·보관함·녹음·벤 면접 id는 없는 id와 같은 `404 not_found`. 모든 조회는 `user_id`로 거른다.
- ID: 접두사 + ULID(26자 Crockford base32) — `u_`, `r_`, `a_`, `rec_`, `pi_`. 외부 패키지 없이 `os.urandom` + 시각으로 만든다.
- 시각 문자열: UTC ISO 8601 밀리초 + `Z`(예: `2026-10-13T04:00:00.000Z`, JS `toISOString()`과 같은 모양).
- 이력서: 종류(`company`·`admission`)마다 3개(슬롯 3+3). `title` 1~40자(앞뒤 공백 제거 후), `text` 최대 20,000자. 개수 확인·삽입은 한 트랜잭션.
- 보관함: 무료(`premium:false`) 기록 5개 한도. 넘으면 `started_at` 오래된 것부터 지우고(녹음 행도) 지운 id를 `evicted`로. 파일 삭제는 커밋 뒤, 남은 파일은 기동 시 정리.
- 목업 결제: 관리자(`is_admin`)만. 관리자는 `tier=premium`, 티켓 +10. 관리자 계정은 기동 때 `ADMIN_LOGIN`·`ADMIN_PASSWORD`가 둘 다 있을 때만 만들거나 맞춘다. 이메일이 아닌 로그인 아이디는 `ADMIN_LOGIN`과 같을 때만 허용.
- 벤: 모델 `claude-sonnet-5-5`, 스트리밍. 대화 effort `low`, 리포트 effort `medium`(`output_config={"effort": ...}`). 시스템 프롬프트·이력서 블록에 `cache_control: {"type": "ephemeral"}`. 서버 측 폴백 `fallbacks: "default"` + 베타 헤더 `server-side-fallback-2026-07-01`(`extra_body`·`extra_headers`로 전달). 면접관 응답 최대 15번, 답변 한 번 최대 2,000자. Claude 실패 턴은 기록하지 않는다(티켓 환불 없음, 같은 요청으로 재시도).
- 종료 문장은 로컬 면접과 같은 `면접을 마치겠습니다`, 리포트 지시문은 `frontend/src/prompts/report.ts`의 `REPORT_INSTRUCTION`과 글자까지 같다(테스트로 묶음).
- 녹음: `audio/webm`·`audio/ogg`만(그 밖 `415 unsupported_media`), 기록 하나당 합계 30MB(`30 * 1024 * 1024` 바이트, 넘으면 `413 too_large`), `(archive_id, turn)`마다 한 파일(재업로드는 교체). 파일 `DATA_DIR/recordings/{user_id}/{rec_id}.webm|.ogg`. nginx `/api/recordings`의 `client_max_body_size 6m`.
- 배포 볼륨: 운영 `/srv/momo/data`, demomo `/srv/momo-dev/data`(dev 쪽 `deploy/.env`의 `DATA_HOST_DIR`). 컨테이너 안은 `/data`.
- CI에서 Claude를 실제로 부르지 않는다(가짜 클라이언트만).

## File Structure

| 파일 | 만들기/고치기 | 책임 |
|---|---|---|
| `docs/API.md` | 고치기 | 계정·이력서·보관함·프리미엄·녹음 계약 확정본(사람이 읽는 `schemas.py`) |
| `CLAUDE.md` | 고치기 | 개요 문장과 "절대 하지 말 것" 8번을 등급별 개인정보 원칙으로 개정 |
| `backend/CLAUDE.md` | 고치기 | "DB·인증 없음" 규칙을 새 계층 규칙(로그인·동의 사용자만 저장, repos/llm 분리)으로 교체 |
| `.gitignore` | 고치기 | 로컬 기본 저장소 `backend/var/` 제외 |
| `.github/workflows/ci.yml` | 고치기 | 프론트 프롬프트 파일이 바뀌어도 백엔드 테스트(프롬프트 동일성)가 돌게 경로 필터 확장 |
| `backend/pyproject.toml`, `backend/uv.lock` | 고치기 | 의존성 3개, ruff per-file-ignores(한글 긴 줄: 테스트·프롬프트) |
| `backend/app/config.py` | 만들기 | 환경변수 → `Settings`(불변 dataclass) |
| `backend/app/ids.py` | 만들기 | ULID와 접두사 id |
| `backend/app/timefmt.py` | 만들기 | UTC ISO 문자열, 한국 날짜 0시 경계 |
| `backend/app/db.py` | 만들기 | sqlite3 연결, 트랜잭션, 마이그레이션, `init_db` |
| `backend/app/migrations/001_init.sql` | 만들기 | `users`, `sessions` |
| `backend/app/migrations/002_resumes_archive.sql` | 만들기 | `resumes`, `premium_interviews`, `archive`, `recordings` |
| `backend/app/security.py` | 만들기 | argon2 해시·검증·더미 검증, 세션 토큰·해시, `RateLimiter`, `client_ip` |
| `backend/app/errors.py` | 만들기 | `ApiError`와 오류 응답 형식(검증 오류 포함) |
| `backend/app/middleware.py` | 만들기 | `OriginGuard`(상태 변경 요청의 Origin 확인) |
| `backend/app/startup.py` | 만들기 | 기동 시 DB 마이그레이션·녹음 폴더·고아 파일 정리·관리자 동기화 |
| `backend/app/main.py` | 고치기 | `create_app(data_dir, settings, clock, claude)`, CORS(credentials), 라우터 등록 |
| `backend/app/deps.py` | 만들기 | `get_db`, `current_user`, `require_user`, `require_premium`, 쿠키 이름 |
| `backend/app/presenters.py` | 만들기 | repo 객체 → 응답 스키마(`to_session`, `recording_url`) |
| `backend/app/schemas.py` | 고치기 | 새 요청·응답 pydantic 모델(계약의 단일 정의) |
| `backend/app/files.py` | 만들기 | 커밋 뒤 파일 삭제, 기동 시 고아 녹음 정리 |
| `backend/app/repos/__init__.py` | 만들기 | 패키지 표시 |
| `backend/app/repos/users.py` | 만들기 | users SQL, 로그인 아이디 정규화, 관리자 동기화, 티켓 지급 |
| `backend/app/repos/sessions.py` | 만들기 | sessions SQL(30일, 만료 시 삭제) |
| `backend/app/repos/resumes.py` | 만들기 | resumes SQL(종류별 3개, 트랜잭션) |
| `backend/app/repos/archive.py` | 만들기 | archive SQL(5개 한도·밀어내기·프리미엄 검증·녹음 경로 수거) |
| `backend/app/repos/premium.py` | 만들기 | premium_interviews SQL(하루 상한·티켓 차감 원자성·턴 기록) |
| `backend/app/repos/recordings.py` | 만들기 | recordings SQL(30MB 합계·교체) |
| `backend/app/routers/auth.py` | 만들기 | 가입·로그인·로그아웃·이메일 중복 확인·요청 수 제한 |
| `backend/app/routers/me.py` | 만들기 | `GET /api/me`, `PUT /api/profile` |
| `backend/app/routers/resumes.py` | 만들기 | 이력서 CRUD |
| `backend/app/routers/archive.py` | 만들기 | 보관함 목록·상세·저장·삭제 |
| `backend/app/routers/premium.py` | 만들기 | 목업 결제, 벤 시작·턴(SSE)·리포트(SSE) |
| `backend/app/routers/recordings.py` | 만들기 | 녹음 업로드·재생(Range) |
| `backend/app/sse.py` | 만들기 | SSE 이벤트 문자열 한 줄 만들기 |
| `backend/app/llm/__init__.py` | 만들기 | 패키지 표시 |
| `backend/app/llm/prompts.py` | 만들기 | 벤 시스템 프롬프트(회사·대입), 메시지 조립, 리포트 지시문, 종료 감지 (백엔드 계층 규율 경로) |
| `backend/app/llm/claude.py` | 만들기 | `ClaudeClient` 프로토콜, `ClaudeError`, `AnthropicClaude`(SDK 스트리밍) |
| `backend/tests/__init__.py` | 만들기 | `tests`를 정규 패키지로(도우미 import 고정) |
| `backend/tests/fakes.py` | 만들기 | `FakeClock`, `FakeClaude` |
| `backend/tests/helpers.py` | 만들기 | 가입·로그인·관리자·벤 시작·보관함 본문·SSE 파싱·SQL 삽입 도우미 |
| `backend/tests/conftest.py` | 고치기 | 임시 `DATA_DIR` 설정, `make_client` 팩토리, 가짜 시계·Claude |
| `backend/tests/test_*.py` | 만들기/고치기 | Task별 테스트(아래) |
| `deploy/docker-compose.yml` | 고치기 | api 환경변수·`/data` 볼륨 |
| `deploy/api.Dockerfile` | 고치기 | `DATA_DIR=/data`, 폴더 권한 |
| `deploy/nginx.conf` | 고치기 | `/api/recordings` 업로드 6MB |
| `deploy/README.md` | 고치기 | `.env` 항목, 데이터 폴더, sqlite 백업, demomo 반영·확인 |

## PR 묶음

| PR | 브랜치(`cw`에서) | 제목(Squash 커밋) | Task |
|---|---|---|---|
| 0 | `docs/accounts-contract` | `docs: 계정·보관함·프리미엄 API 계약 확정과 개인정보 원칙(8번) 개정` | 1, 2 |
| 1 | `feature/accounts-db` | `feat(backend): DB 기반과 계정 — 가입·로그인·세션·프로필·요청 수 제한·Origin 확인` | 3~9 |
| 2 | `feature/resumes-archive` | `feat(backend): 이력서 슬롯과 보관함 — 5개 한도 자동 삭제·프리미엄 기록 검증` | 10~13 |
| 3 | `feature/premium-ben` | `feat(backend): 관리자 목업 결제·티켓과 벤 면접(Claude) 3단계` | 14~21 |
| 4 | `feature/recordings` | `feat(backend): 프리미엄 녹음 업로드·재생(Range)·기록당 30MB` | 22, 23 |
| 5 | `chore/accounts-deploy` | `chore(infra): 계정 데이터 볼륨·녹음 업로드 크기·.env 항목 — demomo 반영` | 24, 25 |

- PR 0은 공유 영역(문서·`CLAUDE.md`)이라 @leemonta9482 승인 필수. PR 1~4는 상대방 리뷰 1회. PR 5는 공유 영역(`deploy/`)이라 승인 필수 + 파이에서 `docker compose config` 확인.
- 선행: PR 1 ← 0, PR 2 ← 1, PR 3 ← 1(Task 21의 보관함 연동 테스트는 PR 2도 필요하므로 PR 3은 PR 2 뒤에 머지), PR 4 ← 2·3, PR 5 ← 1~4.
- 각 PR 브랜치는 앞 PR이 `dev`에 머지된 뒤 `git switch cw && git pull origin dev` 후 딴다.

---

## PR 0 — 계약 확정(문서)

### Task 1: `docs/API.md`에 계정·이력서·보관함·프리미엄·녹음 계약 확정

**Files:**
- Modify: `docs/API.md`

**Interfaces:**
- Produces: 확정 계약 문서. 이후 모든 Task의 응답 모양(`Session`에 `isAdmin`, `ArchiveEntry`에 `score` 없음, 벤 SSE, 녹음 규칙)의 기준.

- [ ] **Step 1: 지금 문서에 새 계약이 없음을 확인(실패 확인)**

Run (리포 루트): `grep -c "momo_session\|isAdmin\|/api/premium/interviews" docs/API.md`
Expected: `0`

- [ ] **Step 2: `## GET /api/health` 절 뒤(`## 참고` 앞)에 아래 절 전체를 넣는다**

`````markdown
## 계정·이력서·보관함·프리미엄 (2026-10-13 확정)

> 설계: `docs/specs/backend/2026-10-13-accounts-backend-design.md`. 초안(`docs/specs/frontend/2026-10-13-accounts-api-contract.md`)에서 바뀐 것: `ArchiveEntry.score` 삭제, 가입 `consent` 필수, 보관함 프리미엄 검증(`premiumInterviewId`), `/api/premium/spend` 삭제 → 벤 면접 3단계, 목업 결제는 관리자만(`Session.isAdmin`), 녹음 형식·크기 규칙, 구글 로그인은 다음 단계, `429 rate_limited`.
> 새 엔드포인트만 추가된다. 위 세 엔드포인트와 `backend/data/manifest.json`은 바뀌지 않는다.

### 공통

| 항목 | 값 |
|---|---|
| 형식 | JSON(UTF-8). 녹음 업로드만 `multipart/form-data`, 벤 대화·리포트는 SSE(`text/event-stream`) |
| 인증 | 세션 쿠키 `momo_session` — `HttpOnly`, `SameSite=Lax`, `Path=/api`, 30일, 운영은 `Secure`. 프론트는 `fetch(..., { credentials: 'include' })` |
| CORS | 정확한 오리진만(기본 `https://momo.ssenu.cloud`, `https://demomo.ssenu.cloud`, `http://localhost:5173`), `Access-Control-Allow-Credentials: true`. 와일드카드 없음 |
| CSRF | 상태를 바꾸는 요청(`POST`·`PUT`·`DELETE`)은 `Origin` 헤더가 허용 목록에 있어야 한다. 없거나 다르면 `403 {"error":"bad_origin"}` |
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

### 프리미엄

#### POST /api/premium/purchase — 목업 결제(관리자 전용)

본문 없음 → `200 Session`(`tier: "premium"`, `tickets` +10). 관리자가 아니면 `403 {"error":"purchase_disabled"}`. `401 unauthorized`.

#### 벤 면접 3단계

대화 기록은 서버가 가진다. 클라이언트는 답변만 보낸다. 벤은 외부 AI(Claude)이므로 시작 전에 사용자에게 알린다.

**1) 시작 — POST /api/premium/interviews**

```jsonc
// 요청 (track에 맞는 쪽 하나만)
{ "track": "company", "resumeText": "...", "company": { "field": "it", "job": "백엔드 개발자" } }
{ "track": "admission", "resumeText": "...(자기소개서)",
  "admission": { "name": "홍길동", "age": 19, "university": "한국대학교", "department": "컴퓨터공학과" } }
// 201 { "interviewId": "pi_01J9ZQ...", "session": Session }   // 티켓 1장 차감된 Session
// 403 premium_required
// 409 { "error": "no_tickets" }
// 422 { "error": "missing_field", "field": "company" }       // track에 맞는 묶음이 없음
// 422 invalid                                                // resumeText 1~20,000자, 각 칸 1~100자, age 1~120
// 503 { "error": "daily_limit" }                             // 서버 전체 하루 상한(BEN_DAILY_LIMIT, 한국 날짜). 티켓 차감 없음
// 503 { "error": "ben_unavailable" }                         // 서버에 Claude 키가 없음. 티켓 차감 없음
```

**2) 턴 — POST /api/premium/interviews/{id}/turns**

본문 `{ "answer": "..." }`. 첫 요청은 `answer` 없이(또는 무시됨) 보내 첫 질문을 받는다. 이후에는 `answer`가 필요하다.

스트림 전 오류(JSON): `404 not_found`, `403 premium_required`, `409 interview_over`(끝났거나 면접관 응답 15번을 다 씀), `422 missing_answer`(`field: "answer"`), `422 answer_too_long`(2,000자 초과, `field: "answer"`), `503 ben_unavailable`.

응답은 SSE다.

```
event: delta
data: {"text":"자기소개를 "}

event: delta
data: {"text":"해 주세요."}

event: done
data: {"ended":false}
```

- `done.ended`가 `true`면 면접이 끝났다(종료 문장 "면접을 마치겠습니다"가 나왔거나 면접관 응답 15번). 다음 턴은 `409 interview_over`. 리포트를 부른다.
- Claude 호출이 실패하면 `event: error` / `data: {"code":"claude_error"}`(안전 분류기 거절이면 `"refused"`)를 보내고 끝난다. 그 턴은 기록하지 않으므로 **같은 요청을 다시 보내면 된다**. 이미 받은 `delta`는 버린다. 티켓은 돌려주지 않고 면접은 이어 갈 수 있다. 무료 면접관으로 떨어지지 않는다.

**3) 리포트 — POST /api/premium/interviews/{id}/report**

본문 없음. 스트림 전 오류: `404`, `403 premium_required`, `409 interview_over`(이미 리포트를 받음), `409 interview_not_started`(턴이 하나도 없음), `503 ben_unavailable`.
SSE로 리포트 원문을 `delta`로 보내고 `event: done` / `data: {}`로 끝난다. 이때 면접은 `done`이 된다. 실패하면 `error` 이벤트(면접은 그대로, 재시도 가능).
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
```

같은 `turn`을 다시 올리면 교체된다. 받은 그대로(변환 없이) 저장한다. 요청 하나가 6MB를 넘으면 nginx가 먼저 `413`으로 막는다(이때 본문은 JSON이 아닐 수 있으니 상태 코드로 판단한다).

#### GET /api/recordings/{id}

본인만. 오디오 바이트(저장한 MIME 그대로), `Range` 지원(`206`). `404 not_found`.
`````

- [ ] **Step 3: 맨 아래 `## 하지 않는 것` 절을 아래로 바꾼다**

기존:

```markdown
## 하지 않는 것

- 이력서·대화·리포트를 받는 엔드포인트는 만들지 않는다. 사용자 데이터는 서버로 오지 않는다.
```

새 내용:

```markdown
## 하지 않는 것

- 비로그인 사용자의 이력서·대화·리포트를 받는 엔드포인트는 없다. 사용자 데이터는 로그인하고 가입 때 동의(`consent`)한 계정의 것만 저장한다.
- 구글 로그인, 계정 삭제(데이터 일괄 삭제), 실제 결제, 녹음을 이용한 말투 분석은 다음 단계다.
```

그리고 `## 참고` 절 끝에 한 줄을 더한다:

```markdown
2026-10-13: 계정·이력서·보관함·프리미엄·녹음 엔드포인트 additive 추가. 기존 엔드포인트·매니페스트 불변. `docs/specs/backend/2026-10-13-accounts-backend-design.md`
```

- [ ] **Step 4: 확인**

Run: `grep -c "momo_session\|isAdmin\|/api/premium/interviews" docs/API.md`
Expected: `4` 이상. 그리고 `grep -n '"score"' docs/API.md` → 출력 없음.

- [ ] **Step 5: 커밋**

```bash
git add docs/API.md
git commit -m "docs: 계정·이력서·보관함·프리미엄·녹음 API 계약 확정 — score 삭제, consent, 벤 3단계 SSE, 관리자 전용 결제"
```

---

### Task 2: `CLAUDE.md` 8번·개요 개정과 `backend/CLAUDE.md` 계층 규칙 갱신

**Files:**
- Modify: `CLAUDE.md`
- Modify: `backend/CLAUDE.md`

**Interfaces:**
- Produces: 개정된 개인정보 원칙(비로그인 = 기기 밖으로 안 나감, 로그인 = 동의 후 서버 저장, 벤 = 외부 AI 사전 고지). PR 1 이후의 코드가 이 원칙을 따른다.

- [ ] **Step 1: 지금 문구 확인(실패 확인)**

Run: `grep -n "이력서 텍스트·대화 내용을 서버로 전송하는 코드 작성 금지" CLAUDE.md && grep -n "데이터베이스·인증·세션 저장 없음" backend/CLAUDE.md`
Expected: 두 줄 모두 출력된다(아직 옛 문구).

- [ ] **Step 2: `CLAUDE.md` 개요 문장 교체**

기존:

```markdown
- 목적: 브라우저 안에서 로컬 LLM(Gemma 4, WebGPU)이 면접관 역할을 하는 모의면접 사이트. 이력서·대화·리포트가 사용자 기기를 떠나지 않는다. 포트폴리오 겸 공모전 데모.
```

새 내용:

```markdown
- 목적: 브라우저 안에서 로컬 LLM(Gemma 4, WebGPU)이 면접관 역할을 하는 모의면접 사이트. 비로그인 사용자의 이력서·대화·리포트는 기기를 떠나지 않는다(로그인 사용자는 동의 후 서버 보관, 프리미엄 면접관 벤은 Claude API — "절대 하지 말 것" 8번). 포트폴리오 겸 공모전 데모.
```

- [ ] **Step 3: `CLAUDE.md` "절대 하지 말 것" 8번 교체**

기존:

```markdown
8. 이력서 텍스트·대화 내용을 서버로 전송하는 코드 작성 금지 (프로젝트 핵심 가치)
```

새 내용:

```markdown
8. 개인정보는 등급으로 가른다(2026-10-13 개정, 공동 승인 — `docs/specs/backend/2026-10-13-accounts-backend-design.md` 1절). **비로그인** 사용자의 이력서·대화·리포트를 서버로 보내는 코드 작성 금지(기기를 떠나지 않는다). **로그인** 사용자의 데이터는 가입 때 받은 동의 범위(이력서 슬롯·보관함·녹음) 안에서만 서버에 저장한다. **프리미엄 면접관(벤)**의 대화는 외부 AI(Claude API)로 가므로 면접 시작 전에 알린다. 이 밖으로 사용자 데이터를 보내거나 비밀번호·이력서·대화 본문을 로그에 남기는 코드 작성 금지
```

- [ ] **Step 4: `backend/CLAUDE.md` 폴더 규칙·계층 책임 교체**

폴더 규칙 코드 블록의 기존:

```
backend/
├── app/          # FastAPI 앱: main.py, routers/, schemas.py(pydantic 응답 모델)
├── data/         # 정적 계약 데이터: manifest.json, questions/{field}.json (계층 규율 경로)
└── tests/        # pytest
```

새 내용:

```
backend/
├── app/          # FastAPI 앱: main.py, routers/, schemas.py(pydantic 요청·응답 모델)
│   ├── db.py, migrations/   # sqlite3 연결·트랜잭션, 번호 붙은 .sql(schema_version)
│   ├── repos/    # SQL 전담(users, sessions, resumes, archive, premium, recordings)
│   └── llm/      # 벤: Claude 호출(claude.py), 프롬프트(prompts.py, 계층 규율 경로)
├── data/         # 정적 계약 데이터: manifest.json, questions/{field}.json (계층 규율 경로)
└── tests/        # pytest
```

계층 책임의 기존 두 줄:

```markdown
- 데이터베이스·인증·세션 저장 없음. 이력서·대화·리포트를 받는 엔드포인트를 만들지 않는다.
- RAG 확장 시에도 사용자 개인 데이터는 서버에 저장하지 않는다. 공개 지식(직무·기업 정보)만 색인한다.
```

새 내용:

```markdown
- 사용자 데이터는 **로그인하고 동의한 사용자의 것만** 저장한다(sqlite3, 위치는 환경변수 `DATA_DIR`, 2026-10-13 개정). 비로그인 사용자의 이력서·대화·리포트를 받는 엔드포인트는 만들지 않는다.
- 라우터는 HTTP, `app/repos/`는 SQL, `app/llm/`은 외부 호출·프롬프트만 맡는다. ORM·인증 라이브러리를 들이지 않는다.
- 비밀번호·이력서·대화 본문을 로그에 남기지 않는다.
- `app/llm/prompts.py`(벤 프롬프트)는 계층 규율 경로다. 바꾸면 demomo에서 벤 1회 완주 + 리포트 JSON 파싱을 확인하고, 변경 제안 본문에 전후 비교를 붙인다. 종료 문장·리포트 지시문은 프론트와 같아야 한다(`tests/test_prompt_parity.py`).
- RAG 확장 시 색인은 공개 지식(직무·기업 정보)만. 사용자 데이터를 색인하지 않는다.
```

- [ ] **Step 5: 확인**

Run: `grep -c "등급으로 가른다" CLAUDE.md && grep -c "로그인하고 동의한 사용자의 것만" backend/CLAUDE.md`
Expected: `1` / `1`. 그리고 `grep -n "데이터베이스·인증·세션 저장 없음" backend/CLAUDE.md` → 출력 없음.

- [ ] **Step 6: 커밋**

```bash
git add CLAUDE.md backend/CLAUDE.md
git commit -m "docs: 개인정보 원칙을 등급별로 개정(절대 하지 말 것 8번) — 비로그인 기기 안, 로그인 동의 후 저장, 벤 외부 AI 고지"
```

> `frontend/CLAUDE.md`의 "이력서 텍스트·대화·리포트를 서버로 보내는 코드 작성 금지"도 같은 원칙으로 고쳐야 하지만 프론트 영역이므로 이 PR 설명에 적어 @leemonta9482에게 요청한다(다른 영역 파일을 고치지 않는다).

---

## PR 1 — DB 기반 + 계정

> PR 1~4의 명령은 모두 `backend/`에서 실행한다.

### Task 3: 설정(`Settings`)·ID(ULID)·시각 문자열

**Files:**
- Create: `backend/app/config.py`, `backend/app/ids.py`, `backend/app/timefmt.py`
- Modify: `.gitignore`, `backend/pyproject.toml`
- Test: `backend/tests/test_config.py`, `backend/tests/test_ids.py`, `backend/tests/test_timefmt.py`

**Interfaces:**
- Produces:
  - `app.config.Settings` (frozen dataclass): `storage_dir: Path`, `cors_origins: tuple[str, ...]`, `cookie_secure: bool = True`, `anthropic_api_key: str | None = None`, `admin_login: str | None = None`, `admin_password: str | None = None`, `ben_daily_limit: int = 30`; 속성 `db_path -> Path`(`storage_dir / "momo.sqlite3"`), `recordings_dir -> Path`(`storage_dir / "recordings"`); `Settings.from_env(env: Mapping[str, str] | None = None) -> Settings`
  - `app.config.DEFAULT_CORS_ORIGINS`, `DEFAULT_STORAGE_DIR`(`backend/var`), `DEFAULT_BEN_DAILY_LIMIT`
  - `app.ids.CROCKFORD`, `app.ids.ulid(now_ms: int | None = None) -> str`, `app.ids.new_id(prefix: str) -> str`
  - `app.timefmt.KST`, `format_utc(dt: datetime) -> str`, `iso(ts: float) -> str`, `kst_day_start(ts: float) -> str`

- [ ] **Step 1: 실패하는 테스트 작성**

`backend/tests/test_config.py`:

```python
import pytest

from app.config import DEFAULT_STORAGE_DIR, Settings


def test_defaults_when_env_is_empty():
    s = Settings.from_env({})
    assert s.storage_dir == DEFAULT_STORAGE_DIR
    assert s.cors_origins == (
        "https://momo.ssenu.cloud",
        "https://demomo.ssenu.cloud",
        "http://localhost:5173",
    )
    assert s.cookie_secure is True
    assert s.anthropic_api_key is None
    assert s.admin_login is None
    assert s.admin_password is None
    assert s.ben_daily_limit == 30


def test_reads_every_env_key(tmp_path):
    s = Settings.from_env(
        {
            "DATA_DIR": str(tmp_path),
            "CORS_ORIGINS": "https://a.example, http://localhost:5173/",
            "COOKIE_SECURE": "0",
            "ANTHROPIC_API_KEY": "sk-test",
            "ADMIN_LOGIN": "admin",
            "ADMIN_PASSWORD": " pass with spaces ",
            "BEN_DAILY_LIMIT": "5",
        }
    )
    assert s.storage_dir == tmp_path
    assert s.cors_origins == ("https://a.example", "http://localhost:5173")
    assert s.cookie_secure is False
    assert s.anthropic_api_key == "sk-test"
    assert s.admin_login == "admin"
    assert s.admin_password == " pass with spaces "
    assert s.ben_daily_limit == 5
    assert s.db_path == tmp_path / "momo.sqlite3"
    assert s.recordings_dir == tmp_path / "recordings"


def test_blank_values_fall_back_to_defaults():
    s = Settings.from_env(
        {"ANTHROPIC_API_KEY": "", "ADMIN_LOGIN": "  ", "ADMIN_PASSWORD": "", "CORS_ORIGINS": ""}
    )
    assert s.anthropic_api_key is None
    assert s.admin_login is None
    assert s.admin_password is None
    assert len(s.cors_origins) == 3


def test_wildcard_origin_is_rejected():
    with pytest.raises(ValueError, match="CORS_ORIGINS"):
        Settings.from_env({"CORS_ORIGINS": "*"})
```

`backend/tests/test_ids.py`:

```python
import pytest

from app.ids import CROCKFORD, new_id, ulid


def test_ulid_is_26_crockford_chars():
    value = ulid()
    assert len(value) == 26
    assert set(value) <= set(CROCKFORD)


def test_ulid_sorts_by_time():
    assert ulid(1_000)[:10] < ulid(2_000)[:10]
    assert ulid(2_000) < ulid(3_000)


def test_new_id_uses_known_prefixes():
    for prefix in ("u", "r", "a", "rec", "pi"):
        value = new_id(prefix)
        assert value.startswith(prefix + "_")
        assert len(value) == len(prefix) + 1 + 26


def test_new_id_rejects_unknown_prefix():
    with pytest.raises(ValueError):
        new_id("x")


def test_ids_are_unique():
    assert len({new_id("u") for _ in range(1000)}) == 1000
```

`backend/tests/test_timefmt.py`:

```python
from datetime import datetime

from app.timefmt import KST, format_utc, iso, kst_day_start


def test_iso_matches_js_to_iso_string():
    assert iso(0) == "1970-01-01T00:00:00.000Z"
    assert iso(1_760_000_000.5) == "2025-10-09T08:53:20.500Z"


def test_format_utc_converts_timezone():
    assert format_utc(datetime(2026, 10, 13, 13, 0, tzinfo=KST)) == "2026-10-13T04:00:00.000Z"


def test_kst_day_start_is_midnight_in_korea():
    # 1_760_000_000 = 2025-10-09 17:53:20 KST → 그날 0시(KST) = 전날 15:00 UTC
    assert kst_day_start(1_760_000_000) == "2025-10-08T15:00:00.000Z"
```

- [ ] **Step 2: 실패 확인**

Run: `uv run pytest tests/test_config.py tests/test_ids.py tests/test_timefmt.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.config'`(그리고 `app.ids`, `app.timefmt`)

- [ ] **Step 3: 구현**

`backend/app/config.py`:

```python
"""환경변수 설정 (spec 3절). 테스트는 Settings를 직접 만들어 create_app에 넘긴다."""

import os
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Self

DEFAULT_CORS_ORIGINS = (
    "https://momo.ssenu.cloud",
    "https://demomo.ssenu.cloud",
    "http://localhost:5173",
)
DEFAULT_BEN_DAILY_LIMIT = 30
# DATA_DIR = 사용자 데이터(DB·녹음). 정적 계약 데이터(MOMO_DATA_DIR)와 다르다.
DEFAULT_STORAGE_DIR = Path(__file__).resolve().parents[1] / "var"


def _stripped(value: str | None) -> str | None:
    if value is None or not value.strip():
        return None
    return value.strip()


def _parse_bool(value: str | None, default: bool) -> bool:
    if value is None or not value.strip():
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _parse_origins(value: str | None) -> tuple[str, ...]:
    if value is None or not value.strip():
        return DEFAULT_CORS_ORIGINS
    origins = tuple(o.strip().rstrip("/") for o in value.split(",") if o.strip())
    if "*" in origins:
        raise ValueError("CORS_ORIGINS must list exact origins, not '*'")
    return origins


@dataclass(frozen=True)
class Settings:
    storage_dir: Path
    cors_origins: tuple[str, ...] = DEFAULT_CORS_ORIGINS
    cookie_secure: bool = True
    anthropic_api_key: str | None = None
    admin_login: str | None = None
    admin_password: str | None = None
    ben_daily_limit: int = DEFAULT_BEN_DAILY_LIMIT

    @property
    def db_path(self) -> Path:
        return self.storage_dir / "momo.sqlite3"

    @property
    def recordings_dir(self) -> Path:
        return self.storage_dir / "recordings"

    @classmethod
    def from_env(cls, env: Mapping[str, str] | None = None) -> Self:
        e = os.environ if env is None else env
        storage = _stripped(e.get("DATA_DIR"))
        limit = _stripped(e.get("BEN_DAILY_LIMIT"))
        return cls(
            storage_dir=Path(storage) if storage else DEFAULT_STORAGE_DIR,
            cors_origins=_parse_origins(e.get("CORS_ORIGINS")),
            cookie_secure=_parse_bool(e.get("COOKIE_SECURE"), default=True),
            anthropic_api_key=_stripped(e.get("ANTHROPIC_API_KEY")),
            admin_login=_stripped(e.get("ADMIN_LOGIN")),
            # 비밀번호는 공백도 값이다 — 비어 있을 때만 없음으로 본다
            admin_password=e.get("ADMIN_PASSWORD") or None,
            ben_daily_limit=int(limit) if limit else DEFAULT_BEN_DAILY_LIMIT,
        )
```

`backend/app/ids.py`:

```python
"""접두사 + ULID (spec 3.1). 시간순으로 정렬되는 26자 Crockford base32."""

import os
import time

CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
PREFIXES = frozenset({"u", "r", "a", "rec", "pi"})


def ulid(now_ms: int | None = None) -> str:
    ms = int(time.time() * 1000) if now_ms is None else now_ms
    value = (ms << 80) | int.from_bytes(os.urandom(10), "big")
    return "".join(CROCKFORD[(value >> (5 * i)) & 0x1F] for i in range(25, -1, -1))


def new_id(prefix: str) -> str:
    if prefix not in PREFIXES:
        raise ValueError(f"unknown id prefix {prefix!r}")
    return f"{prefix}_{ulid()}"
```

`backend/app/timefmt.py`:

```python
"""시각 문자열: UTC ISO 8601 밀리초 + Z (JS toISOString과 같은 모양)."""

from datetime import UTC, datetime, timedelta, timezone

KST = timezone(timedelta(hours=9))


def format_utc(dt: datetime) -> str:
    u = dt.astimezone(UTC)
    return u.strftime("%Y-%m-%dT%H:%M:%S.") + f"{u.microsecond // 1000:03d}Z"


def iso(ts: float) -> str:
    return format_utc(datetime.fromtimestamp(ts, UTC))


def kst_day_start(ts: float) -> str:
    """ts가 속한 한국 날짜의 0시. 벤 하루 상한의 경계."""
    local = datetime.fromtimestamp(ts, KST)
    return format_utc(local.replace(hour=0, minute=0, second=0, microsecond=0))
```

`.gitignore`의 `# backend` 묶음 끝(`backend/.ruff_cache/` 다음 줄)에 추가:

```gitignore
backend/var/
```

`backend/pyproject.toml`의 `[tool.ruff.lint]` 절 바로 뒤에 추가(ruff는 한글을 폭 2로 세어 E501에 쉽게 걸린다 — 테스트 데이터 줄만 풀어 준다):

```toml
[tool.ruff.lint.per-file-ignores]
"tests/**" = ["E501"]
```

- [ ] **Step 4: 통과 확인**

Run: `uv run pytest tests/test_config.py tests/test_ids.py tests/test_timefmt.py -q`
Expected: PASS (12 passed)

- [ ] **Step 5: 커밋**

```bash
uv run ruff check --fix . && uv run ruff format . && uv run pytest -q
git add app/config.py app/ids.py app/timefmt.py tests/test_config.py tests/test_ids.py tests/test_timefmt.py pyproject.toml ../.gitignore
git commit -m "feat(backend): 환경변수 설정(Settings)·접두사 ULID·UTC 시각 문자열"
```

---

### Task 4: sqlite3 연결·트랜잭션·마이그레이션과 `001_init.sql`

**Files:**
- Create: `backend/app/db.py`, `backend/app/migrations/001_init.sql`
- Test: `backend/tests/test_db.py`

**Interfaces:**
- Produces:
  - `app.db.MIGRATIONS_DIR`
  - `app.db.connect(path: Path) -> sqlite3.Connection` (자동 커밋 모드, `sqlite3.Row`, 외래키 켬, `check_same_thread=False`, 잠금 대기 10초)
  - `app.db.connection(path: Path) -> ContextManager[sqlite3.Connection]` (닫아 주는 래퍼)
  - `app.db.transaction(conn) -> ContextManager[sqlite3.Connection]` (`BEGIN IMMEDIATE` … `COMMIT`/`ROLLBACK`)
  - `app.db.migrate(conn, directory: Path = MIGRATIONS_DIR) -> int` (적용 뒤 버전)
  - `app.db.init_db(path: Path) -> None` (폴더 생성 + WAL + 마이그레이션)
  - 테이블 `users(id, email UNIQUE, password_hash, tier, tickets, is_admin, name, age, created_at)`, `sessions(token_hash PK, user_id, expires_at INTEGER)`

- [ ] **Step 1: 실패하는 테스트 작성**

`backend/tests/test_db.py`:

```python
import sqlite3
from pathlib import Path

import pytest

from app import db


def _write(directory: Path, name: str, sql: str) -> None:
    (directory / name).write_text(sql, encoding="utf-8")


def test_migrate_applies_new_files_once_in_order(tmp_path):
    mdir = tmp_path / "m"
    mdir.mkdir()
    _write(mdir, "001_a.sql", "CREATE TABLE a (x INTEGER);")
    _write(mdir, "002_b.sql", "CREATE TABLE b (x INTEGER);")
    with db.connection(tmp_path / "t.sqlite3") as conn:
        assert db.migrate(conn, mdir) == 2
        # 다시 돌려도 CREATE를 되풀이하지 않는다
        assert db.migrate(conn, mdir) == 2
        _write(mdir, "003_c.sql", "CREATE TABLE c (x INTEGER);")
        assert db.migrate(conn, mdir) == 3
        rows = conn.execute("SELECT version FROM schema_version ORDER BY version")
        assert [r[0] for r in rows] == [1, 2, 3]


def test_broken_migration_is_not_recorded(tmp_path):
    mdir = tmp_path / "m"
    mdir.mkdir()
    _write(mdir, "001_a.sql", "CREATE TABLE a (x INTEGER);")
    _write(mdir, "002_b.sql", "CREATE TABLE b (x INTEGER);\nCREATE TABLE broken (;")
    path = tmp_path / "t.sqlite3"
    conn = db.connect(path)
    with pytest.raises(sqlite3.Error):
        db.migrate(conn, mdir)
    conn.close()  # 열린 트랜잭션은 닫을 때 버려진다
    with db.connection(path) as conn:
        assert conn.execute("SELECT MAX(version) FROM schema_version").fetchone()[0] == 1
        assert conn.execute("SELECT name FROM sqlite_master WHERE name = 'b'").fetchone() is None


def test_init_db_creates_account_tables(tmp_path):
    path = tmp_path / "nested" / "momo.sqlite3"
    db.init_db(path)
    with db.connection(path) as conn:
        rows = conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")
        names = {r["name"] for r in rows}
        assert {"schema_version", "users", "sessions"} <= names
        assert conn.execute("PRAGMA journal_mode").fetchone()[0] == "wal"


def test_transaction_rolls_back_on_error(tmp_path):
    with db.connection(tmp_path / "t.sqlite3") as conn:
        conn.execute("CREATE TABLE t (x INTEGER)")
        with pytest.raises(RuntimeError):
            with db.transaction(conn):
                conn.execute("INSERT INTO t VALUES (1)")
                raise RuntimeError("boom")
        assert conn.execute("SELECT COUNT(*) FROM t").fetchone()[0] == 0
        with db.transaction(conn):
            conn.execute("INSERT INTO t VALUES (2)")
        assert conn.execute("SELECT COUNT(*) FROM t").fetchone()[0] == 1


def test_foreign_keys_are_enforced(tmp_path):
    path = tmp_path / "momo.sqlite3"
    db.init_db(path)
    with db.connection(path) as conn, pytest.raises(sqlite3.IntegrityError):
        conn.execute(
            "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ('h', 'u_none', 0)"
        )
```

- [ ] **Step 2: 실패 확인**

Run: `uv run pytest tests/test_db.py -q`
Expected: FAIL — `ImportError: cannot import name 'db' from 'app'`

- [ ] **Step 3: 구현**

`backend/app/db.py`:

```python
"""sqlite3 연결·트랜잭션·마이그레이션 (spec 3절). ORM 없음."""

import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

MIGRATIONS_DIR = Path(__file__).resolve().parent / "migrations"


def connect(path: Path) -> sqlite3.Connection:
    # isolation_level=None: 자동 커밋. 여러 문장은 transaction()으로 묶는다.
    # check_same_thread=False: 스트리밍 응답이 스레드풀에서 돈다.
    conn = sqlite3.connect(path, timeout=10, isolation_level=None, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


@contextmanager
def connection(path: Path) -> Iterator[sqlite3.Connection]:
    conn = connect(path)
    try:
        yield conn
    finally:
        conn.close()


@contextmanager
def transaction(conn: sqlite3.Connection) -> Iterator[sqlite3.Connection]:
    # IMMEDIATE: 시작하자마자 쓰기 잠금 — "세고 넣기"가 섞이지 않는다
    conn.execute("BEGIN IMMEDIATE")
    try:
        yield conn
    except BaseException:
        conn.execute("ROLLBACK")
        raise
    conn.execute("COMMIT")


def migrate(conn: sqlite3.Connection, directory: Path = MIGRATIONS_DIR) -> int:
    conn.execute("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)")
    current = conn.execute("SELECT COALESCE(MAX(version), 0) FROM schema_version").fetchone()[0]
    for file in sorted(directory.glob("*.sql")):
        version = int(file.name.split("_", 1)[0])
        if version <= current:
            continue
        sql = file.read_text(encoding="utf-8")
        conn.executescript(
            f"BEGIN;\n{sql}\nINSERT INTO schema_version (version) VALUES ({version});\nCOMMIT;"
        )
        current = version
    return current


def init_db(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with connection(path) as conn:
        conn.execute("PRAGMA journal_mode = WAL")
        migrate(conn)
```

`backend/app/migrations/001_init.sql`:

```sql
-- 계정과 세션 (spec 3.1). 세션은 토큰의 SHA-256 해시만 둔다.
CREATE TABLE users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    tier TEXT NOT NULL DEFAULT 'member' CHECK (tier IN ('member', 'premium')),
    tickets INTEGER NOT NULL DEFAULT 0 CHECK (tickets >= 0),
    is_admin INTEGER NOT NULL DEFAULT 0 CHECK (is_admin IN (0, 1)),
    name TEXT,
    age INTEGER,
    created_at TEXT NOT NULL
);

CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
);

CREATE INDEX sessions_user ON sessions(user_id);
```

- [ ] **Step 4: 통과 확인**

Run: `uv run pytest tests/test_db.py -q`
Expected: PASS (5 passed)

- [ ] **Step 5: 커밋**

```bash
uv run ruff check --fix . && uv run ruff format . && uv run pytest -q
git add app/db.py app/migrations/001_init.sql tests/test_db.py
git commit -m "feat(backend): sqlite3 연결·트랜잭션·번호순 마이그레이션(schema_version)과 users·sessions 테이블"
```

---

### Task 5: 비밀번호 해시·세션 토큰·요청 수 제한

**Files:**
- Create: `backend/app/security.py`, `backend/tests/__init__.py`, `backend/tests/fakes.py`
- Modify: `backend/pyproject.toml`, `backend/uv.lock` (`uv add argon2-cffi`)
- Test: `backend/tests/test_security.py`

**Interfaces:**
- Produces:
  - `app.security.hash_password(password: str) -> str`, `verify_password(password_hash: str, password: str) -> bool`, `burn_password_check(password: str) -> None`
  - `app.security.new_session_token() -> str`, `hash_token(token: str) -> str`
  - `app.security.RateLimiter(clock: Callable[[], float] = time.monotonic)` — `allow(key: str, limit: int, window: float = 60.0) -> bool`
  - `app.security.client_ip(request: Request) -> str`
  - `tests.fakes.FakeClock(start: float = 1_760_000_000.0)` — 부르면 현재 값, `advance(seconds: float) -> None`

- [ ] **Step 1: 의존성 추가**

Run: `uv add argon2-cffi`
Expected: `pyproject.toml`의 `dependencies`에 `argon2-cffi>=...`가 생기고 `uv.lock`이 갱신된다.

- [ ] **Step 2: 실패하는 테스트 작성**

`backend/tests/__init__.py`: 빈 파일(`tests`를 정규 패키지로 만들어 `from tests.fakes import ...`가 항상 이 폴더를 가리키게 한다).

`backend/tests/fakes.py`:

```python
"""테스트용 가짜 — 시계(요청 수 제한·세션 만료·하루 상한)."""


class FakeClock:
    def __init__(self, start: float = 1_760_000_000.0) -> None:
        self.now = start

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds
```

`backend/tests/test_security.py`:

```python
from starlette.requests import Request

from app.security import (
    RateLimiter,
    burn_password_check,
    client_ip,
    hash_password,
    hash_token,
    new_session_token,
    verify_password,
)
from tests.fakes import FakeClock


def test_password_round_trip():
    h = hash_password("password123")
    assert h.startswith("$argon2")
    assert verify_password(h, "password123")
    assert not verify_password(h, "password124")


def test_verify_rejects_garbage_hash():
    assert not verify_password("not-a-hash", "password123")


def test_burn_password_check_does_not_raise():
    assert burn_password_check("anything") is None


def test_session_token_and_hash():
    token = new_session_token()
    assert len(token) >= 43
    assert token != new_session_token()
    digest = hash_token(token)
    assert len(digest) == 64
    assert digest == hash_token(token)
    assert digest != token


def test_rate_limiter_sliding_window():
    clock = FakeClock()
    limiter = RateLimiter(clock)
    assert [limiter.allow("login:1.1.1.1", 3) for _ in range(4)] == [True, True, True, False]
    assert limiter.allow("login:2.2.2.2", 3)  # 키마다 따로 센다
    clock.advance(59)
    assert not limiter.allow("login:1.1.1.1", 3)
    clock.advance(1)
    assert limiter.allow("login:1.1.1.1", 3)


def _request(headers: dict[str, str], client: tuple[str, int] = ("9.9.9.9", 1234)) -> Request:
    raw = [(k.lower().encode(), v.encode()) for k, v in headers.items()]
    scope = {
        "type": "http",
        "method": "GET",
        "path": "/",
        "query_string": b"",
        "headers": raw,
        "client": client,
    }
    return Request(scope)


def test_client_ip_prefers_cloudflare_header():
    assert client_ip(_request({"CF-Connecting-IP": "1.2.3.4"})) == "1.2.3.4"
    assert client_ip(_request({})) == "9.9.9.9"
```

- [ ] **Step 3: 실패 확인**

Run: `uv run pytest tests/test_security.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.security'`

- [ ] **Step 4: 구현**

`backend/app/security.py`:

```python
"""비밀번호 해시, 세션 토큰, 메모리 요청 수 제한 (spec 4.1)."""

import hashlib
import secrets
import time
from collections import deque
from collections.abc import Callable
from functools import cache

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from fastapi import Request

_hasher = PasswordHasher()


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    try:
        return _hasher.verify(password_hash, password)
    except (VerificationError, InvalidHashError):
        return False


@cache
def _dummy_hash() -> str:
    return _hasher.hash("momo-dummy-password-for-timing")


def burn_password_check(password: str) -> None:
    """계정이 없어도 같은 시간 동안 검증한다(응답 시간으로 가입 여부를 흘리지 않게)."""
    verify_password(_dummy_hash(), password)


def new_session_token() -> str:
    return secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


class RateLimiter:
    """키마다 최근 window초의 요청 시각을 든다. 워커 1개라 메모리로 충분하다."""

    def __init__(self, clock: Callable[[], float] = time.monotonic) -> None:
        self._clock = clock
        self._hits: dict[str, deque[float]] = {}

    def allow(self, key: str, limit: int, window: float = 60.0) -> bool:
        now = self._clock()
        hits = self._hits.setdefault(key, deque())
        while hits and hits[0] <= now - window:
            hits.popleft()
        if len(hits) >= limit:
            return False
        hits.append(now)
        return True


def client_ip(request: Request) -> str:
    forwarded = request.headers.get("cf-connecting-ip")
    if forwarded and forwarded.strip():
        return forwarded.strip()
    return request.client.host if request.client else "unknown"
```

- [ ] **Step 5: 통과 확인**

Run: `uv run pytest tests/test_security.py -q`
Expected: PASS (6 passed)

- [ ] **Step 6: 커밋**

```bash
uv run ruff check --fix . && uv run ruff format . && uv run pytest -q
git add pyproject.toml uv.lock app/security.py tests/__init__.py tests/fakes.py tests/test_security.py
git commit -m "feat(backend): argon2 비밀번호 해시·세션 토큰 해시·IP별 메모리 요청 수 제한"
```

---

### Task 6: 앱 조립 — `create_app(settings, clock)`, 오류 형식, CORS(credentials), Origin 확인, 기동 시 DB

**Files:**
- Create: `backend/app/errors.py`, `backend/app/middleware.py`, `backend/app/startup.py`, `backend/tests/helpers.py`
- Modify: `backend/app/main.py`, `backend/tests/conftest.py`, `backend/tests/test_cors.py`
- Test: `backend/tests/test_app.py`, `backend/tests/test_cors.py`

**Interfaces:**
- Consumes: `Settings`(Task 3), `new_id`(Task 3), `db.init_db`·`db.connection`(Task 4), `RateLimiter`(Task 5), `FakeClock`(Task 5)
- Produces:
  - `app.main.create_app(data_dir: Path | None = None, settings: Settings | None = None, clock: Callable[[], float] = time.time) -> FastAPI` — `app.state.settings`, `app.state.clock`, `app.state.limiter`
  - `app.errors.ApiError(status: int, code: str, **extra: object)`, `app.errors.install_error_handlers(app: FastAPI) -> None`
  - `app.middleware.OriginGuard(app: ASGIApp, allowed: tuple[str, ...])`, `STATE_CHANGING`
  - `app.startup.prepare_storage(settings: Settings, now: float) -> None`
  - 픽스처 `clock`, `settings`(임시 `DATA_DIR`, `cookie_secure=False`, 관리자 `admin`/`admin-pass-1234`), `make_client(settings) -> TestClient`, `client`
  - `tests.helpers`: `ORIGIN`, `PASSWORD`, `ADMIN_LOGIN`, `ADMIN_PASSWORD`, `T0`, `COMPANY_START`, `ADMISSION_START`, `open_db(settings)`, `signup(client, email="a@b.com", name="이우진", password=PASSWORD) -> dict`, `logout(client)`, `login_admin(client) -> dict`, `make_premium(settings, user_id, tickets=10)`, `start_ben(client, body=None) -> str`, `archive_body(**over) -> dict`, `insert_premium_interview(conn, user_id, *, status="done", track="company") -> str`, `insert_recording(conn, *, archive_id, user_id, turn, path, size=10, mime="audio/webm") -> str`, `sse_events(body: str) -> list[tuple[str, dict]]`

- [ ] **Step 1: 테스트 도우미와 픽스처 작성**

`backend/tests/helpers.py` (뒤 Task들이 쓰는 도우미까지 한 번에 둔다. 아직 없는 엔드포인트·테이블을 쓰는 도우미는 그 Task에서 처음 불린다):

```python
"""테스트 공용 도우미. 화면 흐름(가입·로그인·벤 시작)과 SQL 직접 삽입을 짧게 부른다."""

import json
import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

from fastapi.testclient import TestClient

from app import db
from app.config import Settings
from app.ids import new_id

ORIGIN = "http://localhost:5173"
PASSWORD = "password123"
ADMIN_LOGIN = "admin"
ADMIN_PASSWORD = "admin-pass-1234"
T0 = "2026-10-13T04:00:00.000Z"

COMPANY_START = {
    "track": "company",
    "resumeText": "백엔드 3년차, 결제 시스템 개발",
    "company": {"field": "it", "job": "백엔드 개발자"},
}
ADMISSION_START = {
    "track": "admission",
    "resumeText": "로봇 동아리에서 자율주행을 탐구했습니다",
    "admission": {"name": "홍길동", "age": 19, "university": "한국대학교", "department": "컴퓨터공학과"},
}


@contextmanager
def open_db(settings: Settings) -> Iterator[sqlite3.Connection]:
    with db.connection(settings.db_path) as conn:
        yield conn


def signup(
    client: TestClient, email: str = "a@b.com", name: str = "이우진", password: str = PASSWORD
) -> dict[str, Any]:
    body = {"email": email, "password": password, "name": name, "consent": True}
    res = client.post("/api/auth/signup", json=body)
    assert res.status_code == 201, res.text
    return res.json()


def logout(client: TestClient) -> None:
    assert client.post("/api/auth/logout").status_code == 204


def login_admin(client: TestClient) -> dict[str, Any]:
    res = client.post("/api/auth/login", json={"email": ADMIN_LOGIN, "password": ADMIN_PASSWORD})
    assert res.status_code == 200, res.text
    return res.json()


def make_premium(settings: Settings, user_id: str, tickets: int = 10) -> None:
    with open_db(settings) as conn:
        conn.execute(
            "UPDATE users SET tier = 'premium', tickets = ? WHERE id = ?", (tickets, user_id)
        )


def start_ben(client: TestClient, body: dict[str, Any] | None = None) -> str:
    login_admin(client)
    assert client.post("/api/premium/purchase").status_code == 200
    res = client.post("/api/premium/interviews", json=body or COMPANY_START)
    assert res.status_code == 201, res.text
    return res.json()["interviewId"]


def archive_body(**over: Any) -> dict[str, Any]:
    body: dict[str, Any] = {
        "interviewerId": "m1",
        "premium": False,
        "track": "company",
        "startedAt": T0,
        "endedAt": "2026-10-13T04:21:00.000Z",
        "questionCount": 5,
        "hasRecording": False,
        "field": "it",
        "job": "백엔드 개발자",
        "messages": [{"role": "model", "text": "자기소개를 해 주세요.", "at": 1760000000000}],
        "report": [{"question": "자기소개", "answerSummary": "요약", "feedback": "**구체적으로**"}],
        "reportRaw": '[{"question": "자기소개"}]',
        "recordings": [],
    }
    body.update(over)
    return body


def insert_premium_interview(
    conn: sqlite3.Connection, user_id: str, *, status: str = "done", track: str = "company"
) -> str:
    interview_id = new_id("pi")
    conn.execute(
        "INSERT INTO premium_interviews (id, user_id, track, inputs_json, status, created_at)"
        " VALUES (?, ?, ?, '{}', ?, ?)",
        (interview_id, user_id, track, status, T0),
    )
    return interview_id


def insert_recording(
    conn: sqlite3.Connection,
    *,
    archive_id: str,
    user_id: str,
    turn: int,
    path: str,
    size: int = 10,
    mime: str = "audio/webm",
) -> str:
    recording_id = new_id("rec")
    conn.execute(
        "INSERT INTO recordings (id, archive_id, user_id, turn, path, mime, bytes, created_at)"
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (recording_id, archive_id, user_id, turn, path, mime, size, T0),
    )
    return recording_id


def sse_events(body: str) -> list[tuple[str, dict[str, Any]]]:
    events = []
    for block in body.strip().split("\n\n"):
        fields = dict(line.split(": ", 1) for line in block.splitlines())
        events.append((fields["event"], json.loads(fields["data"])))
    return events
```

`backend/tests/conftest.py` 전체를 아래로 바꾼다(`repo_manifest`·`broken_data_dir`는 그대로 옮긴다):

```python
import json
from collections.abc import Callable, Iterator
from contextlib import ExitStack
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from tests.fakes import FakeClock
from tests.helpers import ADMIN_LOGIN, ADMIN_PASSWORD, ORIGIN

REPO_DATA = Path(__file__).resolve().parents[1] / "data"


@pytest.fixture
def clock() -> FakeClock:
    return FakeClock()


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    # 테스트마다 새 DATA_DIR. 관리자 계정은 Task 14부터 기동 때 만들어진다.
    return Settings(
        storage_dir=tmp_path / "storage",
        cookie_secure=False,
        admin_login=ADMIN_LOGIN,
        admin_password=ADMIN_PASSWORD,
    )


@pytest.fixture
def make_client(clock: FakeClock) -> Iterator[Callable[[Settings], TestClient]]:
    with ExitStack() as stack:

        def _make(s: Settings) -> TestClient:
            app = create_app(settings=s, clock=clock)
            return stack.enter_context(TestClient(app, headers={"Origin": ORIGIN}))

        yield _make


@pytest.fixture
def client(make_client: Callable[[Settings], TestClient], settings: Settings) -> TestClient:
    return make_client(settings)


@pytest.fixture
def repo_manifest() -> dict:
    return json.loads((REPO_DATA / "manifest.json").read_text(encoding="utf-8"))


@pytest.fixture
def broken_data_dir(tmp_path: Path) -> Path:
    (tmp_path / "manifest.json").write_text("{ broken", encoding="utf-8")
    (tmp_path / "questions").mkdir()
    return tmp_path
```

- [ ] **Step 2: 실패하는 테스트 작성**

`backend/tests/test_cors.py` 전체를 아래로 바꾼다:

```python
import pytest


def test_vite_dev_origin_is_allowed_with_credentials(client):
    res = client.get("/api/health", headers={"Origin": "http://localhost:5173"})
    assert res.headers.get("access-control-allow-origin") == "http://localhost:5173"
    assert res.headers.get("access-control-allow-credentials") == "true"


@pytest.mark.parametrize("origin", ["https://momo.ssenu.cloud", "https://demomo.ssenu.cloud"])
def test_site_origins_are_allowed(client, origin):
    res = client.get("/api/health", headers={"Origin": origin})
    assert res.headers.get("access-control-allow-origin") == origin


def test_other_origin_is_not_allowed(client):
    res = client.get("/api/health", headers={"Origin": "https://evil.example"})
    assert "access-control-allow-origin" not in res.headers


def test_preflight_allows_post_with_credentials(client):
    res = client.options(
        "/api/auth/login",
        headers={
            "Origin": "https://demomo.ssenu.cloud",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        },
    )
    assert res.status_code == 200
    assert "POST" in res.headers["access-control-allow-methods"]
    assert res.headers["access-control-allow-credentials"] == "true"
```

`backend/tests/test_app.py`:

```python
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import BaseModel, Field

from app.errors import ApiError, install_error_handlers
from app.main import create_app


def test_post_with_foreign_origin_is_rejected(client):
    res = client.post("/api/health", headers={"Origin": "https://evil.example"})
    assert res.status_code == 403
    assert res.json() == {"error": "bad_origin"}


def test_post_without_origin_is_rejected(client):
    del client.headers["origin"]
    res = client.post("/api/health")
    assert res.status_code == 403
    assert res.json() == {"error": "bad_origin"}


def test_post_with_allowed_origin_reaches_router(client):
    # /api/health는 GET뿐이라 405 — Origin 확인은 통과했다는 뜻
    assert client.post("/api/health").status_code == 405


def test_get_is_not_origin_checked(client):
    assert client.get("/api/health", headers={"Origin": "https://evil.example"}).status_code == 200


def test_startup_creates_database_and_recordings_dir(client, settings):
    assert settings.db_path.exists()
    assert settings.recordings_dir.is_dir()


def test_create_app_reads_settings_from_env(monkeypatch, tmp_path):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    app = create_app()
    assert app.state.settings.storage_dir == tmp_path


def test_error_shapes():
    app = FastAPI()
    install_error_handlers(app)

    class Body(BaseModel):
        title: str = Field(max_length=3)

    @app.post("/x")
    def x(body: Body) -> dict:
        return {}

    @app.get("/boom")
    def boom() -> dict:
        raise ApiError(409, "slot_full", kind="company")

    c = TestClient(app)
    res = c.post("/x", json={"title": "toolong"})
    assert res.status_code == 422
    assert res.json() == {"error": "invalid", "field": "title"}
    res = c.get("/boom")
    assert res.status_code == 409
    assert res.json() == {"error": "slot_full", "kind": "company"}
```

- [ ] **Step 3: 실패 확인**

Run: `uv run pytest tests/test_app.py tests/test_cors.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.errors'`(conftest의 `create_app(settings=..., clock=...)`도 아직 `TypeError`)

- [ ] **Step 4: 구현**

`backend/app/errors.py`:

```python
"""오류 응답 형식 하나: {"error": code, ...추가 필드} (docs/API.md 공통)."""

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse


class ApiError(Exception):
    def __init__(self, status: int, code: str, **extra: object) -> None:
        super().__init__(code)
        self.status = status
        self.code = code
        self.extra = extra


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def _api_error(_: Request, exc: ApiError) -> JSONResponse:
        return JSONResponse({"error": exc.code, **exc.extra}, status_code=exc.status)

    @app.exception_handler(RequestValidationError)
    async def _validation(_: Request, exc: RequestValidationError) -> JSONResponse:
        errors = exc.errors()
        loc = errors[0].get("loc", ()) if errors else ()
        names = [str(p) for p in reversed(loc) if isinstance(p, str) and p != "body"]
        body: dict[str, object] = {"error": "invalid"}
        if names:
            body["field"] = names[0]
        return JSONResponse(body, status_code=422)
```

`backend/app/middleware.py`:

```python
"""상태를 바꾸는 요청의 Origin 확인 (spec 4.1 CORS·CSRF)."""

from starlette.datastructures import Headers
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send

STATE_CHANGING = frozenset({"POST", "PUT", "PATCH", "DELETE"})


class OriginGuard:
    def __init__(self, app: ASGIApp, allowed: tuple[str, ...]) -> None:
        self.app = app
        self.allowed = frozenset(allowed)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if (
            scope["type"] == "http"
            and scope["method"] in STATE_CHANGING
            and scope["path"].startswith("/api/")
            and Headers(scope=scope).get("origin") not in self.allowed
        ):
            response = JSONResponse({"error": "bad_origin"}, status_code=403)
            await response(scope, receive, send)
            return
        await self.app(scope, receive, send)
```

`backend/app/startup.py`:

```python
"""기동 시 저장소 준비 (spec 3절 db)."""

from app import db
from app.config import Settings


def prepare_storage(settings: Settings, now: float) -> None:
    db.init_db(settings.db_path)
    settings.recordings_dir.mkdir(parents=True, exist_ok=True)
```

`backend/app/main.py` 전체를 아래로 바꾼다:

```python
import time
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import Settings
from app.data import (
    DATA_DIR,
    MANIFEST_FILENAME,
    QUESTIONS_DIRNAME,
    load_manifest,
    load_question_sets,
)
from app.errors import install_error_handlers
from app.middleware import OriginGuard
from app.routers import health, manifest, questions
from app.security import RateLimiter
from app.startup import prepare_storage


def create_app(
    data_dir: Path | None = None,
    settings: Settings | None = None,
    clock: Callable[[], float] = time.time,
) -> FastAPI:
    base = data_dir or DATA_DIR
    cfg = settings or Settings.from_env()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        # 깨진 파일은 여기서 예외를 던져 기동 자체를 실패시킨다.
        app.state.manifest = load_manifest(base / MANIFEST_FILENAME)
        app.state.question_sets = load_question_sets(base / QUESTIONS_DIRNAME)
        prepare_storage(cfg, clock())
        yield

    app = FastAPI(title="Woo-MoMo API", docs_url=None, redoc_url=None, lifespan=lifespan)
    app.state.settings = cfg
    app.state.clock = clock
    app.state.limiter = RateLimiter(clock)
    install_error_handlers(app)
    # 마지막에 넣은 미들웨어가 가장 바깥: CORS(프리플라이트) → Origin 확인 → 라우터
    app.add_middleware(OriginGuard, allowed=cfg.cors_origins)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(cfg.cors_origins),
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "DELETE"],
        allow_headers=["Content-Type"],
    )
    app.include_router(health.router, prefix="/api")
    app.include_router(manifest.router, prefix="/api")
    app.include_router(questions.router, prefix="/api")
    return app


app = create_app()
```

- [ ] **Step 5: 통과 확인**

Run: `uv run pytest -q`
Expected: PASS — 새 테스트와 기존 테스트(`test_manifest.py`·`test_questions.py`·`test_health.py`·`test_data.py`·`test_schemas.py`) 모두 통과

- [ ] **Step 6: 커밋**

```bash
uv run ruff check --fix . && uv run ruff format . && uv run pytest -q
git add app/errors.py app/middleware.py app/startup.py app/main.py tests/helpers.py tests/conftest.py tests/test_cors.py tests/test_app.py
git commit -m "feat(backend): create_app에 설정·시계 주입, 오류 형식, CORS credentials, Origin 확인, 기동 시 DB 준비"
```

---

### Task 7: users·sessions 저장소

**Files:**
- Create: `backend/app/repos/__init__.py`(빈 파일), `backend/app/repos/users.py`, `backend/app/repos/sessions.py`
- Test: `backend/tests/test_repo_users.py`

**Interfaces:**
- Consumes: `db`(Task 4), `new_id`(Task 3)
- Produces:
  - `app.repos.users.User` (frozen dataclass): `id, email, password_hash, tier, tickets, is_admin: bool, name: str | None, age: int | None, created_at`
  - `app.repos.users.EmailTaken(Exception)`, `normalize_login(raw: str) -> str`
  - `get_by_id(conn, user_id) -> User | None`, `get_by_email(conn, email) -> User | None`, `email_exists(conn, email) -> bool`
  - `create_user(conn, *, email, password_hash, name, created_at) -> User` (중복이면 `EmailTaken`)
  - `update_profile(conn, user_id, *, name, age) -> User`
  - `app.repos.sessions.SESSION_DAYS = 30`, `SESSION_SECONDS = 2_592_000`
  - `create_session(conn, *, token_hash, user_id, now: float) -> None`, `user_for_token(conn, *, token_hash, now: float) -> User | None`(만료면 지우고 None), `delete_session(conn, token_hash) -> None`

- [ ] **Step 1: 실패하는 테스트 작성**

`backend/tests/test_repo_users.py`:

```python
import pytest

from app import db
from app.repos import sessions, users
from tests.helpers import T0


@pytest.fixture
def conn(tmp_path):
    path = tmp_path / "t.sqlite3"
    db.init_db(path)
    with db.connection(path) as c:
        yield c


def _make(conn, email="a@b.com"):
    return users.create_user(conn, email=email, password_hash="h", name="이우진", created_at=T0)


def test_create_and_get_user(conn):
    u = _make(conn)
    assert u.id.startswith("u_")
    assert (u.tier, u.tickets, u.is_admin) == ("member", 0, False)
    assert (u.name, u.age, u.created_at) == ("이우진", None, T0)
    assert users.get_by_email(conn, "a@b.com") == u
    assert users.get_by_id(conn, u.id) == u
    assert users.email_exists(conn, "a@b.com")
    assert not users.email_exists(conn, "x@b.com")


def test_duplicate_email_raises(conn):
    _make(conn)
    with pytest.raises(users.EmailTaken):
        _make(conn)


def test_normalize_login():
    assert users.normalize_login("  A@B.Com ") == "a@b.com"


def test_update_profile(conn):
    u = _make(conn)
    updated = users.update_profile(conn, u.id, name=None, age=19)
    assert (updated.name, updated.age) == (None, 19)


def test_session_lifecycle(conn):
    u = _make(conn)
    start = 1_000.0
    sessions.create_session(conn, token_hash="h1", user_id=u.id, now=start)
    almost = start + sessions.SESSION_SECONDS - 1
    assert sessions.user_for_token(conn, token_hash="h1", now=almost) == u
    assert sessions.user_for_token(conn, token_hash="nope", now=start) is None
    expired = start + sessions.SESSION_SECONDS
    assert sessions.user_for_token(conn, token_hash="h1", now=expired) is None
    # 만료 세션은 조회할 때 지운다
    assert conn.execute("SELECT COUNT(*) FROM sessions").fetchone()[0] == 0


def test_delete_session(conn):
    u = _make(conn)
    sessions.create_session(conn, token_hash="h1", user_id=u.id, now=0)
    sessions.delete_session(conn, "h1")
    assert sessions.user_for_token(conn, token_hash="h1", now=0) is None


def test_session_lasts_30_days():
    assert sessions.SESSION_SECONDS == 30 * 24 * 60 * 60
```

- [ ] **Step 2: 실패 확인**

Run: `uv run pytest tests/test_repo_users.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.repos'`

- [ ] **Step 3: 구현**

`backend/app/repos/__init__.py`: 빈 파일.

`backend/app/repos/users.py`:

```python
"""users 테이블 SQL (spec 3.1). 트랜잭션은 부르는 쪽이 정한다."""

import sqlite3
from dataclasses import dataclass

from app.ids import new_id


@dataclass(frozen=True)
class User:
    id: str
    email: str
    password_hash: str
    tier: str
    tickets: int
    is_admin: bool
    name: str | None
    age: int | None
    created_at: str


class EmailTaken(Exception):
    """같은 이메일(로그인 아이디)이 이미 있다."""


def normalize_login(raw: str) -> str:
    """이메일·관리자 아이디 공통: 앞뒤 공백 제거 + 소문자."""
    return raw.strip().lower()


def _user(row: sqlite3.Row | None) -> User | None:
    if row is None:
        return None
    return User(
        id=row["id"],
        email=row["email"],
        password_hash=row["password_hash"],
        tier=row["tier"],
        tickets=row["tickets"],
        is_admin=bool(row["is_admin"]),
        name=row["name"],
        age=row["age"],
        created_at=row["created_at"],
    )


def _require(user: User | None) -> User:
    if user is None:
        raise LookupError("user row disappeared")
    return user


def get_by_id(conn: sqlite3.Connection, user_id: str) -> User | None:
    return _user(conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone())


def get_by_email(conn: sqlite3.Connection, email: str) -> User | None:
    return _user(conn.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone())


def email_exists(conn: sqlite3.Connection, email: str) -> bool:
    return conn.execute("SELECT 1 FROM users WHERE email = ?", (email,)).fetchone() is not None


def create_user(
    conn: sqlite3.Connection, *, email: str, password_hash: str, name: str | None, created_at: str
) -> User:
    user_id = new_id("u")
    try:
        conn.execute(
            "INSERT INTO users (id, email, password_hash, name, created_at)"
            " VALUES (?, ?, ?, ?, ?)",
            (user_id, email, password_hash, name, created_at),
        )
    except sqlite3.IntegrityError as exc:
        raise EmailTaken(email) from exc
    return _require(get_by_id(conn, user_id))


def update_profile(
    conn: sqlite3.Connection, user_id: str, *, name: str | None, age: int | None
) -> User:
    conn.execute("UPDATE users SET name = ?, age = ? WHERE id = ?", (name, age, user_id))
    return _require(get_by_id(conn, user_id))
```

`backend/app/repos/sessions.py`:

```python
"""sessions 테이블 SQL (spec 4.1). DB에는 토큰의 SHA-256 해시만 둔다."""

import sqlite3

from app.repos import users
from app.repos.users import User

SESSION_DAYS = 30
SESSION_SECONDS = SESSION_DAYS * 24 * 60 * 60


def create_session(
    conn: sqlite3.Connection, *, token_hash: str, user_id: str, now: float
) -> None:
    conn.execute(
        "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)",
        (token_hash, user_id, int(now) + SESSION_SECONDS),
    )


def user_for_token(conn: sqlite3.Connection, *, token_hash: str, now: float) -> User | None:
    row = conn.execute(
        "SELECT user_id, expires_at FROM sessions WHERE token_hash = ?", (token_hash,)
    ).fetchone()
    if row is None:
        return None
    if row["expires_at"] <= now:
        delete_session(conn, token_hash)
        return None
    return users.get_by_id(conn, row["user_id"])


def delete_session(conn: sqlite3.Connection, token_hash: str) -> None:
    conn.execute("DELETE FROM sessions WHERE token_hash = ?", (token_hash,))
```

- [ ] **Step 4: 통과 확인**

Run: `uv run pytest tests/test_repo_users.py -q`
Expected: PASS (7 passed)

- [ ] **Step 5: 커밋**

```bash
uv run ruff check --fix . && uv run ruff format . && uv run pytest -q
git add app/repos/__init__.py app/repos/users.py app/repos/sessions.py tests/test_repo_users.py
git commit -m "feat(backend): users·sessions 저장소 — 이메일 정규화, 30일 세션, 만료 시 삭제"
```

---

### Task 8: 가입·로그인·로그아웃·`GET /api/me` (요청 수 제한 포함)

**Files:**
- Create: `backend/app/deps.py`, `backend/app/presenters.py`, `backend/app/routers/auth.py`, `backend/app/routers/me.py`
- Modify: `backend/app/schemas.py`, `backend/app/main.py`
- Test: `backend/tests/test_auth.py`

**Interfaces:**
- Consumes: `users`·`sessions`(Task 7), `security`(Task 5), `ApiError`(Task 6), `iso`(Task 3), `db.connect`·`db.transaction`(Task 4)
- Produces:
  - `app.deps.COOKIE_NAME = "momo_session"`, `get_db(request) -> Iterator[sqlite3.Connection]`, `current_user(request, conn) -> User | None`, `require_user(user) -> User`(없으면 `401 unauthorized`), `require_premium(user) -> User`(`tier != "premium"`이면 `403 premium_required`)
  - 타입 별칭 `Db`, `CurrentUser`, `LoggedInUser`, `PremiumUser` (`Annotated[..., Depends(...)]`)
  - `app.presenters.to_session(user: User) -> Session`
  - `app.schemas`: `Tier`, `Profile`, `Session`, `SignupBody`, `LoginBody`
  - `app.routers.auth`: `EMAIL_RE`, `EMAIL_MAX = 254`, `PASSWORD_MIN = 8`, `NAME_MAX = 100`, `SIGNUP_PER_MINUTE = 10`, `LOGIN_PER_MINUTE = 10`, `rate_limit(request, bucket: str, per_minute: int) -> None`, `is_email(value: str) -> bool`; `POST /api/auth/signup`(201), `POST /api/auth/login`, `POST /api/auth/logout`(204)
  - `app.routers.me`: `GET /api/me` → `Session | null`

- [ ] **Step 1: 실패하는 테스트 작성**

`backend/tests/test_auth.py`:

```python
from dataclasses import replace

import pytest

from app.repos.sessions import SESSION_SECONDS
from app.security import hash_token
from tests.helpers import PASSWORD, logout, open_db, signup

SIGNUP = "/api/auth/signup"
LOGIN = "/api/auth/login"


def _body(**over):
    body = {"email": "a@b.com", "password": PASSWORD, "name": "이우진", "consent": True}
    body.update(over)
    return body


def test_signup_returns_session_and_sets_cookie(client):
    res = client.post(SIGNUP, json=_body(email="  A@B.com "))
    assert res.status_code == 201
    body = res.json()
    assert body["userId"].startswith("u_")
    assert body == {
        "userId": body["userId"],
        "email": "a@b.com",
        "tier": "member",
        "tickets": 0,
        "isAdmin": False,
        "profile": {"name": "이우진", "age": None},
        "createdAt": "2025-10-09T08:53:20.000Z",
    }
    cookie = res.headers["set-cookie"].lower()
    for part in ("momo_session=", "httponly", "path=/api", "samesite=lax", f"max-age={SESSION_SECONDS}"):
        assert part in cookie
    assert "secure" not in cookie


def test_cookie_is_secure_when_configured(make_client, settings):
    c = make_client(replace(settings, cookie_secure=True))
    res = c.post(SIGNUP, json=_body())
    assert "secure" in res.headers["set-cookie"].lower()


def test_only_token_hash_is_stored(client, settings):
    res = client.post(SIGNUP, json=_body())
    token = res.cookies["momo_session"]
    with open_db(settings) as conn:
        rows = [r["token_hash"] for r in conn.execute("SELECT token_hash FROM sessions")]
    assert rows == [hash_token(token)]


@pytest.mark.parametrize(
    ("over", "code", "field"),
    [
        ({"email": "not-an-email"}, "invalid_email", "email"),
        ({"password": "short7c"}, "weak_password", "password"),
        ({"name": "   "}, "missing_name", "name"),
        ({"name": "가" * 101}, "invalid", "name"),
        ({"consent": False}, "consent_required", "consent"),
        ({"consent": None}, "consent_required", "consent"),
    ],
)
def test_signup_validation(client, over, code, field):
    res = client.post(SIGNUP, json=_body(**over))
    assert res.status_code == 422
    assert res.json() == {"error": code, "field": field}


def test_signup_without_consent_key(client):
    body = _body()
    del body["consent"]
    res = client.post(SIGNUP, json=body)
    assert res.json() == {"error": "consent_required", "field": "consent"}


def test_duplicate_email_is_409(client):
    signup(client)
    res = client.post(SIGNUP, json=_body(email="A@b.com"))
    assert res.status_code == 409
    assert res.json() == {"error": "email_taken"}


def test_me_is_null_without_session(client):
    res = client.get("/api/me")
    assert res.status_code == 200
    assert res.json() is None


def test_me_returns_session_after_signup(client):
    session = signup(client)
    assert client.get("/api/me").json() == session


def test_login_success(client):
    signup(client)
    logout(client)
    assert client.get("/api/me").json() is None
    res = client.post(LOGIN, json={"email": " A@B.COM", "password": PASSWORD})
    assert res.status_code == 200
    assert res.json()["email"] == "a@b.com"
    assert client.get("/api/me").json()["email"] == "a@b.com"


def test_login_failures_share_one_error(client):
    signup(client)
    logout(client)
    wrong = client.post(LOGIN, json={"email": "a@b.com", "password": "wrongpass1"})
    missing = client.post(LOGIN, json={"email": "nobody@b.com", "password": PASSWORD})
    not_email = client.post(LOGIN, json={"email": "someone", "password": PASSWORD})
    for res in (wrong, missing, not_email):
        assert res.status_code == 401
        assert res.json() == {"error": "bad_credentials"}


def test_logout_deletes_session_and_cookie(client, settings):
    signup(client)
    res = client.post("/api/auth/logout")
    assert res.status_code == 204
    assert "max-age=0" in res.headers["set-cookie"].lower()
    with open_db(settings) as conn:
        assert conn.execute("SELECT COUNT(*) FROM sessions").fetchone()[0] == 0
    assert client.get("/api/me").json() is None


def test_logout_without_session_is_204(client):
    assert client.post("/api/auth/logout").status_code == 204


def test_session_expires_after_30_days(client, clock, settings):
    signup(client)
    clock.advance(SESSION_SECONDS - 1)
    assert client.get("/api/me").json() is not None
    clock.advance(1)
    assert client.get("/api/me").json() is None
    with open_db(settings) as conn:
        assert conn.execute("SELECT COUNT(*) FROM sessions").fetchone()[0] == 0


def test_login_is_rate_limited_per_ip(client, clock):
    body = {"email": "nobody@b.com", "password": PASSWORD}
    for _ in range(10):
        assert client.post(LOGIN, json=body).status_code == 401
    res = client.post(LOGIN, json=body)
    assert res.status_code == 429
    assert res.json() == {"error": "rate_limited"}
    other = client.post(LOGIN, json=body, headers={"CF-Connecting-IP": "203.0.113.7"})
    assert other.status_code == 401
    clock.advance(60)
    assert client.post(LOGIN, json=body).status_code == 401


def test_signup_is_rate_limited_per_ip(client):
    for _ in range(10):
        assert client.post(SIGNUP, json=_body(email="bad")).status_code == 422
    res = client.post(SIGNUP, json=_body(email="bad"))
    assert res.status_code == 429
    assert res.json() == {"error": "rate_limited"}
```

- [ ] **Step 2: 실패 확인**

Run: `uv run pytest tests/test_auth.py -q`
Expected: FAIL — `/api/auth/signup`이 404(라우터 없음)여서 `assert 404 == 201` 등으로 실패

- [ ] **Step 3: 구현 — 스키마**

`backend/app/schemas.py` 첫 줄 `from typing import Annotated`를 `from typing import Annotated, Literal`로 바꾸고, 파일 맨 아래에 추가한다:

```python
# ── 계정 (2026-10-13, docs/API.md "계정·이력서·보관함·프리미엄") ──

Tier = Literal["member", "premium"]


class Profile(BaseModel):
    name: str | None
    age: int | None


class Session(BaseModel):
    userId: str
    email: str
    tier: Tier
    tickets: int
    isAdmin: bool
    profile: Profile
    createdAt: str


class SignupBody(BaseModel):
    # 기본값을 둬서 빠진 칸도 라우터가 정해진 오류 코드로 답하게 한다
    email: str = ""
    password: str = ""
    name: str = ""
    consent: bool | None = None


class LoginBody(BaseModel):
    email: str = ""
    password: str = ""
```

- [ ] **Step 4: 구현 — 의존성·표현·라우터**

`backend/app/deps.py`:

```python
"""요청마다 DB 연결과 로그인 사용자를 꺼낸다 (spec 3절 deps)."""

import sqlite3
from collections.abc import Iterator
from typing import Annotated

from fastapi import Depends, Request

from app import db
from app.errors import ApiError
from app.repos import sessions
from app.repos.users import User
from app.security import hash_token

COOKIE_NAME = "momo_session"


def get_db(request: Request) -> Iterator[sqlite3.Connection]:
    with db.connection(request.app.state.settings.db_path) as conn:
        yield conn


Db = Annotated[sqlite3.Connection, Depends(get_db)]


def current_user(request: Request, conn: Db) -> User | None:
    token = request.cookies.get(COOKIE_NAME)
    if not token:
        return None
    now = request.app.state.clock()
    return sessions.user_for_token(conn, token_hash=hash_token(token), now=now)


CurrentUser = Annotated[User | None, Depends(current_user)]


def require_user(user: CurrentUser) -> User:
    if user is None:
        raise ApiError(401, "unauthorized")
    return user


LoggedInUser = Annotated[User, Depends(require_user)]


def require_premium(user: LoggedInUser) -> User:
    if user.tier != "premium":
        raise ApiError(403, "premium_required")
    return user


PremiumUser = Annotated[User, Depends(require_premium)]
```

`backend/app/presenters.py`:

```python
"""저장소 객체 → 응답 스키마."""

from app.repos.users import User
from app.schemas import Profile, Session


def to_session(user: User) -> Session:
    return Session(
        userId=user.id,
        email=user.email,
        tier=user.tier,
        tickets=user.tickets,
        isAdmin=user.is_admin,
        profile=Profile(name=user.name, age=user.age),
        createdAt=user.created_at,
    )
```

`backend/app/routers/auth.py`:

```python
"""가입·로그인·로그아웃 (spec 4.1, docs/API.md 인증)."""

import re
import sqlite3

from fastapi import APIRouter, Request, Response

from app.db import transaction
from app.deps import COOKIE_NAME, Db
from app.errors import ApiError
from app.presenters import to_session
from app.repos import sessions, users
from app.repos.users import User, normalize_login
from app.schemas import LoginBody, Session, SignupBody
from app.security import (
    burn_password_check,
    client_ip,
    hash_password,
    hash_token,
    new_session_token,
    verify_password,
)
from app.timefmt import iso

router = APIRouter()

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
EMAIL_MAX = 254
PASSWORD_MIN = 8
NAME_MAX = 100
SIGNUP_PER_MINUTE = 10
LOGIN_PER_MINUTE = 10


def rate_limit(request: Request, bucket: str, per_minute: int) -> None:
    key = f"{bucket}:{client_ip(request)}"
    if not request.app.state.limiter.allow(key, per_minute):
        raise ApiError(429, "rate_limited")


def is_email(value: str) -> bool:
    return len(value) <= EMAIL_MAX and EMAIL_RE.match(value) is not None


def _cookie_args(request: Request) -> dict[str, object]:
    secure = request.app.state.settings.cookie_secure
    return {"path": "/api", "httponly": True, "samesite": "lax", "secure": secure}


def _start_session(
    request: Request, response: Response, conn: sqlite3.Connection, user: User
) -> None:
    token = new_session_token()
    now = request.app.state.clock()
    sessions.create_session(conn, token_hash=hash_token(token), user_id=user.id, now=now)
    response.set_cookie(
        COOKIE_NAME, token, max_age=sessions.SESSION_SECONDS, **_cookie_args(request)
    )


@router.post("/auth/signup", status_code=201, response_model=Session)
def signup(body: SignupBody, request: Request, response: Response, conn: Db) -> Session:
    rate_limit(request, "signup", SIGNUP_PER_MINUTE)
    email = normalize_login(body.email)
    if not is_email(email):
        raise ApiError(422, "invalid_email", field="email")
    if len(body.password) < PASSWORD_MIN:
        raise ApiError(422, "weak_password", field="password")
    name = body.name.strip()
    if not name:
        raise ApiError(422, "missing_name", field="name")
    if len(name) > NAME_MAX:
        raise ApiError(422, "invalid", field="name")
    if body.consent is not True:
        raise ApiError(422, "consent_required", field="consent")
    password_hash = hash_password(body.password)
    created_at = iso(request.app.state.clock())
    try:
        with transaction(conn):
            user = users.create_user(
                conn, email=email, password_hash=password_hash, name=name, created_at=created_at
            )
            _start_session(request, response, conn, user)
    except users.EmailTaken:
        raise ApiError(409, "email_taken") from None
    return to_session(user)


def _login_allowed(request: Request, login_id: str) -> bool:
    return is_email(login_id)


@router.post("/auth/login", response_model=Session)
def login(body: LoginBody, request: Request, response: Response, conn: Db) -> Session:
    rate_limit(request, "login", LOGIN_PER_MINUTE)
    login_id = normalize_login(body.email)
    user = users.get_by_email(conn, login_id) if _login_allowed(request, login_id) else None
    if user is None:
        burn_password_check(body.password)
        raise ApiError(401, "bad_credentials")
    if not verify_password(user.password_hash, body.password):
        raise ApiError(401, "bad_credentials")
    _start_session(request, response, conn, user)
    return to_session(user)


@router.post("/auth/logout", status_code=204)
def logout(request: Request, conn: Db) -> Response:
    token = request.cookies.get(COOKIE_NAME)
    if token:
        sessions.delete_session(conn, hash_token(token))
    response = Response(status_code=204)
    response.delete_cookie(COOKIE_NAME, **_cookie_args(request))
    return response
```

`backend/app/routers/me.py`:

```python
"""로그인 상태 (spec 4.1). 비로그인은 오류가 아니라 null이다."""

from fastapi import APIRouter

from app.deps import CurrentUser
from app.presenters import to_session
from app.schemas import Session

router = APIRouter()


@router.get("/me", response_model=Session | None)
def me(user: CurrentUser) -> Session | None:
    return to_session(user) if user is not None else None
```

`backend/app/main.py`에서 `from app.routers import health, manifest, questions`를 `from app.routers import auth, health, manifest, me, questions`로 바꾸고, `app.include_router(questions.router, prefix="/api")` 다음 줄에 추가한다:

```python
    app.include_router(auth.router, prefix="/api")
    app.include_router(me.router, prefix="/api")
```

- [ ] **Step 5: 통과 확인**

Run: `uv run pytest tests/test_auth.py -q`
Expected: PASS (20 passed). 이어서 `uv run pytest -q` 전체 PASS.

- [ ] **Step 6: 커밋**

```bash
uv run ruff check --fix . && uv run ruff format . && uv run pytest -q
git add app/deps.py app/presenters.py app/routers/auth.py app/routers/me.py app/schemas.py app/main.py tests/test_auth.py
git commit -m "feat(backend): 가입(consent 필수)·로그인·로그아웃·/api/me — HttpOnly 세션 쿠키, 같은 실패 응답, IP별 요청 수 제한"
```

---

### Task 9: 이메일 중복 확인·`PUT /api/profile`

**Files:**
- Modify: `backend/app/schemas.py`, `backend/app/routers/auth.py`, `backend/app/routers/me.py`
- Test: `backend/tests/test_me.py`

**Interfaces:**
- Consumes: `rate_limit`(Task 8), `users.update_profile`·`users.email_exists`(Task 7), `LoggedInUser`·`Db`(Task 8)
- Produces:
  - `app.schemas.ProfileBody`(`name: str | None` ≤100, `age: int | None` 1~120), `app.schemas.EmailTakenResponse`(`taken: bool`)
  - `app.routers.auth.EMAIL_TAKEN_PER_MINUTE = 20`; `GET /api/auth/email-taken?email=` → `{"taken": bool}`
  - `PUT /api/profile` → `Session`

- [ ] **Step 1: 실패하는 테스트 작성**

`backend/tests/test_me.py`:

```python
import pytest

from tests.helpers import signup

TAKEN = "/api/auth/email-taken"


def test_email_taken(client):
    assert client.get(TAKEN, params={"email": "a@b.com"}).json() == {"taken": False}
    signup(client)
    assert client.get(TAKEN, params={"email": " A@B.com "}).json() == {"taken": True}


def test_email_taken_is_rate_limited(client, clock):
    for _ in range(20):
        assert client.get(TAKEN, params={"email": "x@b.com"}).status_code == 200
    res = client.get(TAKEN, params={"email": "x@b.com"})
    assert res.status_code == 429
    assert res.json() == {"error": "rate_limited"}
    clock.advance(60)
    assert client.get(TAKEN, params={"email": "x@b.com"}).status_code == 200


def test_put_profile(client):
    signup(client)
    res = client.put("/api/profile", json={"name": "  홍길동 ", "age": 19})
    assert res.status_code == 200
    assert res.json()["profile"] == {"name": "홍길동", "age": 19}
    assert client.get("/api/me").json()["profile"] == {"name": "홍길동", "age": 19}
    res = client.put("/api/profile", json={"name": None, "age": None})
    assert res.json()["profile"] == {"name": None, "age": None}


def test_blank_name_becomes_null(client):
    signup(client)
    res = client.put("/api/profile", json={"name": "   ", "age": 20})
    assert res.json()["profile"] == {"name": None, "age": 20}


@pytest.mark.parametrize("age", [0, 121])
def test_put_profile_rejects_age_out_of_range(client, age):
    signup(client)
    res = client.put("/api/profile", json={"name": "홍길동", "age": age})
    assert res.status_code == 422
    assert res.json() == {"error": "invalid", "field": "age"}


def test_put_profile_requires_login(client):
    res = client.put("/api/profile", json={"name": "홍길동", "age": 19})
    assert res.status_code == 401
    assert res.json() == {"error": "unauthorized"}
```

- [ ] **Step 2: 실패 확인**

Run: `uv run pytest tests/test_me.py -q`
Expected: FAIL — `/api/auth/email-taken`·`/api/profile`이 404/405

- [ ] **Step 3: 구현**

`backend/app/schemas.py` 맨 아래에 추가:

```python
class ProfileBody(BaseModel):
    name: str | None = Field(default=None, max_length=100)
    age: int | None = Field(default=None, ge=1, le=120)


class EmailTakenResponse(BaseModel):
    taken: bool
```

`backend/app/routers/auth.py`:
- `from app.schemas import LoginBody, Session, SignupBody`를 `from app.schemas import EmailTakenResponse, LoginBody, Session, SignupBody`로 바꾼다.
- `LOGIN_PER_MINUTE = 10` 다음 줄에 `EMAIL_TAKEN_PER_MINUTE = 20`을 넣는다.
- 파일 맨 아래에 추가:

```python
@router.get("/auth/email-taken", response_model=EmailTakenResponse)
def email_taken(request: Request, conn: Db, email: str = "") -> EmailTakenResponse:
    # 열거 공격에 열려 있다(데모 범위). 요청 수 제한으로만 막는다.
    rate_limit(request, "email-taken", EMAIL_TAKEN_PER_MINUTE)
    return EmailTakenResponse(taken=users.email_exists(conn, normalize_login(email)))
```

`backend/app/routers/me.py` 전체를 아래로 바꾼다:

```python
"""로그인 상태·프로필 (spec 4.1). 비로그인은 오류가 아니라 null이다."""

from fastapi import APIRouter

from app.deps import CurrentUser, Db, LoggedInUser
from app.presenters import to_session
from app.repos import users
from app.schemas import ProfileBody, Session

router = APIRouter()


@router.get("/me", response_model=Session | None)
def me(user: CurrentUser) -> Session | None:
    return to_session(user) if user is not None else None


@router.put("/profile", response_model=Session)
def put_profile(body: ProfileBody, user: LoggedInUser, conn: Db) -> Session:
    name = body.name.strip() if body.name is not None else None
    updated = users.update_profile(conn, user.id, name=name or None, age=body.age)
    return to_session(updated)
```

- [ ] **Step 4: 통과 확인**

Run: `uv run pytest tests/test_me.py -q`
Expected: PASS (7 passed). 이어서 `uv run pytest -q` 전체 PASS.

- [ ] **Step 5: 커밋**

```bash
uv run ruff check --fix . && uv run ruff format . && uv run pytest -q
git add app/schemas.py app/routers/auth.py app/routers/me.py tests/test_me.py
git commit -m "feat(backend): 이메일 중복 확인(IP당 분당 20회)·프로필 수정(age 1~120)"
```

> PR 1 마무리: `git push -u origin feature/accounts-db` → `gh pr create --base dev --title "feat(backend): DB 기반과 계정 — 가입·로그인·세션·프로필·요청 수 제한·Origin 확인"`.

---

## PR 2 — 이력서 슬롯 + 보관함

### Task 10: `002_resumes_archive.sql`과 이력서 저장소(종류별 3개, 동시 요청)

**Files:**
- Create: `backend/app/migrations/002_resumes_archive.sql`, `backend/app/repos/resumes.py`
- Test: `backend/tests/test_repo_resumes.py`

**Interfaces:**
- Consumes: `db.transaction`(Task 4), `new_id`(Task 3), `users.create_user`(Task 7)
- Produces:
  - 테이블 `resumes`, `premium_interviews`, `archive`(`question_count` 포함, `premium_interview_id` 부분 유일 인덱스), `recordings`(`UNIQUE(archive_id, turn)`)
  - `app.repos.resumes.RESUME_SLOTS = 3`, `Resume`(frozen: `id, kind, title, text, updated_at`), `SlotFull(kind)`(속성 `kind`)
  - `list_resumes(conn, user_id) -> list[Resume]`(최근 수정 순), `create_resume(conn, *, user_id, kind, title, text, now) -> Resume`(한 트랜잭션, 꽉 차면 `SlotFull`), `update_resume(conn, *, user_id, resume_id, title, text, now) -> Resume | None`, `delete_resume(conn, *, user_id, resume_id) -> bool`

- [ ] **Step 1: 실패하는 테스트 작성**

`backend/tests/test_repo_resumes.py`:

```python
from concurrent.futures import ThreadPoolExecutor

import pytest

from app import db
from app.repos import resumes, users
from tests.helpers import T0

T1 = "2026-10-13T05:00:00.000Z"


@pytest.fixture
def path(tmp_path):
    p = tmp_path / "t.sqlite3"
    db.init_db(p)
    return p


def _user(conn, email="a@b.com") -> str:
    return users.create_user(conn, email=email, password_hash="h", name=None, created_at=T0).id


def _create(conn, uid, kind="company", title="t", now=T0):
    return resumes.create_resume(conn, user_id=uid, kind=kind, title=title, text="x", now=now)


def test_migration_creates_tables(path):
    with db.connection(path) as conn:
        rows = conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")
        names = {r["name"] for r in rows}
    assert {"resumes", "premium_interviews", "archive", "recordings"} <= names


def test_three_slots_per_kind(path):
    with db.connection(path) as conn:
        uid = _user(conn)
        for i in range(3):
            _create(conn, uid, title=f"t{i}")
        with pytest.raises(resumes.SlotFull) as exc:
            _create(conn, uid)
        assert exc.value.kind == "company"
        # 다른 종류는 따로 센다
        assert _create(conn, uid, kind="admission").kind == "admission"


def test_concurrent_creates_never_exceed_slots(path):
    with db.connection(path) as conn:
        uid = _user(conn)

    def attempt(i: int) -> bool:
        with db.connection(path) as c:
            try:
                _create(c, uid, title=f"t{i}")
                return True
            except resumes.SlotFull:
                return False

    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(attempt, range(8)))
    assert results.count(True) == 3
    with db.connection(path) as conn:
        assert len(resumes.list_resumes(conn, uid)) == 3


def test_list_is_recent_first_and_scoped(path):
    with db.connection(path) as conn:
        uid = _user(conn)
        other = _user(conn, "b@b.com")
        a = _create(conn, uid, now=T0)
        b = _create(conn, uid, now=T1)
        _create(conn, other)
        assert [r.id for r in resumes.list_resumes(conn, uid)] == [b.id, a.id]


def test_update_and_delete_are_scoped_to_owner(path):
    with db.connection(path) as conn:
        uid = _user(conn)
        other = _user(conn, "b@b.com")
        r = _create(conn, uid)
        assert (
            resumes.update_resume(
                conn, user_id=other, resume_id=r.id, title="x", text="y", now=T1
            )
            is None
        )
        updated = resumes.update_resume(
            conn, user_id=uid, resume_id=r.id, title="새 제목", text="y", now=T1
        )
        assert updated is not None
        assert (updated.title, updated.text, updated.updated_at) == ("새 제목", "y", T1)
        assert not resumes.delete_resume(conn, user_id=other, resume_id=r.id)
        assert resumes.delete_resume(conn, user_id=uid, resume_id=r.id)
        assert resumes.list_resumes(conn, uid) == []
```

- [ ] **Step 2: 실패 확인**

Run: `uv run pytest tests/test_repo_resumes.py -q`
Expected: FAIL — `ImportError: cannot import name 'resumes' from 'app.repos'`

- [ ] **Step 3: 구현**

`backend/app/migrations/002_resumes_archive.sql`:

```sql
-- 이력서 슬롯·벤 면접·보관함·녹음 (spec 3.1).
-- 대화·리포트는 해석하지 않고 JSON 문자열 그대로 둔다.
CREATE TABLE resumes (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('company', 'admission')),
    title TEXT NOT NULL,
    text TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX resumes_user_kind ON resumes(user_id, kind);

CREATE TABLE premium_interviews (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    track TEXT NOT NULL CHECK (track IN ('company', 'admission')),
    inputs_json TEXT NOT NULL,
    messages_json TEXT NOT NULL DEFAULT '[]',
    model_turns INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'done')),
    created_at TEXT NOT NULL
);
CREATE INDEX premium_interviews_created ON premium_interviews(created_at);

CREATE TABLE archive (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    interviewer_id TEXT NOT NULL,
    premium INTEGER NOT NULL CHECK (premium IN (0, 1)),
    premium_interview_id TEXT REFERENCES premium_interviews(id),
    track TEXT NOT NULL CHECK (track IN ('company', 'admission')),
    field TEXT,
    job TEXT,
    name TEXT,
    age INTEGER,
    university TEXT,
    department TEXT,
    question_count INTEGER NOT NULL DEFAULT 0,
    started_at TEXT NOT NULL,
    ended_at TEXT NOT NULL,
    messages_json TEXT NOT NULL,
    report_json TEXT NOT NULL,
    report_raw TEXT NOT NULL
);
CREATE INDEX archive_user ON archive(user_id, premium, started_at);
-- 벤 면접 하나는 보관함에 한 번만 저장된다
CREATE UNIQUE INDEX archive_premium_interview
    ON archive(premium_interview_id) WHERE premium_interview_id IS NOT NULL;

CREATE TABLE recordings (
    id TEXT PRIMARY KEY,
    archive_id TEXT NOT NULL REFERENCES archive(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    turn INTEGER NOT NULL,
    path TEXT NOT NULL,
    mime TEXT NOT NULL,
    bytes INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (archive_id, turn)
);
```

`backend/app/repos/resumes.py`:

```python
"""resumes 테이블 SQL (spec 4.2). 종류(kind)마다 3개까지."""

import sqlite3
from dataclasses import dataclass

from app.db import transaction
from app.ids import new_id

RESUME_SLOTS = 3


@dataclass(frozen=True)
class Resume:
    id: str
    kind: str
    title: str
    text: str
    updated_at: str


class SlotFull(Exception):
    def __init__(self, kind: str) -> None:
        super().__init__(kind)
        self.kind = kind


def _resume(row: sqlite3.Row) -> Resume:
    return Resume(
        id=row["id"],
        kind=row["kind"],
        title=row["title"],
        text=row["text"],
        updated_at=row["updated_at"],
    )


def list_resumes(conn: sqlite3.Connection, user_id: str) -> list[Resume]:
    rows = conn.execute(
        "SELECT * FROM resumes WHERE user_id = ? ORDER BY updated_at DESC, id DESC", (user_id,)
    )
    return [_resume(r) for r in rows]


def create_resume(
    conn: sqlite3.Connection, *, user_id: str, kind: str, title: str, text: str, now: str
) -> Resume:
    resume_id = new_id("r")
    with transaction(conn):
        count = conn.execute(
            "SELECT COUNT(*) FROM resumes WHERE user_id = ? AND kind = ?", (user_id, kind)
        ).fetchone()[0]
        if count >= RESUME_SLOTS:
            raise SlotFull(kind)
        conn.execute(
            "INSERT INTO resumes (id, user_id, kind, title, text, updated_at)"
            " VALUES (?, ?, ?, ?, ?, ?)",
            (resume_id, user_id, kind, title, text, now),
        )
    return Resume(id=resume_id, kind=kind, title=title, text=text, updated_at=now)


def update_resume(
    conn: sqlite3.Connection, *, user_id: str, resume_id: str, title: str, text: str, now: str
) -> Resume | None:
    cur = conn.execute(
        "UPDATE resumes SET title = ?, text = ?, updated_at = ? WHERE id = ? AND user_id = ?",
        (title, text, now, resume_id, user_id),
    )
    if cur.rowcount == 0:
        return None
    return _resume(conn.execute("SELECT * FROM resumes WHERE id = ?", (resume_id,)).fetchone())


def delete_resume(conn: sqlite3.Connection, *, user_id: str, resume_id: str) -> bool:
    cur = conn.execute("DELETE FROM resumes WHERE id = ? AND user_id = ?", (resume_id, user_id))
    return cur.rowcount > 0
```

- [ ] **Step 4: 통과 확인**

Run: `uv run pytest tests/test_repo_resumes.py -q`
Expected: PASS (5 passed)

- [ ] **Step 5: 커밋**

```bash
uv run ruff check --fix . && uv run ruff format . && uv run pytest -q
git add app/migrations/002_resumes_archive.sql app/repos/resumes.py tests/test_repo_resumes.py
git commit -m "feat(backend): 이력서·보관함·녹음·벤 면접 테이블(002)과 이력서 저장소 — 종류별 3개를 한 트랜잭션으로"
```

---

### Task 11: 이력서 API (`/api/resumes`)

**Files:**
- Create: `backend/app/routers/resumes.py`
- Modify: `backend/app/schemas.py`, `backend/app/main.py`
- Test: `backend/tests/test_resumes.py`

**Interfaces:**
- Consumes: `resumes` 저장소(Task 10), `LoggedInUser`·`Db`(Task 8), `ApiError`(Task 6), `iso`(Task 3)
- Produces:
  - `app.schemas.ResumeKind`, `ResumeTitle`, `ResumeText`, `ResumeSlot`, `ResumeCreate`, `ResumeUpdate`
  - `GET /api/resumes`, `POST /api/resumes`(201 / `409 slot_full`+`kind`), `PUT /api/resumes/{id}`, `DELETE /api/resumes/{id}`(204)

- [ ] **Step 1: 실패하는 테스트 작성**

`backend/tests/test_resumes.py`:

```python
import pytest

from tests.helpers import logout, signup

URL = "/api/resumes"


def _create(client, kind="company", title="백엔드 신입용", text="이력서 원문"):
    return client.post(URL, json={"kind": kind, "title": title, "text": text})


def test_requires_login(client):
    assert client.get(URL).status_code == 401
    assert _create(client).json() == {"error": "unauthorized"}


def test_create_returns_slot(client):
    signup(client)
    res = _create(client, title="  백엔드 신입용  ")
    assert res.status_code == 201
    body = res.json()
    assert body["id"].startswith("r_")
    assert body == {
        "id": body["id"],
        "kind": "company",
        "title": "백엔드 신입용",
        "text": "이력서 원문",
        "updatedAt": "2025-10-09T08:53:20.000Z",
    }


def test_slot_full_per_kind(client):
    signup(client)
    for _ in range(3):
        assert _create(client).status_code == 201
    res = _create(client)
    assert res.status_code == 409
    assert res.json() == {"error": "slot_full", "kind": "company"}
    assert _create(client, kind="admission").status_code == 201


@pytest.mark.parametrize(
    ("title", "text", "field"),
    [("", "x", "title"), ("   ", "x", "title"), ("가" * 41, "x", "title"), ("t", "x" * 20_001, "text")],
)
def test_validation(client, title, text, field):
    signup(client)
    res = _create(client, title=title, text=text)
    assert res.status_code == 422
    assert res.json() == {"error": "invalid", "field": field}


def test_limits_are_inclusive(client):
    signup(client)
    assert _create(client, title="가" * 40, text="x" * 20_000).status_code == 201


def test_list_recent_first_and_update(client, clock):
    signup(client)
    a = _create(client, title="a").json()
    clock.advance(1)
    b = _create(client, title="b").json()
    assert [r["id"] for r in client.get(URL).json()] == [b["id"], a["id"]]
    clock.advance(1)
    res = client.put(f"{URL}/{a['id']}", json={"kind": "admission", "title": "새", "text": "y"})
    assert res.status_code == 200
    # kind는 바꿀 수 없다(보내도 무시)
    assert (res.json()["kind"], res.json()["title"], res.json()["text"]) == ("company", "새", "y")
    assert [r["id"] for r in client.get(URL).json()] == [a["id"], b["id"]]


def test_delete(client):
    signup(client)
    r = _create(client).json()
    assert client.delete(f"{URL}/{r['id']}").status_code == 204
    assert client.get(URL).json() == []


def test_other_users_resume_is_404(client):
    signup(client)
    r = _create(client).json()
    logout(client)
    signup(client, email="b@b.com")
    assert client.get(URL).json() == []
    res = client.put(f"{URL}/{r['id']}", json={"title": "x", "text": "y"})
    assert res.status_code == 404
    assert res.json() == {"error": "not_found"}
    assert client.delete(f"{URL}/{r['id']}").status_code == 404
```

- [ ] **Step 2: 실패 확인**

Run: `uv run pytest tests/test_resumes.py -q`
Expected: FAIL — `/api/resumes`가 404

- [ ] **Step 3: 구현**

`backend/app/schemas.py`의 `from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator`를 `from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator, model_validator`로 바꾸고, 맨 아래에 추가:

```python
# ── 내 이력서 ──

ResumeKind = Literal["company", "admission"]
ResumeTitle = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=40)]
ResumeText = Annotated[str, Field(max_length=20_000)]


class ResumeSlot(BaseModel):
    id: str
    kind: ResumeKind
    title: str
    text: str
    updatedAt: str


class ResumeCreate(BaseModel):
    kind: ResumeKind
    title: ResumeTitle
    text: ResumeText


class ResumeUpdate(BaseModel):
    # kind는 바꿀 수 없다. 프론트 ResumeDraft가 kind를 실어 보내도 무시된다.
    title: ResumeTitle
    text: ResumeText
```

`backend/app/routers/resumes.py`:

```python
"""내 이력서 슬롯 (spec 4.2). 한도는 서버가 지킨다."""

from fastapi import APIRouter, Request, Response

from app.deps import Db, LoggedInUser
from app.errors import ApiError
from app.repos import resumes
from app.repos.resumes import Resume
from app.schemas import ResumeCreate, ResumeSlot, ResumeUpdate
from app.timefmt import iso

router = APIRouter()


def _slot(r: Resume) -> ResumeSlot:
    return ResumeSlot(id=r.id, kind=r.kind, title=r.title, text=r.text, updatedAt=r.updated_at)


@router.get("/resumes", response_model=list[ResumeSlot])
def list_resumes(user: LoggedInUser, conn: Db) -> list[ResumeSlot]:
    return [_slot(r) for r in resumes.list_resumes(conn, user.id)]


@router.post("/resumes", status_code=201, response_model=ResumeSlot)
def create_resume(
    body: ResumeCreate, user: LoggedInUser, conn: Db, request: Request
) -> ResumeSlot:
    now = iso(request.app.state.clock())
    try:
        r = resumes.create_resume(
            conn, user_id=user.id, kind=body.kind, title=body.title, text=body.text, now=now
        )
    except resumes.SlotFull as exc:
        raise ApiError(409, "slot_full", kind=exc.kind) from None
    return _slot(r)


@router.put("/resumes/{resume_id}", response_model=ResumeSlot)
def update_resume(
    resume_id: str, body: ResumeUpdate, user: LoggedInUser, conn: Db, request: Request
) -> ResumeSlot:
    now = iso(request.app.state.clock())
    r = resumes.update_resume(
        conn, user_id=user.id, resume_id=resume_id, title=body.title, text=body.text, now=now
    )
    if r is None:
        raise ApiError(404, "not_found")
    return _slot(r)


@router.delete("/resumes/{resume_id}", status_code=204)
def delete_resume(resume_id: str, user: LoggedInUser, conn: Db) -> Response:
    if not resumes.delete_resume(conn, user_id=user.id, resume_id=resume_id):
        raise ApiError(404, "not_found")
    return Response(status_code=204)
```

`backend/app/main.py`: 라우터 import 줄을 `from app.routers import auth, health, manifest, me, questions, resumes`로 바꾸고, `app.include_router(me.router, prefix="/api")` 다음 줄에 `    app.include_router(resumes.router, prefix="/api")`를 넣는다.

- [ ] **Step 4: 통과 확인**

Run: `uv run pytest tests/test_resumes.py -q`
Expected: PASS (11 passed). 이어서 `uv run pytest -q` 전체 PASS.

- [ ] **Step 5: 커밋**

```bash
uv run ruff check --fix . && uv run ruff format . && uv run pytest -q
git add app/schemas.py app/routers/resumes.py app/main.py tests/test_resumes.py
git commit -m "feat(backend): 이력서 API — 종류별 3개(409 slot_full), 제목 1~40자·본문 2만 자, 남의 id 404"
```

---

### Task 12: 보관함 저장소(5개 한도·밀어내기·프리미엄 검증)와 파일 정리

**Files:**
- Create: `backend/app/repos/archive.py`, `backend/app/files.py`
- Modify: `backend/app/startup.py`
- Test: `backend/tests/test_repo_archive.py`, `backend/tests/test_files.py`

**Interfaces:**
- Consumes: `db.transaction`(Task 4), `new_id`(Task 3), 002 테이블(Task 10), `tests.helpers.insert_premium_interview`·`insert_recording`(Task 6)
- Produces:
  - `app.repos.archive.ARCHIVE_LIMIT = 5`
  - `NewArchive`(frozen): `interviewer_id, premium, premium_interview_id, track, field, job, name, age, university, department, question_count, started_at, ended_at, messages_json, report_json, report_raw`
  - `ArchiveSummary`(frozen): `id, interviewer_id, premium, track, field, job, name, age, university, department, question_count, started_at, ended_at, has_recording`
  - `ArchiveRecord`(frozen): `summary, messages_json, report_json, report_raw, recordings: list[tuple[int, str]]`(turn, recording id)
  - `SaveResult`(frozen): `archive_id, evicted: list[str], removed_paths: list[str]`
  - `InvalidPremiumInterview(Exception)`
  - `save_archive(conn, *, user_id, new: NewArchive) -> SaveResult`, `list_archive(conn, user_id) -> list[ArchiveSummary]`, `get_archive(conn, *, user_id, archive_id) -> ArchiveRecord | None`, `delete_archive(conn, *, user_id, archive_id) -> list[str] | None`
  - `app.files.remove_files(storage_dir: Path, relative_paths: Iterable[str]) -> None`, `cleanup_orphan_recordings(conn, storage_dir: Path) -> int`
  - `prepare_storage`가 기동 때 고아 녹음 파일을 지운다

- [ ] **Step 1: 실패하는 테스트 작성**

`backend/tests/test_repo_archive.py`:

```python
import pytest

from app import db
from app.repos import archive, users
from tests.helpers import T0, insert_premium_interview, insert_recording


@pytest.fixture
def conn(tmp_path):
    path = tmp_path / "t.sqlite3"
    db.init_db(path)
    with db.connection(path) as c:
        yield c


def _user(conn, email="a@b.com") -> str:
    return users.create_user(conn, email=email, password_hash="h", name=None, created_at=T0).id


def _new(**over) -> archive.NewArchive:
    base = dict(
        interviewer_id="m1",
        premium=False,
        premium_interview_id=None,
        track="company",
        field="it",
        job="백엔드",
        name=None,
        age=None,
        university=None,
        department=None,
        question_count=5,
        started_at=T0,
        ended_at="2026-10-13T04:21:00.000Z",
        messages_json="[]",
        report_json="[]",
        report_raw="",
    )
    base.update(over)
    return archive.NewArchive(**base)


def _at(hour: int) -> str:
    return f"2026-10-13T{hour:02d}:00:00.000Z"


def test_limit_is_five():
    assert archive.ARCHIVE_LIMIT == 5


def test_sixth_free_entry_evicts_the_oldest(conn):
    uid = _user(conn)
    ids = []
    for hour in range(1, 6):
        result = archive.save_archive(conn, user_id=uid, new=_new(started_at=_at(hour)))
        assert result.evicted == []
        ids.append(result.archive_id)
    sixth = archive.save_archive(conn, user_id=uid, new=_new(started_at=_at(6)))
    assert sixth.evicted == [ids[0]]
    listed = [s.id for s in archive.list_archive(conn, uid)]
    assert listed == [sixth.archive_id, *reversed(ids[1:])]


def test_premium_entries_are_not_counted(conn):
    uid = _user(conn)
    for hour in (1, 2):
        pi = insert_premium_interview(conn, uid)
        new = _new(premium=True, premium_interview_id=pi, started_at=_at(hour))
        assert archive.save_archive(conn, user_id=uid, new=new).evicted == []
    for hour in range(3, 8):
        assert archive.save_archive(conn, user_id=uid, new=_new(started_at=_at(hour))).evicted == []
    assert len(archive.list_archive(conn, uid)) == 7


def test_premium_requires_own_done_unused_interview(conn):
    uid = _user(conn)
    other = _user(conn, "b@b.com")
    active = insert_premium_interview(conn, uid, status="active")
    others = insert_premium_interview(conn, other)
    done = insert_premium_interview(conn, uid)
    for bad in (None, "pi_missing", active, others):
        with pytest.raises(archive.InvalidPremiumInterview):
            archive.save_archive(conn, user_id=uid, new=_new(premium=True, premium_interview_id=bad))
    archive.save_archive(conn, user_id=uid, new=_new(premium=True, premium_interview_id=done))
    # 같은 벤 면접을 두 번 저장할 수 없다
    with pytest.raises(archive.InvalidPremiumInterview):
        archive.save_archive(conn, user_id=uid, new=_new(premium=True, premium_interview_id=done))
    assert len(archive.list_archive(conn, uid)) == 1


def test_free_entry_drops_premium_interview_id(conn):
    uid = _user(conn)
    done = insert_premium_interview(conn, uid)
    result = archive.save_archive(conn, user_id=uid, new=_new(premium_interview_id=done))
    row = conn.execute(
        "SELECT premium_interview_id FROM archive WHERE id = ?", (result.archive_id,)
    ).fetchone()
    assert row[0] is None


def test_eviction_returns_recording_paths(conn):
    uid = _user(conn)
    first = archive.save_archive(conn, user_id=uid, new=_new(started_at=_at(1))).archive_id
    path = f"recordings/{uid}/rec_x.webm"
    insert_recording(conn, archive_id=first, user_id=uid, turn=1, path=path)
    for hour in range(2, 6):
        archive.save_archive(conn, user_id=uid, new=_new(started_at=_at(hour)))
    result = archive.save_archive(conn, user_id=uid, new=_new(started_at=_at(6)))
    assert result.evicted == [first]
    assert result.removed_paths == [path]
    assert conn.execute("SELECT COUNT(*) FROM recordings").fetchone()[0] == 0


def test_get_and_delete_are_scoped(conn):
    uid = _user(conn)
    other = _user(conn, "b@b.com")
    aid = archive.save_archive(conn, user_id=uid, new=_new(messages_json='[{"x":1}]')).archive_id
    insert_recording(conn, archive_id=aid, user_id=uid, turn=2, path="recordings/u/b.webm")
    r1 = insert_recording(conn, archive_id=aid, user_id=uid, turn=1, path="recordings/u/a.webm")
    record = archive.get_archive(conn, user_id=uid, archive_id=aid)
    assert record is not None
    assert record.summary.has_recording is True
    assert record.messages_json == '[{"x":1}]'
    assert record.recordings[0] == (1, r1)
    assert archive.get_archive(conn, user_id=other, archive_id=aid) is None
    assert archive.delete_archive(conn, user_id=other, archive_id=aid) is None
    removed = archive.delete_archive(conn, user_id=uid, archive_id=aid)
    assert removed is not None
    assert sorted(removed) == ["recordings/u/a.webm", "recordings/u/b.webm"]
    assert archive.get_archive(conn, user_id=uid, archive_id=aid) is None
```

`backend/tests/test_files.py`:

```python
from app import db
from app.files import cleanup_orphan_recordings, remove_files
from app.repos import archive, users
from tests.helpers import T0, insert_recording


def test_remove_files_ignores_missing(tmp_path):
    (tmp_path / "recordings").mkdir()
    keep = tmp_path / "recordings" / "a.webm"
    keep.write_bytes(b"x")
    remove_files(tmp_path, ["recordings/a.webm", "recordings/missing.webm"])
    assert not keep.exists()


def test_cleanup_removes_only_unknown_files(tmp_path):
    db.init_db(tmp_path / "momo.sqlite3")
    folder = tmp_path / "recordings" / "u_1"
    folder.mkdir(parents=True)
    known = folder / "rec_known.webm"
    stray = folder / "rec_stray.webm"
    partial = folder / "rec_upload.webm.part"
    for f in (known, stray, partial):
        f.write_bytes(b"x")
    with db.connection(tmp_path / "momo.sqlite3") as conn:
        uid = users.create_user(conn, email="a@b.com", password_hash="h", name=None, created_at=T0).id
        new = archive.NewArchive(
            interviewer_id="m2", premium=False, premium_interview_id=None, track="company",
            field="it", job="백엔드", name=None, age=None, university=None, department=None,
            question_count=1, started_at=T0, ended_at=T0, messages_json="[]",
            report_json="[]", report_raw="",
        )
        aid = archive.save_archive(conn, user_id=uid, new=new).archive_id
        insert_recording(conn, archive_id=aid, user_id=uid, turn=1, path="recordings/u_1/rec_known.webm")
        assert cleanup_orphan_recordings(conn, tmp_path) == 2
    assert known.exists()
    assert not stray.exists()
    assert not partial.exists()


def test_startup_removes_orphan_recordings(make_client, settings):
    stray = settings.recordings_dir / "u_x" / "rec_y.webm"
    stray.parent.mkdir(parents=True)
    stray.write_bytes(b"x")
    make_client(settings)
    assert not stray.exists()
```

- [ ] **Step 2: 실패 확인**

Run: `uv run pytest tests/test_repo_archive.py tests/test_files.py -q`
Expected: FAIL — `ImportError: cannot import name 'archive' from 'app.repos'`, `No module named 'app.files'`

- [ ] **Step 3: 구현**

`backend/app/repos/archive.py`:

```python
"""archive SQL (spec 4.2). 대화·리포트는 해석하지 않고 JSON 문자열 그대로 둔다."""

import sqlite3
from dataclasses import dataclass

from app.db import transaction
from app.ids import new_id

ARCHIVE_LIMIT = 5


@dataclass(frozen=True)
class NewArchive:
    interviewer_id: str
    premium: bool
    premium_interview_id: str | None
    track: str
    field: str | None
    job: str | None
    name: str | None
    age: int | None
    university: str | None
    department: str | None
    question_count: int
    started_at: str
    ended_at: str
    messages_json: str
    report_json: str
    report_raw: str


@dataclass(frozen=True)
class ArchiveSummary:
    id: str
    interviewer_id: str
    premium: bool
    track: str
    field: str | None
    job: str | None
    name: str | None
    age: int | None
    university: str | None
    department: str | None
    question_count: int
    started_at: str
    ended_at: str
    has_recording: bool


@dataclass(frozen=True)
class ArchiveRecord:
    summary: ArchiveSummary
    messages_json: str
    report_json: str
    report_raw: str
    recordings: list[tuple[int, str]]


@dataclass(frozen=True)
class SaveResult:
    archive_id: str
    evicted: list[str]
    removed_paths: list[str]


class InvalidPremiumInterview(Exception):
    """본인의, 끝난, 아직 저장되지 않은 벤 면접이 아니다."""


SUMMARY_SQL = """
SELECT a.*,
       EXISTS (SELECT 1 FROM recordings r WHERE r.archive_id = a.id) AS has_recording
FROM archive a
"""

INSERT_SQL = """
INSERT INTO archive (
    id, user_id, interviewer_id, premium, premium_interview_id, track,
    field, job, name, age, university, department, question_count,
    started_at, ended_at, messages_json, report_json, report_raw
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
"""

USABLE_INTERVIEW_SQL = """
SELECT 1 FROM premium_interviews p
WHERE p.id = ? AND p.user_id = ? AND p.status = 'done'
  AND NOT EXISTS (SELECT 1 FROM archive a WHERE a.premium_interview_id = p.id)
"""


def _summary(row: sqlite3.Row) -> ArchiveSummary:
    return ArchiveSummary(
        id=row["id"],
        interviewer_id=row["interviewer_id"],
        premium=bool(row["premium"]),
        track=row["track"],
        field=row["field"],
        job=row["job"],
        name=row["name"],
        age=row["age"],
        university=row["university"],
        department=row["department"],
        question_count=row["question_count"],
        started_at=row["started_at"],
        ended_at=row["ended_at"],
        has_recording=bool(row["has_recording"]),
    )


def _delete_many(conn: sqlite3.Connection, user_id: str, archive_ids: list[str]) -> list[str]:
    """기록과 녹음 행을 지우고, 커밋 뒤 지울 파일 경로를 돌려준다."""
    paths: list[str] = []
    for archive_id in archive_ids:
        rows = conn.execute(
            "SELECT path FROM recordings WHERE archive_id = ? AND user_id = ?",
            (archive_id, user_id),
        )
        paths.extend(r["path"] for r in rows)
        conn.execute(
            "DELETE FROM recordings WHERE archive_id = ? AND user_id = ?", (archive_id, user_id)
        )
        conn.execute("DELETE FROM archive WHERE id = ? AND user_id = ?", (archive_id, user_id))
    return paths


def save_archive(conn: sqlite3.Connection, *, user_id: str, new: NewArchive) -> SaveResult:
    archive_id = new_id("a")
    interview_id = new.premium_interview_id if new.premium else None
    with transaction(conn):
        if new.premium:
            usable = interview_id is not None and conn.execute(
                USABLE_INTERVIEW_SQL, (interview_id, user_id)
            ).fetchone()
            if not usable:
                raise InvalidPremiumInterview
        conn.execute(
            INSERT_SQL,
            (
                archive_id, user_id, new.interviewer_id, int(new.premium), interview_id,
                new.track, new.field, new.job, new.name, new.age, new.university,
                new.department, new.question_count, new.started_at, new.ended_at,
                new.messages_json, new.report_json, new.report_raw,
            ),
        )
        rows = conn.execute(
            "SELECT id FROM archive WHERE user_id = ? AND premium = 0"
            " ORDER BY started_at DESC, id DESC LIMIT -1 OFFSET ?",
            (user_id, ARCHIVE_LIMIT),
        )
        evicted = [r["id"] for r in rows]
        removed = _delete_many(conn, user_id, evicted)
    return SaveResult(archive_id=archive_id, evicted=evicted, removed_paths=removed)


def list_archive(conn: sqlite3.Connection, user_id: str) -> list[ArchiveSummary]:
    rows = conn.execute(
        SUMMARY_SQL + " WHERE a.user_id = ? ORDER BY a.started_at DESC, a.id DESC", (user_id,)
    )
    return [_summary(r) for r in rows]


def get_archive(
    conn: sqlite3.Connection, *, user_id: str, archive_id: str
) -> ArchiveRecord | None:
    row = conn.execute(
        SUMMARY_SQL + " WHERE a.id = ? AND a.user_id = ?", (archive_id, user_id)
    ).fetchone()
    if row is None:
        return None
    recs = conn.execute(
        "SELECT turn, id FROM recordings WHERE archive_id = ? ORDER BY turn", (archive_id,)
    )
    return ArchiveRecord(
        summary=_summary(row),
        messages_json=row["messages_json"],
        report_json=row["report_json"],
        report_raw=row["report_raw"],
        recordings=[(r["turn"], r["id"]) for r in recs],
    )


def delete_archive(conn: sqlite3.Connection, *, user_id: str, archive_id: str) -> list[str] | None:
    """없거나 남의 것이면 None. 지웠으면 커밋 뒤 지울 녹음 파일 경로."""
    with transaction(conn):
        found = conn.execute(
            "SELECT 1 FROM archive WHERE id = ? AND user_id = ?", (archive_id, user_id)
        ).fetchone()
        if found is None:
            return None
        return _delete_many(conn, user_id, [archive_id])
```

`backend/app/files.py`:

```python
"""녹음 파일 정리 (spec 4.2). 파일은 커밋 뒤에 지우고, 남은 것은 기동 때 정리한다."""

import contextlib
import sqlite3
from collections.abc import Iterable
from pathlib import Path


def remove_files(storage_dir: Path, relative_paths: Iterable[str]) -> None:
    for rel in relative_paths:
        with contextlib.suppress(OSError):
            (storage_dir / rel).unlink(missing_ok=True)


def cleanup_orphan_recordings(conn: sqlite3.Connection, storage_dir: Path) -> int:
    """DB에 없는 녹음 파일(삭제 실패·업로드 중단 .part)을 지운다."""
    root = storage_dir / "recordings"
    if not root.is_dir():
        return 0
    known = {row["path"] for row in conn.execute("SELECT path FROM recordings")}
    removed = 0
    for file in list(root.rglob("*")):
        if file.is_file() and file.relative_to(storage_dir).as_posix() not in known:
            with contextlib.suppress(OSError):
                file.unlink()
                removed += 1
    return removed
```

`backend/app/startup.py` 전체를 아래로 바꾼다:

```python
"""기동 시 저장소 준비 (spec 3절 db, 4.2 남은 파일 정리)."""

from app import db
from app.config import Settings
from app.files import cleanup_orphan_recordings


def prepare_storage(settings: Settings, now: float) -> None:
    db.init_db(settings.db_path)
    settings.recordings_dir.mkdir(parents=True, exist_ok=True)
    with db.connection(settings.db_path) as conn:
        cleanup_orphan_recordings(conn, settings.storage_dir)
```

- [ ] **Step 4: 통과 확인**

Run: `uv run pytest tests/test_repo_archive.py tests/test_files.py -q`
Expected: PASS (10 passed)

- [ ] **Step 5: 커밋**

```bash
uv run ruff check --fix . && uv run ruff format . && uv run pytest -q
git add app/repos/archive.py app/files.py app/startup.py tests/test_repo_archive.py tests/test_files.py
git commit -m "feat(backend): 보관함 저장소 — 무료 5개 한도 밀어내기, 프리미엄 면접 검증, 커밋 뒤 녹음 파일 삭제와 기동 시 정리"
```

---

### Task 13: 보관함 API (`/api/archive`)

**Files:**
- Create: `backend/app/routers/archive.py`
- Modify: `backend/app/schemas.py`, `backend/app/presenters.py`, `backend/app/main.py`
- Test: `backend/tests/test_archive.py`

**Interfaces:**
- Consumes: `archive` 저장소(Task 12), `remove_files`(Task 12), `format_utc`(Task 3), `LoggedInUser`·`Db`(Task 8)
- Produces:
  - `app.schemas.Track`, `ChatMessage`, `ReportItem`, `RecordingRef`, `ArchiveEntry`, `ArchiveDetail`, `ArchiveCreate`, `ArchiveSaved`
  - `app.presenters.recording_url(recording_id: str) -> str` (`/api/recordings/{id}`)
  - `app.routers.archive.TRACK_FIELDS`; `GET /api/archive`, `GET /api/archive/{id}`, `POST /api/archive`(201 `{entry, evicted}`), `DELETE /api/archive/{id}`(204)

- [ ] **Step 1: 실패하는 테스트 작성**

`backend/tests/test_archive.py`:

```python
import pytest

from tests.helpers import (
    archive_body,
    insert_premium_interview,
    insert_recording,
    logout,
    open_db,
    signup,
)

URL = "/api/archive"
ENTRY_KEYS = {
    "id", "interviewerId", "premium", "track", "startedAt", "endedAt",
    "questionCount", "hasRecording",
}


def _at(hour: int) -> str:
    return f"2026-10-13T{hour:02d}:00:00.000Z"


def test_requires_login(client):
    assert client.get(URL).status_code == 401
    assert client.post(URL, json=archive_body()).status_code == 401


def test_save_company_entry(client):
    signup(client)
    res = client.post(URL, json=archive_body(hasRecording=True, recordings=[{"turn": 1, "url": "x"}]))
    assert res.status_code == 201
    body = res.json()
    assert body["evicted"] == []
    entry = body["entry"]
    assert entry["id"].startswith("a_")
    assert set(entry) == ENTRY_KEYS | {"field", "job"}  # score 없음, 대입 칸 없음
    assert entry["hasRecording"] is False  # 보낸 값은 무시하고 서버가 계산한다
    assert (entry["field"], entry["job"], entry["questionCount"]) == ("it", "백엔드 개발자", 5)


def test_started_at_is_normalized_to_utc(client):
    signup(client)
    res = client.post(URL, json=archive_body(startedAt="2026-10-13T13:00:00+09:00"))
    assert res.json()["entry"]["startedAt"] == "2026-10-13T04:00:00.000Z"


def test_admission_entry_keeps_only_admission_fields(client):
    signup(client)
    body = archive_body(
        track="admission", interviewerId="f3", name="홍길동", age=19,
        university="한국대학교", department="컴퓨터공학과",
    )
    entry = client.post(URL, json=body).json()["entry"]
    assert set(entry) == ENTRY_KEYS | {"name", "age", "university", "department"}


@pytest.mark.parametrize(
    ("over", "field"),
    [
        ({"job": None}, "job"),
        ({"field": "  "}, "field"),
        ({"track": "admission", "name": "홍길동", "age": 19, "department": "컴공"}, "university"),
    ],
)
def test_missing_track_fields(client, over, field):
    signup(client)
    res = client.post(URL, json=archive_body(**over))
    assert res.status_code == 422
    assert res.json() == {"error": "missing_field", "field": field}


def test_detail_round_trip(client):
    signup(client)
    sent = archive_body()
    aid = client.post(URL, json=sent).json()["entry"]["id"]
    detail = client.get(f"{URL}/{aid}").json()
    assert detail["messages"] == sent["messages"]
    assert detail["report"] == sent["report"]
    assert detail["reportRaw"] == sent["reportRaw"]
    assert detail["recordings"] == []
    assert detail["id"] == aid


def test_sixth_free_save_evicts_oldest(client):
    signup(client)
    ids = [client.post(URL, json=archive_body(startedAt=_at(h))).json()["entry"]["id"] for h in range(1, 6)]
    res = client.post(URL, json=archive_body(startedAt=_at(6)))
    assert res.json()["evicted"] == [ids[0]]
    listed = client.get(URL).json()
    assert len(listed) == 5
    assert [e["startedAt"] for e in listed] == [_at(h) for h in range(6, 1, -1)]
    assert client.get(f"{URL}/{ids[0]}").status_code == 404


def test_premium_entries_need_a_done_interview_and_skip_the_limit(client, settings):
    me = signup(client)
    with open_db(settings) as conn:
        done = insert_premium_interview(conn, me["userId"])
        active = insert_premium_interview(conn, me["userId"], status="active")
    ok = client.post(URL, json=archive_body(premium=True, premiumInterviewId=done, interviewerId="m2"))
    assert ok.status_code == 201
    assert ok.json()["entry"]["premium"] is True
    for bad in ({"premiumInterviewId": done}, {"premiumInterviewId": active}, {}):
        res = client.post(URL, json=archive_body(premium=True, **bad))
        assert res.status_code == 422
        assert res.json() == {"error": "invalid_premium_interview"}
    for h in range(1, 6):
        assert client.post(URL, json=archive_body(startedAt=_at(h))).json()["evicted"] == []
    assert len(client.get(URL).json()) == 6


def test_other_users_interview_is_rejected(client, settings):
    first = signup(client)
    with open_db(settings) as conn:
        theirs = insert_premium_interview(conn, first["userId"])
    logout(client)
    signup(client, email="b@b.com")
    res = client.post(URL, json=archive_body(premium=True, premiumInterviewId=theirs))
    assert res.json() == {"error": "invalid_premium_interview"}


def test_delete_removes_recording_files(client, settings):
    me = signup(client)
    with open_db(settings) as conn:
        done = insert_premium_interview(conn, me["userId"])
    aid = client.post(URL, json=archive_body(premium=True, premiumInterviewId=done)).json()["entry"]["id"]
    rel = f"recordings/{me['userId']}/rec_test.webm"
    file = settings.storage_dir / rel
    file.parent.mkdir(parents=True, exist_ok=True)
    file.write_bytes(b"audio")
    with open_db(settings) as conn:
        rec_id = insert_recording(conn, archive_id=aid, user_id=me["userId"], turn=1, path=rel)
    assert client.get(URL).json()[0]["hasRecording"] is True
    detail = client.get(f"{URL}/{aid}").json()
    assert detail["recordings"] == [{"turn": 1, "url": f"/api/recordings/{rec_id}"}]
    assert client.delete(f"{URL}/{aid}").status_code == 204
    assert not file.exists()
    assert client.get(f"{URL}/{aid}").status_code == 404


def test_other_users_entry_is_404(client):
    signup(client)
    aid = client.post(URL, json=archive_body()).json()["entry"]["id"]
    logout(client)
    signup(client, email="b@b.com")
    assert client.get(URL).json() == []
    assert client.get(f"{URL}/{aid}").json() == {"error": "not_found"}
    assert client.delete(f"{URL}/{aid}").status_code == 404
```

- [ ] **Step 2: 실패 확인**

Run: `uv run pytest tests/test_archive.py -q`
Expected: FAIL — `/api/archive`가 404

- [ ] **Step 3: 구현**

`backend/app/schemas.py`의 pydantic import 줄을 `from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, StringConstraints, field_validator, model_validator`로 바꾸고, 맨 아래에 추가:

```python
# ── 보관함 ──

Track = Literal["company", "admission"]
ShortText = Annotated[str, Field(max_length=100)]


class ChatMessage(BaseModel):
    role: Literal["user", "model"]
    text: str
    at: int | None = None


class ReportItem(BaseModel):
    question: str
    answerSummary: str
    feedback: str


class RecordingRef(BaseModel):
    turn: int
    url: str


class ArchiveEntry(BaseModel):
    id: str
    interviewerId: str
    premium: bool
    track: Track
    startedAt: str
    endedAt: str
    questionCount: int
    hasRecording: bool
    field: str | None = None
    job: str | None = None
    name: str | None = None
    age: int | None = None
    university: str | None = None
    department: str | None = None


class ArchiveDetail(ArchiveEntry):
    messages: list[ChatMessage]
    report: list[ReportItem]
    reportRaw: str
    recordings: list[RecordingRef]


class ArchiveCreate(BaseModel):
    # 프론트 ArchiveDraft의 hasRecording·recordings는 서버가 정하므로 무시된다
    interviewerId: str = Field(min_length=1, max_length=20)
    premium: bool
    track: Track
    startedAt: AwareDatetime
    endedAt: AwareDatetime
    questionCount: int = Field(default=0, ge=0)
    field: ShortText | None = None
    job: ShortText | None = None
    name: ShortText | None = None
    age: int | None = Field(default=None, ge=1, le=120)
    university: ShortText | None = None
    department: ShortText | None = None
    messages: list[ChatMessage]
    report: list[ReportItem]
    reportRaw: str
    premiumInterviewId: str | None = None


class ArchiveSaved(BaseModel):
    entry: ArchiveEntry
    evicted: list[str]
```

`backend/app/presenters.py` 맨 아래에 추가:

```python
def recording_url(recording_id: str) -> str:
    return f"/api/recordings/{recording_id}"
```

`backend/app/routers/archive.py`:

```python
"""보관함 (spec 4.2). 5개 한도는 서버가 집행한다."""

import json

from fastapi import APIRouter, Request, Response

from app.deps import Db, LoggedInUser
from app.errors import ApiError
from app.files import remove_files
from app.presenters import recording_url
from app.repos import archive
from app.schemas import ArchiveCreate, ArchiveDetail, ArchiveEntry, ArchiveSaved, RecordingRef
from app.timefmt import format_utc

router = APIRouter()

TRACK_FIELDS = {
    "company": ("field", "job"),
    "admission": ("name", "age", "university", "department"),
}


def _entry(s: archive.ArchiveSummary) -> ArchiveEntry:
    return ArchiveEntry(
        id=s.id,
        interviewerId=s.interviewer_id,
        premium=s.premium,
        track=s.track,
        startedAt=s.started_at,
        endedAt=s.ended_at,
        questionCount=s.question_count,
        hasRecording=s.has_recording,
        field=s.field,
        job=s.job,
        name=s.name,
        age=s.age,
        university=s.university,
        department=s.department,
    )


def _to_new(body: ArchiveCreate) -> archive.NewArchive:
    needed = TRACK_FIELDS[body.track]
    for name in needed:
        value = getattr(body, name)
        if value is None or (isinstance(value, str) and not value.strip()):
            raise ApiError(422, "missing_field", field=name)

    def keep(name: str):  # 다른 트랙의 칸은 저장하지 않는다
        return getattr(body, name) if name in needed else None

    messages = [m.model_dump(exclude_none=True) for m in body.messages]
    return archive.NewArchive(
        interviewer_id=body.interviewerId,
        premium=body.premium,
        premium_interview_id=body.premiumInterviewId if body.premium else None,
        track=body.track,
        field=keep("field"),
        job=keep("job"),
        name=keep("name"),
        age=keep("age"),
        university=keep("university"),
        department=keep("department"),
        question_count=body.questionCount,
        started_at=format_utc(body.startedAt),
        ended_at=format_utc(body.endedAt),
        messages_json=json.dumps(messages, ensure_ascii=False),
        report_json=json.dumps([r.model_dump() for r in body.report], ensure_ascii=False),
        report_raw=body.reportRaw,
    )


@router.get("/archive", response_model=list[ArchiveEntry], response_model_exclude_none=True)
def list_archive(user: LoggedInUser, conn: Db) -> list[ArchiveEntry]:
    return [_entry(s) for s in archive.list_archive(conn, user.id)]


@router.get(
    "/archive/{archive_id}", response_model=ArchiveDetail, response_model_exclude_none=True
)
def get_archive(archive_id: str, user: LoggedInUser, conn: Db) -> ArchiveDetail:
    record = archive.get_archive(conn, user_id=user.id, archive_id=archive_id)
    if record is None:
        raise ApiError(404, "not_found")
    return ArchiveDetail(
        **_entry(record.summary).model_dump(),
        messages=json.loads(record.messages_json),
        report=json.loads(record.report_json),
        reportRaw=record.report_raw,
        recordings=[RecordingRef(turn=t, url=recording_url(i)) for t, i in record.recordings],
    )


@router.post(
    "/archive", status_code=201, response_model=ArchiveSaved, response_model_exclude_none=True
)
def save_archive(
    body: ArchiveCreate, user: LoggedInUser, conn: Db, request: Request
) -> ArchiveSaved:
    new = _to_new(body)
    try:
        result = archive.save_archive(conn, user_id=user.id, new=new)
    except archive.InvalidPremiumInterview:
        raise ApiError(422, "invalid_premium_interview") from None
    remove_files(request.app.state.settings.storage_dir, result.removed_paths)
    entry = ArchiveEntry(
        id=result.archive_id,
        interviewerId=new.interviewer_id,
        premium=new.premium,
        track=new.track,
        startedAt=new.started_at,
        endedAt=new.ended_at,
        questionCount=new.question_count,
        hasRecording=False,
        field=new.field,
        job=new.job,
        name=new.name,
        age=new.age,
        university=new.university,
        department=new.department,
    )
    return ArchiveSaved(entry=entry, evicted=result.evicted)


@router.delete("/archive/{archive_id}", status_code=204)
def delete_archive(archive_id: str, user: LoggedInUser, conn: Db, request: Request) -> Response:
    paths = archive.delete_archive(conn, user_id=user.id, archive_id=archive_id)
    if paths is None:
        raise ApiError(404, "not_found")
    remove_files(request.app.state.settings.storage_dir, paths)
    return Response(status_code=204)
```

`backend/app/main.py`: 라우터 import 줄을 `from app.routers import archive, auth, health, manifest, me, questions, resumes`로 바꾸고, `app.include_router(resumes.router, prefix="/api")` 다음 줄에 `    app.include_router(archive.router, prefix="/api")`를 넣는다.

- [ ] **Step 4: 통과 확인**

Run: `uv run pytest tests/test_archive.py -q`
Expected: PASS (13 passed). 이어서 `uv run pytest -q` 전체 PASS.

- [ ] **Step 5: 커밋**

```bash
uv run ruff check --fix . && uv run ruff format . && uv run pytest -q
git add app/schemas.py app/presenters.py app/routers/archive.py app/main.py tests/test_archive.py
git commit -m "feat(backend): 보관함 API — 트랙별 필수 칸, 5개 넘으면 evicted, 프리미엄 위조 거부, 삭제 시 녹음 파일도"
```

> PR 2 마무리: `gh pr create --base dev --title "feat(backend): 이력서 슬롯과 보관함 — 5개 한도 자동 삭제·프리미엄 기록 검증"`.

---

## PR 3 — 관리자·티켓 + 벤 면접 3단계

### Task 14: 관리자 계정 기동 시 생성·동기화와 관리자 아이디 로그인

**Files:**
- Modify: `backend/app/repos/users.py`, `backend/app/startup.py`, `backend/app/routers/auth.py`
- Test: `backend/tests/test_admin.py`

**Interfaces:**
- Consumes: `Settings.admin_login`·`admin_password`(Task 3), `hash_password`(Task 5), `users`(Task 7), `prepare_storage`(Task 12)
- Produces:
  - `app.repos.users.sync_admin(conn, *, login: str | None, password_hash: str | None, created_at: str) -> None` — 값이 둘 다 있으면 그 계정을 만들거나(비밀번호·`is_admin=1` 맞춤) 다른 관리자 표시는 지운다. 없으면 모든 `is_admin`을 0으로
  - `app.startup.sync_admin(conn, settings: Settings, now: float) -> None`, `prepare_storage`가 부른다
  - `app.routers.auth._login_allowed(request, login_id) -> bool` — 이메일이거나, `ADMIN_LOGIN`·`ADMIN_PASSWORD`가 둘 다 있고 `login_id == normalize_login(ADMIN_LOGIN)`일 때만 True

- [ ] **Step 1: 실패하는 테스트 작성**

`backend/tests/test_admin.py`:

```python
from dataclasses import replace

from tests.helpers import ADMIN_PASSWORD, login_admin, open_db, signup

LOGIN = "/api/auth/login"


def _admins(settings) -> list[str]:
    with open_db(settings) as conn:
        return [r["email"] for r in conn.execute("SELECT email FROM users WHERE is_admin = 1")]


def test_admin_is_created_at_startup(client, settings):
    session = login_admin(client)
    assert session["isAdmin"] is True
    assert session["email"] == "admin"
    assert (session["tier"], session["tickets"]) == ("member", 0)
    assert _admins(settings) == ["admin"]


def test_admin_login_is_normalized(make_client, settings):
    c = make_client(replace(settings, admin_login="  Admin "))
    res = c.post(LOGIN, json={"email": "ADMIN", "password": ADMIN_PASSWORD})
    assert res.status_code == 200
    assert res.json()["email"] == "admin"


def test_restart_resyncs_password_and_flag(make_client, settings):
    make_client(settings)
    with open_db(settings) as conn:
        conn.execute("UPDATE users SET is_admin = 0")
    c = make_client(replace(settings, admin_password="new-pass-5678"))
    assert c.post(LOGIN, json={"email": "admin", "password": ADMIN_PASSWORD}).status_code == 401
    res = c.post(LOGIN, json={"email": "admin", "password": "new-pass-5678"})
    assert res.status_code == 200
    assert res.json()["isAdmin"] is True
    assert _admins(settings) == ["admin"]


def test_no_admin_when_password_is_missing(make_client, settings):
    make_client(settings)
    c = make_client(replace(settings, admin_password=None))
    assert _admins(settings) == []
    res = c.post(LOGIN, json={"email": "admin", "password": ADMIN_PASSWORD})
    assert res.json() == {"error": "bad_credentials"}


def test_no_admin_when_env_is_empty(make_client, settings):
    c = make_client(replace(settings, admin_login=None, admin_password=None))
    assert _admins(settings) == []
    assert c.post(LOGIN, json={"email": "admin", "password": ADMIN_PASSWORD}).status_code == 401


def test_non_email_login_only_matches_admin_login(client):
    res = client.post(LOGIN, json={"email": "root", "password": ADMIN_PASSWORD})
    assert res.json() == {"error": "bad_credentials"}


def test_signup_still_requires_email(client):
    body = {"email": "admin2", "password": "password123", "name": "x", "consent": True}
    assert client.post("/api/auth/signup", json=body).json() == {
        "error": "invalid_email",
        "field": "email",
    }


def test_regular_user_is_not_admin(client):
    assert signup(client)["isAdmin"] is False
```

- [ ] **Step 2: 실패 확인**

Run: `uv run pytest tests/test_admin.py -q`
Expected: FAIL — `login_admin`이 `401`(관리자 계정이 아직 만들어지지 않음)

- [ ] **Step 3: 구현**

`backend/app/repos/users.py` 맨 아래에 추가:

```python
def sync_admin(
    conn: sqlite3.Connection, *, login: str | None, password_hash: str | None, created_at: str
) -> None:
    """ADMIN_LOGIN 계정 하나만 관리자로 맞춘다(spec 4.4). 값이 없으면 관리자는 없다."""
    if login is None or password_hash is None:
        conn.execute("UPDATE users SET is_admin = 0 WHERE is_admin = 1")
        return
    existing = get_by_email(conn, login)
    if existing is None:
        conn.execute(
            "INSERT INTO users (id, email, password_hash, is_admin, created_at)"
            " VALUES (?, ?, ?, 1, ?)",
            (new_id("u"), login, password_hash, created_at),
        )
    else:
        conn.execute(
            "UPDATE users SET password_hash = ?, is_admin = 1 WHERE id = ?",
            (password_hash, existing.id),
        )
    conn.execute("UPDATE users SET is_admin = 0 WHERE is_admin = 1 AND email != ?", (login,))
```

`backend/app/startup.py` 전체를 아래로 바꾼다:

```python
"""기동 시 저장소 준비 (spec 3절 db, 4.2 남은 파일 정리, 4.4 관리자 계정)."""

import sqlite3

from app import db
from app.config import Settings
from app.files import cleanup_orphan_recordings
from app.repos import users
from app.security import hash_password
from app.timefmt import iso


def prepare_storage(settings: Settings, now: float) -> None:
    db.init_db(settings.db_path)
    settings.recordings_dir.mkdir(parents=True, exist_ok=True)
    with db.connection(settings.db_path) as conn:
        cleanup_orphan_recordings(conn, settings.storage_dir)
        sync_admin(conn, settings, now)


def sync_admin(conn: sqlite3.Connection, settings: Settings, now: float) -> None:
    """ADMIN_LOGIN·ADMIN_PASSWORD가 둘 다 있을 때만 관리자 계정이 있다."""
    login: str | None = None
    password_hash: str | None = None
    if settings.admin_login and settings.admin_password:
        login = users.normalize_login(settings.admin_login)
        password_hash = hash_password(settings.admin_password)
    with db.transaction(conn):
        users.sync_admin(conn, login=login, password_hash=password_hash, created_at=iso(now))
```

`backend/app/routers/auth.py`의 `_login_allowed`를 아래로 바꾼다:

```python
def _login_allowed(request: Request, login_id: str) -> bool:
    """일반 계정은 이메일만. 이메일이 아닌 아이디는 관리자 아이디일 때만(spec 4.4)."""
    if is_email(login_id):
        return True
    cfg = request.app.state.settings
    if not (cfg.admin_login and cfg.admin_password):
        return False
    return login_id == normalize_login(cfg.admin_login)
```

- [ ] **Step 4: 통과 확인**

Run: `uv run pytest tests/test_admin.py -q`
Expected: PASS (8 passed). 이어서 `uv run pytest -q` 전체 PASS.

- [ ] **Step 5: 커밋**

```bash
uv run ruff check --fix . && uv run ruff format . && uv run pytest -q
git add app/repos/users.py app/startup.py app/routers/auth.py tests/test_admin.py
git commit -m "feat(backend): .env의 ADMIN_LOGIN·ADMIN_PASSWORD로 관리자 계정을 기동 때 생성·동기화, 관리자 아이디 로그인"
```

---

### Task 15: 목업 결제 `POST /api/premium/purchase` (관리자 전용)

**Files:**
- Create: `backend/app/routers/premium.py`
- Modify: `backend/app/repos/users.py`, `backend/app/main.py`
- Test: `backend/tests/test_purchase.py`

**Interfaces:**
- Consumes: `LoggedInUser`·`Db`(Task 8), `to_session`(Task 8), 관리자 계정(Task 14)
- Produces:
  - `app.repos.users.TICKETS_PER_PURCHASE = 10`, `grant_tickets(conn, user_id, count: int = TICKETS_PER_PURCHASE) -> User`(`tier='premium'`, `tickets += count`)
  - `app.routers.premium.router`; `POST /api/premium/purchase` → `Session` · `403 purchase_disabled`

- [ ] **Step 1: 실패하는 테스트 작성**

`backend/tests/test_purchase.py`:

```python
from app.repos.users import TICKETS_PER_PURCHASE
from tests.helpers import login_admin, signup

URL = "/api/premium/purchase"


def test_ten_tickets_per_purchase():
    assert TICKETS_PER_PURCHASE == 10


def test_requires_login(client):
    res = client.post(URL)
    assert res.status_code == 401
    assert res.json() == {"error": "unauthorized"}


def test_member_cannot_purchase(client):
    signup(client)
    res = client.post(URL)
    assert res.status_code == 403
    assert res.json() == {"error": "purchase_disabled"}
    me = client.get("/api/me").json()
    assert (me["tier"], me["tickets"]) == ("member", 0)


def test_admin_gets_ten_tickets_each_time(client):
    login_admin(client)
    first = client.post(URL)
    assert first.status_code == 200
    body = first.json()
    assert (body["tier"], body["tickets"], body["isAdmin"]) == ("premium", 10, True)
    assert client.post(URL).json()["tickets"] == 20
```

- [ ] **Step 2: 실패 확인**

Run: `uv run pytest tests/test_purchase.py -q`
Expected: FAIL — `ImportError: cannot import name 'TICKETS_PER_PURCHASE'`

- [ ] **Step 3: 구현**

`backend/app/repos/users.py`: `from app.ids import new_id` 다음에 빈 줄을 두고 `TICKETS_PER_PURCHASE = 10`을 넣고, 맨 아래에 추가:

```python
def grant_tickets(
    conn: sqlite3.Connection, user_id: str, count: int = TICKETS_PER_PURCHASE
) -> User:
    conn.execute(
        "UPDATE users SET tier = 'premium', tickets = tickets + ? WHERE id = ?", (count, user_id)
    )
    return _require(get_by_id(conn, user_id))
```

`backend/app/routers/premium.py`:

```python
"""프리미엄: 목업 결제(관리자 전용)와 벤 면접 (spec 4.4)."""

from fastapi import APIRouter

from app import db
from app.deps import Db, LoggedInUser
from app.errors import ApiError
from app.presenters import to_session
from app.repos import users
from app.schemas import Session

router = APIRouter()


@router.post("/premium/purchase", response_model=Session)
def purchase(user: LoggedInUser, conn: Db) -> Session:
    # 공개 사이트라 일반 계정은 막는다. 마지막 방어선은 BEN_DAILY_LIMIT.
    if not user.is_admin:
        raise ApiError(403, "purchase_disabled")
    with db.transaction(conn):
        updated = users.grant_tickets(conn, user.id)
    return to_session(updated)
```

`backend/app/main.py`: 라우터 import 줄을 `from app.routers import archive, auth, health, manifest, me, premium, questions, resumes`로 바꾸고, `app.include_router(archive.router, prefix="/api")` 다음 줄에 `    app.include_router(premium.router, prefix="/api")`를 넣는다.

- [ ] **Step 4: 통과 확인**

Run: `uv run pytest tests/test_purchase.py -q`
Expected: PASS (4 passed)

- [ ] **Step 5: 커밋**

```bash
uv run ruff check --fix . && uv run ruff format . && uv run pytest -q
git add app/repos/users.py app/routers/premium.py app/main.py tests/test_purchase.py
git commit -m "feat(backend): 관리자 전용 목업 결제 — 프리미엄 전환·티켓 10장, 일반 계정은 403 purchase_disabled"
```

---

### Task 16: 벤 프롬프트(회사·대입)와 프론트 문구 동일성 테스트

**Files:**
- Create: `backend/app/llm/__init__.py`(빈 파일), `backend/app/llm/prompts.py`
- Modify: `backend/pyproject.toml`, `.github/workflows/ci.yml`
- Test: `backend/tests/test_prompts.py`, `backend/tests/test_prompt_parity.py`

**Interfaces:**
- Produces (`app.llm.prompts`):
  - 상수 `END_PHRASE`, `KICKOFF`, `REPORT_INSTRUCTION`, `SHARP_CHARACTER`, `SHARP_FOLLOW_UP`, `SHARP_REACTION`, `SHARP_REPORT_TONE`, `FIELD_LABELS`, `COMPANY_FOCUS`, `ADMISSION_FOCUS`
  - `build_system(track: str, inputs: dict) -> list[dict]` — `[{"type":"text","text":소개+규칙}, {"type":"text","text":"[지원자 이력서|자기소개서]\n…","cache_control":{"type":"ephemeral"}}]`. `inputs`는 `{"resumeText": str, "company": {...}}` 또는 `{"resumeText": str, "admission": {...}}`
  - `turn_messages(messages: list[dict], answer: str | None) -> list[dict]` — `[user KICKOFF, (assistant|user)…, (user answer)]`. 저장 메시지 `{"role":"model"|"user","text":...}`를 Claude 메시지 `{"role":"assistant"|"user","content":...}`로
  - `report_instruction() -> str` (프론트 `buildReportInstruction(PERSONAS.sharp)`과 같은 규칙), `report_messages(messages) -> list[dict]`
  - `has_end_phrase(text: str) -> bool` (공백 무시)

- [ ] **Step 1: 실패하는 테스트 작성**

`backend/tests/test_prompts.py`:

```python
from app.llm import prompts

COMPANY = {"resumeText": "백엔드 3년, 결제 시스템", "company": {"field": "it", "job": "백엔드 개발자"}}
ADMISSION = {
    "resumeText": "로봇 동아리에서 자율주행을 탐구했습니다",
    "admission": {"name": "홍길동", "age": 19, "university": "한국대학교", "department": "컴퓨터공학과"},
}
HISTORY = [{"role": "model", "text": "자기소개 해 주세요."}]


def test_company_system_blocks():
    rules, resume = prompts.build_system("company", COMPANY)
    text = rules["text"]
    assert 'IT 분야 기업의 채용 면접관입니다. 지원 직무는 "백엔드 개발자"입니다.' in text
    assert prompts.SHARP_CHARACTER in text
    assert prompts.SHARP_FOLLOW_UP in text
    assert f'정확히 이 문장으로 끝냅니다: "{prompts.END_PHRASE}."' in text
    assert "질문 5개" in text
    assert "cache_control" not in rules
    assert resume == {
        "type": "text",
        "text": "[지원자 이력서]\n백엔드 3년, 결제 시스템",
        "cache_control": {"type": "ephemeral"},
    }


def test_admission_system_blocks():
    rules, essay = prompts.build_system("admission", ADMISSION)
    for part in ("한국대학교 컴퓨터공학과의 입학 면접관", "홍길동(19세)", "전공 적합성", "탐구 경험", "자기소개서에 쓴 내용의 근거"):
        assert part in rules["text"]
    assert essay["text"] == "[지원자 자기소개서]\n로봇 동아리에서 자율주행을 탐구했습니다"
    assert essay["cache_control"] == {"type": "ephemeral"}


def test_unknown_field_uses_the_code():
    rules, _ = prompts.build_system("company", {**COMPANY, "company": {"field": "space", "job": "x"}})
    assert "space 분야 기업" in rules["text"]


def test_turn_messages():
    assert prompts.turn_messages([], None) == [{"role": "user", "content": "면접을 시작해 주세요."}]
    assert prompts.turn_messages(HISTORY, "안녕하세요") == [
        {"role": "user", "content": prompts.KICKOFF},
        {"role": "assistant", "content": "자기소개 해 주세요."},
        {"role": "user", "content": "안녕하세요"},
    ]


def test_report_messages_end_with_sharp_instruction():
    msgs = prompts.report_messages(HISTORY)
    last = msgs[-1]
    assert last["role"] == "user"
    assert f"\n{prompts.SHARP_REPORT_TONE}\n\n[" in last["content"]
    assert last["content"].replace(f"\n{prompts.SHARP_REPORT_TONE}", "", 1) == prompts.REPORT_INSTRUCTION
    assert msgs[:-1] == prompts.turn_messages(HISTORY, None)


def test_has_end_phrase_ignores_spaces():
    assert prompts.has_end_phrase("수고하셨습니다. 면접을 마치겠습니다.")
    assert prompts.has_end_phrase("면접을  마치 겠습니다")
    assert not prompts.has_end_phrase("다음 질문입니다.")
```

`backend/tests/test_prompt_parity.py`:

```python
"""벤 프롬프트가 프론트와 글자까지 같은지 (spec 4.4). 프론트 파일을 리포에서 직접 읽는다."""

import re
from pathlib import Path

from app.llm import prompts

FRONTEND_SRC = Path(__file__).resolve().parents[2] / "frontend" / "src"


def _read(rel: str) -> str:
    return (FRONTEND_SRC / rel).read_text(encoding="utf-8").replace("\r\n", "\n")


def test_report_instruction_matches_frontend():
    m = re.search(r"export const REPORT_INSTRUCTION = `(.*?)`", _read("prompts/report.ts"), re.S)
    assert m is not None
    assert prompts.REPORT_INSTRUCTION == m.group(1)


def test_end_phrase_matches_frontend():
    m = re.search(r"export const END_PHRASE = '([^']*)'", _read("utils/endDetector.ts"))
    assert m is not None
    assert prompts.END_PHRASE == m.group(1)


def test_kickoff_matches_frontend():
    m = re.search(r"export const KICKOFF = '([^']*)'", _read("prompts/interviewer.ts"))
    assert m is not None
    assert prompts.KICKOFF == m.group(1)


def test_ben_is_the_sharp_persona():
    assert re.search(r"make\('m2', '벤',[^\n]*'sharp'", _read("interviewers/index.ts"))


def test_sharp_persona_text_matches_frontend():
    src = _read("prompts/personas.ts")
    sharp = src[src.index("  sharp: {") :]
    for value in (prompts.SHARP_CHARACTER, prompts.SHARP_FOLLOW_UP, prompts.SHARP_REPORT_TONE):
        assert f"'{value}'" in sharp
    assert f"reaction: '{prompts.SHARP_REACTION}'" in sharp
```

- [ ] **Step 2: 실패 확인**

Run: `uv run pytest tests/test_prompts.py tests/test_prompt_parity.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.llm'`

- [ ] **Step 3: 구현**

`backend/app/llm/__init__.py`: 빈 파일.

`backend/app/llm/prompts.py` (리포트 지시문은 `frontend/src/prompts/report.ts`의 `REPORT_INSTRUCTION`을 그대로 옮긴 것이다):

```python
"""벤(프리미엄 면접관) 프롬프트 (spec 4.4). 백엔드 계층 규율 경로.

바꾸면 demomo에서 벤 1회 완주 + 리포트 JSON 파싱을 확인한다.
프론트와 글자까지 같아야 하는 값(tests/test_prompt_parity.py가 묶는다):
- END_PHRASE ↔ frontend/src/utils/endDetector.ts
- KICKOFF ↔ frontend/src/prompts/interviewer.ts
- REPORT_INSTRUCTION ↔ frontend/src/prompts/report.ts
- SHARP_* ↔ frontend/src/prompts/personas.ts의 sharp (벤 = m2 = sharp)
"""

from typing import Any

Message = dict[str, Any]

END_PHRASE = "면접을 마치겠습니다"
KICKOFF = "면접을 시작해 주세요."

REPORT_INSTRUCTION = """면접이 끝났습니다. 지금까지 당신이 한 질문과 지원자의 답변을 문항별로 정리해 피드백을 작성하세요.
꼬리질문은 원래 질문에 합쳐 하나의 문항으로 다룹니다.
아래 JSON 배열 형식으로만 출력하고, 다른 말은 하지 마세요. 코드 펜스는 써도 됩니다.
feedback 안에서 가장 중요한 구절 하나는 **별표 두 개**로 감싸 강조하세요.

[
  {"question": "질문 원문", "answerSummary": "지원자 답변 요약 (한두 문장)", "feedback": "구체적인 피드백 (두세 문장, 점수 없이)"}
]"""

SHARP_CHARACTER = "논리와 근거를 엄격하게 확인합니다. 간결하고 건조한 존댓말을 쓰고, 수치·근거·본인의 기여·한계를 캐묻습니다. 모호한 표현은 구체적으로 되묻습니다. 무례하거나 인신공격적인 표현은 쓰지 않습니다."
SHARP_FOLLOW_UP = "지원자의 답변에 근거·수치·본인의 기여가 부족하거나 모호하면 꼬리질문으로 구체적으로 되묻습니다. 한 질문당 꼬리질문은 최대 2개입니다."
SHARP_REACTION = "네."
SHARP_REPORT_TONE = "칭찬은 생략하고 근거 부족·모호한 표현·빠진 수치를 직설적으로 짚습니다."

# 프론트 stores/interview.ts FIELD_LABELS와 같은 이름
FIELD_LABELS = {"it": "IT", "finance": "금융", "manufacturing": "제조", "retail": "유통", "general": "기타"}

COMPANY_FOCUS = "이력서 내용을 근거로 질문 5개를 준비해 순서대로 진행합니다. 첫 질문은 자기소개입니다."
ADMISSION_FOCUS = (
    "자기소개서 내용을 근거로 질문 5개를 준비해 순서대로 진행합니다. 첫 질문은 자기소개입니다. "
    "전공 적합성, 탐구 경험, 자기소개서에 쓴 내용의 근거를 고르게 묻습니다."
)


def _rules(focus: str) -> str:
    # 로컬 면접관(frontend/src/prompts/interviewer.ts)과 같은 진행 규칙. 2번만 트랙별로 다르다.
    return "\n".join(
        [
            "[진행 규칙]",
            "1. 한국어 존댓말을 씁니다. 한 번에 질문을 하나만 합니다. 질문은 두 문장 이내로 짧게 합니다.",
            f"2. {focus}",
            f"3. {SHARP_FOLLOW_UP}",
            f'4. 답변에 대한 평가, 점수, 조언은 면접 중에는 절대 말하지 않습니다. 짧은 반응("{SHARP_REACTION}" 정도)만 허용됩니다.',
            "5. 질문 번호나 남은 질문 수를 말하지 않습니다.",
            f'6. 다섯 번째 질문의 답변(꼬리질문 포함)이 끝나면 정확히 이 문장으로 끝냅니다: "{END_PHRASE}."',
            "7. 질문 외의 설명, 머리말, 이모지, 마크다운은 쓰지 않습니다.",
        ]
    )


def _company_intro(company: dict[str, Any]) -> str:
    label = FIELD_LABELS.get(company["field"], company["field"])
    return (
        f'당신은 {label} 분야 기업의 채용 면접관입니다. 지원 직무는 "{company["job"]}"입니다.\n'
        "지금부터 지원자와 1:1 모의 면접을 진행합니다.\n"
        f"{SHARP_CHARACTER}"
    )


def _admission_intro(a: dict[str, Any]) -> str:
    return (
        f"당신은 {a['university']} {a['department']}의 입학 면접관입니다. "
        f"지원자는 {a['name']}({a['age']}세)입니다.\n"
        "지금부터 지원자와 1:1 모의 입학 면접을 진행합니다.\n"
        f"{SHARP_CHARACTER}"
    )


def build_system(track: str, inputs: dict[str, Any]) -> list[dict[str, Any]]:
    """[소개+규칙, 이력서] 두 블록. 면접 내내 같으므로 끝 블록에 캐시를 건다."""
    if track == "company":
        intro = _company_intro(inputs["company"])
        focus, heading = COMPANY_FOCUS, "[지원자 이력서]"
    else:
        intro = _admission_intro(inputs["admission"])
        focus, heading = ADMISSION_FOCUS, "[지원자 자기소개서]"
    return [
        {"type": "text", "text": f"{intro}\n\n{_rules(focus)}"},
        {
            "type": "text",
            "text": f"{heading}\n{inputs['resumeText']}",
            "cache_control": {"type": "ephemeral"},
        },
    ]


def _history(messages: list[Message]) -> list[Message]:
    out: list[Message] = [{"role": "user", "content": KICKOFF}]
    for m in messages:
        role = "assistant" if m["role"] == "model" else "user"
        out.append({"role": role, "content": m["text"]})
    return out


def turn_messages(messages: list[Message], answer: str | None) -> list[Message]:
    out = _history(messages)
    if answer is not None:
        out.append({"role": "user", "content": answer})
    return out


def report_instruction() -> str:
    """프론트 buildReportInstruction(PERSONAS.sharp)과 같다: JSON 예시 앞에 말투 한 줄."""
    return REPORT_INSTRUCTION.replace("\n\n[", f"\n{SHARP_REPORT_TONE}\n\n[", 1)


def report_messages(messages: list[Message]) -> list[Message]:
    return [*_history(messages), {"role": "user", "content": report_instruction()}]


def has_end_phrase(text: str) -> bool:
    """프론트 hasEndPhrase와 같다: 공백을 모두 빼고 비교한다."""
    return "".join(END_PHRASE.split()) in "".join(text.split())
```

`backend/pyproject.toml`의 `[tool.ruff.lint.per-file-ignores]`에 한 줄 추가(프롬프트 원문은 줄을 나누면 프론트와 글자가 달라진다):

```toml
"app/llm/prompts.py" = ["E501"]
```

`.github/workflows/ci.yml`의 `changes` job 필터에서 `backend:` 목록을 아래로 바꾼다(프론트 프롬프트만 바뀌어도 동일성 테스트가 돈다):

```yaml
            backend:
              - 'backend/**'
              - 'docs/API.md'
              - 'frontend/src/prompts/**'
              - 'frontend/src/utils/endDetector.ts'
              - 'frontend/src/interviewers/index.ts'
```

- [ ] **Step 4: 통과 확인**

Run: `uv run pytest tests/test_prompts.py tests/test_prompt_parity.py -q`
Expected: PASS (11 passed)

- [ ] **Step 5: 커밋**

```bash
uv run ruff check --fix . && uv run ruff format . && uv run pytest -q
git add app/llm/__init__.py app/llm/prompts.py tests/test_prompts.py tests/test_prompt_parity.py pyproject.toml ../.github/workflows/ci.yml
git commit -m "feat(backend): 벤 프롬프트(회사·대입)와 프론트 종료 문장·리포트 지시문·sharp 말투 동일성 테스트"
```

---

### Task 17: Claude 클라이언트(`ClaudeClient` 프로토콜·`AnthropicClaude`)와 주입

**Files:**
- Create: `backend/app/llm/claude.py`
- Modify: `backend/pyproject.toml`, `backend/uv.lock` (`uv add anthropic`), `backend/app/main.py`, `backend/tests/fakes.py`, `backend/tests/conftest.py`
- Test: `backend/tests/test_claude.py`

**Interfaces:**
- Produces:
  - `app.llm.claude.MODEL = "claude-sonnet-5-5"`, `TURN_MAX_TOKENS = 4096`, `REPORT_MAX_TOKENS = 16000`, `FALLBACK_BETA = "server-side-fallback-2026-07-01"`, `Effort = Literal["low", "medium"]`
  - `ClaudeError(code: str)`(속성 `code`: `"claude_error"` | `"refused"`)
  - `ClaudeClient`(Protocol): `stream_text(*, system: list[dict], messages: list[dict], effort: Effort, max_tokens: int) -> Iterator[str]`
  - `AnthropicClaude(api_key: str | None = None, *, sdk: Any = None)` — 공식 SDK `messages.stream(...)`
  - `create_app(..., claude: ClaudeClient | None = None)` — None이면 `ANTHROPIC_API_KEY`가 있을 때만 `AnthropicClaude`, 없으면 `app.state.claude = None`
  - `tests.fakes.FakeClaude` — `replies: list[list[str | Exception]]`, `calls: list[dict]`, 기본 응답 `["자기소개를 ", "해 주세요."]`
  - 픽스처 `fake_claude`, `make_client(settings, claude=fake_claude)`

- [ ] **Step 1: 의존성 추가와 SDK 확인**

Run: `uv add anthropic`
Expected: `pyproject.toml`의 `dependencies`에 `anthropic>=...`, `uv.lock` 갱신.

Run: `uv run python -c "import inspect; from anthropic.resources.messages import Messages; print('output_config' in inspect.signature(Messages.stream).parameters)"`
Expected: `True`. (`False`가 나오면 SDK가 오래된 것이다. 그때는 Step 4의 `output_config={"effort": effort},` 줄을 지우고 `extra_body={"fallbacks": "default", "output_config": {"effort": effort}},`로 합치며, Step 2 테스트의 `kw["output_config"]` 확인을 `kw["extra_body"]["output_config"] == {"effort": "low"}`로 바꾼다.)

- [ ] **Step 2: 실패하는 테스트 작성**

`backend/tests/test_claude.py`:

```python
from dataclasses import replace
from types import SimpleNamespace

import anthropic
import pytest

from app.llm.claude import FALLBACK_BETA, MODEL, AnthropicClaude, ClaudeError
from app.main import create_app

SYSTEM = [
    {"type": "text", "text": "규칙"},
    {"type": "text", "text": "이력서", "cache_control": {"type": "ephemeral"}},
]
MESSAGES = [{"role": "user", "content": "면접을 시작해 주세요."}]


class _Stream:
    def __init__(self, chunks, stop_reason="end_turn"):
        self._chunks = chunks
        self._stop = stop_reason

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    @property
    def text_stream(self):
        return iter(self._chunks)

    def get_final_message(self):
        return SimpleNamespace(stop_reason=self._stop)


class _Messages:
    def __init__(self, stream=None, error=None):
        self.kwargs = None
        self._stream = stream
        self._error = error

    def stream(self, **kwargs):
        self.kwargs = kwargs
        if self._error is not None:
            raise self._error
        return self._stream


class _ApiFailure(anthropic.APIError):
    def __init__(self):
        Exception.__init__(self, "upstream failed")


def _claude(messages: _Messages) -> AnthropicClaude:
    return AnthropicClaude(sdk=SimpleNamespace(messages=messages))


def test_streams_text_with_model_effort_cache_and_fallback():
    messages = _Messages(stream=_Stream(["안녕", "하세요"]))
    out = list(_claude(messages).stream_text(system=SYSTEM, messages=MESSAGES, effort="low", max_tokens=4096))
    assert out == ["안녕", "하세요"]
    kw = messages.kwargs
    assert kw["model"] == MODEL == "claude-sonnet-5-5"
    assert kw["max_tokens"] == 4096
    assert kw["system"] == SYSTEM
    assert kw["messages"] == MESSAGES
    assert kw["output_config"] == {"effort": "low"}
    assert kw["extra_body"] == {"fallbacks": "default"}
    assert kw["extra_headers"] == {"anthropic-beta": FALLBACK_BETA}
    assert FALLBACK_BETA == "server-side-fallback-2026-07-01"


def test_refusal_becomes_claude_error():
    messages = _Messages(stream=_Stream(["부분"], stop_reason="refusal"))
    gen = _claude(messages).stream_text(system=SYSTEM, messages=MESSAGES, effort="medium", max_tokens=16000)
    assert next(gen) == "부분"
    with pytest.raises(ClaudeError) as exc:
        next(gen)
    assert exc.value.code == "refused"


def test_api_error_becomes_claude_error():
    messages = _Messages(error=_ApiFailure())
    with pytest.raises(ClaudeError) as exc:
        list(_claude(messages).stream_text(system=SYSTEM, messages=MESSAGES, effort="low", max_tokens=4096))
    assert exc.value.code == "claude_error"


def test_app_builds_real_client_only_with_key(settings):
    assert create_app(settings=settings).state.claude is None
    app = create_app(settings=replace(settings, anthropic_api_key="sk-test"))
    assert isinstance(app.state.claude, AnthropicClaude)


def test_injected_client_wins(settings, fake_claude):
    assert create_app(settings=settings, claude=fake_claude).state.claude is fake_claude
```

- [ ] **Step 3: 실패 확인**

Run: `uv run pytest tests/test_claude.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.llm.claude'`

- [ ] **Step 4: 구현**

`backend/app/llm/claude.py`:

```python
"""벤의 Claude 호출 (spec 4.4). 라우터는 ClaudeClient만 알고, 테스트는 가짜를 넣는다."""

from collections.abc import Iterator
from typing import Any, Literal, Protocol

import anthropic

MODEL = "claude-sonnet-5-5"
TURN_MAX_TOKENS = 4096
REPORT_MAX_TOKENS = 16000
FALLBACK_BETA = "server-side-fallback-2026-07-01"

Effort = Literal["low", "medium"]


class ClaudeError(Exception):
    """호출 실패(claude_error) 또는 안전 분류기 거절(refused)."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


class ClaudeClient(Protocol):
    def stream_text(
        self,
        *,
        system: list[dict[str, Any]],
        messages: list[dict[str, Any]],
        effort: Effort,
        max_tokens: int,
    ) -> Iterator[str]: ...


class AnthropicClaude:
    """공식 SDK 스트리밍. 키는 ANTHROPIC_API_KEY(서버 .env)."""

    def __init__(self, api_key: str | None = None, *, sdk: Any = None) -> None:
        self._sdk = sdk if sdk is not None else anthropic.Anthropic(api_key=api_key)

    def stream_text(
        self,
        *,
        system: list[dict[str, Any]],
        messages: list[dict[str, Any]],
        effort: Effort,
        max_tokens: int,
    ) -> Iterator[str]:
        try:
            with self._sdk.messages.stream(
                model=MODEL,
                max_tokens=max_tokens,
                system=system,
                messages=messages,
                output_config={"effort": effort},
                # 안전 분류기 거절 시 서버 측 폴백. SDK 타입에 아직 없을 수 있어
                # 본문·헤더로 그대로 보낸다(fallbacks "default" + 베타 헤더).
                extra_body={"fallbacks": "default"},
                extra_headers={"anthropic-beta": FALLBACK_BETA},
            ) as stream:
                yield from stream.text_stream
                final = stream.get_final_message()
        except anthropic.APIError as exc:
            raise ClaudeError("claude_error") from exc
        if final.stop_reason == "refusal":
            raise ClaudeError("refused")
```

`backend/tests/fakes.py` 전체를 아래로 바꾼다:

```python
"""테스트용 가짜 — 시계(요청 수 제한·세션 만료·하루 상한)와 Claude."""

from collections.abc import Iterator
from typing import Any

DEFAULT_REPLY = ["자기소개를 ", "해 주세요."]


class FakeClock:
    def __init__(self, start: float = 1_760_000_000.0) -> None:
        self.now = start

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


class FakeClaude:
    """replies에 넣은 순서대로 조각을 흘린다. 항목이 예외면 그 자리에서 던진다."""

    def __init__(self) -> None:
        self.replies: list[list[Any]] = []
        self.calls: list[dict[str, Any]] = []

    def stream_text(
        self,
        *,
        system: list[dict[str, Any]],
        messages: list[dict[str, Any]],
        effort: str,
        max_tokens: int,
    ) -> Iterator[str]:
        self.calls.append(
            {"system": system, "messages": messages, "effort": effort, "max_tokens": max_tokens}
        )
        reply = self.replies.pop(0) if self.replies else list(DEFAULT_REPLY)
        for item in reply:
            if isinstance(item, Exception):
                raise item
            yield item
```

`backend/tests/conftest.py`:
- import에 `from app.llm.claude import ClaudeClient`를 넣고 `from tests.fakes import FakeClock`를 `from tests.fakes import FakeClaude, FakeClock`로 바꾼다.
- `make_client` 픽스처를 아래로 바꾸고, 그 위에 `fake_claude` 픽스처를 넣는다:

```python
@pytest.fixture
def fake_claude() -> FakeClaude:
    return FakeClaude()


@pytest.fixture
def make_client(clock: FakeClock, fake_claude: FakeClaude) -> Iterator[Callable[..., TestClient]]:
    with ExitStack() as stack:

        def _make(s: Settings, claude: ClaudeClient | None = fake_claude) -> TestClient:
            # claude=None이면 설정(ANTHROPIC_API_KEY)에 맡긴다 — 테스트 설정엔 키가 없어 None
            app = create_app(settings=s, clock=clock, claude=claude)
            return stack.enter_context(TestClient(app, headers={"Origin": ORIGIN}))

        yield _make
```

`backend/app/main.py`:
- import에 `from app.llm.claude import AnthropicClaude, ClaudeClient`를 넣는다.
- `create_app`의 인자 목록 끝(`clock` 다음)에 `claude: ClaudeClient | None = None,`을 넣는다.
- `app.state.limiter = RateLimiter(clock)` 다음 줄에 `    app.state.claude = claude if claude is not None else _default_claude(cfg)`를 넣는다.
- `create_app` 정의 바로 위에 추가:

```python
def _default_claude(cfg: Settings) -> ClaudeClient | None:
    # 키가 없으면 벤을 끈다(시작에서 503 ben_unavailable, 티켓 차감 없음)
    return AnthropicClaude(cfg.anthropic_api_key) if cfg.anthropic_api_key else None
```

- [ ] **Step 5: 통과 확인**

Run: `uv run pytest tests/test_claude.py -q`
Expected: PASS (5 passed). 이어서 `uv run pytest -q` 전체 PASS.

- [ ] **Step 6: 커밋**

```bash
uv run ruff check --fix . && uv run ruff format . && uv run pytest -q
git add pyproject.toml uv.lock app/llm/claude.py app/main.py tests/fakes.py tests/conftest.py tests/test_claude.py
git commit -m "feat(backend): Claude 클라이언트 — claude-sonnet-5-5 스트리밍, effort, 서버 측 폴백, 거절·오류를 ClaudeError로, 앱에 주입"
```

---

### Task 18: 벤 면접 저장소(하루 상한·티켓 차감 원자성·턴 기록)

**Files:**
- Create: `backend/app/repos/premium.py`
- Test: `backend/tests/test_repo_premium.py`

**Interfaces:**
- Consumes: `db.transaction`(Task 4), `new_id`(Task 3), `premium_interviews` 테이블(Task 10)
- Produces:
  - `app.repos.premium.MAX_MODEL_TURNS = 15`
  - `PremiumInterview`(frozen): `id, user_id, track, inputs: dict, messages: list[dict], model_turns: int, status: str, created_at: str`
  - `NoTickets`, `DailyLimitReached`
  - `start_interview(conn, *, user_id, track, inputs, created_at: str, day_start: str, daily_limit: int) -> str` — 상한 확인 → 티켓 차감 → 행 생성(한 트랜잭션)
  - `get_interview(conn, *, user_id, interview_id) -> PremiumInterview | None`
  - `append_turn(conn, *, interview_id, answer: str | None, model_text: str) -> PremiumInterview`
  - `mark_done(conn, *, interview_id) -> None`

- [ ] **Step 1: 실패하는 테스트 작성**

`backend/tests/test_repo_premium.py`:

```python
from concurrent.futures import ThreadPoolExecutor

import pytest

from app import db
from app.repos import premium, users
from tests.helpers import T0

DAY_START = "2026-10-12T15:00:00.000Z"  # 2026-10-13 0시(KST)
INPUTS = {"resumeText": "이력서", "company": {"field": "it", "job": "백엔드"}}


@pytest.fixture
def path(tmp_path):
    p = tmp_path / "t.sqlite3"
    db.init_db(p)
    return p


def _premium_user(conn, email="a@b.com", tickets=2) -> str:
    uid = users.create_user(conn, email=email, password_hash="h", name=None, created_at=T0).id
    conn.execute("UPDATE users SET tier = 'premium', tickets = ? WHERE id = ?", (tickets, uid))
    return uid


def _start(conn, uid, created_at=T0, limit=30) -> str:
    return premium.start_interview(
        conn, user_id=uid, track="company", inputs=INPUTS,
        created_at=created_at, day_start=DAY_START, daily_limit=limit,
    )


def _tickets(conn, uid) -> int:
    return users.get_by_id(conn, uid).tickets


def test_max_model_turns_is_15():
    assert premium.MAX_MODEL_TURNS == 15


def test_start_spends_a_ticket_and_creates_a_row(path):
    with db.connection(path) as conn:
        uid = _premium_user(conn)
        iid = _start(conn, uid)
        assert iid.startswith("pi_")
        assert _tickets(conn, uid) == 1
        iv = premium.get_interview(conn, user_id=uid, interview_id=iid)
        assert iv is not None
        assert (iv.track, iv.inputs, iv.messages, iv.model_turns, iv.status) == (
            "company", INPUTS, [], 0, "active",
        )


def test_no_tickets(path):
    with db.connection(path) as conn:
        uid = _premium_user(conn, tickets=0)
        with pytest.raises(premium.NoTickets):
            _start(conn, uid)
        assert conn.execute("SELECT COUNT(*) FROM premium_interviews").fetchone()[0] == 0


def test_daily_limit_counts_everyone_today_and_keeps_tickets(path):
    with db.connection(path) as conn:
        a = _premium_user(conn)
        b = _premium_user(conn, "b@b.com")
        _start(conn, a, created_at="2026-10-12T14:59:59.999Z", limit=2)  # 어제(KST)라 세지 않는다
        _start(conn, a, limit=2)
        _start(conn, b, limit=2)
        with pytest.raises(premium.DailyLimitReached):
            _start(conn, b, limit=2)
        assert _tickets(conn, b) == 1


def test_concurrent_starts_spend_each_ticket_once(path):
    with db.connection(path) as conn:
        uid = _premium_user(conn, tickets=3)

    def attempt(_: int) -> bool:
        with db.connection(path) as c:
            try:
                _start(c, uid)
                return True
            except premium.NoTickets:
                return False

    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(attempt, range(8)))
    assert results.count(True) == 3
    with db.connection(path) as conn:
        assert _tickets(conn, uid) == 0
        assert conn.execute("SELECT COUNT(*) FROM premium_interviews").fetchone()[0] == 3


def test_append_turn_and_mark_done(path):
    with db.connection(path) as conn:
        uid = _premium_user(conn)
        iid = _start(conn, uid)
        iv = premium.append_turn(conn, interview_id=iid, answer=None, model_text="자기소개 해 주세요.")
        assert iv.messages == [{"role": "model", "text": "자기소개 해 주세요."}]
        assert iv.model_turns == 1
        iv = premium.append_turn(conn, interview_id=iid, answer="안녕하세요", model_text="다음 질문")
        assert [m["role"] for m in iv.messages] == ["model", "user", "model"]
        assert iv.model_turns == 2
        premium.mark_done(conn, interview_id=iid)
        assert premium.get_interview(conn, user_id=uid, interview_id=iid).status == "done"


def test_get_is_scoped_to_owner(path):
    with db.connection(path) as conn:
        uid = _premium_user(conn)
        other = _premium_user(conn, "b@b.com")
        iid = _start(conn, uid)
        assert premium.get_interview(conn, user_id=other, interview_id=iid) is None
```

- [ ] **Step 2: 실패 확인**

Run: `uv run pytest tests/test_repo_premium.py -q`
Expected: FAIL — `ImportError: cannot import name 'premium' from 'app.repos'`

- [ ] **Step 3: 구현**

`backend/app/repos/premium.py`:

```python
"""premium_interviews SQL (spec 4.4). 티켓 1장 = 1행. 대화 기록은 서버가 가진다."""

import json
import sqlite3
from dataclasses import dataclass
from typing import Any

from app.db import transaction
from app.ids import new_id

MAX_MODEL_TURNS = 15


@dataclass(frozen=True)
class PremiumInterview:
    id: str
    user_id: str
    track: str
    inputs: dict[str, Any]
    messages: list[dict[str, Any]]
    model_turns: int
    status: str
    created_at: str


class NoTickets(Exception):
    """남은 티켓이 없다."""


class DailyLimitReached(Exception):
    """오늘(한국 날짜) 서버 전체 벤 면접 수가 상한에 닿았다."""


def _interview(row: sqlite3.Row) -> PremiumInterview:
    return PremiumInterview(
        id=row["id"],
        user_id=row["user_id"],
        track=row["track"],
        inputs=json.loads(row["inputs_json"]),
        messages=json.loads(row["messages_json"]),
        model_turns=row["model_turns"],
        status=row["status"],
        created_at=row["created_at"],
    )


def start_interview(
    conn: sqlite3.Connection,
    *,
    user_id: str,
    track: str,
    inputs: dict[str, Any],
    created_at: str,
    day_start: str,
    daily_limit: int,
) -> str:
    """하루 상한 확인 → 티켓 차감 → 행 생성을 한 트랜잭션으로."""
    interview_id = new_id("pi")
    with transaction(conn):
        used = conn.execute(
            "SELECT COUNT(*) FROM premium_interviews WHERE created_at >= ?", (day_start,)
        ).fetchone()[0]
        if used >= daily_limit:
            raise DailyLimitReached
        cur = conn.execute(
            "UPDATE users SET tickets = tickets - 1 WHERE id = ? AND tickets > 0", (user_id,)
        )
        if cur.rowcount == 0:
            raise NoTickets
        conn.execute(
            "INSERT INTO premium_interviews (id, user_id, track, inputs_json, created_at)"
            " VALUES (?, ?, ?, ?, ?)",
            (interview_id, user_id, track, json.dumps(inputs, ensure_ascii=False), created_at),
        )
    return interview_id


def get_interview(
    conn: sqlite3.Connection, *, user_id: str, interview_id: str
) -> PremiumInterview | None:
    row = conn.execute(
        "SELECT * FROM premium_interviews WHERE id = ? AND user_id = ?", (interview_id, user_id)
    ).fetchone()
    return _interview(row) if row is not None else None


def append_turn(
    conn: sqlite3.Connection, *, interview_id: str, answer: str | None, model_text: str
) -> PremiumInterview:
    """성공한 턴만 기록한다: (답변) + 면접관 응답, model_turns + 1."""
    with transaction(conn):
        row = conn.execute(
            "SELECT messages_json FROM premium_interviews WHERE id = ?", (interview_id,)
        ).fetchone()
        messages = json.loads(row["messages_json"])
        if answer is not None:
            messages.append({"role": "user", "text": answer})
        messages.append({"role": "model", "text": model_text})
        conn.execute(
            "UPDATE premium_interviews SET messages_json = ?, model_turns = model_turns + 1"
            " WHERE id = ?",
            (json.dumps(messages, ensure_ascii=False), interview_id),
        )
        updated = conn.execute(
            "SELECT * FROM premium_interviews WHERE id = ?", (interview_id,)
        ).fetchone()
    return _interview(updated)


def mark_done(conn: sqlite3.Connection, *, interview_id: str) -> None:
    conn.execute("UPDATE premium_interviews SET status = 'done' WHERE id = ?", (interview_id,))
```

- [ ] **Step 4: 통과 확인**

Run: `uv run pytest tests/test_repo_premium.py -q`
Expected: PASS (7 passed)

- [ ] **Step 5: 커밋**

```bash
uv run ruff check --fix . && uv run ruff format . && uv run pytest -q
git add app/repos/premium.py tests/test_repo_premium.py
git commit -m "feat(backend): 벤 면접 저장소 — 하루 상한·티켓 차감·행 생성을 한 트랜잭션으로, 성공한 턴만 기록"
```

---

### Task 19: 벤 면접 시작 `POST /api/premium/interviews`

**Files:**
- Modify: `backend/app/schemas.py`, `backend/app/routers/premium.py`
- Test: `backend/tests/test_premium_start.py`

**Interfaces:**
- Consumes: `premium.start_interview`(Task 18), `PremiumUser`(Task 8), `iso`·`kst_day_start`(Task 3), `app.state.claude`(Task 17), `users.get_by_id`(Task 7)
- Produces:
  - `app.schemas.NonBlank100`, `CompanyInputs`, `AdmissionInputs`, `InterviewStart`, `InterviewStarted`, `TurnBody`
  - `POST /api/premium/interviews` → `201 {"interviewId", "session"}` · `403 premium_required` · `409 no_tickets` · `422 missing_field`(`field`: `"company"`|`"admission"`) · `503 daily_limit` · `503 ben_unavailable`
  - 저장되는 `inputs`: `{"resumeText": str, "<track>": {...}}`

- [ ] **Step 1: 실패하는 테스트 작성**

`backend/tests/test_premium_start.py`:

```python
import json
from dataclasses import replace

from tests.helpers import (
    ADMISSION_START,
    COMPANY_START,
    login_admin,
    make_premium,
    open_db,
    signup,
)

URL = "/api/premium/interviews"


def _admin_with_tickets(client) -> None:
    login_admin(client)
    assert client.post("/api/premium/purchase").status_code == 200


def test_member_is_forbidden(client):
    signup(client)
    res = client.post(URL, json=COMPANY_START)
    assert res.status_code == 403
    assert res.json() == {"error": "premium_required"}


def test_start_company_spends_a_ticket(client, settings):
    _admin_with_tickets(client)
    res = client.post(URL, json=COMPANY_START)
    assert res.status_code == 201
    body = res.json()
    assert body["interviewId"].startswith("pi_")
    assert body["session"]["tickets"] == 9
    with open_db(settings) as conn:
        row = conn.execute("SELECT track, inputs_json, status FROM premium_interviews").fetchone()
    assert (row["track"], row["status"]) == ("company", "active")
    assert json.loads(row["inputs_json"]) == {
        "resumeText": COMPANY_START["resumeText"],
        "company": COMPANY_START["company"],
    }


def test_start_admission(client):
    _admin_with_tickets(client)
    assert client.post(URL, json=ADMISSION_START).status_code == 201


def test_missing_track_group(client):
    _admin_with_tickets(client)
    body = {"track": "company", "resumeText": "x", "admission": ADMISSION_START["admission"]}
    res = client.post(URL, json=body)
    assert res.status_code == 422
    assert res.json() == {"error": "missing_field", "field": "company"}


def test_resume_text_limit(client):
    _admin_with_tickets(client)
    res = client.post(URL, json={**COMPANY_START, "resumeText": "가" * 20_001})
    assert res.status_code == 422
    assert res.json() == {"error": "invalid", "field": "resumeText"}


def test_no_tickets(client, settings):
    me = signup(client)
    make_premium(settings, me["userId"], tickets=0)
    res = client.post(URL, json=COMPANY_START)
    assert res.status_code == 409
    assert res.json() == {"error": "no_tickets"}


def test_daily_limit_keeps_the_ticket(make_client, settings, clock):
    c = make_client(replace(settings, ben_daily_limit=1))
    _admin_with_tickets(c)
    assert c.post(URL, json=COMPANY_START).status_code == 201
    res = c.post(URL, json=COMPANY_START)
    assert res.status_code == 503
    assert res.json() == {"error": "daily_limit"}
    assert c.get("/api/me").json()["tickets"] == 9
    clock.advance(24 * 60 * 60)  # 다음 날(KST)
    assert c.post(URL, json=COMPANY_START).status_code == 201


def test_ben_unavailable_without_key(make_client, settings):
    c = make_client(settings, claude=None)
    _admin_with_tickets(c)
    res = c.post(URL, json=COMPANY_START)
    assert res.status_code == 503
    assert res.json() == {"error": "ben_unavailable"}
    assert c.get("/api/me").json()["tickets"] == 10
```

- [ ] **Step 2: 실패 확인**

Run: `uv run pytest tests/test_premium_start.py -q`
Expected: FAIL — `/api/premium/interviews`가 404(또는 405)

- [ ] **Step 3: 구현**

`backend/app/schemas.py` 맨 아래에 추가:

```python
# ── 벤 면접 ──

NonBlank100 = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]


class CompanyInputs(BaseModel):
    field: NonBlank100
    job: NonBlank100


class AdmissionInputs(BaseModel):
    name: NonBlank100
    age: int = Field(ge=1, le=120)
    university: NonBlank100
    department: NonBlank100


class InterviewStart(BaseModel):
    track: Track
    resumeText: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=20_000)
    ]
    company: CompanyInputs | None = None
    admission: AdmissionInputs | None = None


class InterviewStarted(BaseModel):
    interviewId: str
    session: Session


class TurnBody(BaseModel):
    answer: str | None = None
```

`backend/app/routers/premium.py` 전체를 아래로 바꾼다:

```python
"""프리미엄: 목업 결제(관리자 전용)와 벤 면접 3단계 (spec 4.4)."""

from fastapi import APIRouter, Request

from app import db
from app.deps import Db, LoggedInUser, PremiumUser
from app.errors import ApiError
from app.presenters import to_session
from app.repos import premium, users
from app.schemas import InterviewStart, InterviewStarted, Session
from app.timefmt import iso, kst_day_start

router = APIRouter()


@router.post("/premium/purchase", response_model=Session)
def purchase(user: LoggedInUser, conn: Db) -> Session:
    # 공개 사이트라 일반 계정은 막는다. 마지막 방어선은 BEN_DAILY_LIMIT.
    if not user.is_admin:
        raise ApiError(403, "purchase_disabled")
    with db.transaction(conn):
        updated = users.grant_tickets(conn, user.id)
    return to_session(updated)


@router.post("/premium/interviews", status_code=201, response_model=InterviewStarted)
def start_interview(
    body: InterviewStart, user: PremiumUser, conn: Db, request: Request
) -> InterviewStarted:
    if request.app.state.claude is None:
        raise ApiError(503, "ben_unavailable")
    group = body.company if body.track == "company" else body.admission
    if group is None:
        raise ApiError(422, "missing_field", field=body.track)
    inputs = {"resumeText": body.resumeText, body.track: group.model_dump()}
    now = request.app.state.clock()
    try:
        interview_id = premium.start_interview(
            conn,
            user_id=user.id,
            track=body.track,
            inputs=inputs,
            created_at=iso(now),
            day_start=kst_day_start(now),
            daily_limit=request.app.state.settings.ben_daily_limit,
        )
    except premium.DailyLimitReached:
        raise ApiError(503, "daily_limit") from None
    except premium.NoTickets:
        raise ApiError(409, "no_tickets") from None
    fresh = users.get_by_id(conn, user.id)
    if fresh is None:
        raise ApiError(401, "unauthorized")
    return InterviewStarted(interviewId=interview_id, session=to_session(fresh))
```

- [ ] **Step 4: 통과 확인**

Run: `uv run pytest tests/test_premium_start.py -q`
Expected: PASS (8 passed). 이어서 `uv run pytest -q` 전체 PASS.

- [ ] **Step 5: 커밋**

```bash
uv run ruff check --fix . && uv run ruff format . && uv run pytest -q
git add app/schemas.py app/routers/premium.py tests/test_premium_start.py
git commit -m "feat(backend): 벤 면접 시작 — 티켓 차감 원자성, 하루 상한 503 daily_limit, 키 없으면 503 ben_unavailable"
```

---

### Task 20: 벤 턴 `POST /api/premium/interviews/{id}/turns` (SSE)

**Files:**
- Create: `backend/app/sse.py`
- Modify: `backend/app/routers/premium.py`
- Test: `backend/tests/test_ben_turns.py`

**Interfaces:**
- Consumes: `premium.get_interview`·`append_turn`·`MAX_MODEL_TURNS`(Task 18), `prompts.build_system`·`turn_messages`·`has_end_phrase`(Task 16), `ClaudeClient`·`ClaudeError`·`TURN_MAX_TOKENS`(Task 17), `TurnBody`(Task 19), `db.connection`(Task 4)
- Produces:
  - `app.sse.SSE_HEADERS = {"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}`, `sse(event: str, data: dict) -> str`
  - `app.routers.premium.ANSWER_MAX = 2000`, `is_over(interview: PremiumInterview) -> bool`
  - SSE: `event: delta`/`data: {"text"}` … `event: done`/`data: {"ended": bool}` 또는 `event: error`/`data: {"code"}`
  - 스트림 전 JSON 오류: `404 not_found`, `409 interview_over`, `422 missing_answer`·`answer_too_long`(`field: "answer"`), `503 ben_unavailable`

- [ ] **Step 1: 실패하는 테스트 작성**

`backend/tests/test_ben_turns.py`:

```python
import json

from app.llm import prompts
from app.llm.claude import TURN_MAX_TOKENS, ClaudeError
from tests.helpers import logout, make_premium, open_db, signup, sse_events, start_ben


def _turn(client, iid, answer=None):
    body = {} if answer is None else {"answer": answer}
    return client.post(f"/api/premium/interviews/{iid}/turns", json=body)


def _row(settings, iid):
    with open_db(settings) as conn:
        return conn.execute(
            "SELECT messages_json, model_turns, status FROM premium_interviews WHERE id = ?", (iid,)
        ).fetchone()


def test_first_turn_streams_the_first_question(client, fake_claude, settings):
    iid = start_ben(client)
    res = _turn(client, iid, answer="첫 턴의 답변은 무시된다")
    assert res.status_code == 200
    assert res.headers["content-type"].startswith("text/event-stream")
    assert sse_events(res.text) == [
        ("delta", {"text": "자기소개를 "}),
        ("delta", {"text": "해 주세요."}),
        ("done", {"ended": False}),
    ]
    call = fake_claude.calls[0]
    assert call["effort"] == "low"
    assert call["max_tokens"] == TURN_MAX_TOKENS
    assert call["messages"] == [{"role": "user", "content": prompts.KICKOFF}]
    assert call["system"][-1]["cache_control"] == {"type": "ephemeral"}
    row = _row(settings, iid)
    assert row["model_turns"] == 1
    assert json.loads(row["messages_json"]) == [{"role": "model", "text": "자기소개를 해 주세요."}]


def test_answer_is_sent_and_recorded(client, fake_claude, settings):
    iid = start_ben(client)
    _turn(client, iid)
    res = _turn(client, iid, answer="  안녕하세요, 이우진입니다. ")
    assert sse_events(res.text)[-1] == ("done", {"ended": False})
    assert fake_claude.calls[1]["messages"][-2:] == [
        {"role": "assistant", "content": "자기소개를 해 주세요."},
        {"role": "user", "content": "안녕하세요, 이우진입니다."},
    ]
    roles = [m["role"] for m in json.loads(_row(settings, iid)["messages_json"])]
    assert roles == ["model", "user", "model"]


def test_later_turns_need_an_answer(client):
    iid = start_ben(client)
    _turn(client, iid)
    res = _turn(client, iid, answer="   ")
    assert res.status_code == 422
    assert res.json() == {"error": "missing_answer", "field": "answer"}


def test_answer_is_at_most_2000_chars(client):
    iid = start_ben(client)
    _turn(client, iid)
    res = _turn(client, iid, answer="가" * 2001)
    assert res.status_code == 422
    assert res.json() == {"error": "answer_too_long", "field": "answer"}
    assert sse_events(_turn(client, iid, answer="가" * 2000).text)[-1][0] == "done"


def test_failed_turn_is_not_recorded_and_can_be_retried(client, fake_claude, settings):
    iid = start_ben(client)
    fake_claude.replies = [["부분", ClaudeError("claude_error")]]
    res = _turn(client, iid)
    assert sse_events(res.text) == [("delta", {"text": "부분"}), ("error", {"code": "claude_error"})]
    row = _row(settings, iid)
    assert (row["model_turns"], row["messages_json"]) == (0, "[]")
    assert client.get("/api/me").json()["tickets"] == 9  # 티켓은 돌려주지 않는다
    retry = _turn(client, iid)
    assert sse_events(retry.text)[-1] == ("done", {"ended": False})
    assert _row(settings, iid)["model_turns"] == 1


def test_refusal_code_is_passed_through(client, fake_claude):
    iid = start_ben(client)
    fake_claude.replies = [[ClaudeError("refused")]]
    assert sse_events(_turn(client, iid).text) == [("error", {"code": "refused"})]


def test_end_phrase_ends_the_interview(client, fake_claude):
    iid = start_ben(client)
    fake_claude.replies = [["수고하셨습니다. 면접을 마치겠습니다."]]
    assert sse_events(_turn(client, iid).text)[-1] == ("done", {"ended": True})
    res = _turn(client, iid, answer="더 할 말")
    assert res.status_code == 409
    assert res.json() == {"error": "interview_over"}


def test_at_most_15_interviewer_turns(client):
    iid = start_ben(client)
    last = None
    for i in range(15):
        res = _turn(client, iid, answer=None if i == 0 else f"답변 {i}")
        last = sse_events(res.text)[-1]
    assert last == ("done", {"ended": True})
    assert _turn(client, iid, answer="16번째").json() == {"error": "interview_over"}


def test_other_users_interview_is_404(client, settings):
    iid = start_ben(client)
    logout(client)
    me = signup(client, email="b@b.com")
    make_premium(settings, me["userId"])
    res = _turn(client, iid)
    assert res.status_code == 404
    assert res.json() == {"error": "not_found"}


def test_member_is_forbidden(client):
    iid = start_ben(client)
    logout(client)
    signup(client, email="b@b.com")
    assert _turn(client, iid).json() == {"error": "premium_required"}
```

- [ ] **Step 2: 실패 확인**

Run: `uv run pytest tests/test_ben_turns.py -q`
Expected: FAIL — `/api/premium/interviews/{id}/turns`가 404

- [ ] **Step 3: 구현**

`backend/app/sse.py`:

```python
"""SSE 한 이벤트: event 줄 + data 줄(JSON 한 줄) + 빈 줄."""

import json
from typing import Any

# X-Accel-Buffering: nginx가 모아 보내지 않고 바로 흘리게 한다
SSE_HEADERS = {"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}


def sse(event: str, data: dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"
```

`backend/app/routers/premium.py`:
- import 묶음을 아래로 바꾼다:

```python
import sqlite3
from collections.abc import Iterator

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse

from app import db
from app.deps import Db, LoggedInUser, PremiumUser
from app.errors import ApiError
from app.llm import prompts
from app.llm.claude import TURN_MAX_TOKENS, ClaudeClient, ClaudeError
from app.presenters import to_session
from app.repos import premium, users
from app.repos.premium import MAX_MODEL_TURNS, PremiumInterview
from app.repos.users import User
from app.schemas import InterviewStart, InterviewStarted, Session, TurnBody
from app.sse import SSE_HEADERS, sse
from app.timefmt import iso, kst_day_start
```

- `router = APIRouter()` 다음 줄에 빈 줄과 `ANSWER_MAX = 2000`을 넣는다.
- 파일 맨 아래에 추가:

```python
def _owned(conn: sqlite3.Connection, user: User, interview_id: str) -> PremiumInterview:
    interview = premium.get_interview(conn, user_id=user.id, interview_id=interview_id)
    if interview is None:
        raise ApiError(404, "not_found")
    return interview


def _claude(request: Request) -> ClaudeClient:
    claude = request.app.state.claude
    if claude is None:
        raise ApiError(503, "ben_unavailable")
    return claude


def is_over(interview: PremiumInterview) -> bool:
    """리포트까지 받았거나, 면접관 응답 15번이거나, 마지막 응답이 종료 문장이면 끝."""
    if interview.status == "done" or interview.model_turns >= MAX_MODEL_TURNS:
        return True
    last = interview.messages[-1] if interview.messages else None
    return last is not None and last["role"] == "model" and prompts.has_end_phrase(last["text"])


@router.post("/premium/interviews/{interview_id}/turns")
def take_turn(
    interview_id: str, body: TurnBody, user: PremiumUser, conn: Db, request: Request
) -> StreamingResponse:
    interview = _owned(conn, user, interview_id)
    if is_over(interview):
        raise ApiError(409, "interview_over")
    answer: str | None = None
    if interview.messages:  # 첫 턴은 첫 질문만 받는다(answer 무시)
        answer = (body.answer or "").strip()
        if not answer:
            raise ApiError(422, "missing_answer", field="answer")
        if len(answer) > ANSWER_MAX:
            raise ApiError(422, "answer_too_long", field="answer")
    claude = _claude(request)
    system = prompts.build_system(interview.track, interview.inputs)
    messages = prompts.turn_messages(interview.messages, answer)
    db_path = request.app.state.settings.db_path

    def events() -> Iterator[str]:
        chunks: list[str] = []
        try:
            for text in claude.stream_text(
                system=system, messages=messages, effort="low", max_tokens=TURN_MAX_TOKENS
            ):
                chunks.append(text)
                yield sse("delta", {"text": text})
        except ClaudeError as exc:
            # 실패한 턴은 기록하지 않는다 — 같은 요청으로 다시 시도한다
            yield sse("error", {"code": exc.code})
            return
        with db.connection(db_path) as c:
            saved = premium.append_turn(
                c, interview_id=interview.id, answer=answer, model_text="".join(chunks)
            )
        yield sse("done", {"ended": is_over(saved)})

    return StreamingResponse(events(), media_type="text/event-stream", headers=SSE_HEADERS)
```

- [ ] **Step 4: 통과 확인**

Run: `uv run pytest tests/test_ben_turns.py -q`
Expected: PASS (10 passed). 이어서 `uv run pytest -q` 전체 PASS.

- [ ] **Step 5: 커밋**

```bash
uv run ruff check --fix . && uv run ruff format . && uv run pytest -q
git add app/sse.py app/routers/premium.py tests/test_ben_turns.py
git commit -m "feat(backend): 벤 턴 SSE(delta·done·error) — 서버가 대화 보관, 15번·2,000자 상한, 실패 턴 미기록"
```

---

### Task 21: 벤 리포트 `POST /api/premium/interviews/{id}/report` (SSE)

**Files:**
- Modify: `backend/app/routers/premium.py`
- Test: `backend/tests/test_ben_report.py`

**Interfaces:**
- Consumes: `prompts.report_messages`·`report_instruction`(Task 16), `REPORT_MAX_TOKENS`(Task 17), `premium.mark_done`(Task 18), `_owned`·`_claude`(Task 20), 보관함 프리미엄 검증(Task 13)
- Produces: `POST /api/premium/interviews/{id}/report` → SSE `delta`… `done {}`(성공 시 `status=done`) 또는 `error {code}`. 스트림 전 `409 interview_over`(이미 done), `409 interview_not_started`(턴 0)

- [ ] **Step 1: 실패하는 테스트 작성**

`backend/tests/test_ben_report.py`:

```python
from app.llm import prompts
from app.llm.claude import REPORT_MAX_TOKENS, ClaudeError
from tests.helpers import archive_body, open_db, sse_events, start_ben

REPORT_RAW = '[{"question": "자기소개", "answerSummary": "요약", "feedback": "**근거**가 부족합니다."}]'


def _report(client, iid):
    return client.post(f"/api/premium/interviews/{iid}/report")


def _one_turn(client, iid) -> None:
    client.post(f"/api/premium/interviews/{iid}/turns", json={})


def _status(settings, iid) -> str:
    with open_db(settings) as conn:
        row = conn.execute("SELECT status FROM premium_interviews WHERE id = ?", (iid,)).fetchone()
    return row[0]


def test_report_streams_and_finishes(client, fake_claude, settings):
    iid = start_ben(client)
    _one_turn(client, iid)
    fake_claude.replies = [[REPORT_RAW[:20], REPORT_RAW[20:]]]
    events = sse_events(_report(client, iid).text)
    assert "".join(d["text"] for e, d in events if e == "delta") == REPORT_RAW
    assert events[-1] == ("done", {})
    call = fake_claude.calls[-1]
    assert call["effort"] == "medium"
    assert call["max_tokens"] == REPORT_MAX_TOKENS
    assert call["messages"][-1] == {"role": "user", "content": prompts.report_instruction()}
    assert _status(settings, iid) == "done"
    assert _report(client, iid).json() == {"error": "interview_over"}
    turn = client.post(f"/api/premium/interviews/{iid}/turns", json={"answer": "더"})
    assert turn.json() == {"error": "interview_over"}


def test_report_needs_a_turn_first(client):
    iid = start_ben(client)
    res = _report(client, iid)
    assert res.status_code == 409
    assert res.json() == {"error": "interview_not_started"}


def test_failed_report_keeps_the_interview_active(client, fake_claude, settings):
    iid = start_ben(client)
    _one_turn(client, iid)
    fake_claude.replies = [[ClaudeError("claude_error")]]
    assert sse_events(_report(client, iid).text) == [("error", {"code": "claude_error"})]
    assert _status(settings, iid) == "active"
    assert sse_events(_report(client, iid).text)[-1] == ("done", {})


def test_finished_interview_can_be_archived_once(client):
    iid = start_ben(client)
    _one_turn(client, iid)
    _report(client, iid)
    body = archive_body(premium=True, premiumInterviewId=iid, interviewerId="m2")
    res = client.post("/api/archive", json=body)
    assert res.status_code == 201
    assert res.json()["entry"]["premium"] is True
    assert client.post("/api/archive", json=body).json() == {"error": "invalid_premium_interview"}
```

- [ ] **Step 2: 실패 확인**

Run: `uv run pytest tests/test_ben_report.py -q`
Expected: FAIL — `/api/premium/interviews/{id}/report`가 404

- [ ] **Step 3: 구현**

`backend/app/routers/premium.py`:
- `from app.llm.claude import TURN_MAX_TOKENS, ClaudeClient, ClaudeError`를 `from app.llm.claude import REPORT_MAX_TOKENS, TURN_MAX_TOKENS, ClaudeClient, ClaudeError`로 바꾼다.
- 파일 맨 아래에 추가:

```python
@router.post("/premium/interviews/{interview_id}/report")
def make_report(
    interview_id: str, user: PremiumUser, conn: Db, request: Request
) -> StreamingResponse:
    interview = _owned(conn, user, interview_id)
    if interview.status == "done":
        raise ApiError(409, "interview_over")
    if interview.model_turns == 0:
        raise ApiError(409, "interview_not_started")
    claude = _claude(request)
    system = prompts.build_system(interview.track, interview.inputs)
    messages = prompts.report_messages(interview.messages)
    db_path = request.app.state.settings.db_path

    def events() -> Iterator[str]:
        try:
            for text in claude.stream_text(
                system=system, messages=messages, effort="medium", max_tokens=REPORT_MAX_TOKENS
            ):
                yield sse("delta", {"text": text})
        except ClaudeError as exc:
            yield sse("error", {"code": exc.code})
            return
        with db.connection(db_path) as c:
            premium.mark_done(c, interview_id=interview.id)
        yield sse("done", {})

    return StreamingResponse(events(), media_type="text/event-stream", headers=SSE_HEADERS)
```

- [ ] **Step 4: 통과 확인**

Run: `uv run pytest tests/test_ben_report.py -q`
Expected: PASS (4 passed). 이어서 `uv run pytest -q` 전체 PASS.

- [ ] **Step 5: 커밋**

```bash
uv run ruff check --fix . && uv run ruff format . && uv run pytest -q
git add app/routers/premium.py tests/test_ben_report.py
git commit -m "feat(backend): 벤 리포트 SSE(effort medium) — 끝나면 done, 보관함에 프리미엄 기록으로 한 번 저장"
```

> PR 3 마무리(PR 2가 `dev`에 머지된 뒤): `gh pr create --base dev --title "feat(backend): 관리자 목업 결제·티켓과 벤 면접(Claude) 3단계"`. PR 본문에 벤 프롬프트 전문(회사·대입)을 붙인다(계층 규율).

---

## PR 4 — 녹음

### Task 22: 녹음 업로드 `POST /api/recordings` (형식·30MB·교체)

**Files:**
- Create: `backend/app/repos/recordings.py`, `backend/app/routers/recordings.py`
- Modify: `backend/pyproject.toml`, `backend/uv.lock` (`uv add python-multipart`), `backend/app/schemas.py`, `backend/app/main.py`
- Test: `backend/tests/test_recordings.py`

**Interfaces:**
- Consumes: `recordings` 테이블(Task 10), `PremiumUser`·`Db`(Task 8), `remove_files`(Task 12), `recording_url`(Task 13), `new_id`·`iso`(Task 3), `db.transaction`(Task 4)
- Produces:
  - `app.repos.recordings.RECORDING_LIMIT_BYTES = 30 * 1024 * 1024`, `MIME_EXTENSIONS = {"audio/webm": "webm", "audio/ogg": "ogg"}`
  - `Recording`(frozen): `id, archive_id, user_id, turn, path, mime, size`
  - `TooLarge(Exception)`
  - `is_own_premium_archive(conn, *, user_id, archive_id) -> bool`, `used_bytes(conn, *, archive_id, excluding_turn: int) -> int`, `replace_recording(conn, *, recording: Recording, created_at: str, limit: int) -> str | None`(지울 옛 파일 경로), `get_recording(conn, *, user_id, recording_id) -> Recording | None`
  - `app.schemas.RecordingCreated`(`id`, `url`)
  - `app.routers.recordings.CHUNK_BYTES = 65536`; `POST /api/recordings`(multipart `archiveId`, `turn`, `clip`) → `201 {id, url}` · `403 premium_required` · `404 not_found` · `413 too_large` · `415 unsupported_media`

- [ ] **Step 1: 의존성 추가**

Run: `uv add python-multipart`
Expected: `pyproject.toml`의 `dependencies`에 `python-multipart>=...`(FastAPI `Form`·`UploadFile`에 필요), `uv.lock` 갱신.

- [ ] **Step 2: 실패하는 테스트 작성**

`backend/tests/test_recordings.py`:

```python
from app.repos import recordings
from tests.helpers import (
    archive_body,
    insert_premium_interview,
    login_admin,
    logout,
    make_premium,
    open_db,
    signup,
)

URL = "/api/recordings"


def _premium_archive(client, settings) -> tuple[str, str]:
    me = login_admin(client)
    assert client.post("/api/premium/purchase").status_code == 200
    with open_db(settings) as conn:
        iid = insert_premium_interview(conn, me["userId"])
    body = archive_body(premium=True, premiumInterviewId=iid, interviewerId="m2")
    res = client.post("/api/archive", json=body)
    assert res.status_code == 201, res.text
    return me["userId"], res.json()["entry"]["id"]


def _upload(client, archive_id, turn, data, mime="audio/webm;codecs=opus"):
    return client.post(
        URL,
        data={"archiveId": archive_id, "turn": str(turn)},
        files={"clip": ("clip", data, mime)},
    )


def _files(settings) -> list[str]:
    return sorted(p.name for p in settings.recordings_dir.rglob("*") if p.is_file())


def test_limit_is_30mb_per_archive():
    assert recordings.RECORDING_LIMIT_BYTES == 30 * 1024 * 1024


def test_upload_stores_file_and_shows_in_archive(client, settings):
    uid, aid = _premium_archive(client, settings)
    res = _upload(client, aid, 1, b"webm-bytes")
    assert res.status_code == 201
    rec = res.json()
    assert rec["id"].startswith("rec_")
    assert rec["url"] == f"/api/recordings/{rec['id']}"
    stored = settings.recordings_dir / uid / f"{rec['id']}.webm"
    assert stored.read_bytes() == b"webm-bytes"
    detail = client.get(f"/api/archive/{aid}").json()
    assert detail["recordings"] == [{"turn": 1, "url": rec["url"]}]
    assert detail["hasRecording"] is True


def test_ogg_keeps_the_ogg_extension(client, settings):
    uid, aid = _premium_archive(client, settings)
    rec = _upload(client, aid, 1, b"ogg-bytes", mime="audio/ogg").json()
    assert (settings.recordings_dir / uid / f"{rec['id']}.ogg").exists()


def test_unsupported_media_is_415(client, settings):
    _, aid = _premium_archive(client, settings)
    res = _upload(client, aid, 1, b"mp3", mime="audio/mpeg")
    assert res.status_code == 415
    assert res.json() == {"error": "unsupported_media"}
    assert _files(settings) == []


def test_archive_total_over_limit_is_413_and_same_turn_replaces(client, settings, monkeypatch):
    monkeypatch.setattr(recordings, "RECORDING_LIMIT_BYTES", 1000)
    _, aid = _premium_archive(client, settings)
    first = _upload(client, aid, 1, b"a" * 600).json()
    res = _upload(client, aid, 2, b"b" * 600)
    assert res.status_code == 413
    assert res.json() == {"error": "too_large"}
    assert _files(settings) == [f"{first['id']}.webm"]  # 남은 .part 없음
    # 같은 turn은 교체 — 옛 파일 크기는 빼고 센다
    second = _upload(client, aid, 1, b"c" * 900)
    assert second.status_code == 201
    assert _files(settings) == [f"{second.json()['id']}.webm"]
    detail = client.get(f"/api/archive/{aid}").json()
    assert detail["recordings"] == [{"turn": 1, "url": second.json()["url"]}]


def test_member_is_forbidden(client):
    signup(client)
    res = _upload(client, "a_missing", 1, b"x")
    assert res.status_code == 403
    assert res.json() == {"error": "premium_required"}


def test_free_or_foreign_archive_is_404(client, settings):
    _, premium_aid = _premium_archive(client, settings)
    free_aid = client.post("/api/archive", json=archive_body()).json()["entry"]["id"]
    assert _upload(client, free_aid, 1, b"x").json() == {"error": "not_found"}
    logout(client)
    other = signup(client, email="b@b.com")
    make_premium(settings, other["userId"])
    assert _upload(client, premium_aid, 1, b"x").json() == {"error": "not_found"}
```

- [ ] **Step 3: 실패 확인**

Run: `uv run pytest tests/test_recordings.py -q`
Expected: FAIL — `ImportError: cannot import name 'recordings' from 'app.repos'`

- [ ] **Step 4: 구현**

`backend/app/repos/recordings.py`:

```python
"""recordings SQL (spec 4.3). 기록 하나당 합계 30MB, (archive_id, turn)마다 한 파일."""

import sqlite3
from dataclasses import dataclass

from app.db import transaction

RECORDING_LIMIT_BYTES = 30 * 1024 * 1024
MIME_EXTENSIONS = {"audio/webm": "webm", "audio/ogg": "ogg"}


@dataclass(frozen=True)
class Recording:
    id: str
    archive_id: str
    user_id: str
    turn: int
    path: str
    mime: str
    size: int


class TooLarge(Exception):
    """기록 하나의 녹음 합계가 상한을 넘는다."""


def is_own_premium_archive(conn: sqlite3.Connection, *, user_id: str, archive_id: str) -> bool:
    row = conn.execute(
        "SELECT 1 FROM archive WHERE id = ? AND user_id = ? AND premium = 1",
        (archive_id, user_id),
    ).fetchone()
    return row is not None


def used_bytes(conn: sqlite3.Connection, *, archive_id: str, excluding_turn: int) -> int:
    return conn.execute(
        "SELECT COALESCE(SUM(bytes), 0) FROM recordings WHERE archive_id = ? AND turn != ?",
        (archive_id, excluding_turn),
    ).fetchone()[0]


def replace_recording(
    conn: sqlite3.Connection, *, recording: Recording, created_at: str, limit: int
) -> str | None:
    """같은 turn이 있으면 바꾼다. 커밋 뒤 지울 옛 파일 경로를 돌려준다."""
    r = recording
    with transaction(conn):
        if used_bytes(conn, archive_id=r.archive_id, excluding_turn=r.turn) + r.size > limit:
            raise TooLarge
        old = conn.execute(
            "SELECT path FROM recordings WHERE archive_id = ? AND turn = ?", (r.archive_id, r.turn)
        ).fetchone()
        conn.execute(
            "DELETE FROM recordings WHERE archive_id = ? AND turn = ?", (r.archive_id, r.turn)
        )
        conn.execute(
            "INSERT INTO recordings (id, archive_id, user_id, turn, path, mime, bytes, created_at)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (r.id, r.archive_id, r.user_id, r.turn, r.path, r.mime, r.size, created_at),
        )
    return old["path"] if old is not None else None


def get_recording(
    conn: sqlite3.Connection, *, user_id: str, recording_id: str
) -> Recording | None:
    row = conn.execute(
        "SELECT * FROM recordings WHERE id = ? AND user_id = ?", (recording_id, user_id)
    ).fetchone()
    if row is None:
        return None
    return Recording(
        id=row["id"],
        archive_id=row["archive_id"],
        user_id=row["user_id"],
        turn=row["turn"],
        path=row["path"],
        mime=row["mime"],
        size=row["bytes"],
    )
```

`backend/app/schemas.py` 맨 아래에 추가:

```python
# ── 녹음 ──


class RecordingCreated(BaseModel):
    id: str
    url: str
```

`backend/app/routers/recordings.py`:

```python
"""녹음 업로드·재생 (spec 4.3). 받은 그대로(webm/opus·ogg) 저장한다."""

from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Form, Request, UploadFile

from app.deps import Db, PremiumUser
from app.errors import ApiError
from app.files import remove_files
from app.ids import new_id
from app.presenters import recording_url
from app.repos import recordings
from app.schemas import RecordingCreated
from app.timefmt import iso

router = APIRouter()

CHUNK_BYTES = 64 * 1024


def _receive(clip: UploadFile, target: Path, budget: int) -> int:
    """조각마다 크기를 세며 .part에 쓴다. 남은 한도를 넘는 순간 멈추고 413."""
    part = target.with_name(target.name + ".part")
    size = 0
    try:
        with part.open("wb") as out:
            while chunk := clip.file.read(CHUNK_BYTES):
                size += len(chunk)
                if size > budget:
                    raise ApiError(413, "too_large")
                out.write(chunk)
        part.replace(target)
    except BaseException:
        part.unlink(missing_ok=True)
        raise
    return size


@router.post("/recordings", status_code=201, response_model=RecordingCreated)
def upload_recording(
    archive_id: Annotated[str, Form(alias="archiveId")],
    turn: Annotated[int, Form(ge=0)],
    clip: UploadFile,
    user: PremiumUser,
    conn: Db,
    request: Request,
) -> RecordingCreated:
    mime = (clip.content_type or "").split(";", 1)[0].strip().lower()
    ext = recordings.MIME_EXTENSIONS.get(mime)
    if ext is None:
        raise ApiError(415, "unsupported_media")
    if not recordings.is_own_premium_archive(conn, user_id=user.id, archive_id=archive_id):
        raise ApiError(404, "not_found")
    limit = recordings.RECORDING_LIMIT_BYTES
    budget = limit - recordings.used_bytes(conn, archive_id=archive_id, excluding_turn=turn)
    storage = request.app.state.settings.storage_dir
    recording_id = new_id("rec")
    relative = f"recordings/{user.id}/{recording_id}.{ext}"
    target = storage / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    size = _receive(clip, target, budget)
    rec = recordings.Recording(
        id=recording_id,
        archive_id=archive_id,
        user_id=user.id,
        turn=turn,
        path=relative,
        mime=mime,
        size=size,
    )
    try:
        old = recordings.replace_recording(
            conn, recording=rec, created_at=iso(request.app.state.clock()), limit=limit
        )
    except recordings.TooLarge:
        target.unlink(missing_ok=True)
        raise ApiError(413, "too_large") from None
    except BaseException:
        target.unlink(missing_ok=True)
        raise
    if old is not None:
        remove_files(storage, [old])
    return RecordingCreated(id=recording_id, url=recording_url(recording_id))
```

`backend/app/main.py`: 라우터 import 줄을 `from app.routers import archive, auth, health, manifest, me, premium, questions, recordings, resumes`로 바꾸고, `app.include_router(premium.router, prefix="/api")` 다음 줄에 `    app.include_router(recordings.router, prefix="/api")`를 넣는다.

- [ ] **Step 5: 통과 확인**

Run: `uv run pytest tests/test_recordings.py -q`
Expected: PASS (7 passed). 이어서 `uv run pytest -q` 전체 PASS.

- [ ] **Step 6: 커밋**

```bash
uv run ruff check --fix . && uv run ruff format . && uv run pytest -q
git add pyproject.toml uv.lock app/repos/recordings.py app/routers/recordings.py app/schemas.py app/main.py tests/test_recordings.py
git commit -m "feat(backend): 녹음 업로드 — webm/ogg만(415), 기록당 30MB를 세며 받기(413), 같은 turn은 교체"
```

---

### Task 23: 녹음 재생 `GET /api/recordings/{id}` (Range)와 기록 삭제 시 파일 삭제

**Files:**
- Modify: `backend/app/routers/recordings.py`
- Test: `backend/tests/test_recordings.py`

**Interfaces:**
- Consumes: `recordings.get_recording`(Task 22), `LoggedInUser`(Task 8), 보관함 삭제(Task 13)
- Produces: `GET /api/recordings/{id}` → `200`/`206`(Range) 오디오 바이트, `Content-Type` = 저장한 MIME · `401` · `404 not_found`

- [ ] **Step 1: 실패하는 테스트 작성**

`backend/tests/test_recordings.py` 맨 아래에 추가:

```python
def test_get_supports_range(client, settings):
    _, aid = _premium_archive(client, settings)
    url = _upload(client, aid, 1, b"0123456789").json()["url"]
    full = client.get(url)
    assert full.status_code == 200
    assert full.content == b"0123456789"
    assert full.headers["content-type"] == "audio/webm"
    assert full.headers["accept-ranges"] == "bytes"
    part = client.get(url, headers={"Range": "bytes=2-5"})
    assert part.status_code == 206
    assert part.content == b"2345"
    assert part.headers["content-range"] == "bytes 2-5/10"


def test_get_is_owner_only(client, settings):
    _, aid = _premium_archive(client, settings)
    url = _upload(client, aid, 1, b"x").json()["url"]
    logout(client)
    assert client.get(url).status_code == 401
    signup(client, email="b@b.com")
    res = client.get(url)
    assert res.status_code == 404
    assert res.json() == {"error": "not_found"}


def test_deleting_the_archive_deletes_recordings(client, settings):
    _, aid = _premium_archive(client, settings)
    url = _upload(client, aid, 1, b"x").json()["url"]
    assert len(_files(settings)) == 1
    assert client.delete(f"/api/archive/{aid}").status_code == 204
    assert _files(settings) == []
    assert client.get(url).status_code == 404
```

- [ ] **Step 2: 실패 확인**

Run: `uv run pytest tests/test_recordings.py -q`
Expected: FAIL — 새 세 테스트가 `GET /api/recordings/{id}` 405로 실패

- [ ] **Step 3: 구현**

`backend/app/routers/recordings.py`:
- `from fastapi import APIRouter, Form, Request, UploadFile` 다음 줄에 `from fastapi.responses import FileResponse`를 넣는다.
- `from app.deps import Db, PremiumUser`를 `from app.deps import Db, LoggedInUser, PremiumUser`로 바꾼다.
- 파일 맨 아래에 추가:

```python
@router.get("/recordings/{recording_id}")
def get_recording(
    recording_id: str, user: LoggedInUser, conn: Db, request: Request
) -> FileResponse:
    rec = recordings.get_recording(conn, user_id=user.id, recording_id=recording_id)
    if rec is None:
        raise ApiError(404, "not_found")
    path = request.app.state.settings.storage_dir / rec.path
    if not path.is_file():
        raise ApiError(404, "not_found")
    # FileResponse가 Range(206)·Accept-Ranges를 처리한다
    return FileResponse(path, media_type=rec.mime)
```

- [ ] **Step 4: 통과 확인**

Run: `uv run pytest tests/test_recordings.py -q`
Expected: PASS (10 passed). 이어서 `uv run pytest -q` 전체 PASS.

- [ ] **Step 5: 커밋**

```bash
uv run ruff check --fix . && uv run ruff format . && uv run pytest -q
git add app/routers/recordings.py tests/test_recordings.py
git commit -m "feat(backend): 녹음 재생 — 본인만, Range 206, 저장한 MIME 그대로, 기록 삭제 시 파일도 삭제"
```

> PR 4 마무리: `gh pr create --base dev --title "feat(backend): 프리미엄 녹음 업로드·재생(Range)·기록당 30MB"`.

---

## PR 5 — 배포 (공동 영역, 상대방 승인 필수)

> 이 PR의 명령은 리포 루트에서 실행한다. 운영(momo)은 지시 전까지 건드리지 않는다 — demomo에만 반영한다.

### Task 24: compose 볼륨·환경변수, Dockerfile `DATA_DIR`, nginx 업로드 6MB

**Files:**
- Modify: `deploy/docker-compose.yml`, `deploy/api.Dockerfile`, `deploy/nginx.conf`

**Interfaces:**
- Consumes: `Settings.from_env` 환경변수 이름(Task 3)
- Produces: api 컨테이너 `DATA_DIR=/data` + 호스트 `${DATA_HOST_DIR:-/srv/momo/data}` 볼륨, `.env`의 `CORS_ORIGINS`·`COOKIE_SECURE`·`ANTHROPIC_API_KEY`·`ADMIN_LOGIN`·`ADMIN_PASSWORD`·`BEN_DAILY_LIMIT` 전달, nginx `/api/recordings`의 `client_max_body_size 6m`

- [ ] **Step 1: 지금 설정에 없음을 확인(실패 확인)**

Run: `docker compose -f deploy/docker-compose.yml config | grep -c "DATA_DIR\|/data"` → Expected: `0`
Run: `grep -c "client_max_body_size" deploy/nginx.conf` → Expected: `0`

- [ ] **Step 2: `deploy/docker-compose.yml`의 `api` 서비스 교체**

`api:` 블록 전체를 아래로 바꾼다(`web` 서비스는 그대로):

```yaml
  api:
    image: ghcr.io/4this/woo-momo-api:latest
    build:
      context: ../backend
      dockerfile: ../deploy/api.Dockerfile
    expose:
      - "8000"
    environment:
      DATA_DIR: /data
      CORS_ORIGINS: ${CORS_ORIGINS:-https://momo.ssenu.cloud,https://demomo.ssenu.cloud,http://localhost:5173}
      COOKIE_SECURE: ${COOKIE_SECURE:-1}
      ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY:-}
      ADMIN_LOGIN: ${ADMIN_LOGIN:-}
      ADMIN_PASSWORD: ${ADMIN_PASSWORD:-}
      BEN_DAILY_LIMIT: ${BEN_DAILY_LIMIT:-30}
    volumes:
      # 계정 DB·녹음. 운영 /srv/momo/data, demomo는 deploy/.env의 DATA_HOST_DIR=/srv/momo-dev/data
      - ${DATA_HOST_DIR:-/srv/momo/data}:/data
    healthcheck:
      test: ["CMD", "python", "-c", "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/api/health').status==200 else 1)"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 10s
    restart: unless-stopped
```

- [ ] **Step 3: `deploy/api.Dockerfile` 교체**

```dockerfile
FROM python:3.12-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 UV_COMPILE_BYTECODE=1
WORKDIR /app

COPY --from=ghcr.io/astral-sh/uv:0.11 /uv /usr/local/bin/uv
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

COPY app ./app
COPY data ./data

# /data: 계정 DB·녹음(호스트 볼륨이 덮는다). 호스트 폴더도 uid 10001 소유여야 쓸 수 있다.
RUN useradd -r -u 10001 app && mkdir -p /data && chown -R app:app /app /data

ENV PATH="/app/.venv/bin:$PATH" MOMO_DATA_DIR=/app/data DATA_DIR=/data
EXPOSE 8000
USER app
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
```

- [ ] **Step 4: `deploy/nginx.conf`에 녹음 업로드 location 추가, `/api/` 읽기 시간 늘리기**

`# FastAPI 프록시 (/api/... 경로 그대로 전달)` 주석 바로 위에 넣는다:

```nginx
    # 녹음 업로드: 답변 하나(한 파일)가 들어가도록 6MB. 나머지 /api/는 기본 1MB 그대로.
    location /api/recordings {
        client_max_body_size 6m;
        resolver 127.0.0.11 valid=10s ipv6=off;
        set $api_upstream api;
        proxy_pass http://$api_upstream:8000$request_uri;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

```

그리고 기존 `location /api/ { ... }` 블록 안 `proxy_set_header X-Forwarded-For ...;` 다음 줄에 추가한다(벤 리포트 스트림이 생각하는 동안 끊기지 않게. SSE 버퍼링은 앱이 `X-Accel-Buffering: no`로 끈다):

```nginx
        proxy_read_timeout 300s;
```

- [ ] **Step 5: 확인**

Run: `docker compose -f deploy/docker-compose.yml config -q && docker compose -f deploy/docker-compose.yml config | grep -E "DATA_DIR|/data"`
Expected: 오류 없이 `DATA_DIR: /data`와 `source: /srv/momo/data` / `target: /data`가 보인다.

Run: `docker run --rm -v "$PWD/deploy/nginx-http.conf:/etc/nginx/conf.d/00-limits.conf:ro" -v "$PWD/deploy/nginx.conf:/etc/nginx/conf.d/default.conf:ro" nginx:1.27-alpine nginx -t`
Expected: `syntax is ok` / `test is successful`

- [ ] **Step 6: 커밋**

```bash
git add deploy/docker-compose.yml deploy/api.Dockerfile deploy/nginx.conf
git commit -m "chore(infra): api에 DATA_DIR(/data) 볼륨과 계정·벤 환경변수, nginx 녹음 업로드 6MB·API 읽기 300초"
```

---

### Task 25: `deploy/README.md` — `.env` 항목·데이터 폴더·sqlite 백업·demomo 반영

**Files:**
- Modify: `deploy/README.md`

**Interfaces:**
- Consumes: Task 24의 compose 변수(`DATA_HOST_DIR` 외 6개), 컨테이너 uid 10001
- Produces: 파이 운영 절차 문서(demomo 먼저, momo는 지시 후)

- [ ] **Step 1: 지금 문서에 없음을 확인(실패 확인)**

Run: `grep -c "ADMIN_PASSWORD\|DATA_HOST_DIR" deploy/README.md` → Expected: `0`

- [ ] **Step 2: `## 최초 1회 (일반 절차)` 바로 위에 아래 절을 넣는다**

`````markdown
## 계정·보관함·벤 (2026-10-13~)

계정 DB(sqlite)와 녹음 파일은 api 컨테이너의 `/data`에 쌓이고, 호스트 폴더를 볼륨으로 붙인다. 설계: `docs/specs/backend/2026-10-13-accounts-backend-design.md`.

| 환경 | 호스트 폴더 | `deploy/.env` |
|---|---|---|
| demomo(dev) | `/srv/momo-dev/data` | `DATA_HOST_DIR=/srv/momo-dev/data` |
| momo(운영) | `/srv/momo/data` | (기본값이라 안 적어도 된다) — **지시 전까지 반영하지 않는다** |

### 데이터 폴더 (최초 1회)
컨테이너는 uid 10001로 돈다. 호스트 폴더를 그 uid 소유로 만든다.
```
sudo install -d -o 10001 -g 10001 /srv/momo-dev/data
```

### `deploy/.env` 항목 (커밋 금지 — `.gitignore`가 막는다)

| 키 | 예 | 설명 |
|---|---|---|
| `DATA_HOST_DIR` | `/srv/momo-dev/data` | 호스트의 데이터 폴더. 없으면 `/srv/momo/data` |
| `ANTHROPIC_API_KEY` | `sk-ant-...` | 벤(Claude) 키. 없으면 벤 시작이 `503 ben_unavailable` |
| `ADMIN_LOGIN` | `admin` | 관리자 아이디(이메일이 아니어도 된다). 목업 결제는 이 계정만 |
| `ADMIN_PASSWORD` | (긴 무작위 문자열) | **추측하기 쉬운 값 금지.** 공개 사이트라 누구나 티켓을 충전해 Claude 비용을 쓸 수 있다. `$`는 쓰지 않는다(compose가 변수로 읽는다) |
| `BEN_DAILY_LIMIT` | `30` | 서버 전체 하루(한국 날짜) 벤 면접 수 상한. 마지막 방어선 |
| `CORS_ORIGINS` | `https://momo.ssenu.cloud,https://demomo.ssenu.cloud,http://localhost:5173` | 정확한 오리진만, 쉼표로. `*` 금지(기동 실패) |
| `COOKIE_SECURE` | `1` | 세션 쿠키 `Secure`. HTTPS 뒤라 `1` 유지 |

`ADMIN_LOGIN`·`ADMIN_PASSWORD` 중 하나라도 비우면 다음 기동 때 관리자 표시가 지워지고 목업 결제는 아무도 못 쓴다. 비밀번호를 바꾸려면 `.env`를 고치고 `docker compose up -d`로 api를 다시 띄운다(기동 때 맞춘다).

### 반영(demomo)
```
cd /srv/apps/Woo-MoMo-Project-dev/deploy
git pull
docker compose config -q && docker compose config | grep -E "DATA_DIR|/data"   # 볼륨·환경변수 확인
docker compose up -d --build
curl -s https://demomo.ssenu.cloud/api/health
curl -s https://demomo.ssenu.cloud/api/me        # null
ls -l /srv/momo-dev/data                          # momo.sqlite3, recordings/
```
수동 확인(spec 8절): 가입 → 이력서 저장 → 보관함 6번째 저장에 가장 오래된 기록 자동 삭제 → 관리자 로그인 → 목업 결제 → 벤 1회 완주(실제 Claude) → 리포트 → 보관함 저장 → 녹음 재생.

### 백업 (수동 — 자동화는 다음 단계)
DB는 실행 중에도 sqlite 백업 API로 안전하게 복사한다. 녹음은 파일 그대로 복사한다.
```
sudo install -d /srv/momo-dev/backup
cd /srv/apps/Woo-MoMo-Project-dev/deploy
docker compose exec api python -c "import sqlite3; s=sqlite3.connect('/data/momo.sqlite3'); d=sqlite3.connect('/data/backup.sqlite3'); s.backup(d); d.close(); s.close()"
sudo mv /srv/momo-dev/data/backup.sqlite3 /srv/momo-dev/backup/momo-$(date +%F).sqlite3
sudo rsync -a /srv/momo-dev/data/recordings/ /srv/momo-dev/backup/recordings/
```
호스트에 `sqlite3`가 있으면 `sqlite3 /srv/momo-dev/data/momo.sqlite3 ".backup '/srv/momo-dev/backup/momo-$(date +%F).sqlite3'"`도 된다.

복원: `docker compose stop api` → 백업 파일을 `/srv/momo-dev/data/momo.sqlite3`로 복사(같은 폴더의 `momo.sqlite3-wal`·`momo.sqlite3-shm`은 지운다) → `sudo chown 10001:10001 /srv/momo-dev/data/momo.sqlite3` → `docker compose start api`. 기동 때 DB에 없는 녹음 파일은 자동으로 지워진다.

### nginx
`/api/recordings`만 요청 크기 6MB(`client_max_body_size 6m`), 나머지 `/api/`는 기본 1MB. 벤 스트림(SSE)은 앱이 `X-Accel-Buffering: no`로 버퍼링을 끄고, `/api/`의 `proxy_read_timeout`은 300초다.
`````

- [ ] **Step 3: 확인**

Run: `grep -c "ADMIN_PASSWORD\|DATA_HOST_DIR" deploy/README.md` → Expected: `4` 이상

- [ ] **Step 4: 커밋**

```bash
git add deploy/README.md
git commit -m "docs: 배포 README에 계정 데이터 폴더·.env 항목·sqlite 백업·demomo 반영 절차"
```

- [ ] **Step 5: 파이에서 확인(머지 전, 리뷰어와 함께)**

`ssh admin@webPi` → demomo 클론에서 PR 브랜치를 받아 `cd deploy && docker compose config -q`(오류 없음)와 `docker compose config | grep -E "DATA_DIR|/data"`(`/srv/momo-dev/data`가 보임)를 확인하고 결과를 PR에 붙인다. `dev` 머지 뒤 위 "반영(demomo)" 절차와 수동 확인을 한다. 운영(momo)·`main`은 지시가 있을 때만.

> PR 5 마무리: `gh pr create --base dev --title "chore(infra): 계정 데이터 볼륨·녹음 업로드 크기·.env 항목 — demomo 반영"`.

---

## Spec 대응표 (self-review)

| spec | 요구 | Task |
|---|---|---|
| 1 | 등급별 개인정보, `CLAUDE.md` 8번 개정 | 2 |
| 1 | 녹음 기록당 30MB, turn별 파일, webm/opus 그대로 | 22 |
| 1·4.4 | 서버가 면접 세션 보관, 시작(차감)→턴(SSE)→리포트, `/premium/spend` 없음 | 18~21 |
| 1·2.7 | 구글 로그인은 다음 단계(만들지 않음, 문서 표시) | 1 |
| 1·3 | 표준 `sqlite3` + 얇은 repos, ORM·인증 라이브러리 없음, `argon2-cffi` | 4, 5, 7 |
| 1·2.5·4.4 | 목업 결제 관리자 전용, `.env`로 관리자 생성, `Session.isAdmin` | 1, 8, 14, 15 |
| 2.1 | `ArchiveEntry.score` 삭제 | 1, 13 |
| 2.2 | 가입 `consent` 필수 → `422 consent_required` | 1, 8 |
| 2.3 | 프리미엄 기록은 `premiumInterviewId`(본인·완료) 검증 → `422 invalid_premium_interview` | 12, 13, 21 |
| 2.6 | 녹음 415·413·같은 turn 교체 | 22 |
| 2.8 | `429 rate_limited` | 8, 9 |
| 2 끝 | 매니페스트 불변, additive | Global Constraints, 1 |
| 3 | 구조(main·db·migrations·security·deps·repos·routers·llm), 환경변수 7개 | 3~6, 파일 구조 |
| 3.1 | 테이블 6개, 접두사+ULID, JSON 그대로, 녹음 경로 규칙 | 3, 4, 10, 22 |
| 4.1 | 이메일 정규화·형식, 8자, `409 email_taken`, 이메일 인증 없음 | 8 |
| 4.1 | 같은 `401 bad_credentials` + 더미 해시 | 5, 8 |
| 4.1 | 세션 토큰·쿠키 속성·SHA-256 저장 | 5, 7, 8 |
| 4.1 | `/me` null·만료 삭제, `PUT /profile`(age 1~120) | 7, 8, 9 |
| 4.1 | `require_user` 401, `require_premium` 403, 남의 id 404 | 8, 11, 13, 20, 22, 23 |
| 4.1 | 요청 수 제한 20/10/10, `CF-Connecting-IP` | 5, 8, 9 |
| 4.1 | CORS 기본값·credentials·와일드카드 금지, Origin 확인 `403 bad_origin` | 3, 6 |
| 4.1 | 비밀번호·이력서·대화 로그 금지 | Global Constraints, 2(로그 호출을 만들지 않음) |
| 4.2 | 이력서 한 트랜잭션·3개·제목 1~40·본문 2만·최근 수정순 | 10, 11 |
| 4.2 | 보관함 본문·트랙별 필수·5개 한도·`evicted`·커밋 뒤 파일 삭제·기동 시 정리 | 12, 13 |
| 4.2 | 목록 최신순, 상세(messages·report·reportRaw·recordings), 삭제 시 녹음도 | 12, 13, 23 |
| 4.3 | 프리미엄 본인 프리미엄 기록만, 스트리밍으로 세며 413, Range, MIME 그대로 | 22, 23 |
| 4.4 | 관리자 생성·갱신·`.env` 없으면 없음, 이메일 아닌 아이디 예외 | 14 |
| 4.4 | `BEN_DAILY_LIMIT` 기본 30, `503 daily_limit`, 차감 없음 | 3, 18, 19 |
| 4.4 | 시작 본문·한 트랜잭션·`201 {interviewId, session}`·`409 no_tickets` | 18, 19 |
| 4.4 | 턴 SSE `delta`/`done {ended}`/`error {code}`, 15번·2,000자·`409 interview_over` | 20 |
| 4.4 | 리포트 SSE, `status=done` | 21 |
| 4.4 | 실패 시 `error`, 턴 미기록, 티켓 환불 없음, 무료로 안 떨어짐 | 20, 21 |
| 4.4 | 회사·대입 프롬프트, 질문 5개·꼬리질문·종료 문장 동일 | 16 |
| 4.4 | 리포트 지시문 = 프론트 `report.ts`(테스트) | 16 |
| 4.4 | `claude-sonnet-5-5`, 스트리밍, effort low/medium, 캐시, `fallbacks: "default"`, 주입 | 17 |
| 6 | 볼륨(운영·demomo), nginx 6MB, `.env` 항목, demomo 먼저 | 24, 25 |
| 7 | PR 순서 0~5, `cw`에서 따고 base `dev` | PR 묶음 |
| 8 | pytest+httpx TDD, 테스트마다 임시 `DATA_DIR` | 6(conftest) 이후 전부 |
| 8 | 동시 요청(슬롯·티켓), 원자성, 하루 상한, 관리자 생성·갱신·없음, SSE 순서, 15번, 실패 턴, 413·415, Range, 삭제 시 파일, 동일성 | 10, 18, 19, 14, 20, 22, 23, 16 |
| 8 | CI `pytest`·`ruff`, Claude 실제 호출 없음 | 전 Task 커밋 단계, 17(가짜) |
| 8 | 수동(demomo) 시나리오 | 25 |
