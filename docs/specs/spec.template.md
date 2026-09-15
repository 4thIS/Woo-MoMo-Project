# {기능명} — 설계 (spec)

<!-- 배치: docs/specs/YYYY-MM-DD-{feature-slug}-design.md -->
<!-- brainstorming 스킬로 작성. "무엇을·왜"만. 구현 방법(어떻게)은 plan에서. -->
<!-- 전체 설계는 docs/superpowers/specs/2026-09-15-mock-interview-design.md 참조. 이 템플릿은 그 하위 기능용. -->

- 생성일시: YYYY-MM-DD
- 수정일시: YYYY-MM-DD

## 0. 배경 · 위치

(이 기능이 왜 지금 필요한가. 전체 설계서의 어느 섹션에 해당하는가.)

## 1. 목표 · 비목표

### 목표
- (목표 1)
- (목표 2)

### 비목표 (이번엔 안 함 / 후속)
- (비목표 1)

## 2. 데이터 · 계약 (있다면)

(신규/변경되는 계약물: 매니페스트 필드, `/api` 응답. 없으면 "없음".)

- `backend/data/manifest.json` · `/api` 응답 스키마 변경: 있음 / 없음 → 있으면 lockstep 필요 (`docs/API.md` 먼저 갱신).

## 3. 접근 제어 / 제약

- (브라우저 요구사항, 온디바이스 제약, 엣지 케이스 규칙.)

## 4. 인터페이스 계약

| 메서드·경로 / 함수 | 접근 | 설명 |
|---|---|---|
| (예: `GET /api/questions/{field}` / `parseReport(raw): ReportItem[]`) | (public / internal) | (설명) |

## 5. 영역별 영향

- frontend: (무엇을)
- backend: (무엇을)
- deploy / finetune: (무엇을, 없으면 "없음")

## 6. 무회귀 · 롤아웃

- (기존 동작 보존 방법, 배포 순서. 계약 변경 시 lockstep 명시.)

## 7. 역할 분담

| 영역 | 담당 |
|------|------|
| frontend | @leemonta9482 |
| backend | @ssenu |
| deploy / docs / finetune | @ssenu @leemonta9482 |

## 8. 성공 기준

- (완료를 어떻게 확인하는가 — 관찰 가능한 기준. 예: 데모 체크리스트 항목 N 통과.)

## 9. 열린 결정 (plan 단계에서 확정)

- (열린 질문 1)
