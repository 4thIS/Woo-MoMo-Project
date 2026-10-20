# 관리자 대시보드 — 설계 (spec)

- 생성일시: 2026-10-17
- 수정일시: 2026-10-17
- 구현: 백엔드·프론트 모두 @ssenu. `frontend/` 변경은 CODEOWNERS에 따라 @leemonta9482 리뷰.

## 0. 배경 · 위치

로그인(2026-10-13)이 생기면서 DB에 사용자·보관 기록·벤 면접·녹음이 쌓인다. 지금은 파이에 들어가 sqlite를 직접 봐야 운영 상태를 알 수 있다.
관리자 대시보드는 모모 안의 화면(`/admin`)으로, 관리자로 로그인했을 때만 들어갈 수 있다. 같은 앱·같은 배포를 탄다(별도 사이트 아님).

## 1. 목표 · 비목표

### 목표
- **운영 모니터링(A):** 가입 추이, 오늘 벤 사용량 대 하루 상한, 보관·녹음 규모, 브리핑 캐시.
- **사용자 관리(B):** 사용자 목록·상세(메타데이터만), **티켓 지급·회수**.
- **비용 관리(D):** Claude 호출마다 토큰·웹 검색을 기록하고 일별·종류별 추정 비용을 본다.
- 관리자를 여러 명(본인·공동 개발자) 둘 수 있다. 비상용 `ADMIN_LOGIN` 계정은 유지한다.
- 바꾸는 작업(티켓 조정)은 감사 로그에 남는다.

### 비목표 (이번엔 안 함 — 9절 "추후 방안")
- 이력서·대화·리포트·녹음 **원문 열람**(C)
- 계정 정지·삭제, 사용자 탈퇴, 대시보드에서 관리자 지정, 조회 감사 로그
- 비로그인 사용자 통계 — 원칙상 서버에 기록이 없다(CLAUDE.md 8번)

## 2. 관리자 권한

### 2.1 관리자 목록
- 새 설정 `ADMIN_EMAILS`: 쉼표로 구분한 이메일 목록(공백 제거·소문자, `users.normalize_login`과 같은 규칙). 비어 있으면 없음.
- 관리자 = 비상용 `ADMIN_LOGIN` 계정 ∪ `ADMIN_EMAILS`에 있는 이메일로 가입한 계정(기동 시 반영).
- 기동 시(`startup.sync_admin`): 위 집합만 `is_admin = 1`, 나머지는 0으로 맞추고 해제되는 계정의 세션을 지운다(지금 동작 유지). `ADMIN_EMAILS` 계정의 비밀번호는 건드리지 않는다(각자 가입 때 정한 것).
- 가입만으로는 관리자가 되지 않는다. 목록은 기동 시에만 반영된다(가입에 이메일 인증이 없어, 가입 즉시 승격하면 목록에만 있고 아직 가입 안 한 이메일을 남이 선점해 관리자가 될 수 있다).
- 응답 `Session.isAdmin`은 지금처럼 이 값을 따른다.

### 2.2 비상용 비밀번호 알림
- `ADMIN_PASSWORD`가 설정돼 있고 12자 미만이면 개요 응답에 `weakEmergencyPassword: true`. 로그인은 막지 않는다(지금 demomo가 짧은 비밀번호를 쓰므로 즉시 막으면 비상용 계정이 잠긴다). 화면은 경고 배너를 띄운다.

### 2.3 권한 확인
- `deps.AdminUser`: 로그인 + `is_admin`. 아니면 `401 unauthorized`(비로그인) / `403 {"error":"admin_required"}`.
- 모든 `/api/admin/*`는 `AdminUser`를 거친다. 화면 버튼을 숨기는 것은 편의일 뿐 보안이 아니다.

## 3. 관리자 API (`/api/admin/*`, 계약 — `docs/API.md` 갱신)

시각은 기존과 같은 UTC ISO 문자열, "오늘"·일별 묶음은 한국 날짜(KST, 벤 하루 상한과 같은 기준).

### 3.1 `GET /api/admin/overview`
```jsonc
{
  "users": { "total": 42, "last7Days": 5, "last30Days": 18, "withTickets": 7, "admins": 3 },   // withTickets: 티켓 1장 이상 보유
  "tickets": { "outstanding": 61 },                 // 모든 사용자 남은 티켓 합
  "ben": { "today": 4, "dailyLimit": 30,
           "byDay": [{ "date": "2026-10-17", "count": 4 }, ...] },   // 최근 30일, 없는 날은 0
  "archive": { "entries": 120, "ben": 15 },          // ben: 벤(프리미엄 면접관) 기록
  "recordings": { "count": 33, "bytes": 51200000 },
  "briefings": { "cached": 6 },                     // 7일 안의 company_briefings 행
  "weakEmergencyPassword": true
}
```

### 3.2 `GET /api/admin/users?q=&page=`
- `q`: 이메일·이름 부분 일치(대소문자 무시, 최대 100자). `page`: 1부터, 한 페이지 50명, 가입 최신순.
```jsonc
{ "page": 1, "pageSize": 50, "total": 42,
  "items": [{ "id": "u_…", "email": "…", "name": "…" | null, "createdAt": "…",
              "tickets": 3, "isAdmin": false,
              "archiveCount": 4, "benCount": 2, "lastActiveAt": "…" | null }] }
```
- `lastActiveAt`: 가장 최근 세션 생성·보관 기록·벤 면접 시각 중 최댓값.

### 3.3 `GET /api/admin/users/{id}`
메타데이터만 — 이력서·대화·리포트·녹음 **본문 없음**.
```jsonc
{ "user": { …3.2 항목과 같은 칸… },
  "ben": [{ "id": "pi_…", "createdAt": "…", "track": "company", "status": "active" | "done",
            "modelTurns": 9, "briefingStatus": "ok" }],          // 최신순 최대 50
  "archive": [{ "id": "…", "startedAt": "…", "interviewerId": "m2", "premium": true,
                "track": "company", "questionCount": 5, "hasRecording": true }],  // 최신순 최대 50, hasRecording은 recordings 행 존재
  "ticketLog": [{ "at": "…", "adminEmail": "…", "delta": 5, "reason": "…" }] }   // 최신순 최대 50
```
없는 사용자 `404 not_found`.

### 3.4 `POST /api/admin/users/{id}/tickets`
- 본문 `{ "delta": 5, "reason": "이벤트 보상" }`. `delta` 정수 −100~100, 0 불가. `reason` 공백 제거 후 1~200자.
- 결과 티켓이 0 미만이면 `409 {"error":"insufficient_tickets"}`(바꾸지 않음). 없는 사용자 `404`.
- 티켓 변경과 감사 로그 기록은 **한 트랜잭션**. 응답 `200 { "tickets": 8 }`.
- 대시보드는 계정 등급(`tier`)을 **보여 주지도 바꾸지도 않는다**. 계정 상태는 비로그인/로그인뿐이고, 벤 사용 가능 여부는 티켓으로 본다는 것이 제품 기준이다.
- 알려진 제약: 현재 코드는 아직 `tier == "premium"`으로 벤을 막는다(9절 "등급 정리"). 정리 전까지는 티켓만 지급받은 계정이 벤을 시작하지 못할 수 있다.

### 3.5 `GET /api/admin/usage?days=30`
`days` 1~90(기본 30).
```jsonc
{ "pricing": { "model": "claude-sonnet-5-5", "inputPerMTok": 2.0, "outputPerMTok": 10.0,
               "cacheReadPerMTok": 0.2, "cacheWritePerMTok": 2.5, "webSearch": 0.01 },
  "since": "2026-10-17" | null,                    // 기록을 시작한 한국 날짜(기록이 없으면 null)
  "byDay": [{ "date": "…", "calls": 40, "inputTokens": 0, "outputTokens": 0,
              "cacheReadTokens": 0, "cacheWriteTokens": 0, "webSearches": 3,
              "errors": 1, "refusals": 0, "costUsd": 0.42 }],
  "byKind": [{ "kind": "turn" | "report" | "research", "calls": 0, "costUsd": 0.0 }],
  "topInterviews": [{ "interviewId": "pi_…", "userEmail": "…" | null, "calls": 12, "costUsd": 0.31 }] }  // 비용 순 상위 10
```
비용은 **조회할 때** 요금표로 계산한다(저장하지 않음). 합계는 행별 비용을 반올림하지 않고 더한 뒤 한 번만 반올림한다.

- `byDay`: 오래된 날 → 최근 날 순, 기록 없는 날도 0으로 채운다(`days`개).
- `byKind`: 기록이 있는 종류만.
- `topInterviews`: 비용 순위. 면접 id가 없는 행은 제외. 사용자가 지워졌으면 `userEmail`은 `null`.
- `since`: 기록이 하나도 없으면 `null`.
- 비용은 **하한 추정치**다. 클라이언트 연결이 끊기거나 호출이 중도 포기되면 기록되지 않을 수 있다.

### 3.6 `GET /api/admin/audit?page=`
최신순 50개: `{ at, adminEmail, action: "tickets", targetUserId, targetEmail, delta, reason }`.

## 4. 비용 기록

- 새 테이블 `claude_usage`(마이그레이션): `id, at, user_id, interview_id, kind(turn|report|research), model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, web_searches, outcome(ok|error|refused)`.
- 기록 시점: 벤 턴·리포트·회사 조사 호출이 끝날 때마다(성공·실패 모두). 응답의 `usage`에서 토큰을 읽는다. 실패로 `usage`를 못 받으면 토큰 0·`outcome`만 기록한다.
- `ClaudeClient`가 호출마다 사용량을 돌려줄 수 있게 한다(스트리밍은 끝난 뒤 최종 메시지의 `usage`, 조사는 이어 받기를 포함해 합산·`server_tool_use.web_search_requests`). 테스트용 가짜 클라이언트도 사용량을 돌려준다.
- 요금표는 `app/llm/pricing.py` 상수(Sonnet 5.5: 입력 $2, 출력 $10, 캐시 읽기 $0.20, 캐시 쓰기 $2.50 /100만 토큰, 웹 검색 $0.01/회). 바뀌면 상수만 고친다.
- 기록 실패(DB 오류)는 면접을 막지 않는다 — 삼키되 본문 없이 오류 종류만 남긴다.
- 개인정보: 숫자·종류·id만. 프롬프트·응답 본문을 기록하지 않는다.

## 5. 감사 로그

- 새 테이블 `admin_audit`: `id, at, admin_user_id, action, target_user_id, detail_json`(티켓: `{"delta":5,"reason":"…"}`).
- 이번 범위의 기록 대상은 **티켓 조정뿐**. 조회는 기록하지 않는다.
- 삭제 API 없음.

## 6. 프론트 (`frontend/`, 구현 @ssenu, 리뷰 @leemonta9482)

- 진입: 주소가 `/admin`이면 `App`이 관리자 화면을 **지연 로딩**해 띄운다(라우터 도입 없음 — 지금 phase 방식 옆에 주소 확인 한 갈래). nginx는 이미 모든 경로를 `index.html`로 보낸다.
- 관리자로 로그인하면 상단 바에 "관리자" 버튼(`session.isAdmin`). 관리자가 아니거나 비로그인으로 `/admin`에 오면 안내 후 홈 링크.
- 화면: 탭 4개 — **개요**(카드 + 최근 30일 벤 막대, 약한 비상용 비밀번호 경고), **사용자**(검색·페이지 → 상세 → 티켓 조정 폼: 수량·사유·확인), **비용**(일별 막대·종류별 표·상위 면접, 기록 시작일 표시), **감사 로그**.
- 차트는 새 라이브러리 없이 SVG·CSS 막대.
- 파일: `views/admin/*`, `services/adminApi.ts`, `stores/admin.ts` 신규. 기존 파일은 `App`(주소 분기)·상단 바(버튼)만.
- 모든 텍스트는 Vue 텍스트 바인딩(`innerHTML` 금지 — 사용자 이름·사유가 들어간다).

## 7. 보안 · 배포

- 서버 권한 확인(2.3)이 1차 방어.
- **Cloudflare Access**(2차): `/admin`, `/api/admin/*` 경로에 정책 — 허용 이메일(본인·@leemonta9482) 또는 GitHub 4thIS 조직. 설정 절차는 `deploy/README.md`에 적고 대시보드에서 사람이 설정한다(코드 변경 없음). demomo·momo 각각.
- `deploy/.env`에 `ADMIN_EMAILS` 추가(사람이 직접). 비밀번호는 커밋하지 않는다.
- 비상용 비밀번호는 운영 전 12자 이상으로 바꾼다(2.2 경고로 상기).
- `/api/premium/purchase`는 Cloudflare Access 경로(`/admin`, `/api/admin/*`) 밖이다. 서버의 관리자 검사로만 막힌다(관리자 전용).

## 8. 롤아웃 · 테스트

- 순서: 백엔드 PR(관리자 권한·API·비용 기록·감사 로그·`docs/API.md`) → dev → demomo에서 curl 확인 → 프론트 PR → Cloudflare Access 설정.
- 기존 동작 보존: `ADMIN_EMAILS`가 없으면 관리자 결정은 지금과 같다. 비용 기록 추가가 벤 턴·리포트·조사의 SSE 이벤트·응답을 바꾸지 않는다.
- 백엔드 테스트: 관리자 집합(비상용 ∪ 목록, 목록 밖 해제·세션 삭제, 가입만으로는 관리자 아님·재기동 후 관리자), 403/401, 각 API 응답 형태·집계(빈 DB, 날짜 경계 KST), 티켓 조정(범위·0·음수 결과 409·트랜잭션·감사 로그), 비용 기록(성공·실패·거절, 조사 합산, 비용 계산), 본문 비노출(응답에 이력서·대화 문자열이 없음).

## 9. 추후 방안 (이번 범위 밖)

- **등급 정리:** `users.tier`·`PremiumUser`(`403 premium_required`)를 없애고 "로그인 + 티켓 1장 이상이면 벤 시작, 진행 중 턴·리포트·녹음은 본인 면접이면 허용"으로 바꾼다. `Session.tier`는 프론트가 티켓 기준으로 바뀐 뒤 제거(lockstep). 결제 목업의 "일반 계정 1회 허용"과 함께 처리.

- **콘텐츠 열람(C):** 신고 대응 등으로 특정 기록의 대화·리포트를 열람. 열람 사유 입력 + 열람 감사 로그 필수. 가입 동의는 "본인이 다시 보기 위한 보관"이므로 **동의 범위·고지 문구를 공동으로 합의한 뒤** 진행(CLAUDE.md 8번 개정 필요 여부 포함).
- 계정 정지·해제(로그인·세션 차단, 데이터 유지), 계정 삭제와 사용자 직접 탈퇴(이력서·보관함·녹음 삭제, 되돌릴 수 없음 — 확인 절차·감사 로그).
- 대시보드에서 관리자 지정·해제(지금은 `ADMIN_EMAILS`로만).
- 조회 감사 로그(사용자 상세 열람 기록) — C를 붙일 때 같은 구조로.
- 요금표 여러 모델·기간별 버전 관리, 비용 알림(일일 상한 근접 시).
