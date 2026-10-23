# 벤 모집공고 링크 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 벤 회사 트랙에 모집공고 URL(선택)을 받아, 첫 턴 조사 호출 한 번에서 `web_fetch`로 공고를 읽고 브리핑에 "모집공고 요구사항"을 넣어 질문에 반영한다.

**Architecture:** `schemas.CompanyInputs.postingUrl` → 시작 시 회사명 또는 URL이 있으면 조사 대기. `briefing.make_briefing(..., posting_url)`이 `claude.research(..., fetch_domains=[host])`를 부르고(웹 검색 + 웹 가져오기 도구), 캐시 키는 `cache_key(company, job, posting_url)`. `prompts.build_system`이 브리핑 속 공고 요구사항을 보고 질문 규칙을 덧붙인다.

**Tech Stack:** Python 3.12, FastAPI, pydantic v2, sqlite3, anthropic SDK(`web_search_20260209`, `web_fetch_20260209`), pytest, ruff, uv

**Spec:** `docs/specs/backend/2026-10-23-ben-job-posting-design.md`

## Global Constraints

- 모든 `/api` 변경은 additive. 회사명·공고 URL이 모두 없으면 요청·SSE·프롬프트가 지금과 바이트 단위로 같다. 회사명만 있으면 조사 요청(도구 목록·메시지)·캐시 키·프롬프트가 지금과 같다.
- `postingUrl`: 공백 제거 후 1~500자, `http`/`https` 스킴 + 호스트 있는 절대 URL. 비면 없음. 위반 → `422 {"error":"invalid","field":"postingUrl"}`. 대입 트랙이면 저장하지 않음. 저장되는 `inputs.company`에는 값이 있을 때만.
- 조사 시작: 회사명(공백·대괄호 접기 후 비지 않음) 또는 `postingUrl`이 있으면 `briefing_status="pending"`.
- 조사 도구: 공고 URL이 있을 때만 `{"type": "web_fetch_20260209", "name": "web_fetch", "max_uses": 2, "allowed_domains": [<공고 호스트>]}`를 `WEB_SEARCH_TOOL` 뒤에 추가.
- 조사 메시지(공고 있을 때): `지원 기업: {회사명 또는 "(공고에서 확인)"}\n지원 직무: {직무}\n모집공고: {URL}\n이 기업의 면접 준비용 브리핑을 작성해 주세요.` — 공고 없으면 지금 문구 그대로.
- 조사에는 회사명·직무·공고 URL만. 이력서·대화 금지. 로그에 URL·본문 남기지 않음.
- 브리핑 상한 2,000 → 2,800자. 최소 200자·출처 10개·검색 결과 없으면 실패 규칙 유지(공고 가져오기 성공 URL도 출처로 인정).
- 캐시 키: `posting_url`이 없으면 지금과 동일한 문자열. 있으면 `f"{기존}\n{url.strip()}"`. 회사명 없으면 회사 자리에 빈 문자열.
- 공고 질문 규칙(서버가 판단): 브리핑에 `모집공고 요구사항`이 있고 `공고를 확인하지 못함`이 없으면 진행 규칙 2번에 `POSTING_FOCUS` 추가.
- `POSTING_FOCUS = "질문 중 1~2개는 [지원 기업 최신 정보]의 \"모집공고 요구사항\"(기술 스택·업무)을 지원자 이력서와 연결해 묻고, 회사 소식 질문보다 먼저 합니다."`
- `REPORT_INSTRUCTION`·로컬 프롬프트와의 동기화(`tests/test_prompt_parity.py`)는 그대로 통과.
- 커밋: `feat(api):`(계약·docs), `feat(backend):`. 검증: `cd backend && uv run ruff format . && uv run pytest -q && uv run ruff check . && uv run ruff format --check .`

---

### Task 1: 계약 — `company.postingUrl`, 조사 시작 조건, `docs/API.md`

**Files:** Modify `backend/app/schemas.py`(`CompanyInputs`), `backend/app/routers/premium.py`(`start_interview`의 조사 시작 판단), `docs/API.md`(벤 1) 시작). Test `backend/tests/test_premium_start.py`.

- [ ] **Step 1: 실패 테스트**
  - `postingUrl` 저장(앞뒤 공백 제거), `briefing_status == "pending"`
  - 회사명 없이 URL만 → pending, URL·이름 둘 다 없으면 none, 이름만이면 지금처럼 pending
  - 빈 문자열·공백 → 저장 안 함(`"postingUrl" not in inputs.company`)
  - `ftp://x.com/a`, `example.com/jobs`(스킴 없음), `https://`(호스트 없음), 501자 → 422 `field: "postingUrl"`
  - 대입 트랙 요청에 `company.postingUrl`이 있어도 무시(저장 안 됨, none)
- [ ] **Step 2: 실패 확인** — `uv run pytest tests/test_premium_start.py -q`
- [ ] **Step 3: 구현**
  - `CompanyInputs.postingUrl: str | None = None` + `field_validator`: strip → 빈 값 None → 길이 ≤500 → `urllib.parse.urlsplit`로 `scheme in {"http","https"} and netloc` 아니면 `ValueError`.
  - `start_interview`: `research = body.track == "company" and body.company is not None and (bool(prompts._one_line(body.company.name or "")) or body.company.postingUrl is not None)` → `briefing_status="pending" if research else "none"`. `inputs`는 `model_dump(exclude_none=True)` 그대로.
  - `docs/API.md` 1) 시작: 요청 예시에 `"postingUrl": "https://…"` 추가, 설명 bullet(형식·조사 시작 조건·조사에 보내는 것은 회사명·직무·URL뿐·대입 무시).
- [ ] **Step 4~5: 검증 → 커밋** `feat(api): 벤 시작 요청에 company.postingUrl(선택) — 회사명 또는 공고가 있으면 첫 턴 조사`

### Task 2: 조사 — `web_fetch`, 공고 메시지·지시문, 캐시 키, 브리핑 상한

**Files:** Modify `backend/app/llm/claude.py`(`research`에 `fetch_domains`), `backend/app/llm/briefing.py`, `backend/app/repos/briefings.py`(`cache_key`), `backend/app/routers/premium.py`(`_resolve_briefing`·`_research_with_pings`·`_research_and_store`가 URL을 넘김), `backend/tests/fakes.py`(가짜 `research`가 `fetch_domains`를 받아 기록). Tests `test_claude.py`, `test_briefing.py`, `test_repo_briefings.py`, `test_ben_briefing.py`.

**Interfaces — Produces:**
- `claude.WEB_FETCH_TOOL_BASE = {"type": "web_fetch_20260209", "name": "web_fetch", "max_uses": 2}`
- `ClaudeClient.research(*, system, messages, max_tokens, on_usage=None, fetch_domains: list[str] | None = None)` — `fetch_domains`가 있으면 `tools=[WEB_SEARCH_TOOL, {**WEB_FETCH_TOOL_BASE, "allowed_domains": fetch_domains}]`, 없으면 지금 그대로 `[WEB_SEARCH_TOOL]`.
  - 응답 처리: `server_tool_use`는 이름과 무관하게 "검색 시작"으로 본다(머리말 규칙). `web_fetch_tool_result` 블록의 `content`가 오류가 아니면(`getattr(content, "url", None)`) 그 URL을 출처에 넣는다(제목은 `content.content.title` 등 있으면, 없으면 URL). 오류 객체면 무시.
- `briefing.research_messages(company, job, posting_url=None)`, `briefing.make_briefing(claude, company, job, on_usage=None, posting_url=None)` — URL이 있으면 `fetch_domains=[urlsplit(url).hostname]`.
- `RESEARCH_SYSTEM` 규칙 8 추가: `8. 메시지에 모집공고가 있으면 먼저 그 페이지를 읽고, 다섯 번째 소제목 "모집공고 요구사항"에 담당 업무·필수 자격/기술 스택·우대 사항·인재상을 공고에 적힌 대로 정리합니다. 공고를 열지 못하거나 공고가 아니면 그 소제목에 "공고를 확인하지 못함"이라고만 씁니다. 지원 기업이 "(공고에서 확인)"이면 공고에서 회사명을 확인해 첫 줄에 밝힙니다.`
- `BRIEFING_MAX = 2800`
- `briefings.cache_key(company, job, posting_url: str | None = None)`

- [ ] **Step 1: 실패 테스트**
  - `test_claude.py`: `fetch_domains=["www.wanted.co.kr"]` → 두 번째 도구가 `web_fetch_20260209`·`max_uses` 2·`allowed_domains` 그 값; 없으면 도구가 `[WEB_SEARCH_TOOL]` 하나뿐(지금과 동일); `web_fetch_tool_result`(성공 → 출처 추가, 오류 객체 → 무시); `server_tool_use`(web_fetch)도 머리말을 버림.
  - `test_briefing.py`: URL 있을 때 메시지 문구·`fetch_domains`, 회사명 없으면 `(공고에서 확인)`, URL 없을 때 지금 문구 그대로, 2,800자 자르기, 공고만 출처(검색 결과 없음)여도 성공.
  - `test_repo_briefings.py`: URL 없으면 키가 지금과 같음, URL 있으면 다름(공백 제거).
  - `test_ben_briefing.py`: URL만 있는 면접 첫 턴 → 조사 1회(가짜 research에 `fetch_domains` 기록), 같은 회사·직무라도 URL이 다르면 캐시 미적중·같으면 적중, 이름만 있는 기존 흐름은 그대로(기존 테스트 통과).
- [ ] **Step 2~4: 실패 확인 → 구현 → 검증**
- [ ] **Step 5: 커밋** `feat(backend): 벤 회사 조사에 모집공고 읽기(web_fetch, 공고 도메인만) — 공고 요구사항 소제목, 캐시 키에 URL`

### Task 3: 면접 반영 — 공고 질문 규칙 (`app/llm/prompts.py`, 계층 규율 경로)

**Files:** Modify `backend/app/llm/prompts.py`. Test `backend/tests/test_prompts.py`.

- [ ] **Step 1: 실패 테스트**
  - 브리핑에 `모집공고 요구사항` + 정상 내용 → 규칙 2번에 `BRIEFING_FOCUS`와 `POSTING_FOCUS` 둘 다
  - 브리핑에 `모집공고 요구사항`이 있지만 `공고를 확인하지 못함` → `POSTING_FOCUS` 없음
  - 공고 소제목 없는 브리핑 → 지금과 동일(`BRIEFING_FOCUS`만)
  - 브리핑 없음 → 지금과 바이트 동일
  - 회사명 없이 공고로만 조사한 면접(`company`에 `name` 없음) → 소개 문장이 `{분야} 분야 기업`(지금 폴백)
- [ ] **Step 2~4: 실패 확인 → 구현(`POSTING_MARK = "모집공고 요구사항"`, `POSTING_MISSING = "공고를 확인하지 못함"`, `POSTING_FOCUS` 상수 — Global Constraints 문구 그대로, `build_system`에서 판단) → 검증**
- [ ] **Step 5: 커밋** `feat(backend): 벤 질문 규칙 — 공고 요구사항이 있으면 기술 스택·업무를 이력서와 연결해 1~2개 질문`

## 마무리 (컨트롤러)

- PR `feature/job-posting` → `dev`, 본문에 `prompts.py` 전후 비교(규칙 2번 문장), 리뷰어 @leemonta9482. 프론트 이슈(공고 링크 칸·고지 한 줄) 등록.
- 머지 후 demomo에서 공개 공고 URL로 벤 첫 턴 확인(브리핑의 공고 요구사항, 질문 반영).
