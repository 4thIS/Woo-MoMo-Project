# 녹음 길이 · 답변별 육각형 프로필 — 설계 (spec, 백엔드)

- 생성일시: 2026-10-30
- 수정일시: 2026-10-30
- 프론트 몫: 이슈로 요청(재생바 길이 표시, 답변별 육각형 그래프 + 코멘트)

## 0. 배경

- 보관함 녹음을 재생하기 전 시간이 `00:00 / 00:00`으로 뜬다. 녹음은 브라우저 MediaRecorder의 webm이라 파일 앞에 전체 길이가 없어서, 끝까지 읽기 전에는 브라우저가 길이를 모른다.
- 벤 리포트(버전 2)의 답변별 측정값이 표로만 나온다. 답변마다 6개 축의 단계를 육각형 그래프로, 축별 짧은 코멘트를 옆에 보여 주려 한다. 점수 대신 5단계(1 아쉬움 ~ 5 좋음)로 그린다(서비스 원칙 "점수 대신 고칠 점").

## 1. 목표 · 비목표

### 목표
- 녹음 업로드 때 길이를 받아 저장하고, 보관함 상세에 돌려준다.
- 벤 리포트 버전 2의 답변 항목마다 6축 `profile`(단계 + 코멘트)을 붙인다. 측정 축은 서버 규칙으로, "답변 내용"만 모델이 판단한다.

### 비목표
- 로컬 면접관(Gemma) 리포트의 그래프(측정값이 없음)
- 면접 전체 종합 그래프
- 예전 녹음 길이 채우기(값 없음 → 화면이 파일 끝을 읽어 보조)

## 2. 녹음 길이

- `POST /api/recordings` 폼에 선택 칸 `durationSec`(숫자, `0 < x ≤ 600`). 범위 밖 → `422 {"error":"invalid","field":"durationSec"}`. 없으면 NULL.
- 마이그레이션 `010_recording_duration.sql`: `recordings.duration_sec REAL`(NULL 허용).
- `ArchiveDetail.recordings[]`: `{ "turn", "url", "durationSec": number | null }`. 같은 turn을 다시 올리면 길이도 교체.
- additive — 예전 화면은 칸을 무시한다.

## 3. 답변별 프로필 (리포트 버전 2 확장)

### 3.1 축과 단계 (`level`: 1~5 정수, 값이 없으면 `null`)

| key | label | 정하는 쪽 | 규칙 | comment |
|---|---|---|---|---|
| `content` | 답변 내용 | 모델 | 구체성·근거·본인 기여로 1~5 | 모델이 쓴 한 문장(40자 이내, 서버가 정리) |
| `speed` | 말 속도 | 서버 | 판정 보통 → 5, 빠름·느림 → 3 | `분당 {n}음절로 {보통이에요 / 조금 빨라요 / 조금 느려요}` |
| `fluency` | 쉼·유창성 | 서버 | 쉼 적음 5 · 보통 4 · 잦음 2, 군말 "잦은 경향"이면 1 내림(최소 1) | `2초 넘는 쉼이 말한 1분당 {r}회{예요}` + 군말 잦으면 `, 군말이 잦은 편이에요` |
| `response` | 순발력 | 서버 | 첫마디까지 ≤1.5초 5 · ≤3초 4 · ≤6초 2 · 그 이상 1 | `첫마디까지 {s}초 걸렸어요` |
| `confidence` | 자신감 | 서버(목소리) | high 5 · mid 3 · low 2 | 목소리 분석 근거(정리된 reason). 근거가 비면 `자신감이 {높게/보통으로/낮게} 들렸어요` |
| `clarity` | 발음·명료도 | 서버(목소리) | good 5 · ok 3 · poor 2 | 위와 같음(`발음이 {또렷하게/보통으로/흐리게} 들렸어요`) |

- 측정이 없는 답변(브라우저 측정 없음): content 외 5축 `level`·`comment` 모두 `null`.
- 측정 부족(`insufficient`): content 외 5축 모두 `null`(표의 `measurements`와 같은 판정 — 5초 미만 말로는 목소리 판정도 믿기 어렵다).
- 목소리 분석이 없거나(동의 안 함·실패) 한글 없는 받아쓰기로 합치지 않았으면 confidence·clarity `null`.
- 축 순서는 항상 위 표 순서, 6개 고정.

### 3.2 모델 출력 (구조화 출력 스키마 additive)
- `items[]`에 `contentLevel`(integer, `enum [1,2,3,4,5]`)과 `contentComment`(string) 추가 — 스키마의 required에도 넣는다.
- 검증: `contentLevel`이 1~5 정수(bool 아님)가 아니거나 `contentComment`가 문자열이 아니면 `"shape"`(기존 재생성 1회 규칙 그대로).
- `contentComment`는 서버가 공백을 접고 `[]()` 제거, 40자로 자른다.

### 3.3 지시문 (`REPORT_INSTRUCTION_V2`, 계층 규율 경로)
버전 2 지시문에 한 줄 추가:
> `- contentLevel은 그 답변의 내용(구체성·근거·본인 기여)을 1~5로 매기고(5가 가장 좋음), contentComment에는 그 이유를 40자 이내 한 문장으로 쓰세요.`

버전 1 지시문·로컬 지시문은 그대로(`test_prompt_parity.py`).

### 3.4 계약 (`docs/API.md`)
- `report` 이벤트 `items[]`에 `profile: [{ key, label, level, comment }]`(6개) 추가. 저장 `report_v2_json`·보관함 `reportV2`도 같은 모양. 예전에 저장된 리포트에는 `profile`이 없다 → 화면은 기존 측정값 표.

## 4. 영역별 영향

- backend PR ①(녹음 길이): `routers/recordings.py`, `repos/recordings.py`, 보관함 상세 매핑, `schemas.py`(`RecordingRef.durationSec`), 마이그레이션 010, `docs/API.md`
- backend PR ②(프로필): `llm/report_v2.py`(스키마·검증·build), `llm/delivery.py`(축 판정 함수), `llm/prompts.py`(한 줄), `docs/API.md`
- frontend(이슈): 녹음 업로드에 `durationSec`, 재생바 첫 표시, 예전 녹음 보조 / 답변 피드백 칸 좌우 분할 — 왼쪽 육각형(5단계 눈금, null 축 회색 "측정 없음"), 오른쪽 축 이름·단계 말·코멘트, 보관함·리포트·PDF, 좁은 화면은 위아래

## 5. 성공 기준

- 테스트: `durationSec` 저장·교체·범위 오류·없음(null)·상세 응답 / 축별 단계 규칙 경계(속도 3라벨, 쉼·군말 내림과 최소 1, 첫마디 1.5·3·6초, 목소리 3단계), null 규칙(측정 없음·부족·목소리 없음), 6축 순서, `contentLevel` 검증·정리, 지시문 한 줄, 버전 1 불변.
- demomo: 벤 면접 1회(목소리 동의) → 답변마다 6축 profile, 보관함 녹음 길이 표시.
