# 리포트 v2 답변별 목소리 분석 이유 `voiceStatus`

- 날짜: 2026-11-10
- 담당: 박찬우(@ssenu, backend) — 화면은 이우진(@leemonta9482)
- 기준: 이슈 #178(C안 먼저, 공동 합의), `docs/specs/backend/2026-11-03-voice-gemini-direct-design.md`

## 1. 무엇을 · 왜

목소리 분석 동의를 안 하고 면접을 보면 리포트의 자신감·발음·명료도가 이유 없이 "측정 없음"으로 나와 고장으로 보였다(2026-11-09 demomo). 서버가 답변별 목소리 상태를 `done`이 아니면 전부 `None` 하나로 접어 보냈기 때문에, 프론트가 동의 안 함·분석 실패·답변이 짧음·서버 사정을 구분할 수 없었다.

리포트 v2 `report` 이벤트의 `items[].measurements`에 **`voiceStatus`**를 더한다(additive, `docs/API.md`).

## 2. 값

| 값 | 언제 | 우선 |
|---|---|---|
| `no_consent` | 그 면접에서 목소리 분석에 동의하지 않음(`voice_consent=0`) | 1 |
| `too_short` | 측정 부족 — 말한 시간 5초 미만·음절 0(`insufficient`와 같은 조건) | 2 |
| `ok` | 분석 결과 있음 | 3 |
| `pending` | 리포트를 만들 때까지(`VOICE_WAIT_SEC` 20초) 분석이 안 끝남(`queued`) | 3 |
| `failed` | 분석 오류, 또는 한글 없는 받아쓰기라 결과를 버림 | 3 |
| `unavailable` | 서버 사정 — 키 없음·한도 소진(`unavailable`), 녹음이 안 올라옴(행 없음) | 3 |

- 우선은 위에서 아래로: 동의 안 함이면 측정 부족이어도 `no_consent`.
- `measurements`가 `null`인 답변(브라우저 측정이 없음)에는 실을 곳이 없다 — 지금처럼 그 축 전체가 비어 있다.
- 예전에 저장된 리포트(`report_v2_json`·보관함 `reportV2`)에는 이 키가 없다. 프론트는 없으면 이유 없이 "측정 없음"을 그린다.
- 리포트 버전 1·SSE 순서·DB 스키마는 그대로.

## 3. 구현

- `delivery.AnswerMetrics.voice_status`(기본 `no_consent`), `delivery.voice_status(m)`가 우선을 정하고 `judge()`가 두 갈래(측정 부족·정상) 모두에 싣는다.
- `routers/premium._metrics(..., consent=)`가 저장 상태를 `_VOICE_STATUS`로 옮긴다(`done→ok`, `queued→pending`, `failed→failed`, `unavailable→unavailable`, 없음→`unavailable`).

## 4. 화면 (이우진)

리포트 "측정 없음" 옆에 이유 한 줄. 체크박스 옆 "켜지 않으면 자신감·발음은 측정되지 않아요" 안내는 계약과 무관하게 먼저.
