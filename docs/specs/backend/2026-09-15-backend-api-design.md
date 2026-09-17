# backend API — 설계 (spec)

- 생성일시: 2026-09-15
- 수정일시: 2026-09-15
- 담당: @ssenu
- 상위 문서: `docs/superpowers/specs/2026-09-15-mock-interview-design.md` 섹션 2, 4.5, 5
- 계약 문서: `docs/API.md`

## 0. 배경 · 위치

모의면접 사이트의 추론·이력서 처리·리포트는 전부 브라우저에서 일어난다. 백엔드는 프론트가 하드코딩하지 않아야 할 **설정과 정적 자산**만 내려준다. 전체 설계서 섹션 5.1이 정한 세 엔드포인트를 구현하고, nginx·docker-compose로 라즈베리파이(arm64)에 올린다.

배포 인프라(`deploy/`)는 공동 영역이지만, 첫 배포 구성은 백엔드 담당이 이 spec 범위에서 만든다. 이후 변경은 공동 리뷰.

## 1. 목표 · 비목표

### 목표
- `GET /api/manifest`, `GET /api/questions/{field}`, `GET /api/health` 세 엔드포인트를 `docs/API.md`와 정확히 일치하게 제공한다.
- 응답 형태를 pydantic 스키마로 단일 정의하고, `backend/data/*.json`이 그 스키마를 통과하는지 테스트로 보장한다.
- 모델·질문 교체가 **코드 변경 없이** `data/` 파일 교체만으로 가능하다.
- nginx가 프론트 정적 파일과 `/models/` 모델 파일(Range 지원, 캐시 헤더)을 서빙하고 `/api/`를 FastAPI로 프록시한다.
- `deploy/docker-compose.yml` 하나로 라즈베리파이에서 `docker compose up -d`가 된다. 이미지는 CI가 linux/arm64로 빌드해 GHCR에 올린다.
- 분야별 폴백 질문 세트 5종(`it`, `finance`, `manufacturing`, `retail`, `general`)을 한국어로 작성한다.

### 비목표 (이번엔 안 함 / 후속)
- 이력서·대화·리포트를 받는 엔드포인트. 프로젝트 핵심 가치상 만들지 않는다.
- 로그인·세션·데이터베이스.
- RAG(직무·기업 지식 검색). 범위 확정 전까지 넣지 않는다. 넣더라도 사용자 개인 데이터는 서버에 저장하지 않는다는 원칙만 미리 고정한다.
- 서버 측 LLM 추론 폴백.
- 파인튜닝 모델 변환·호스팅 자동화. 모델 파일은 수동으로 볼륨에 복사한다.

## 2. 데이터 · 계약

이 영역이 `/api` 응답 계약을 **제공**한다. 형태는 `docs/API.md`가 기준이며 이 spec은 반복하지 않는다.

- `backend/data/manifest.json`: 매니페스트 1개. 필드 `id`, `url`, `size`, `template`, `systemPromptOverride`, `fallback`.
- `backend/data/questions/{field}.json`: `{ "field": string, "questions": string[5] }`. 미등록 field는 `general.json`으로 대체(200 응답, 404 아님).
- 계약 변경: 이번 spec은 `docs/API.md`의 초기 정의를 그대로 구현한다. 변경 없음. 이후 변경은 additive + lockstep.

## 3. 접근 제어 / 제약

- 인증 없음. 모든 엔드포인트 공개 읽기 전용(GET만).
- CORS: 프론트와 같은 오리진(nginx 뒤)이므로 별도 CORS 허용 불필요. 로컬 개발(Vite dev 서버 5173)에서만 `http://localhost:5173` 허용.
- `data/` 파일은 앱 시작 시 한 번 읽어 스키마 검증하고 메모리에 둔다. 파일이 깨져 있으면 **기동 실패**로 드러나야 한다(런타임에 500이 아니라).
- 매니페스트 `url`은 `/models/`로 시작하는 상대 경로만 허용한다(외부 URL 금지, 프록시 우회 방지).
  - 2026-09-17 변경: 허용 목록 `/models/`, `https://huggingface.co/`로 확장. 현재 HF 커밋 고정 주소를 사용한다. 이유·복귀 절차: `docs/specs/backend/2026-09-17-model-hosting-hf-design.md`
- 라즈베리파이 자원: uvicorn 워커 1개, 의존성 최소(fastapi, uvicorn, pydantic). 무거운 라이브러리 금지.
- 모델 파일은 리포·이미지에 넣지 않는다. 호스트 `/srv/momo/models`를 nginx 컨테이너에 읽기 전용 마운트.

## 4. 인터페이스 계약

| 메서드·경로 / 함수 | 접근 | 설명 |
|---|---|---|
| `GET /api/manifest` | public | `Manifest` 스키마. `docs/API.md` 참조 |
| `GET /api/questions/{field}` | public | `QuestionSet` 스키마. 미등록 field → general |
| `GET /api/health` | public | `{ "status": "ok" }` |
| `app.schemas.Manifest`, `ModelRef`, `ChatTemplate`, `QuestionSet` | internal | pydantic 모델. 응답과 `data/` 검증 양쪽에 사용 |
| `app.data.load_manifest(path) -> Manifest` | internal | 파일 읽기 + 검증. 실패 시 예외 |
| `app.data.load_question_sets(dir) -> dict[str, QuestionSet]` | internal | 디렉터리 전체 로드. `general` 없으면 예외 |
| nginx `/`, `/models/`, `/api/` | public | 정적·모델·프록시 |

## 5. 영역별 영향

- backend: 전부 신규. `backend/app/`, `backend/data/`, `backend/tests/`, `pyproject.toml`, `uv.lock`.
- deploy (공동, 이번 spec에서 초기 생성): `deploy/docker-compose.yml`, `deploy/nginx.conf`, `deploy/web.Dockerfile`, `deploy/api.Dockerfile`. `web.Dockerfile`은 프론트 빌드 산출물이 아직 없어도 동작하도록 `frontend/dist`가 없으면 플레이스홀더 index.html을 넣는다.
- frontend: 영향 없음. `docs/API.md`만 소비한다.
- finetune: 영향 없음.

## 6. 무회귀 · 롤아웃

- 기존 동작 없음(신규). 롤아웃 순서:
  1. 백엔드 PR 머지 → CI가 `api` 이미지 빌드·푸시
  2. 파이에 `/srv/momo/models/`에 모델 파일 복사, `deploy/` 복사
  3. `docker compose pull && docker compose up -d`
  4. `curl /api/health`, `curl /api/manifest`, `curl -I /models/<file>`(206 Range 확인)
- 프론트가 없어도 `web` 컨테이너는 플레이스홀더로 기동한다. 프론트 머지 후 이미지 재빌드만 하면 된다.

## 7. 역할 분담

| 영역 | 담당 |
|------|------|
| backend | @ssenu |
| deploy 초기 구성 | @ssenu (리뷰 @leemonta9482) |
| frontend | 영향 없음 |

## 8. 성공 기준

- `uv run pytest -q` 전부 통과. 테스트는 세 엔드포인트, 미등록 field 폴백, `data/` 스키마 검증, 잘못된 매니페스트 기동 실패를 포함.
- `uv run ruff check .`, `uv run ruff format --check .` clean.
- `docker compose -f deploy/docker-compose.yml config -q` 통과.
- 파이에서 `curl http://localhost/api/manifest`가 `docs/API.md` 예시와 같은 형태를 반환.
- `curl -I -H "Range: bytes=0-1023" http://localhost/models/<file>`가 206을 반환.

## 9. 열린 결정 (plan 단계에서 확정)

- GHCR 이미지 네임스페이스: 조직(`ghcr.io/4this/`) vs 개인. CI에 조직으로 넣어 두었고, 조직 패키지 권한이 안 켜지면 개인으로 바꾼다.
- 로컬 개발 시 프론트 dev 서버가 `/api`를 어떻게 붙는지(Vite proxy vs CORS). CORS 허용을 넣되 프론트 담당이 Vite proxy를 쓰면 제거 가능.
