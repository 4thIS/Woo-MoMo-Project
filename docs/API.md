# 백엔드 계약 (API)

> 소유: backend (@ssenu). 이 문서와 `backend/app/schemas.py`는 항상 일치해야 한다.
> 변경은 additive만. 변경 PR을 먼저 머지·배포한 뒤 frontend가 새 필드를 사용한다(lockstep).

## GET /api/manifest

현재 서빙 중인 모델과 채팅 템플릿. 프론트는 모델 URL·템플릿 토큰을 하드코딩하지 않고 여기서 받는다.

```json
{
  "id": "gemma4-e4b-it",
  "url": "/models/gemma4-e4b-it-web.litertlm",
  "size": 2969059328,
  "template": {
    "turnStart": "<|turn>",
    "turnEnd": "<turn|>",
    "roles": { "system": "system", "user": "user", "model": "model" }
  },
  "systemPromptOverride": null,
  "fallback": {
    "id": "gemma4-e2b-it",
    "url": "/models/gemma4-e2b-it-web.litertlm",
    "size": 2008432640
  }
}
```

| 필드 | 타입 | 설명 |
|---|---|---|
| `id` | string | 모델 식별자. Cache API 키에 포함되어 모델 교체 시 캐시가 갈린다 |
| `url` | string | 모델 파일 경로 (nginx `/models/` 서빙, Range 지원) |
| `size` | number | 바이트. 진행률 표시와 수신 무결성 확인에 사용 |
| `template` | object | 채팅 템플릿 토큰. 실제 토크나이저와 대조해 확정 (D-6 검증 항목) |
| `systemPromptOverride` | string \| null | null이면 프론트 내장 시스템 프롬프트 사용. 파인튜닝 모델은 짧은 프롬프트로 대체 가능 |
| `fallback` | object \| null | 초기화 실패 시 재시도할 경량 모델. 없으면 null |

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

## 하지 않는 것

- 이력서·대화·리포트를 받는 엔드포인트는 만들지 않는다. 사용자 데이터는 서버로 오지 않는다.
