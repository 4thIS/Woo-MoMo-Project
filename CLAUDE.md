# Woo-MoMo-Project — 협업 가이드 (CLAUDE.md)

> 이 파일은 **이 프로젝트에 참여하는 모든 사람과 모든 AI**가 최우선으로 읽는 협업 헌법입니다.
> 개인 글로벌 설정(`~/.claude/CLAUDE.md` 등)보다 이 파일이 우선합니다.
> 큰 원칙만 여기 두고, 세부는 영역별 `CLAUDE.md`와 `docs/` 하위로 위임합니다(Progressive Disclosure).

## 프로젝트 개요

- 목적: 브라우저 안에서 로컬 LLM(Gemma 4, WebGPU)이 면접관 역할을 하는 모의면접 사이트. 이력서·대화·리포트가 사용자 기기를 떠나지 않는다. 포트폴리오 겸 공모전 데모.
- 스택: 프론트 Vite + Vue 3 + TypeScript + Pinia (MediaPipe LLM Inference, pdf.js, Web Speech API) / 백엔드 FastAPI (Python 3.12, uv) / 배포 nginx + docker-compose (linux/arm64)
- 호스팅: https://github.com/4thIS/Woo-MoMo-Project
- 배포: 개인 라즈베리파이 웹서버. 기존 리버스 프록시·도메인 뒤에 docker-compose로 올린다. 모델 파일(`.litertlm`)은 호스트 볼륨 `/srv/momo/models`. 단, 2026-09-17부터 원본 모델·TTS는 브라우저가 Hugging Face에서 직접 받는다(파인튜닝 모델은 파이 서빙으로 복귀, `docs/specs/backend/2026-09-17-model-hosting-hf-design.md`).
- 설계 문서: `docs/superpowers/specs/2026-09-15-mock-interview-design.md` (전체 아키텍처·화면·LLM 흐름·일정)

## 역할 분담

| 사람 | 계정 | 영역 | 책임 |
|------|------|------|------|
| 박찬우 | @ssenu | `backend/` | FastAPI 구현, RAG 확장, 계약(매니페스트·API 응답) 소유 |
| 이우진 | @leemonta9482 | `frontend/` | Vue 화면·LLM 실행·음성·도트 그래픽 구현 |
| 공동 | @ssenu @leemonta9482 | `deploy/` `docs/` `finetune/` | 인프라·CI·문서·파인튜닝 트랙 (둘 다 관리, 변경 시 서로 리뷰) |

- 설계(spec/plan)는 둘이 합의해 확정한다. 확정된 문서가 리포에 커밋되면 그것이 기준이다.
- 공유 영역은 특정 Owner가 없다. 대신 **상대방 승인**을 받아 머지한다(CODEOWNERS로 자동 배정).

### 계층 규율 (고비용 계층 보호)

아래 경로는 함부로 고치지 않는다. 흔들리면 파급이 커 품질이 무너지는 계층이다.

| 경로 | 내용 | 고칠 때 |
|------|------|---------|
| `backend/data/manifest.json` | 모델 매니페스트 계약. 프론트의 모델 로드·채팅 템플릿·폴백이 전부 이 형태에 의존 | 필드는 additive만. 변경 시 `docs/API.md` 갱신 + 프론트 담당과 사전 협의 + 변경 제안에 BREAKING CHANGE 표기 |
| `frontend/src/prompts/`, `frontend/src/services/llm.ts` | 시스템 프롬프트·리포트 지시문·채팅 템플릿 조립. 면접 흐름과 리포트 형식이 여기서 결정됨 | 리허설로 면접 1회 완주 + 리포트 JSON 파싱 확인 후 변경. 프롬프트 변경은 변경 제안 본문에 전후 비교 첨부 |
| `deploy/` | docker-compose·nginx. 모델 파일 Range 서빙·API 프록시·볼륨 마운트 | 파이에서 `docker compose config` 검증 후 변경. 상대방 리뷰 필수 |

## 폴더 구조 요약

```
Woo-MoMo-Project/
├── frontend/   ← Vue 3 SPA (랜딩·준비·면접·리포트 화면, 브라우저 내 LLM 실행)
├── backend/    ← FastAPI (매니페스트·폴백 질문·헬스체크, 추후 RAG)
├── deploy/     ← docker-compose.yml, nginx.conf, Dockerfile (공동)
├── finetune/   ← Colab 노트북·데이터셋 스크립트 (사이트 코드와 독립, 공동)
└── docs/       ← 사람·AI 공용 문서 (specs/·plans/·API.md 포함)
```

## 문서 체계 — 전체 설계서 1개 + 영역별 spec/plan

프론트와 백엔드는 **완전히 분리해서 개발**한다. 문서도 영역 단위로 분리한다.

| 층 | 문서 | 담당 | 역할 |
|---|---|---|---|
| 전체 | `docs/superpowers/specs/2026-09-15-mock-interview-design.md` | 공동 | 아키텍처·화면·LLM 흐름·배포·일정. 두 영역이 공유하는 기준 |
| 영역 spec | `docs/specs/backend/`, `docs/specs/frontend/` | 각 영역 담당 | 전체 설계서에서 자기 영역 몫만 떼어 "무엇을·왜" 확정 |
| 영역 plan | `docs/plans/backend/`, `docs/plans/frontend/` | 각 영역 담당 | 자기 영역 spec을 Task 단위 작업지시서로 |

- 파일명: `docs/specs/{area}/YYYY-MM-DD-{slug}-design.md`, `docs/plans/{area}/YYYY-MM-DD-{slug}.md`
- 영역 spec은 전체 설계서와 어긋나면 안 된다. 어긋나야 하면 전체 설계서를 먼저 고치고(공동 리뷰) 영역 spec을 따라간다.
- 두 영역이 만나는 지점(`/api` 계약)은 `docs/API.md` 하나로만 정의한다. 각 영역 spec은 이를 참조만 한다.
- 다른 영역의 spec/plan을 대신 쓰지 않는다. 필요하면 이슈로 요청한다.

## 작업 흐름

### 새 기능

1. brainstorming → `docs/specs/{area}/`에 spec 작성·커밋
2. writing-plans → `docs/plans/{area}/`에 plan 작성·커밋 (Task 단위)
3. `main`에서 `feature/` 브랜치 생성 → plan대로 구현
4. 매 작업 TDD (실패 테스트 먼저)
5. 변경 제안 전 검증 + 리뷰 요청
6. 리뷰 → Squash merge
7. `main` 머지 → CI가 arm64 이미지 빌드·GHCR 푸시 → 파이에서 `docker compose pull && up -d`

### 버그 수정

1. 근본 원인 진단(증상 아님) → 진단 결과를 변경 제안 설명에 첨부
2. 실패 재현 테스트 작성 → 수정 → 변경 제안

### Trivial 예외

오타·문서·한 줄 수정은 spec/plan 생략 가능. 단 **변경 제안·리뷰는 반드시 거침**.

## 커밋 규칙 — Conventional Commits

```
feat(frontend): ...     # 프론트 기능
feat(backend): ...      # 백엔드 기능
fix(frontend): ...      # 버그
feat(api): ...          # 계약 변경(양쪽 영향)
chore(infra): ...       # deploy/·CI
docs: ...               # 문서
finetune: ...           # 파인튜닝 트랙
```

## 변경 제안(PR) 규칙

1. 변경 제안 1개 = 작은 작업 1개. 거대 변경은 분할.
2. 제목은 Conventional Commits 형식(Squash 시 커밋 메시지).
3. 템플릿 체크리스트를 모두 채운다.
4. CI 통과 필수.
5. 자기 영역은 상대방 리뷰 1회, 공유 영역은 상대방 승인 필수.

## 절대 하지 말 것

1. 비밀키·`.env`·인증서 커밋 금지 (`.gitignore` + 훅이 차단)
2. `main` 직접 push 금지 (Protected Branches)
3. 계약(`backend/data/manifest.json`, `/api` 응답 스키마) 변경과 그 계약에 의존하는 프론트 코드를 같은 변경 제안에 섞지 않음 — **계약 먼저 배포 후 코드**(lockstep). 새 필드는 additive로.
4. 계층 규율 경로를 기준 대조 없이 수정 금지
5. `git push --force`, `git reset --hard` 금지
6. 파괴적 명령 임의 실행 금지 — 막히면 이슈로 남김
7. 모델 파일(`.litertlm`)·이력서 샘플 PDF 등 대용량/개인정보 파일 커밋 금지 (500KB 훅이 차단)
8. 이력서 텍스트·대화 내용을 서버로 전송하는 코드 작성 금지 (프로젝트 핵심 가치)

## 문서 인덱스

| 문서 | 내용 |
|------|------|
| `docs/superpowers/specs/2026-09-15-mock-interview-design.md` | 전체 설계서 (아키텍처·화면·LLM·배포·일정) |
| `docs/API.md` | 백엔드 계약: 매니페스트·폴백 질문·헬스체크 응답 형식 (백엔드 담당이 소유) |
| `docs/specs/{area}/`·`docs/plans/{area}/` | 영역별 설계서·작업지시서 (템플릿: `docs/specs/spec.template.md`, `docs/plans/plan.template.md`) |
| `docs/demo-checklist.md` | 데모 리허설 수동 시나리오 |
| `frontend/CLAUDE.md` | frontend 영역 규칙 |
| `backend/CLAUDE.md` | backend 영역 규칙 |
