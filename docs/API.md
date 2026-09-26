# 백엔드 계약 (API)

> 소유: backend (@ssenu). 이 문서와 `backend/app/schemas.py`는 항상 일치해야 한다.
> 변경은 additive만. 변경 PR을 먼저 머지·배포한 뒤 frontend가 새 필드를 사용한다(lockstep).

## GET /api/manifest

현재 서빙 중인 모델과 채팅 템플릿. 프론트는 모델 URL·템플릿 토큰을 하드코딩하지 않고 여기서 받는다.

```json
{
  "id": "gemma4-e4b-it",
  "url": "https://huggingface.co/litert-community/gemma-4-E4B-it-litert-lm/resolve/2eee7ac325f20eb8c9ac1d0e972f7c84663062da/gemma-4-E4B-it-web.litertlm",
  "size": 2969059328,
  "template": {
    "turnStart": "<|turn>",
    "turnEnd": "<turn|>",
    "roles": { "system": "system", "user": "user", "model": "model" }
  },
  "systemPromptOverride": null,
  "fallback": {
    "id": "gemma4-e2b-it",
    "url": "https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm/resolve/b3ca0d2f076785a8f4b2219ddbd2bdb99954eae1/gemma-4-E2B-it-web.litertlm",
    "size": 2008432640
  },
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
}
```

| 필드 | 타입 | 설명 |
|---|---|---|
| `id` | string | 모델 식별자. Cache API 키에 포함되어 모델 교체 시 캐시가 갈린다 |
| `url` | string | 모델 파일 주소. `/models/`(파이 nginx 자체 서빙, Range 지원) 또는 `https://huggingface.co/`(커밋 해시 고정 `resolve/<sha>/`)로 시작. 프론트는 이 값을 그대로 `fetch`한다 |
| `size` | number | 바이트. 진행률 표시와 수신 무결성 확인에 사용 |
| `template` | object | 채팅 템플릿 토큰. 실제 토크나이저와 대조해 확정 (D-6 검증 항목) |
| `systemPromptOverride` | string \| null | null이면 프론트 내장 시스템 프롬프트 사용. 파인튜닝 모델은 짧은 프롬프트로 대체 가능 |
| `fallback` | object \| null | 초기화 실패 시 재시도할 경량 모델. 없으면 null |
| `tts` | object \| null | 면접관 음성(TTS) 모델. null이면 프론트는 음성 단계를 건너뛴다. `id`(캐시 키), `baseUrl`(`/models/` 또는 `https://huggingface.co/`로 시작·`/`로 끝), `files[]`(`path` 상대경로·`size` 바이트), `voice`(프리셋명), `lang`(언어 코드). 파일 URL = `baseUrl + path` |
| `tts.voices` | array \| null | 받을 수 있는 목소리 목록(2026-09-26 추가). 항목 `{ id, path, size }`, 파일 URL = `baseUrl + path`. **엔진 파일 = `files` 중 경로가 `voices[].path`에 없는 것**이다. 새 프론트는 엔진 + 고른 목소리 하나만 받는다. `files` 안의 기본 목소리 파일은 `voices`를 모르는 옛 프론트 호환용이다. 기본 `voice`는 항상 이 목록에 있다. null이면 기본 `voice`만 쓴다 |

## GET /api/questions/{field}

분야별 폴백 질문 5개. 모델이 질문 생성에 실패했을 때 시스템 프롬프트에 참고용으로 끼워 넣는다.
미등록 `field`는 `general` 세트를 반환한다 (404 아님). `field`는 대소문자를 구분하지 않는다(소문자로 정규화).

```json
{
  "field": "it",
  "questions": [
    "자기소개를 1분 내로 해주세요.",
    "이력서에 적은 프로젝트 중 가장 어려웠던 문제와 해결 과정을 말씀해 주세요.",
    "협업 중 의견 충돌이 있었던 경험과 대처 방법은 무엇인가요?",
    "지원 직무에서 본인의 강점과 보완할 점은 무엇인가요?",
    "우리 회사에 지원한 이유는 무엇인가요?"
  ]
}
```

등록 분야: `it`, `finance`, `manufacturing`, `retail`, `general`.

## GET /api/health

```json
{ "status": "ok" }
```

## 참고

`tts`는 additive로 추가됨(2026-09-17). 기존 필드 불변.

2026-09-17: `url`·`fallback.url`·`tts.baseUrl` 값을 파이(`/models/`)에서 Hugging Face로 전환. 응답 형태 불변, 허용 접두사만 확장. 이유와 파이 서빙 복귀 절차(파인튜닝 모델 포함): `docs/specs/backend/2026-09-17-model-hosting-hf-design.md`

2026-09-26: `tts.voices` additive 추가(면접관별 목소리). 기존 필드 불변. `docs/specs/backend/2026-09-26-tts-voices-design.md`

## 하지 않는 것

- 이력서·대화·리포트를 받는 엔드포인트는 만들지 않는다. 사용자 데이터는 서버로 오지 않는다.
