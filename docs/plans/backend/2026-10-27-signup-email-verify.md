# 가입 이메일 인증(PIN) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `SIGNUP_EMAIL_VERIFY`가 켜지면 가입 전에 메일로 받은 6자리 PIN을 확인하고, 맞을 때만 계정을 만든다. 꺼져 있으면 가입은 지금과 바이트 단위로 같다.

**Architecture:** `app/mail.py`(발송기 Protocol + httpx 구현)를 `create_app(mailer=)`로 주입하고, PIN 상태는 마이그레이션 008의 `signup_codes` 테이블(`app/repos/signup_codes.py`)에 둔다. `app/routers/auth.py`에 인증번호 발송·설정 조회 엔드포인트를 더하고 `signup`이 켜졌을 때 PIN을 확인한다.

**Tech Stack:** Python 3.12, FastAPI, pydantic v2, sqlite3, httpx, pytest, ruff, uv

**Spec:** `docs/specs/backend/2026-10-27-signup-email-verify-design.md`

## Global Constraints

- 설정: `SIGNUP_EMAIL_VERIFY`(`_parse_bool`, 기본 false), `MAIL_API_KEY`(`field(default=None, repr=False)`), `MAIL_API_URL`(기본 `https://send.ssenu.cloud/v1/send`). compose api 환경변수에 셋 다(`${SIGNUP_EMAIL_VERIFY:-false}`, `${MAIL_API_KEY:-}`, `${MAIL_API_URL:-https://send.ssenu.cloud/v1/send}`).
- 꺼져 있으면: `POST /api/auth/signup`은 `code`를 무시하고 지금과 같다(기존 테스트 수정 없이 통과). `POST /api/auth/signup/code`는 `404 {"error":"verify_disabled"}`. `GET /api/auth/signup/config`는 `{"emailVerify": false}`.
- 발송 요청: `POST {MAIL_API_URL}`, 헤더 `Authorization: Bearer {key}`, `Content-Type: application/json`, `Idempotency-Key: signup-{secrets.token_hex(8)}`(발송마다 새 값), JSON `{"to","subject","text"}`, timeout 10초, `User-Agent: woo-momo/1.0`. 2xx가 아니거나 httpx 예외면 `MailError`.
- 메일: 제목 `[모두의 모의면접] 가입 인증번호`. 본문 `인증번호: {code}\n\n10분 안에 입력해 주세요.\n가입을 요청하지 않았다면 이 메일은 무시하셔도 됩니다.`
- PIN: `f"{secrets.randbelow(1_000_000):06d}"`. 저장은 `hashlib.sha256(f"{email}:{code}".encode()).hexdigest()`, 비교는 `hmac.compare_digest`. 원문은 DB·로그·응답에 없음.
- 상수: `CODE_TTL_SEC = 600`, `CODE_MAX_ATTEMPTS = 5`, `CODE_RESEND_SEC = 60`, `CODE_HOURLY_MAX = 5`, `CODE_PER_MINUTE = 5`(IP, 기존 `rate_limit` 버킷 `"signup-code"`).
- 마이그레이션 `008_signup_codes.sql`: `CREATE TABLE signup_codes (email TEXT PRIMARY KEY, code_hash TEXT NOT NULL, expires_at REAL NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, last_sent_at REAL NOT NULL, window_start REAL NOT NULL, window_count INTEGER NOT NULL)`. 시간은 `request.app.state.clock()` 초(float).
- `POST /api/auth/signup/code {email}` 순서: verify 꺼짐 404 → IP 제한 429 `rate_limited` → `normalize_login` 후 형식 422 `invalid_email`(field email) → 키 없음(발송기 None) 503 `mail_unavailable` → 가입된 이메일 409 `email_taken` → 줄이 있고 `now - last_sent_at < 60` 이면 429 `code_cooldown` + `retryAfterSec`(올림 정수) → 1시간 창(`now - window_start < 3600`)에서 `window_count >= 5`면 429 `code_limit` → 새 PIN 생성 → **발송** → 성공하면 줄 저장(새 해시·만료 now+600·attempts 0·last_sent_at now·창 갱신: 창이 지났으면 window_start=now, count=1, 아니면 count+1) → `202 {"expiresInSec":600,"resendInSec":60}`. 발송 실패면 `502 mail_failed`, 줄은 그대로.
- `POST /api/auth/signup` 켜짐: 기존 칸 검사 다음에 PIN 검사(오류 모두 `field: "code"`): `code.strip()` 비면 422 `code_required` / 줄 없음·`now >= expires_at`·`attempts >= 5`면 422 `code_expired` / 틀리면 attempts+1(커밋), 그 결과 5에 닿으면 422 `code_expired`, 아니면 422 `code_invalid` + `attemptsLeft` → 그다음 이메일 중복 409 → 계정 생성·세션·`signup_codes` 줄 삭제를 한 트랜잭션.
- `ApiError`에 추가 필드(`retryAfterSec`, `attemptsLeft`)를 실어 보내는 방법은 기존 `ApiError` 구조를 확인해 맞춘다(필요하면 additive로 확장).
- 로그에는 예외 클래스 이름만. PIN·이메일·키 금지.
- 커밋: `feat(api):`(계약·docs), `feat(backend):`, `chore(infra):`. 검증: `cd backend && uv run ruff format . && uv run pytest -q && uv run ruff check . && uv run ruff format --check .`

---

### Task 1: 발송기·설정·주입 (`app/mail.py`, `config.py`, `main.py`, compose)

**Files:** Create `backend/app/mail.py`, `backend/tests/test_mail.py`. Modify `backend/app/config.py`, `backend/app/main.py`(`create_app(..., mailer=...)`, `app.state.mailer`), `backend/tests/fakes.py`(`FakeMailer`: `sent` 목록, `fail` 플래그), `backend/tests/conftest.py`(`fake_mailer` fixture, `make_client(..., mailer=)` 기본 None), `deploy/docker-compose.yml`, `deploy/README.md`(메일 인증 절: 변수 3개, `read -rsp`로 키 넣기, 켜는 순서).

**Interfaces — Produces:**
- `class MailError(Exception)`; `class Mailer(Protocol): def send(self, *, to: str, subject: str, text: str, idempotency_key: str) -> None`
- `class HttpMailer: __init__(self, url: str, api_key: str, *, client: httpx.Client | None = None)`
- `create_app`: 주입된 `mailer`가 없고 `settings.mail_api_key`가 있으면 `HttpMailer`를 만든다. 둘 다 없으면 `app.state.mailer = None`.

- [ ] Step 1: 실패 테스트 — httpx `MockTransport`로 요청 형식(URL·헤더 4개·JSON), 2xx 성공, 4xx/5xx·`httpx.TimeoutException` → `MailError`, 실패 시 로그(caplog)에 키·주소·본문 없음; `Settings` 기본값·env 파싱·`repr`에 키 없음; `create_app` 주입 규칙.
- [ ] Step 2~4: 실패 확인 → 구현 → 검증(+ `docker compose -f deploy/docker-compose.yml config -q`)
- [ ] Step 5: 커밋 `feat(backend): 메일 발송기(send.ssenu.cloud)와 가입 인증 설정 — 기본 꺼짐`

### Task 2: PIN 저장과 인증번호 받기 API (마이그레이션 008, repo, 엔드포인트 2개)

**Files:** Create `backend/app/migrations/008_signup_codes.sql`, `backend/app/repos/signup_codes.py`, `backend/tests/test_signup_code.py`. Modify `backend/app/routers/auth.py`, `backend/app/schemas.py`(`SignupCodeBody`, `SignupCodeSent`, `SignupConfig`), `docs/API.md`(인증 절).

**Interfaces — Produces (repo):** `get(conn, email) -> CodeRow | None`, `save_sent(conn, *, email, code_hash, now) -> None`(창 갱신 포함), `add_attempt(conn, email) -> int`(갱신 후 attempts), `delete(conn, email) -> None`; `hash_code(email, code) -> str`, `new_code() -> str`, 상수들.

- [ ] Step 1: 실패 테스트 — 꺼짐 404·config false / 켜짐: 202와 응답 본문, FakeMailer에 메일 1통(제목·본문 형식, 본문의 6자리가 DB 해시와 일치, DB에 원문 없음), 같은 이메일 60초 안 `code_cooldown`+`retryAfterSec`, 61초 뒤 재발송 성공·이전 해시 교체, 1시간 6번째 `code_limit`(가짜 시계로 60초씩 전진), 1시간 뒤 창 초기화, IP 6번째 `rate_limited`, 가입된 이메일 409·메일 0통, 형식 오류 422, 발송기 None 503, 발송 실패 502·줄 그대로·쿨다운 안 걸림, config true.
- [ ] Step 2~4: 실패 확인 → 구현 → 검증
- [ ] Step 5: 커밋 `feat(api): 가입 인증번호 받기 POST /auth/signup/code·설정 조회 GET /auth/signup/config — PIN 해시 저장, 재발송·발송 상한`

### Task 3: 가입에서 PIN 확인 (`POST /api/auth/signup`)

**Files:** Modify `backend/app/schemas.py`(`SignupBody.code: str = ""`), `backend/app/routers/auth.py`(`signup`), `docs/API.md`. Test `backend/tests/test_signup_verify.py`, 기존 가입 테스트는 수정 없이 통과.

- [ ] Step 1: 실패 테스트 — 꺼짐: `code`를 보내도 무시·지금과 같은 응답 / 켜짐: 맞는 PIN 201·세션 쿠키·`signup_codes` 줄 삭제, 같은 PIN으로 다른 가입 시도 `code_expired`, PIN 없음 `code_required`, 틀림 `code_invalid`+`attemptsLeft` 4→3…, 5번째 오답 `code_expired` 이후 맞는 PIN도 `code_expired`, 10분 뒤 `code_expired`, 재발송 후 이전 PIN `code_invalid`, 기존 칸 오류가 PIN 검사보다 먼저, 이미 가입한 이메일 409, 기존 계정 로그인 영향 없음, 마이그레이션 008 적용 후 기존 DB 계정 로그인 유지.
- [ ] Step 2~4: 실패 확인 → 구현 → 검증
- [ ] Step 5: 커밋 `feat(api): 가입 시 이메일 PIN 확인 — 맞을 때만 계정 생성, 오답 5회 폐기·10분 만료`

## 마무리 (컨트롤러)

- 최종 리뷰 → 수정 1회 → PR `feature/signup-email-verify` → `dev`(`deploy/` 포함이라 @leemonta9482 리뷰). 프론트 이슈(가입 화면 PIN).
- 머지 후 demomo `.env`에 `MAIL_API_KEY`(값은 화면에 안 찍음) → 잠깐 켜서 curl로 실제 발송 1회(`cwhappy123@gmail.com`) → 끄기.
