# 벤 성향 설정 — 작업지시서

- spec: `docs/specs/backend/2026-11-07-ben-settings-design.md`
- 브랜치: `feature/ben-settings` (base `dev`)

## Global Constraints

- 설정이 없거나 모두 기본값이면 시스템 프롬프트·리포트 지시문이 변경 전과 글자까지 같다.
- 값은 정해진 Literal만(자유 입력 없음), 모르는 키는 422.
- 전체 꼬리질문 상한 3개를 넘지 않는다.
- `frontend/`는 고치지 않는다(화면은 이슈로 요청).

## Task 1: 변경 전 스냅숏 + 실패 테스트

- [x] 변경 전 `build_system`(회사·브리핑·공고·입학)과 리포트 지시문(버전 1·2)을 `tests/fixtures/ben_prompts_before_settings.json`으로 고정
- [x] `tests/test_ben_settings.py`: 기본값 일치, 축·단계별 문장, 트랙별 문구, 회사·공고 비중 무시 조건, 422, 프론트 `standard`·`gentle` 문구 일치

## Task 2: 스키마·프롬프트

- [x] `app/schemas.py` `BenSettings`, `InterviewStart.benSettings`
- [x] `app/llm/prompts.py` `ben_settings`, 축별 표, `build_system`·`report_instruction`·`report_messages`·`report_messages_v2`
- [x] `uv run pytest tests/test_ben_settings.py tests/test_prompts.py tests/test_prompt_parity.py`

## Task 3: 라우터·문서

- [x] `app/routers/premium.py` 시작 때 `inputs["benSettings"]` 저장, 리포트 버전 1·2에 온화함 전달
- [x] 라우터 테스트(저장·422·턴과 리포트가 저장값 사용), `test_premium_start` 기대값에 기본 설정 추가
- [x] `docs/API.md` `benSettings`
- [x] `uv run ruff check . && uv run ruff format --check . && uv run pytest -q`

## Task 4: demomo 확인 (dev 머지 후)

- [ ] 관리자 계정으로 API 직접 호출: 기본값 1회 + `warmth: high` 포함 조합 1회 완주, 리포트 파싱 확인
- [ ] 결과를 보고 `dev → main`은 사용자 지시 후
- [ ] 우진이 새 디자인 배포 후 톱니바퀴·슬라이더 UI 이슈 작성
