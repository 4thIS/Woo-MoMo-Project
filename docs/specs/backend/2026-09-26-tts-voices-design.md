# 매니페스트 `tts.voices` — 면접관별 목소리 목록 (spec)

- 생성일시: 2026-09-26
- 수정일시: 2026-09-26
- 상태: 승인됨 (브레인스토밍 완료)
- 담당: @ssenu (백엔드·계약)
- 상위 문서: 프론트 기능 spec `docs/specs/frontend/2026-09-26-interviewer-personas-design.md` (면접관 선택·페르소나)
- 계약: `docs/API.md` — `tts`에 `voices`를 **additive**로 추가한다

## 0. 배경 · 위치

면접관을 3명(온화한 선배·기본·날카로운 압박)으로 늘리고, 면접관마다 목소리를 다르게 한다. Supertonic 3는 엔진(ONNX 4개 + 설정 2개, 약 398MB)을 모든 목소리가 공유하고, 목소리마다 다른 것은 `voice_styles/{ID}.json` 하나(약 290KB)뿐이다. 따라서 프론트는 **엔진 + 고른 목소리 파일 하나**만 받으면 된다.

지금 매니페스트는 목소리를 `voice: "M2"` 하나만 알려 주고, `files`에 `voice_styles/M2.json`이 섞여 있다. 프론트가 다른 목소리를 받으려면 그 경로와 크기가 필요하다. 모델 파일의 주소·크기는 매니페스트가 기준이라는 원칙(`docs/specs/backend/2026-09-17-model-hosting-hf-design.md`)을 지키기 위해, 목소리 목록을 매니페스트에 추가한다.

## 1. 목표 · 비목표

### 목표
- `tts.voices`에 받을 수 있는 목소리 10개(F1~F5, M1~M5)의 `id`·`path`·`size`를 제공한다.
- 기존 필드(`files`·`voice` 등)는 그대로 둬서, 이미 배포된 프론트가 수정 없이 동작한다.

### 비목표
- 어떤 면접관이 어떤 목소리를 쓰는지는 매니페스트에 두지 않는다. 프론트의 면접관 정의가 정한다. 면접관 이름·페르소나·스프라이트도 프론트 몫이다.
- 목소리 미리 듣기 오디오는 프론트 정적 파일이다(매니페스트와 무관).

## 2. 데이터 · 계약

`/api/manifest` 응답의 `tts`에 선택 필드 `voices`를 추가한다. 형태는 **additive**이고 BREAKING CHANGE는 없다.

```json
"tts": {
  "id": "supertonic-3",
  "baseUrl": "https://huggingface.co/Supertone/supertonic-3/resolve/3cadd1ee6394adea1bd021217a0e650ede09a323/",
  "files": [
    { "path": "onnx/text_encoder.onnx", "size": 36416150 },
    { "path": "onnx/duration_predictor.onnx", "size": 3700147 },
    { "path": "onnx/vector_estimator.onnx", "size": 256534781 },
    { "path": "onnx/vocoder.onnx", "size": 101424195 },
    { "path": "onnx/tts.json", "size": 8253 },
    { "path": "onnx/unicode_indexer.json", "size": 277676 },
    { "path": "voice_styles/M2.json", "size": 292055 }
  ],
  "voice": "M2",
  "lang": "ko",
  "voices": [
    { "id": "F1", "path": "voice_styles/F1.json", "size": 292046 },
    { "id": "F2", "path": "voice_styles/F2.json", "size": 292423 },
    { "id": "F3", "path": "voice_styles/F3.json", "size": 290794 },
    { "id": "F4", "path": "voice_styles/F4.json", "size": 291808 },
    { "id": "F5", "path": "voice_styles/F5.json", "size": 291479 },
    { "id": "M1", "path": "voice_styles/M1.json", "size": 291748 },
    { "id": "M2", "path": "voice_styles/M2.json", "size": 292055 },
    { "id": "M3", "path": "voice_styles/M3.json", "size": 290198 },
    { "id": "M4", "path": "voice_styles/M4.json", "size": 291522 },
    { "id": "M5", "path": "voice_styles/M5.json", "size": 291469 }
  ]
}
```

- 크기는 HF 고정 커밋 `3cadd1ee…a323`의 `voice_styles/` 트리에서 조회한 값이다(2026-09-26).
- **새 프론트의 해석 규칙(`docs/API.md`에 명시):**
  - **엔진 파일** = `files` 중 경로가 `voices[].path`에 없는 것(지금은 6개)
  - **목소리 파일** = 고른 목소리 `voices[i]` 하나. 파일 URL = `baseUrl + path`
  - `files` 안의 목소리 파일(`voice_styles/M2.json`)은 `voices`를 모르는 옛 프론트를 위한 호환용이다.
- `voices`가 없으면(null) 프론트는 기본 목소리 `voice`만 쓴다.
- `backend/data/manifest.json` · `/api` 응답 스키마 변경: **있음(additive)** → lockstep. 이 계약 PR을 먼저 머지·배포한 뒤 프론트가 `voices`를 사용한다.

## 3. 접근 제어 / 제약

- `TtsVoice.path`는 기존 `TtsFile.path`와 같은 규칙을 따른다: 비어 있지 않고, `/`로 시작하지 않으며, `..` 세그먼트가 없어야 한다.
- `TtsVoice.size > 0`, `TtsVoice.id`는 비어 있지 않다.
- `voices`가 있으면:
  - 1개 이상이어야 한다.
  - `id`가 서로 겹치지 않는다.
  - 기본 `voice`가 `voices[].id` 안에 있어야 한다. 기본 목소리 파일을 찾을 수 없는 매니페스트를 막는다.
- URL 허용 목록(`/models/`, `https://huggingface.co/`)과 HF 커밋 고정은 `baseUrl`에 이미 적용되고, `voices`는 그 아래 상대 경로라 추가 규칙이 없다.
- 모든 모델은 `extra="forbid"`를 유지한다.

## 4. 인터페이스 계약

| 메서드·경로 / 함수 | 접근 | 설명 |
|---|---|---|
| `GET /api/manifest` | public | `tts.voices` 추가(선택). 나머지 형태 불변 |
| `app.schemas.TtsVoice` | internal | `id: str`, `path: str`(상대·`..` 금지), `size: int > 0` |
| `app.schemas.TtsManifest.voices` | internal | `list[TtsVoice] \| None = None`. 모델 검증기: 1개 이상, id 유일, `voice ∈ ids` |

`TtsFile.path` 검증 로직은 `TtsVoice`와 공유한다(함수로 추출하거나 `TtsVoice`가 같은 검증기를 쓴다).

## 5. 영역별 영향

- **backend:** `schemas.py`(`TtsVoice`, `voices` 필드와 검증기), `data/manifest.json`(`voices` 10개), 테스트
- **docs:** `docs/API.md` 예시·필드 표에 `voices` 행과 "엔진 = files − voices 경로" 규칙 추가, 참고 절에 추가 날짜 기록
- **frontend:** 이 PR에서는 없음. 배포 뒤 프론트 spec의 이슈들이 `voices`를 쓴다.
- **deploy:** 없음. 파이 복귀용 `/srv/momo/models/tts/supertonic-3/`에는 M2만 있다. 파이 서빙으로 돌아갈 때는 `voice_styles/` 10개를 모두 배치해야 한다(`deploy/README.md` TTS 절에 한 줄 추가).

## 6. 무회귀 · 롤아웃

1. 계약 PR(`feat(api)`) 머지 → 파이 api만 재빌드한다.
   ```
   cd /srv/apps/Woo-MoMo-Project && git pull && cd deploy && docker compose up -d --build api
   ```
2. 확인: `curl -s https://momo.ssenu.cloud/api/manifest | python -c "import sys,json; t=json.load(sys.stdin)['tts']; print(t['voice'], len(t['voices']))"` → `M2 10`
3. 지금 배포된 프론트는 `voices`를 무시하고 기존처럼 `files` 7개를 받는다. 동작 변화가 없다.
4. 그다음 프론트 이슈를 진행한다(lockstep).

## 7. 역할 분담

| 영역 | 담당 |
|---|---|
| backend·계약·`docs/API.md` | @ssenu |
| frontend(면접관 선택·목소리 다운로드) | @leemonta9482 — 프론트 spec의 이슈 |
| deploy/README 한 줄 | @ssenu (리뷰 @leemonta9482) |

## 8. 성공 기준

- `uv run pytest -q && uv run ruff check . && uv run ruff format --check .` 통과
- 스키마 테스트:
  - 허용: `voices` 없음, `voices` 10개
  - 거부: 빈 목록, id 중복, `voice`가 목록에 없음, 절대 경로, `..` 경로, size 0
- 저장소 매니페스트 테스트:
  - `voices` 10개의 경로가 모두 `voice_styles/{id}.json`이다.
  - `voice`(M2)가 목록에 있고, M2의 크기가 `files`의 M2와 같다.
- 배포 뒤 도메인 `/api/manifest`에 `voices` 10개가 나오고, 기존 프론트의 준비 흐름(다운로드·목소리 준비)이 그대로 통과한다.
- 브라우저(오리진 `https://momo.ssenu.cloud`)에서 `voices` 10개 URL을 fetch하면 200이고 크기가 일치한다(CORS 포함).

## 9. 열린 결정

- 없음. 어떤 면접관이 어떤 목소리를 쓸지는 프론트 spec의 "목소리 청취 후 결정" 단계에서 정한다.
