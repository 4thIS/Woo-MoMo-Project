# 스크롤 애니메이션 철거 — 설계 (spec)

- 생성일시: 2026-11-07
- 수정일시: 2026-11-07

## 0. 배경 · 위치

프론트 전면 개편(네비게이션 · 준비 · 리포트 · 내정보 · 보관함)에 앞서, **지금 있는 스크롤 연동 애니메이션을 전부 걷어낸다.** 전체 설계서 6절(화면)의 공통 바탕에 해당한다.

철거를 먼저 하는 이유는 하나다. 지금은 레이아웃과 움직임이 섞여 있어, 화면이 어색할 때 **레이아웃 탓인지 애니메이션 탓인지 가릴 수 없다.** 바탕이 안 움직여야 자리를 판단할 수 있다.

개편 시안(승인 완료): https://claude.ai/artifact/7q3VdUDuQdVcgpyKHdWLVd — 아트보드 `애니메이션 — 걷어낼 것과 남길 것`

개편 순서에서 이 spec이 **1번**이다. 이어지는 spec: 모던 레트로 껍데기 → 준비 → 리포트 → 보관함 → 내정보.

### 지금 무엇이 문제인가

| 현상 | 원인 |
|---|---|
| 트랙패드로 스크롤하면 걸리고 튄다 | `useSectionWheel`이 `wheel`을 `preventDefault`하고 700ms 잠근다. 관성 스크롤은 그 사이 수십 번 들어오고 전부 버려진다 |
| 사파리·파이어폭스에서 섹션 등장 효과가 아예 없다 | `.snap > .content`의 `animation-timeline: view()`는 크롬 계열 전용 |
| 섹션이 화면보다 길면 아랫부분에 닿을 수 없다 | `.snap`이 `min-height: 100vh` + `scroll-snap-type: y mandatory` |
| 스크롤할 때마다 다시 그린다 | `LandingView`의 히어로 페이드가 `scrollTop`을 읽어 `fade`를 갱신 |

## 1. 목표 · 비목표

### 목표

- 스크롤 위치를 입력으로 받는 모든 움직임을 제거하고, **평범한 문서 스크롤**로 되돌린다.
- 섹션이 화면보다 길어도 끝까지 읽을 수 있게 한다.
- 브라우저와 입력 기기(휠 · 트랙패드 · 터치 · 키보드)에 따라 동작이 갈리지 않게 한다.
- 손맛에 해당하는 움직임(`.press`, 커서 깜빡임, 화면 전환)은 **그대로 둔다.**

### 비목표 (이번엔 안 함 / 후속)

- 새 등장 애니메이션 추가 — 레이아웃이 확정된 뒤 별도 spec으로 다룬다. 이번엔 **빼기만** 한다.
- 레이아웃 변경 — 이 spec은 섹션 구조를 바꾸지 않는다. `.snap` 클래스가 남아도 좋다.
- 면접 화면(`InterviewView`)과 그 안의 움직임 — 손대지 않는다.

## 2. 데이터 · 계약 (있다면)

없음. `backend/data/manifest.json` · `/api` 응답 스키마 변경 **없음** → lockstep 불필요.

## 3. 접근 제어 / 제약

- 판단 기준은 하나다 — **스크롤 위치를 입력으로 받는가.** 받으면 지운다. 안 받으면 남긴다.
- `prefers-reduced-motion: reduce`에서 움직임이 전부 꺼지는 현재 규칙은 유지한다.
- `@media print`에서 움직임이 꺼지는 현재 규칙도 유지한다.
- 스크롤러가 `.snap-root`(요소)에서 문서(`body`)로 옮겨 간다. 화면 아래 고정된 `HintBar`가 뷰포트 기준으로 서 있으므로, `scrollbar-gutter: stable both-edges`가 없어져도 가운데 정렬이 어긋나지 않는지 확인해야 한다 (`styles/base.css` 주석 참조).

### 걷어낼 것

| 대상 | 위치 |
|---|---|
| `useSectionWheel` 컴포저블 | `composables/useSectionWheel.ts` — 파일째. 테스트도 함께 |
| 그 호출 2곳 | `views/LandingView.vue`, `views/PrepareView.vue` |
| 스크롤 스냅 컨테이너 | `styles/base.css` `.snap-root` — `height: 100vh`, `overflow-y: auto`, `scroll-snap-type`, `scrollbar-gutter` |
| 한 화면 = 한 섹션 | `.snap` — `min-height: 100vh`, `scroll-snap-align` |
| 스크롤 타임라인 등장 | `.snap > .content` — `animation-timeline: view()`, `animation-range` |
| 바닥 안내 화살표 | `.snap:not(:last-of-type)::after` 와 `@keyframes bob` |
| 히어로 페이드 | `views/LandingView.vue` — `fade`, `onScroll`, 스크롤 리스너 등록·해제 |
| 위 선택자가 적힌 예외 블록 정리 | `base.css`의 `prefers-reduced-motion`·`@media print` |

### 남길 것

- `.press` 호버·누름(하드 그림자) — 이 제품의 버튼 그 자체다.
- `@keyframes blink`(커서), `@keyframes nudge`(아이콘).
- `App.vue`의 화면 전환 `Transition`.
- `deal`(요금 카드), `silence-drain`(답변 입력), `caption-float`(힌트 바).
- `InterviewerPicker`의 **가로** `scroll-snap` — 캐러셀이라 다른 물건이다.

### 나중에 다시 올릴 때 지킬 것 (여기서 미리 못 박는다)

1. **스크롤을 가로채지 않는다.** 휠은 브라우저 것이다.
2. **들어올 때 한 번만.** `IntersectionObserver`로 클래스를 붙이고, 한 번 붙으면 떼지 않는다.
3. **`animation-timeline`을 쓰지 않는다.** 크롬에서만 도는 것을 기본 경험에 둘 수 없다.
4. **높이를 못 박지 않는다.** `height: 100vh` 금지. 필요하면 `min-height: 100svh`까지.
5. **`opacity`와 `transform`만 움직인다.**
6. `prefers-reduced-motion`에서 전부 꺼지는 규칙은 그대로.

## 4. 인터페이스 계약

| 함수 · 선택자 | 접근 | 설명 |
|---|---|---|
| `useSectionWheel(root)` | internal | **삭제.** 호출처 2곳에서 import와 호출을 함께 지운다 |
| `.snap-root` | internal | 스크롤러 지정을 버린다. 일반 블록이 된다 |
| `.snap` | internal | `min-height: 100vh`를 버린다. 섹션 사이 여백만 담당한다 |

## 5. 영역별 영향

- frontend: `composables/useSectionWheel.ts`(삭제), `styles/base.css`, `views/LandingView.vue`, `views/PrepareView.vue`. 테스트 — `composables/useSectionWheel.test.ts`(삭제), `styles/base.test.ts`의 `.snap-root` 단언 2건, `views/PrepareView.test.ts:442`의 `.snap-root` 참조.
- backend: 없음.
- deploy / finetune: 없음.

## 6. 무회귀 · 롤아웃

- 계약 변경이 없으므로 lockstep 불필요. 단독 배포 가능하다.
- 섹션 구조(`<section class="snap">`)와 그 안의 내용은 **건드리지 않는다.** 바뀌는 것은 높이와 스크롤 동작뿐이다.
- 이 변경 하나로 랜딩·준비 화면이 **한 번에 다 보이는 긴 문서**가 된다. 보기에 허전해질 수 있으나, 그 자리는 다음 spec(준비 화면 레이아웃)에서 채운다. 중간 상태를 운영에 내보내도 기능은 전부 동작한다.
- 배포 순서: 작업 PR → `dev` → demomo 눈으로 확인 → `dev → main`.

## 7. 역할 분담

| 영역 | 담당 |
|------|------|
| frontend | @leemonta9482 |
| backend | @ssenu |
| deploy / docs / finetune | @ssenu @leemonta9482 |

## 8. 성공 기준

- 트랙패드로 랜딩을 위에서 아래까지 내렸을 때 걸리거나 되돌아가는 구간이 없다.
- 사파리·파이어폭스·크롬에서 **같은 모양**으로 스크롤된다.
- 창을 세로로 줄여 섹션이 화면보다 길어져도 섹션 아랫부분에 닿는다.
- <kbd>Tab</kbd>으로 요소를 훑을 때 화면이 튀지 않는다.
- `pnpm test && pnpm lint && pnpm exec prettier --check src && pnpm exec vue-tsc --noEmit && pnpm build` 전부 통과.
- 코드베이스에 `animation-timeline`·`scroll-snap-type: y`·`useSectionWheel` 검색 결과가 0건.
