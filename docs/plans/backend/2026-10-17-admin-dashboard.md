# 관리자 대시보드 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 모모 안 `/admin` 화면에서 관리자(비상용 계정 + `ADMIN_EMAILS`)가 운영 지표·사용자(티켓 조정)·Claude 비용·감사 로그를 본다.

**Architecture:** 백엔드는 `AdminUser` 권한 의존성 + `routers/admin.py`(조회·티켓 조정) + `repos/admin_stats.py`·`repos/audit.py`·`repos/usage.py` + 마이그레이션 005(`claude_usage`, `admin_audit`). Claude 호출마다 `on_usage` 콜백으로 사용량을 받아 기록한다. 프론트는 `App`이 주소 `/admin`일 때 지연 로딩한 `views/admin/AdminView.vue`를 띄우고, `services/adminApi.ts`·`stores/admin.ts`가 API를 감싼다.

**Tech Stack:** FastAPI·pydantic v2·sqlite3·pytest·ruff·uv / Vue 3·TS·Pinia·Vitest·@vue/test-utils·pnpm

**Spec:** `docs/specs/backend/2026-10-17-admin-dashboard-design.md`

## Global Constraints

- 계정 등급(`tier`)은 대시보드에서 **보여 주지도 바꾸지도 않는다**. 응답에 `tier` 칸을 넣지 않는다.
- 이력서·대화·리포트·녹음 **본문**은 어떤 `/api/admin/*` 응답에도 넣지 않는다. 사용량 기록에도 프롬프트·응답 본문을 넣지 않는다.
- 모든 `/api/admin/*`는 `AdminUser`: 비로그인 `401 {"error":"unauthorized"}`, 로그인했지만 관리자 아님 `403 {"error":"admin_required"}`.
- 관리자 = 비상용 `ADMIN_LOGIN` 계정 ∪ `ADMIN_EMAILS`(쉼표 구분, 공백 제거·소문자) 이메일로 가입한 계정. 목록 밖은 기동 시 해제·세션 삭제. 목록 이메일로 가입하면 즉시 관리자.
- 비상용 비밀번호 12자 미만이면 개요 `weakEmergencyPassword: true`(로그인은 막지 않음).
- 티켓 조정: `delta` 정수 −100~100·0 불가, `reason` 공백 제거 후 1~200자, 결과 음수면 `409 {"error":"insufficient_tickets"}`, 티켓 변경 + 감사 로그 한 트랜잭션, 응답 `{"tickets": n}`.
- 목록 페이지 50개, `q` 최대 100자, `usage?days` 1~90(기본 30). "오늘"·일별은 KST 날짜(`timefmt.kst_day_start`와 같은 기준).
- 요금표(`app/llm/pricing.py`): Sonnet 5.5 입력 $2.0, 출력 $10.0, 캐시 읽기 $0.2, 캐시 쓰기 $2.5 (/100만 토큰), 웹 검색 $0.01/회. 비용은 조회 시 계산.
- 사용량 기록 실패는 면접을 막지 않는다(삼키고 본문 없는 경고만).
- 회사명 없는 벤 면접·측정값 없는 리포트 등 기존 경로의 SSE 이벤트·프롬프트·응답은 그대로.
- 프론트: 사용자 이름·사유 등은 Vue 텍스트 바인딩만(`innerHTML` 금지). 새 라이브러리 금지(차트는 SVG/CSS).
- 커밋: `feat(backend):` / `feat(api):`(계약·`docs/API.md`) / `feat(frontend):`.
- 백엔드 검증(`backend/`): `uv run ruff format . && uv run pytest -q && uv run ruff check . && uv run ruff format --check .`
- 프론트 검증(`frontend/`): `pnpm test && pnpm lint && pnpm exec prettier --check . && pnpm exec vue-tsc --noEmit`

---

### Task 1: 관리자 여러 명 + `AdminUser`

**Files:** Modify `backend/app/config.py`, `backend/app/startup.py`, `backend/app/repos/users.py`, `backend/app/routers/auth.py`, `backend/app/deps.py`. Test `backend/tests/test_admin.py`(기존 파일 확장), `backend/tests/test_config.py`.

**Interfaces — Produces:**
- `Settings.admin_emails: tuple[str, ...] = ()` ← env `ADMIN_EMAILS`(쉼표 분리, 각 `normalize_login`, 빈 항목 제거, 중복 제거·순서 유지)
- `users.sync_admin(conn, *, login, password_hash, created_at, emails: tuple[str, ...] = ())`: 관리자 집합 = `{login} ∪ emails`(login이 None이면 emails만). 비상용 계정 생성·비밀번호 동기화는 지금과 같고, `emails` 계정은 존재할 때만 `is_admin = 1`(비밀번호 안 건드림). 집합 밖 `is_admin = 1` 계정은 세션 삭제 후 0.
- `startup.sync_admin`이 `settings.admin_emails`를 넘긴다.
- 가입(`auth.signup`): 정규화한 이메일이 `request.app.state.settings.admin_emails`에 있으면 같은 트랜잭션에서 `is_admin = 1`(응답 `isAdmin: true`).
- `deps.require_admin` / `AdminUser = Annotated[User, Depends(require_admin)]`: `LoggedInUser` 위에서 `not user.is_admin` → `ApiError(403, "admin_required")`.

- [ ] **Step 1: 실패 테스트** — 아래 케이스를 `tests/test_admin.py`·`tests/test_config.py`에 추가(기존 픽스처 `settings`·`make_client`·`helpers.signup/login_admin` 재사용, `dataclasses.replace(settings, admin_emails=(...))`):
  1. `Settings.from_env({"ADMIN_EMAILS": " A@b.com, c@d.com ,,a@b.com"}).admin_emails == ("a@b.com", "c@d.com")`; 없으면 `()`.
  2. `ADMIN_EMAILS`에 있는 이메일로 가입 → 응답 `isAdmin is True`. 목록에 없는 가입 → `False`.
  3. 이미 가입한 일반 계정 → `admin_emails`에 넣고 앱 재기동(`make_client(replace(...))`) → `/api/me`의 `isAdmin`이 `True`, 비밀번호 그대로 로그인 가능.
  4. 목록에서 빼고 재기동 → `isAdmin False`, 그 계정의 기존 세션 쿠키로 `/api/me`가 비로그인(`null`).
  5. 비상용 계정은 `admin_emails`가 있어도 계속 관리자(`login_admin` 성공 + `isAdmin`).
  6. `admin_login`·`admin_password` 없이 `admin_emails`만 있어도 목록 계정은 관리자.
- [ ] **Step 2: 실패 확인** — `uv run pytest tests/test_admin.py tests/test_config.py -q`
- [ ] **Step 3: 구현** — 위 Interfaces대로. `users.sync_admin` 끝의 해제 SQL은 `email NOT IN (집합)`으로 일반화(빈 집합이면 전부 해제 — 지금 `login is None` 분기와 같은 결과). `deps.py`:

```python
def require_admin(user: LoggedInUser) -> User:
    if not user.is_admin:
        raise ApiError(403, "admin_required")
    return user


AdminUser = Annotated[User, Depends(require_admin)]
```
- [ ] **Step 4: 통과 확인** — 백엔드 검증 명령
- [ ] **Step 5: 커밋** — `feat(backend): 관리자 여러 명(ADMIN_EMAILS) — 가입 즉시 관리자, 목록 밖 해제, AdminUser`

---

### Task 2: 마이그레이션 005 + 사용량·감사 저장소 + 요금표

**Files:** Create `backend/app/migrations/005_admin_usage_audit.sql`, `backend/app/repos/usage.py`, `backend/app/repos/audit.py`, `backend/app/llm/pricing.py`. Test `backend/tests/test_repo_usage.py`, `backend/tests/test_repo_audit.py`, `backend/tests/test_pricing.py`.

```sql
-- 관리자 대시보드(spec 2026-10-17 4·5절): Claude 호출 사용량과 관리자 감사 로그. additive.
CREATE TABLE claude_usage (
    id TEXT PRIMARY KEY,
    at TEXT NOT NULL,
    user_id TEXT NOT NULL,
    interview_id TEXT,
    kind TEXT NOT NULL CHECK (kind IN ('turn', 'report', 'research')),
    model TEXT NOT NULL,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    cache_read_tokens INTEGER NOT NULL DEFAULT 0,
    cache_write_tokens INTEGER NOT NULL DEFAULT 0,
    web_searches INTEGER NOT NULL DEFAULT 0,
    outcome TEXT NOT NULL CHECK (outcome IN ('ok', 'error', 'refused'))
);
CREATE INDEX claude_usage_at ON claude_usage (at);
CREATE TABLE admin_audit (
    id TEXT PRIMARY KEY,
    at TEXT NOT NULL,
    admin_user_id TEXT NOT NULL,
    action TEXT NOT NULL,
    target_user_id TEXT,
    detail_json TEXT NOT NULL
);
CREATE INDEX admin_audit_at ON admin_audit (at);
```

**Interfaces — Produces:**
- `pricing.MODEL_PRICING = {"model": "claude-sonnet-5-5", "inputPerMTok": 2.0, "outputPerMTok": 10.0, "cacheReadPerMTok": 0.2, "cacheWritePerMTok": 2.5, "webSearch": 0.01}`; `pricing.cost_usd(input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, web_searches) -> float`(소수 넷째 자리 반올림).
- `usage.record(conn, *, at, user_id, interview_id, kind, model, input_tokens=0, output_tokens=0, cache_read_tokens=0, cache_write_tokens=0, web_searches=0, outcome) -> None`
- `usage.rows_since(conn, since: str) -> list[sqlite3.Row]`(시각 오름차순), `usage.first_at(conn) -> str | None`
- `audit.record_tickets(conn, *, at, admin_user_id, target_user_id, delta, reason) -> None`(`action='tickets'`, `detail_json={"delta":…,"reason":…}`)
- `audit.page(conn, *, page: int, size: int = 50) -> tuple[int, list[dict]]` — `(total, items)`, 최신순, 항목 `{at, adminEmail, action, targetUserId, targetEmail, delta, reason}`(users 조인, 삭제된 사용자면 이메일 None)
- `audit.ticket_log(conn, *, target_user_id, limit=50) -> list[dict]` — `{at, adminEmail, delta, reason}` 최신순

- [ ] **Step 1: 실패 테스트** — 기록·조회 왕복, 정렬, 페이지(51개 넣고 2페이지 1개), `cost_usd(1_000_000, 1_000_000, 1_000_000, 1_000_000, 10) == 14.8`, 마이그레이션 후 두 테이블 존재.
- [ ] **Step 2~4** — 실패 확인 → 구현 → 백엔드 검증
- [ ] **Step 5: 커밋** — `feat(backend): Claude 사용량·관리자 감사 로그 저장소(마이그레이션 005), 요금표`

---

### Task 3: Claude 호출 사용량 기록 (`on_usage`)

**Files:** Modify `backend/app/llm/claude.py`, `backend/app/llm/briefing.py`, `backend/app/routers/premium.py`, `backend/tests/fakes.py`. Test `backend/tests/test_claude.py`, `backend/tests/test_ben_usage.py`(신규).

**Interfaces — Produces:**
- `claude.Usage`(frozen dataclass): `input_tokens=0, output_tokens=0, cache_read_tokens=0, cache_write_tokens=0, web_searches=0`; `Usage.__add__`.
- `UsageSink = Callable[[Usage, str], None]` — `(usage, outcome)`, outcome `ok|error|refused`.
- `ClaudeClient.stream_text(..., on_usage: UsageSink | None = None)` / `research(..., on_usage: UsageSink | None = None)`.
  - `AnthropicClaude.stream_text`: 끝나면 `final.usage`로 `Usage`(`input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`; None은 0) 만들어 거절이면 `"refused"`, 아니면 `"ok"`로 콜백 후 기존대로 진행(거절이면 `ClaudeError("refused")`). `APIError`면 `Usage()`·`"error"` 콜백 후 `ClaudeError("claude_error")`.
  - `research`: 이어 받기마다 사용량 합산(`server_tool_use.web_search_requests`도), 끝·거절·오류에 같은 규칙으로 콜백 1번.
  - 콜백 예외는 삼킨다(`try/except Exception: pass` — 기록 실패가 면접을 막지 않게).
- `briefing.make_briefing(claude, company, job, on_usage=None)`이 `research`에 그대로 넘긴다.
- 라우터: 벤 턴(`kind="turn"`)·리포트(`"report"`)·조사(`"research"`) 호출에 `on_usage`를 넘기고, 콜백은 `db.connection(db_path)`로 `usage.record(...)`(`user_id`·`interview_id`·`model=claude.MODEL`·KST 아닌 UTC `iso(clock())`). 기록 중 예외는 삼킨다.
- `FakeClaude`: 생성자에 `usage: Usage = Usage(input_tokens=100, output_tokens=20)`; `stream_text`·`research`가 성공 시 `(self.usage, "ok")`, 예외 항목을 만나면 `(Usage(), "error")`(ClaudeError의 code가 `refused`면 `"refused"`)로 콜백 후 예외.

- [ ] **Step 1: 실패 테스트**
  - `test_claude.py`: 가짜 SDK `final.usage`/응답 `usage`(SimpleNamespace)로 `stream_text` 콜백 값·outcome(ok/refused/error), `research` 이어 받기 합산과 `web_search_requests`.
  - `test_ben_usage.py`: 벤 첫 턴 후 `claude_usage` 1행(`kind='turn'`, `outcome='ok'`, `input_tokens=100`); 회사명 있는 첫 턴 → `research` 1행 + `turn` 1행; 실패 턴(`ClaudeError`) → `outcome='error'` 1행; 리포트 → `report` 1행; 콜백이 던져도(`monkeypatch`로 `usage.record`가 예외) 턴 SSE가 정상 `done`.
- [ ] **Step 2~4** — 실패 확인 → 구현 → 백엔드 검증(기존 벤 테스트 그대로 통과)
- [ ] **Step 5: 커밋** — `feat(backend): 벤 Claude 호출마다 토큰·웹 검색 사용량 기록(on_usage)`

---

### Task 4: 관리자 조회·티켓 API + `docs/API.md`

**Files:** Create `backend/app/repos/admin_stats.py`, `backend/app/routers/admin.py`; Modify `backend/app/main.py`(라우터 등록), `backend/app/schemas.py`(관리자 응답·요청 모델), `docs/API.md`. Test `backend/tests/test_admin_api.py`.

**Interfaces — Produces:** spec 3절의 6개 엔드포인트, 응답 형태 그대로(칸 이름 camelCase).
- `admin_stats.overview(conn, *, now: float, daily_limit: int, emergency_password: str | None) -> dict`
- `admin_stats.users_page(conn, *, q: str, page: int) -> dict`, `admin_stats.user_detail(conn, user_id) -> dict | None`
- `admin_stats.usage_report(conn, *, now: float, days: int) -> dict` — `pricing.cost_usd`로 일별·종류별·상위 10 면접 비용
- `POST /tickets`: 트랜잭션 안에서 `UPDATE users SET tickets = tickets + ? WHERE id = ? AND tickets + ? >= 0` → rowcount 0이면 사용자 유무로 `404`/`409 insufficient_tickets`, 성공이면 `audit.record_tickets`.

- [ ] **Step 1: 실패 테스트** (`test_admin_api.py`)
  - 6개 엔드포인트 모두: 비로그인 401, 일반 계정 403 `admin_required`.
  - overview: 빈 DB 값(0들, `byDay` 30칸, `ben.dailyLimit` = 설정값), 가입·벤 면접 만든 뒤 숫자, KST 날짜 경계(`clock`을 한국 자정 직전·직후로), 비상용 비밀번호 `"admin"` → `weakEmergencyPassword True`, 12자 이상이면 False.
  - users: 페이지·검색(이메일·이름), `lastActiveAt`, **응답 JSON 문자열에 `tier` 키 없음**.
  - user detail: 벤·보관 메타데이터, `hasRecording`, **이력서 텍스트·대화 문자열이 응답에 없음**(보관 기록 `messages`의 고유 문자열로 확인), 없는 id 404.
  - tickets: +5 → 200 `{"tickets": n}` + 감사 1행 + 상세 `ticketLog`; −(현재+1) → 409, 티켓·감사 그대로; `delta` 0·101·`reason` 공백 → 422; 없는 사용자 404.
  - usage: `claude_usage` 행을 직접 넣고 일별·종류별 합계·`costUsd`·`topInterviews`·`since`; `days` 0·91 → 422.
  - audit: 페이지·최신순·`targetEmail`.
- [ ] **Step 2~4** — 실패 확인 → 구현 → 백엔드 검증
- [ ] **Step 4b: `docs/API.md`** — "관리자(2026-10-17)" 절 추가: 권한(401/403), 6개 엔드포인트 요청·응답(spec 3절 그대로), `ADMIN_EMAILS`, 티켓 조정 오류, 비용 계산 방식, 본문 비노출 원칙. `Session.isAdmin` 설명에 `ADMIN_EMAILS` 한 줄. 문서 인덱스 표 그대로.
- [ ] **Step 5: 커밋** — `feat(api): 관리자 API — 개요·사용자·티켓 조정·비용·감사 로그`

---

### Task 5: 프론트 — 관리자 API 서비스·스토어

**Files:** Create `frontend/src/services/adminApi.ts`, `frontend/src/services/adminApi.test.ts`, `frontend/src/stores/admin.ts`, `frontend/src/stores/admin.test.ts`.

**Interfaces — Produces:**
- 타입: `AdminOverview`, `AdminUserRow`, `AdminUserPage`, `AdminUserDetail`, `AdminUsage`, `AdminAuditPage` — spec 3절 응답 그대로.
- `adminApi`: `overview()`, `users(q, page)`, `user(id)`, `adjustTickets(id, delta, reason) -> Promise<number>`, `usage(days)`, `audit(page)`. `fetch('/api/admin/…', { credentials: 'include' })`, POST는 JSON. 오류 본문 `{"error": code}`를 `AdminError(code, message)`로 — 메시지: `unauthorized` "로그인이 필요합니다", `admin_required` "관리자만 볼 수 있습니다", `insufficient_tickets` "회수할 티켓이 부족합니다", `invalid` "입력한 값을 다시 확인해 주세요", `not_found` "없는 사용자입니다", 연결 실패 `network` "연결하지 못했습니다", 그 밖 `unknown` "요청을 처리하지 못했습니다".
- `useAdminStore`: 상태 `tab: 'overview'|'users'|'usage'|'audit'`, `overview`, `users`, `query`, `page`, `detail`, `usage`, `usageDays`, `audit`, `loading`, `error: string | null`; 액션 `loadTab(tab)`, `searchUsers(q)`, `goPage(n)`, `openUser(id)`, `closeUser()`, `adjustTickets(delta, reason)`(성공 시 상세·목록 다시 읽음), `setUsageDays(d)`.
- 기존 `httpAccount.test.ts`의 `fetch` 스텁 패턴을 따른다.

- [ ] **Step 1~4** — 테스트(요청 URL·메서드·본문, 오류 코드→메시지, 스토어 흐름: 탭 로드, 검색 시 1페이지로, 티켓 조정 후 다시 읽기, 오류 시 `error` 문구) → 구현 → 프론트 검증
- [ ] **Step 5: 커밋** — `feat(frontend): 관리자 API 서비스·스토어`

---

### Task 6: 프론트 — `/admin` 화면과 진입 버튼

**Files:** Create `frontend/src/views/admin/AdminView.vue`, `AdminOverview.vue`, `AdminUsers.vue`, `AdminUserDetail.vue`, `AdminUsage.vue`, `AdminAudit.vue`, `BarChart.vue`(SVG 막대), 각 테스트 `*.test.ts`. Modify `frontend/src/App.vue`, `frontend/src/components/TopBar.vue`(+ `TopBar.test.ts`).

**동작:**
- `App.vue`: `location.pathname === '/admin'`이면 `defineAsyncComponent(() => import('@/views/admin/AdminView.vue'))`를 띄우고 기존 phase 화면·HintBar는 띄우지 않는다(TopBar는 유지). 아니면 지금과 같다.
- `TopBar.vue`: `account.session?.isAdmin`이면 "관리자" 링크 버튼(`data-test="top-admin"`, `href="/admin"`). 관리자 화면에서는 "모모로" 링크(`href="/"`).
- `AdminView`: 세션 로드 전 "확인 중", 비로그인·비관리자면 "관리자만 볼 수 있습니다" + 홈 링크(`data-test="admin-denied"`). 관리자면 탭 4개(`data-test="admin-tab-<tab>"`)와 해당 컴포넌트.
- `AdminOverview`: 카드(가입자 전체·7일·30일, 티켓 보유 사용자, 남은 티켓 합, 오늘 벤 `today/dailyLimit`, 보관·벤 기록, 녹음 개수·용량 MB, 브리핑 캐시) + `BarChart`(최근 30일 벤). `weakEmergencyPassword`면 경고 배너(`data-test="admin-weak-password"`): "비상용 관리자 비밀번호가 12자 미만입니다 — 운영 전에 바꿔 주세요".
- `AdminUsers`: 검색 입력(Enter·버튼), 표(이메일·이름·가입일·티켓·관리자·보관·벤·마지막 활동), 이전/다음 페이지, 행 클릭 → `AdminUserDetail`.
- `AdminUserDetail`: 사용자 칸, 벤 면접 표, 보관 기록 표, 티켓 조정 폼(수량 −100~100·사유 1~200자, 제출 전 확인 문구 "이메일 계정에 ±N장 — 진행할까요?"), 조정 이력. 오류는 스토어 `error` 문구.
- `AdminUsage`: 기간 선택(7/30/90일), 기록 시작일(`since`) 안내, 일별 비용 `BarChart`, 종류별 표, 상위 면접 표, 요금표 표시.
- `AdminAudit`: 표 + 페이지.
- `BarChart`: props `items: {label: string; value: number}[]`, `format?: (n) => string`; SVG 막대 + 각 막대 `<title>`(값), 값이 모두 0이면 "기록 없음".
- 스타일은 기존 픽셀 UI 컴포넌트(`PixelWindow`, `PixelButton`, `StatCard`, `PixelTag`)와 CSS 변수를 쓴다.

- [ ] **Step 1~4** — 컴포넌트 테스트(권한 분기, 탭 전환, 경고 배너, 검색·페이지, 티켓 폼 검증·확인·성공 후 갱신, BarChart 빈 값·막대 수, TopBar 관리자 버튼 표시 조건, App 주소 분기) → 구현 → 프론트 검증(+ `pnpm build`로 관리자 화면이 별도 청크인지 확인)
- [ ] **Step 5: 커밋** — `feat(frontend): 관리자 대시보드 화면 — 개요·사용자(티켓 조정)·비용·감사 로그, 관리자 버튼`

---

### Task 7: 배포 문서 (`deploy/README.md`)

**Files:** Modify `deploy/README.md`.

- "관리자 대시보드(2026-10-17)" 절: `deploy/.env`에 `ADMIN_EMAILS=…` 추가 방법(직접 편집, 커밋 금지), 재기동 `docker compose up -d --no-build`, 비상용 비밀번호 12자 이상 권장과 변경 명령(`read -rsp` 방식), **Cloudflare Access** 설정 절차(Zero Trust → Access → Applications → Self-hosted, 도메인 `demomo.ssenu.cloud`·경로 `admin`과 `api/admin`, 정책 Allow — Emails(본인·공동 개발자) 또는 GitHub 조직 4thIS, demomo·momo 각각), 확인 방법(`curl -I https://demomo.ssenu.cloud/api/admin/overview` → Access 로그인으로 리다이렉트).
- [ ] **Step 1: 문서 작성** — **Step 2: 커밋** `docs: 배포 README 관리자 대시보드 — ADMIN_EMAILS, 비상용 비밀번호, Cloudflare Access`

---

## 마무리 (컨트롤러)

- 백엔드 PR(Task 1~4, 7) → dev 머지 → demomo 자동 배포 → curl로 관리자 API 확인(비상용 계정) → 프론트 PR(Task 5~6, 리뷰 @leemonta9482) → demomo 화면 확인 → Cloudflare Access는 사람이 설정.
- PR은 사용자가 올리라고 할 때 올린다(머지는 사용자).
