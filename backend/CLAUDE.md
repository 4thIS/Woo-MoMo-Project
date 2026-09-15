# backend — 영역 가이드

> 루트 `../CLAUDE.md`를 먼저 읽으십시오. 이 파일은 backend 영역 특수 규칙만 다룹니다.
> 담당: @ssenu

## 스택

- 언어/런타임: Python 3.12, FastAPI, uvicorn (워커 1개, 라즈베리파이 arm64)
- 패키지 매니저: **uv** (다른 매니저 사용 금지, `uv.lock` 커밋)
- 테스트: pytest (+ httpx TestClient)
- 린트·포맷: ruff

## 폴더 규칙

```
backend/
├── app/          # FastAPI 앱: main.py, routers/, schemas/(pydantic 응답 모델)
├── data/         # 정적 계약 데이터: manifest.json, questions/{field}.json (계층 규율 경로)
└── tests/        # pytest
```

## 계층 책임

- `app/schemas/`가 `/api` 응답 형태의 단일 정의다. `docs/API.md`는 이 스키마를 사람이 읽는 버전이며 둘은 항상 일치해야 한다.
- `data/`는 코드가 아니라 계약 데이터다. 코드 배포 없이 파일 교체만으로 모델·질문을 바꿀 수 있어야 한다.
- 데이터베이스·인증·세션 저장 없음. 이력서·대화·리포트를 받는 엔드포인트를 만들지 않는다.
- RAG 확장 시에도 사용자 개인 데이터는 서버에 저장하지 않는다. 공개 지식(직무·기업 정보)만 색인한다.
- 공통 인프라 계층은 도메인을 import하지 않는다(의존 방향 단방향 유지).

## 커밋 scope

- `feat(backend):`, `fix(backend):`, `feat(api):`(계약 변경, 양쪽 영향)

## 테스트

- 새 코드는 테스트 동반(TDD: 실패 → 구현 → 통과).
- 세 엔드포인트(`/api/manifest`, `/api/questions/{field}`, `/api/health`)와 미등록 분야 폴백(`general.json`)은 항상 테스트로 고정한다.
- `data/*.json`은 테스트에서 pydantic 스키마로 검증한다. 형식이 깨진 JSON이 배포되지 않도록.
- 외부 의존이 생기면 mock보다 **테스트용 실물**(격리된 테스트 인스턴스)을 쓴다.

## 계약(Contract) 규칙

- 이 영역이 `/api` 응답 계약을 **제공**한다. 형태의 소유자는 이 영역이다.
- 변경은 additive 우선: 기존 필드는 불변, 신규 필드만 추가. 프론트가 아직 안 써도 깨지지 않게.
- 변경 순서(lockstep): `docs/API.md` + `schemas/` + `data/` 변경 제안을 **먼저** 머지·배포 → 그 뒤 프론트가 새 필드를 사용.
- 파인튜닝 모델 반영은 `data/manifest.json`의 `id`·`url`·`template`·`systemPromptOverride` 수정과 모델 파일 볼륨 복사로 끝난다. 코드 변경 없음.

## 절대 하지 말 것

- 다른 영역 디렉토리(`frontend/`) 수정 금지 — 필요 시 이슈로 요청. `deploy/`·`docs/`·`finetune/`은 공동 영역이므로 상대방 리뷰를 받는다.
- 패키지 매니저·언어 버전 설정 임의 변경 금지.
- 계약(응답 스키마) 변경 시 frontend 담당과 사전 협의 + 변경 제안에 BREAKING CHANGE 명시.
- 계층 규율 경로(`data/manifest.json`)를 `docs/API.md` 대조 없이 수정 금지.
- 모델 파일(`.litertlm`)을 리포·이미지에 포함 금지. 호스트 볼륨으로만.
