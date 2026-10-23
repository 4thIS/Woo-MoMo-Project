# 벤 리포트 버전 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `BEN_REPORT_V2`가 켜지면 벤 리포트를 답변 하나 = 항목 하나(Q1·Q2·Q2-1)와 종합으로 만들고, 번호·측정값 연결·검증은 서버가 하며, SSE `event: report`와 보관함 `reportV2`로 내보낸다. 꺼져 있으면 지금과 바이트 단위로 같다.

**Architecture:** 순수 모듈 `app/llm/report_v2.py`(스키마·답변 수·검증·번호·측정값·이벤트 데이터)를 먼저 만들고, `claude.stream_text`에 구조화 출력(`output_format`)을, `prompts.py`에 버전 2 지시문을 더한 뒤, `make_report`가 설정에 따라 버전 2 경로(검증 실패 시 1회 재생성)를 탄다. 저장은 마이그레이션 007의 `report_v2_json` 칸(면접·보관함).

**Tech Stack:** Python 3.12, FastAPI, pydantic v2, sqlite3, anthropic SDK 1.13(`output_config={"effort", "format": {"type": "json_schema", "schema"}}`), pytest, ruff, uv

**Spec:** `docs/specs/backend/2026-10-23-ben-report-v2-design.md`

## Global Constraints

- `BEN_REPORT_V2` 기본 `false`(`_parse_bool`). 꺼져 있으면 리포트 요청(system·messages·effort·max_tokens, `output_format` 없음)·SSE 순서(`delta…`, `done`)·저장·재요청이 지금과 바이트 단위로 같다. 기존 테스트 수정 없이 통과.
- 로컬 면접관 지시문(`REPORT_INSTRUCTION`, `report_instruction()`)과 `tests/test_prompt_parity.py`는 그대로.
- 답변 수 = `interview.messages`에서 `role == "user"`인 메시지 수(첫 사용자 메시지 `KICKOFF`는 `_history`가 붙이는 것이라 `messages`에 없음 — 구현 전에 `start_interview`/`append_turn`으로 확인하고, 다르면 `KICKOFF` 텍스트인 사용자 메시지를 뺀다).
- 구조화 출력 스키마(`REPORT_V2_SCHEMA`)는 모든 object에 `additionalProperties: false`와 전체 `required`. 지원 안 되는 제약(`minimum`·`maximum`·`minLength`·`maxLength`·`minItems>1`·`maxItems`)을 쓰지 않는다. 범위·개수는 서버 검증·정리로.
  - `items[]`: `answer` integer, `kind` enum `["main","follow"]`, `question`·`answerSummary`·`feedback` string, `delivery` `anyOf [string, null]`.
  - `summary`: `strengths`·`improvements` = array of `{point: string, answers: array of integer}`, `delivery` `anyOf [string, null]`, `postingFit` `anyOf [{met: array of string, gaps: array of string}, null]`.
- 검증(`report_v2.validate(obj, n) -> str | None`, 실패 사유 코드): JSON 파싱 실패 `"json"`, `items[].answer`가 정확히 `1..n` 오름차순(빠짐·중복·순서) 아니면 `"answers"`, 첫 항목 `kind != "main"`이면 `"first_kind"`, `summary.*.answers` 값이 `1..n` 밖이면 `"refs"`. 서버 정리(실패 아님): `strengths`·`improvements`는 앞 3개만, `answers` 중복 제거·정렬.
- 검증 실패 → 같은 요청으로 **한 번 더** 생성(`_count_attempt` 한 번 더, 사용량 기록도 그대로). 두 번째도 실패 → `sse("error", {"code": "bad_report"})`, `mark_done` 안 함. 첫 시도의 `delta`는 이미 흘렀으므로 재생성 전에 `sse("reset", {})`를 보내 프론트가 원문 버퍼를 비우게 한다.
- 번호: `main`마다 `Q1, Q2, …`; `follow`는 바로 앞 `main`(=`Qn`) 아래 `Qn-1, Qn-2, …`, `parent: "Qn"`; `main`은 `parent: null`. `summary`의 `answers` → `refs`(그 답변들의 id, 답변 순).
- 측정값(`measurements`, 측정 없으면 `null`) — 값은 `delivery.py` 판정 그대로(모델 숫자 아님): `{"syllablesPerMin": int, "speed": "느림|보통|빠름", "longPauses": int, "pausesPerMin": float(소수 1자리), "pause": "적음|보통|잦음", "longestPauseSec": float(1자리), "firstWordSec": float(1자리), "firstWord": "보통|망설임 긺", "filler": {"level": "적음|보통|잦은 경향", "count": int|null, "examples": [str]} | null, "voice": {"confidence": {"level","reason"}, "tone": {...}, "tremor": {"present","reason"}, "trailingOff": {"present","reason"}, "clarity": {"level","reason"}} | null, "insufficient": false}`. 측정 부족(말한 시간 5초 미만 또는 음절 0)이면 `{"insufficient": true}`에 나머지 키 모두 `null`. 목소리 reason은 `delivery._reason` 정리(괄호 제거·공백 접기·60자), examples는 `delivery._example` 통과분만.
- `postingFit`: 브리핑이 `prompts._has_posting(briefing)`을 만족할 때만 모델 값을 두고, 아니면 서버가 `null`로 덮는다. 측정 블록이 없으면 `items[].delivery`·`summary.delivery`도 서버가 `null`로 덮는다.
- 지시문: `REPORT_INSTRUCTION_V2`(아래 Task 2 문구 그대로) + 측정이 있으면 `DELIVERY_INSTRUCTION_V2` + (목소리면 `VOICE_NOTE`) + 측정 블록 + 공고가 있으면 `POSTING_FIT_INSTRUCTION`. 리포트 시스템 프롬프트에는 `_has_posting(briefing)`일 때만 브리핑을 넣는다(`build_system(track, inputs, briefing)`), 아니면 지금처럼 브리핑 없이.
- SSE(켜짐): `delta…` → (실패 시 `reset` → `delta…`) → `report {"version": 2, "items": [...], "summary": {...}}` → `done`. `done` 재요청: `delta(저장 원문)` → (`report_v2_json`이 있으면 `report`) → `done`.
- 저장: 마이그레이션 `007_report_v2.sql` — `premium_interviews.report_v2_json TEXT`, `archive.report_v2_json TEXT`(둘 다 NULL 허용). `premium.mark_done(..., report_v2_json: str | None = None)`.
- 보관함: `ArchiveCreate.reportV2: dict | None`(직렬화 200,000바이트 초과 → `422 {"error":"invalid","field":"reportV2"}`), `ArchiveDetail.reportV2: dict | None`(없으면 `null`). `report` 0개 허용 유지(테스트로 고정). 목록(`ArchiveEntry`)은 그대로.
- 개인정보: 리포트 원문·측정값·목소리 이유는 로그에 남기지 않는다(예외는 클래스 이름만).
- 커밋: `feat(api):`(계약·docs), `feat(backend):`. 검증: `cd backend && uv run ruff format . && uv run pytest -q && uv run ruff check . && uv run ruff format --check .`

---

### Task 1: 순수 모듈 `app/llm/report_v2.py` + `delivery.judge`

**Files:** Create `backend/app/llm/report_v2.py`, `backend/tests/test_report_v2.py`. Modify `backend/app/llm/delivery.py`(공개 함수 `judge` 추가, 기존 출력 불변). Test `backend/tests/test_delivery.py`(기존 통과 + `judge`).

**Interfaces — Produces:**
- `delivery.judge(m: AnswerMetrics) -> dict[str, Any]` — Global Constraints의 `measurements` 딕셔너리(측정 부족이면 `insufficient: true`). `_line`과 같은 판정 함수(`_speed`, `_pause`, `_filler_text`의 기준)를 공유해 둘이 어긋나지 않게 한다. `filler.level`은 `_filler_text`의 라벨 부분(예시 괄호 제외), `count`는 `filler_count`(브라우저만이면 `None`), 군말 정보가 전혀 없으면 `filler: None`.
- `report_v2.REPORT_V2_SCHEMA: dict`
- `report_v2.answer_count(messages: list[Message]) -> int`
- `report_v2.parse(raw: str) -> dict | None` (JSON 객체가 아니면 None)
- `report_v2.validate(obj: dict, n: int) -> str | None`
- `report_v2.build(obj: dict, metrics: list[AnswerMetrics], *, has_delivery: bool, has_posting: bool) -> dict` — 정리·번호·refs·측정값·null 덮기까지 끝낸 `report` 이벤트 데이터(`{"version": 2, "items", "summary"}`).

- [ ] **Step 1: 실패 테스트** — 스키마(모든 object `additionalProperties: false`, 금지 제약 키 없음을 재귀로 검사), `answer_count`, `parse`(배열·깨진 JSON → None), `validate` 사유별(정상 None / 빠짐·중복·역순 `answers` / 첫 follow `first_kind` / refs 범위 밖 `refs`), 번호(main, follow, follow, main, follow → Q1, Q1-1, Q1-2, Q2, Q2-1; parent), refs 변환, strengths 4개 → 3개, 측정값(브라우저만 / 목소리 포함 / 측정 부족 / 측정 없는 답변 `null`), `has_delivery=False`면 delivery 모두 null, `has_posting=False`면 postingFit null, `judge`가 `_line`과 같은 판정(같은 입력에서 speed·pause·firstWord 라벨이 줄 텍스트에 들어 있음).
- [ ] **Step 2: 실패 확인** — `uv run pytest tests/test_report_v2.py tests/test_delivery.py -q`
- [ ] **Step 3: 구현**
- [ ] **Step 4: 검증** (전체)
- [ ] **Step 5: 커밋** `feat(backend): 벤 리포트 버전 2 — 출력 스키마·검증·번호(Q2-1)·답변별 측정값`

### Task 2: 구조화 출력 + 버전 2 지시문 (`claude.py`, `prompts.py` 계층 규율 경로)

**Files:** Modify `backend/app/llm/claude.py`, `backend/app/llm/prompts.py`, `backend/tests/fakes.py`(가짜 `stream_text`가 `output_format`을 받아 `calls`에 기록). Test `backend/tests/test_claude.py`, `backend/tests/test_prompts.py`.

**Interfaces — Produces:**
- `ClaudeClient.stream_text(..., output_format: dict[str, Any] | None = None)` — 있으면 `output_config={"effort": effort, "format": {"type": "json_schema", "schema": output_format}}`, 없으면 지금 그대로 `{"effort": effort}`(키 추가 없음).
- `prompts.REPORT_INSTRUCTION_V2`:
  ```
  면접이 끝났습니다. 지금까지의 면접을 답변 단위로 평가하세요.
  - 답변 번호(answer)는 '면접을 시작해 주세요.' 이후 지원자가 한 답변의 순서입니다(1부터). 답변마다 정확히 한 항목을 순서대로 쓰세요.
  - kind: 그 답변이 받은 질문이 새 질문이면 "main", 바로 앞 질문을 파고든 꼬리질문이면 "follow"입니다. 첫 항목은 "main"입니다.
  - question은 당신이 한 질문 원문, answerSummary는 답변 요약 한두 문장, feedback은 두세 문장이며 가장 중요한 구절 하나를 **강조**하세요.
  - 압박 면접관답게 칭찬은 생략하고, 근거·수치가 부족한 부분을 직설적으로 지적하세요.
  - summary.strengths와 summary.improvements는 각각 2~3개이며, answers에 근거가 된 답변 번호를 넣으세요. improvements에는 고칠 방법을 함께 쓰세요.
  - delivery와 summary.delivery는 전달력 측정이 주어졌을 때만 쓰고, 아니면 null로 두세요. postingFit은 모집공고 요구사항이 주어졌을 때만 쓰고, 아니면 null로 두세요.
  ```
  (`'면접을 시작해 주세요.'`는 `KICKOFF`로 조립)
- `prompts.DELIVERY_INSTRUCTION_V2 = "아래는 녹음에서 잰 답변별 전달력 수치와 판정입니다. 측정이 있는 답변의 delivery에 판정과 숫자를 근거로 한두 문장을 쓰고 고칠 방법을 하나 제시하세요. 측정이 없거나 측정 부족인 답변의 delivery는 null입니다. summary.delivery에는 전체 경향을 두세 문장으로 쓰세요. 군말은 단정하지 말고 '경향'으로만 말하세요."`
- `prompts.POSTING_FIT_INSTRUCTION = "시스템 프롬프트의 [지원 기업 최신 정보] 중 \"모집공고 요구사항\"을 근거로, 지원자가 면접에서 보여 준 것을 postingFit.met에, 드러나지 않았거나 부족한 요구사항을 postingFit.gaps에 짧은 구절로 쓰세요."`
- `prompts.report_messages_v2(messages, delivery_block: str | None, *, voice: bool, posting: bool) -> list[Message]` — `[*_history(messages), {"role": "user", "content": instruction}]`, instruction = V2 + (측정 블록 있으면 `\n\n{DELIVERY_INSTRUCTION_V2}{" " + VOICE_NOTE if voice}\n\n{block}`) + (posting이면 `\n\n{POSTING_FIT_INSTRUCTION}`).
- `prompts.report_system(track, inputs, briefing) -> list[dict]` — `_has_posting(briefing)`이면 `build_system(track, inputs, briefing)`, 아니면 `build_system(track, inputs)`.

- [ ] **Step 1: 실패 테스트** — `output_format` 있을 때 SDK에 넘어가는 `output_config`(가짜 sdk로), 없을 때 지금과 같은 kwargs; V2 지시문 조립 4조합(측정 유무 × 공고 유무, 목소리 note); `report_system` 공고 있/없; 기존 `report_messages`·`report_instruction()` 불변(parity 통과).
- [ ] **Step 2~4: 실패 확인 → 구현 → 검증**
- [ ] **Step 5: 커밋** `feat(backend): 벤 리포트 버전 2 지시문·구조화 출력(output_config.format)`

### Task 3: 리포트 경로 — 설정·검증 재생성·`report` 이벤트·저장·재요청 (계약)

**Files:** Create `backend/app/migrations/007_report_v2.sql`. Modify `backend/app/config.py`(`ben_report_v2: bool = False`, env `BEN_REPORT_V2`), `backend/app/repos/premium.py`(`report_v2_json` 읽기·`mark_done` 인자), `backend/app/routers/premium.py`(`make_report`), `docs/API.md`(벤 리포트 절), `deploy/docker-compose.yml`(api env `BEN_REPORT_V2: ${BEN_REPORT_V2:-false}`), `deploy/README.md`(켜는 순서 한 절). Test `backend/tests/test_ben_report_v2.py`(신규), 기존 `test_ben_*` 그대로 통과.

- [ ] **Step 1: 실패 테스트** — 꺼짐: 가짜 Claude 호출 kwargs에 `output_format` 없음·SSE가 지금과 동일(기존 테스트가 담당, 하나는 명시적으로 고정). 켜짐: 호출에 `output_format == REPORT_V2_SCHEMA`, system에 공고 있는 브리핑일 때만 브리핑 블록; 정상 JSON → `delta…`, `report`(Q 번호·measurements), `done`, DB `report_v2_json` 저장; 첫 응답 검증 실패·두 번째 정상 → `reset` 후 `report`, 시도 2회 집계; 두 번 실패 → `error bad_report`, 면접 `active` 유지; `done` 재요청 → 저장 원문 `delta` + `report` + `done`(Claude 미호출); 동의+목소리 결과 → measurements.voice; 측정 없음 → delivery 모두 null; Claude 오류 → 지금처럼 `error claude_error`.
- [ ] **Step 2: 실패 확인**
- [ ] **Step 3: 구현** — 기존 `events()` 구조 유지, 켜짐일 때만 `report_v2` 분기(`_generate_once()` 헬퍼로 스트리밍+모으기, 최대 2회). 마이그레이션은 `ALTER TABLE ... ADD COLUMN report_v2_json TEXT` 두 줄. `docs/API.md`: `event: report`·`reset`·`bad_report`·재요청·`BEN_REPORT_V2`(꺼짐 기본, 켜면 원문이 JSON 객체라 예전 파서로 못 읽음 → 프론트 배포 뒤 켬).
- [ ] **Step 4: 검증** + `docker compose -f deploy/docker-compose.yml config -q`
- [ ] **Step 5: 커밋** `feat(api): 벤 리포트 버전 2 — BEN_REPORT_V2(기본 꺼짐), 검증·1회 재생성, SSE report 이벤트, 저장·재요청`

### Task 4: 보관함 `reportV2`

**Files:** Modify `backend/app/schemas.py`(`ArchiveCreate.reportV2`, `ArchiveDetail.reportV2`), `backend/app/repos/archive.py`(`report_v2_json` 저장·조회), `backend/app/routers/archive.py`(또는 보관함 라우터 파일 — 매핑), `docs/API.md`(보관함 절). Test `backend/tests/test_archive*.py`.

- [ ] **Step 1: 실패 테스트** — `reportV2` 있음 → 상세에서 같은 dict 왕복; 없음 → 상세 `reportV2: null`; 200,000바이트 초과 → 422 `field: "reportV2"`; `report: []` 허용; 기존 보관 요청(키 없음) 그대로 통과.
- [ ] **Step 2~4: 실패 확인 → 구현 → 검증**
- [ ] **Step 5: 커밋** `feat(api): 보관함에 벤 리포트 버전 2(reportV2) 선택 칸`

## 마무리 (컨트롤러)

- 최종 리뷰 → 수정 1회 → PR `feature/ben-report-v2` → `dev`(본문에 `prompts.py` 전후 비교: 기존 지시문 불변 + 새 상수), 리뷰어 @leemonta9482.
- 프론트 이슈: 버전 2 표시(종합·Q 번호·꼬리질문 들여쓰기·측정값 표·`reset` 처리·보관 시 `reportV2`·예전 리포트 표시 유지).
- 프론트 배포 뒤 demomo `.env`에 `BEN_REPORT_V2=true` → 꼬리질문 있는 벤 면접 1회 확인.
