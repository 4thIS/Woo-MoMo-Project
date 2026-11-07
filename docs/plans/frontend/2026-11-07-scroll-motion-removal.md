# 스크롤 애니메이션 철거 — 구현 계획 (plan)

- 생성일시: 2026-11-07
- 기준 spec: `docs/specs/frontend/2026-11-07-scroll-motion-removal-design.md`

**Goal:** 스크롤 위치를 입력으로 받는 모든 움직임을 걷어내고, 랜딩·준비 화면을 평범한 문서 스크롤로 되돌린다.

**Architecture:** 빼기만 한다. 새 코드는 `scrollToProgress`를 문서 스크롤로 옮기는 한 곳뿐이다. 스크롤러가 `.snap-root`(요소)에서 문서(`html`/`body`)로 옮겨 가므로, 요소 스크롤러를 전제한 코드·CSS·테스트를 함께 고친다. 섹션 구조(`<section class="snap">`)와 그 안의 내용은 건드리지 않는다.

**Tech Stack:** frontend: Vue 3 + TS + Vite + Pinia + Vitest

## Global Constraints

- 계약 변경 **없음**. `backend/data/manifest.json`·`/api` 응답 스키마를 건드리지 않는다. lockstep 불필요.
- `frontend/`만 고친다. `backend/`·`deploy/`는 손대지 않는다.
- **면접 화면(`InterviewView`)은 건드리지 않는다.** 그 화면도 자기 스크롤러를 갖지만 이번 범위가 아니다 (`styles/base.css` 맨 위 주석 참조).
- **남길 움직임**: `.press` 호버·누름, `@keyframes blink`, `@keyframes nudge`, `App.vue` 화면 전환 `Transition`, `deal`(PremiumModal), `silence-drain`(AnswerInput), `caption-float`(HintBar), `InterviewerPicker`의 **가로** `scroll-snap`. 이 여덟을 지우면 과잉이다.
- 색 리터럴은 `tokens.css`에만. 이번 작업에서 색은 건드리지 않는다.
- `docs/`에 prettier를 돌리지 않는다.
- 매 Task 끝에 커밋한다. 커밋 메시지에 Claude/AI 저작 표기를 넣지 않는다.

## Review Focus

테스트가 잡지 못하는 자리들. 각 Task를 끝낸 뒤 **demomo에서 눈으로** 확인한다.

- **섹션이 뷰포트보다 길 때 아랫부분에 닿는가** — jsdom에는 레이아웃이 없어 자동 테스트로 못 잡는다. 창을 세로 500px로 줄여 확인.
- **`HintBar`가 가운데에 서는가** — `scrollbar-gutter: stable both-edges`를 없애면 안쪽 스크롤러가 사라져 내용 가운데가 스크롤바 폭의 절반만큼 움직일 수 있다(`base.test.ts`의 그 단언이 설명하는 상황).
- **스크롤바가 둘로 보이지 않는가** — 요소 스크롤러를 버리면 문서 스크롤바 하나만 남아야 한다.
- **트랙패드 관성 스크롤** — 자동 테스트 불가. 맥 트랙패드로 랜딩을 위에서 아래까지.
- **`prefers-reduced-motion: reduce`에서 남은 움직임** — OS 설정을 켜고 랜딩·준비를 훑어, 남기기로 한 여덟 개만 꺼지는지 확인.

---

### Task 1: 휠 가로채기 제거

**Files:**
- Delete: `frontend/src/composables/useSectionWheel.ts`
- Delete: `frontend/src/composables/useSectionWheel.test.ts`
- Modify: `frontend/src/views/LandingView.vue` (import 1줄 + 호출 1줄)
- Modify: `frontend/src/views/PrepareView.vue` (import 1줄 + 호출 1줄)

**Interfaces:**
- Consumes: 없음
- Produces: 없음 (`useSectionWheel`이 사라진다. 다른 Task가 참조하지 않는다)

- [ ] **Step 1: 지우기 전에 무엇이 사라지는지 본다**

Run: `pnpm test -- useSectionWheel`
Expected: PASS (지금은 테스트가 통과한다. 이 Task는 기능 추가가 아니라 제거라 실패 테스트를 먼저 쓰지 않는다 — 대신 **지워질 테스트가 지금 무엇을 지키는지** 읽고 넘어간다)

- [ ] **Step 2: 파일 둘을 지운다**

```bash
rm frontend/src/composables/useSectionWheel.ts
rm frontend/src/composables/useSectionWheel.test.ts
```

- [ ] **Step 3: `LandingView.vue`에서 호출을 뗀다**

지울 줄 둘 (8행, 30행):

```ts
import { useSectionWheel } from '@/composables/useSectionWheel'
```
```ts
useSectionWheel(root)
```

`const root = ref<HTMLElement | null>(null)`는 **남긴다** — 29행 아래 `onScroll`이 아직 쓰고 있고, Task 4에서 함께 정리한다.

- [ ] **Step 4: `PrepareView.vue`에서 호출을 뗀다**

지울 줄 둘 (7행, 29행):

```ts
import { useSectionWheel } from '@/composables/useSectionWheel'
```
```ts
useSectionWheel(root)
```

`root`는 남긴다 — `scrollToProgress`가 쓰고 있고 Task 5에서 고친다.

- [ ] **Step 5: 전체 테스트**

Run: `pnpm test`
Expected: PASS. `useSectionWheel` 관련 테스트 파일이 사라졌으므로 전체 개수가 줄어든다. **다른 테스트가 깨지면 안 된다.**

- [ ] **Step 6: 남은 참조가 없는지 확인**

Run: `grep -rn "useSectionWheel" frontend/src`
Expected: 결과 없음 (exit 1)

- [ ] **Step 7: 커밋**

```bash
git add -A frontend/src/composables frontend/src/views/LandingView.vue frontend/src/views/PrepareView.vue
git commit -m "fix(frontend): 휠 가로채기 제거 — 스크롤은 브라우저 것으로 되돌린다"
```

---

### Task 2: 스크롤 스냅과 100vh 해제

**Files:**
- Modify: `frontend/src/styles/base.css` (`.snap-root`, `.snap`, `prefers-reduced-motion` 블록)
- Modify: `frontend/src/views/PrepareView.vue` (scoped `.prepare`, `.prepare .snap`)
- Test: `frontend/src/styles/base.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces: 문서(`html`)가 스크롤러가 된다. Task 5의 `scrollToProgress`가 이 사실에 기댄다

- [ ] **Step 1: 실패하는 테스트를 먼저 쓴다**

`frontend/src/styles/base.test.ts`의 `describe('base.css — 스크롤')` 안, **기존 "안쪽 스크롤러는 양쪽에 같은 자리를 둔다" 테스트를 아래로 교체**한다. 그 테스트가 지키던 상황(안쪽 스크롤러)이 사라지기 때문이다.

```ts
it('섹션을 한 화면에 가두지 않는다 — 내용이 길면 그냥 더 스크롤된다', () => {
  // 100vh + mandatory 스냅이면 섹션이 화면보다 길 때 아랫부분에 닿을 방법이 없다
  expect(block('.snap')).not.toMatch(/min-height/)
  expect(base).not.toMatch(/scroll-snap-type:\s*y/)
})

it('스크롤러는 문서 하나다 — 요소 스크롤러를 두면 스크롤바가 둘이 된다', () => {
  expect(block('.snap-root')).not.toMatch(/overflow-y:\s*auto/)
  expect(block('.snap-root')).not.toMatch(/height:\s*100vh/)
})

it('앵커로 이동할 때 상단바에 가리지 않게 문서가 자리를 비운다', () => {
  expect(block('html')).toMatch(/scroll-padding-top/)
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm test -- base.test`
Expected: FAIL 3건 — `.snap`에 `min-height`가 있고, `scroll-snap-type: y`가 있고, `.snap-root`에 `overflow-y: auto`·`height: 100vh`가 있고, `html` 블록에 `scroll-padding-top`이 없다.

- [ ] **Step 3: `base.css`의 `.snap-root`·`.snap`을 고친다**

현재:

```css
.snap-root {
  height: 100vh;
  overflow-y: auto;
  scrollbar-gutter: stable both-edges;
  scroll-snap-type: y mandatory;
}
.snap {
  position: relative;
  min-height: 100vh;
  scroll-snap-align: start;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--sp-10) var(--sp-4);
}
```

바꿀 것 — `.snap-root` 규칙은 통째로 지우고(클래스는 템플릿에 남아도 무해하다), `.snap`은 여백만 맡는다:

```css
/* 섹션 하나. 더 이상 한 화면에 가두지 않는다 — 내용이 길면 그냥 더 스크롤된다.
   스크롤러는 문서 하나다(2026-11-07 철거) */
.snap {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--sp-14) var(--sp-4);
}
```

세로 여백을 `--sp-10`(40px) → `--sp-14`(56px)로 올린다. 100vh가 벌어 주던 자리를 여백이 대신한다.

- [ ] **Step 4: `html`에 `scroll-padding-top`을 둔다**

`base.css`의 `html` 규칙(없으면 `body` 바로 위에 새로 만든다)에 더한다:

```css
html {
  /* 앵커·scrollIntoView로 이동할 때 전역 상단바가 머리글을 덮지 않게 비운다.
     요소 스크롤러를 버리면서 .prepare에 있던 것을 문서로 옮겼다 */
  scroll-padding-top: var(--topbar-h);
}
```

- [ ] **Step 5: `PrepareView.vue`의 scoped 스타일을 고친다**

현재 (748~754행):

```css
.prepare {
  /* 이 화면의 머리글(72px) + 그 위를 덮는 전역 상단바만큼 아래에 섹션이 맞춰진다 */
  scroll-padding-top: calc(72px + var(--topbar-h));
}
.prepare .snap {
  min-height: calc(100vh - 72px - var(--topbar-h));
}
```

둘 다 지운다. `scroll-padding-top`은 Step 4에서 `html`로 옮겼고, 이 화면의 sticky 머리글(72px)만큼은 그 머리글 자신이 `top: var(--topbar-h)`로 이미 비키고 있다. 섹션 최소 높이는 더 이상 필요 없다.

- [ ] **Step 6: `prefers-reduced-motion` 블록에서 `.snap-root`를 뺀다**

현재 블록 안의 이 두 줄을 지운다:

```css
  .snap-root {
    scroll-snap-type: none;
  }
```

- [ ] **Step 7: 테스트가 통과하는지**

Run: `pnpm test -- base.test`
Expected: PASS

- [ ] **Step 8: 전체 테스트**

Run: `pnpm test`
Expected: PASS. `PrepareView.test.ts:442`의 `.snap-root` 참조는 **아직 살아 있다**(클래스를 템플릿에서 지우지 않았다). Task 5에서 그 테스트를 다시 쓴다.

- [ ] **Step 9: 눈으로 확인**

Run: `pnpm dev`
창을 세로 500px로 줄이고 랜딩을 끝까지 내린다.
Expected: 모든 섹션의 아랫부분까지 닿는다. 스크롤바가 하나다. 화면 아래 힌트 바가 가운데에 선다.

- [ ] **Step 10: 커밋**

```bash
git add frontend/src/styles/base.css frontend/src/styles/base.test.ts frontend/src/views/PrepareView.vue
git commit -m "fix(frontend): 스크롤 스냅·100vh 해제 — 스크롤러를 문서로 되돌린다"
```

---

### Task 3: 스크롤 연동 등장과 바닥 화살표 제거

**Files:**
- Modify: `frontend/src/styles/base.css`
- Test: `frontend/src/styles/base.test.ts`

**Interfaces:**
- Consumes: Task 2가 만든 `.snap`(여백만 맡는 규칙)
- Produces: 없음

- [ ] **Step 1: 실패하는 테스트**

`base.test.ts`에 더한다:

```ts
it('크롬에서만 도는 스크롤 타임라인을 기본 경험에 두지 않는다', () => {
  // animation-timeline: view()는 크롬 계열 전용이다. 사파리·파이어폭스에서는
  // 아무 일도 일어나지 않아 브라우저마다 다른 화면이 된다
  expect(base).not.toMatch(/animation-timeline/)
  expect(base).not.toMatch(/animation-range/)
})

it('스크롤을 재촉하는 바닥 화살표를 두지 않는다', () => {
  expect(base).not.toMatch(/@keyframes bob/)
})
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm test -- base.test`
Expected: FAIL 2건 — `animation-timeline`과 `@keyframes bob`이 아직 있다.

- [ ] **Step 3: `.snap > .content`에서 스크롤 타임라인을 뺀다**

현재:

```css
/* 섹션 내용은 화면에 들어오는 동안 rise 재생(Chrome scroll-driven animation). 미지원 브라우저는 로드 시 1회 */
.snap > .content {
  width: 100%;
  max-width: var(--content-w);
  animation: rise var(--dur-3) var(--ease) both;
  animation-timeline: view();
  animation-range: entry 10% entry 70%;
}
```

바꿀 것 — 폭만 남긴다. `rise` 자체도 뗀다(로드 때 한 번 재생되는 것도 스크롤과 무관해 보이지만, 긴 문서에서 아래쪽 섹션이 보이지도 않는 채로 재생돼 버려 의미가 없다):

```css
.snap > .content {
  width: 100%;
  max-width: var(--content-w);
}
```

`@keyframes rise`와 `.rise` 클래스는 **남긴다** — `PixelWindow` 등이 직접 쓰고 있다.

- [ ] **Step 4: 바닥 화살표와 `bob`을 지운다**

`.snap:not(:last-of-type)::after` 규칙 전체와 `@keyframes bob` 전체를 지운다.

- [ ] **Step 5: 예외 블록 정리**

`prefers-reduced-motion` 블록의 선택자 목록에서 사라진 둘을 뺀다:

```css
  .blink,
  .rise,
  .snap > .content,
  .snap:not(:last-of-type)::after,
```
→
```css
  .blink,
  .rise,
```

`@media print` 블록도 같게 한다:

```css
  .blink,
  .snap:not(:last-of-type)::after {
    display: none;
  }
  .rise,
  .snap > .content {
    animation: none;
  }
```
→
```css
  .blink {
    display: none;
  }
  .rise {
    animation: none;
  }
```

- [ ] **Step 6: 테스트**

Run: `pnpm test -- base.test`
Expected: PASS

- [ ] **Step 7: 전체 테스트**

Run: `pnpm test`
Expected: PASS

- [ ] **Step 8: 커밋**

```bash
git add frontend/src/styles/base.css frontend/src/styles/base.test.ts
git commit -m "fix(frontend): 스크롤 연동 등장·바닥 화살표 제거 — 브라우저마다 다른 화면을 없앤다"
```

---

### Task 4: 히어로 페이드 제거

**Files:**
- Modify: `frontend/src/views/LandingView.vue`
- Test: `frontend/src/views/LandingView.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces: `LandingView`의 `root` ref가 더 이상 스크롤 리스너를 달지 않는다

- [ ] **Step 1: 실패하는 테스트**

`LandingView.test.ts`에 더한다:

```ts
it('스크롤할 때마다 다시 그리지 않는다 — 스크롤 리스너를 달지 않는다', () => {
  const add = vi.spyOn(HTMLElement.prototype, 'addEventListener')
  mountView()
  const scrollListeners = add.mock.calls.filter(([type]) => type === 'scroll')
  expect(scrollListeners).toHaveLength(0)
  add.mockRestore()
})
```

`mountView`는 이 파일에 이미 있는 헬퍼를 그대로 쓴다. 없으면 기존 테스트의 마운트 방식을 복사한다.

- [ ] **Step 2: 실패 확인**

Run: `pnpm test -- LandingView`
Expected: FAIL — `scroll` 리스너가 1건 잡힌다.

- [ ] **Step 3: `fade`와 `onScroll`을 지운다**

`<script setup>`에서 지울 것 (26~33행 부근):

```ts
/* 히어로 페이드: 스크롤 진행률 0→1 (스크롤 컨테이너는 .snap-root인 루트 요소) */
const hero = ref<HTMLElement | null>(null)
const fade = ref(0)
const onScroll = () => {
  const h = hero.value?.offsetHeight ?? 1
  fade.value = Math.min(1, Math.max(0, (root.value?.scrollTop ?? 0) / (h * 0.6)))
}
```

`const root = ref<HTMLElement | null>(null)`는 템플릿의 `ref="root"`가 아직 쓰므로 남긴다.

`onMounted`에서 지울 줄:

```ts
  root.value?.addEventListener('scroll', onScroll, { passive: true })
```

`onBeforeUnmount`에서 지울 줄:

```ts
  root.value?.removeEventListener('scroll', onScroll)
```

- [ ] **Step 4: 템플릿에서 `fade`·`hero` 사용처를 지운다**

Run: `grep -n "fade\|hero" frontend/src/views/LandingView.vue`

히어로 `<section>`의 `ref="hero"`와, `fade`를 읽는 인라인 `:style`(또는 `:class`)을 지운다. 히어로는 이제 늘 또렷하게 보인다.

- [ ] **Step 5: 테스트 통과**

Run: `pnpm test -- LandingView`
Expected: PASS

- [ ] **Step 6: 전체 테스트**

Run: `pnpm test`
Expected: PASS

- [ ] **Step 7: 커밋**

```bash
git add frontend/src/views/LandingView.vue frontend/src/views/LandingView.test.ts
git commit -m "fix(frontend): 히어로 페이드 제거 — 매 스크롤 다시 그리던 것을 없앤다"
```

---

### Task 5: `scrollToProgress`를 문서 스크롤로

**Files:**
- Modify: `frontend/src/views/PrepareView.vue` (`scrollToProgress`)
- Test: `frontend/src/views/PrepareView.test.ts` (442행 테스트)

**Interfaces:**
- Consumes: Task 2가 만든 "문서가 스크롤러" 상태
- Produces: `scrollToProgress()` — 진행 창이 있는 첫 섹션으로 이동. 요소 스크롤러를 쓰지 않는다

- [ ] **Step 1: 실패하는 테스트로 고쳐 쓴다**

`PrepareView.test.ts`의 "Gemma 실패: … 진행 창으로 스크롤한다" 테스트(435~445행)를 아래로 교체한다:

```ts
it('Gemma 실패: 문구가 실패를 말하고 "진행 창으로" 링크가 진행 창으로 스크롤한다', async () => {
  const m = useModelStore()
  m.status = 'error'
  m.error = 'gpu'
  const w = mountView()
  await filled(w)
  expect(w.find('[data-test=start]').text()).toContain('면접관을 준비하지 못했습니다')
  // 스크롤러는 문서다 — 요소가 아니라 window가 움직인다 (2026-11-07 철거)
  const scrollTo = vi.fn()
  vi.stubGlobal('scrollTo', scrollTo)
  await w.find('[data-test=start-scroll-top]').trigger('click')
  expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ top: 0 }))
  vi.unstubAllGlobals()
})
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm test -- PrepareView`
Expected: FAIL — `scrollTo`가 호출되지 않는다(아직 `root.value?.scrollTo`를 부른다).

- [ ] **Step 3: 구현**

`PrepareView.vue` 229~231행:

```ts
function scrollToProgress() {
  root.value?.scrollTo({ top: 0, behavior: 'smooth' })
}
```
→
```ts
/* 스크롤러는 문서다(2026-11-07 철거). 요소가 아니라 창을 올린다 */
function scrollToProgress() {
  scrollTo({ top: 0, behavior: 'smooth' })
}
```

- [ ] **Step 4: 테스트 통과**

Run: `pnpm test -- PrepareView`
Expected: PASS

- [ ] **Step 5: `root` ref가 아직 쓰이는지 확인하고 정리**

Run: `grep -n "root" frontend/src/views/PrepareView.vue`

`ref="root"`(템플릿)와 선언만 남고 **읽는 곳이 없으면** 둘 다 지운다. `LandingView.vue`도 같게 확인한다. 쓰는 곳이 남아 있으면 그대로 둔다.

- [ ] **Step 6: 전체 테스트**

Run: `pnpm test`
Expected: PASS

- [ ] **Step 7: 남은 흔적 전수 검색**

```bash
grep -rn "animation-timeline\|scroll-snap-type: y\|useSectionWheel\|snap-root" frontend/src
```
Expected: `snap-root`가 템플릿 클래스로 남아 있다면 그것만 나온다(무해). 나머지 셋은 **0건**이어야 한다.

- [ ] **Step 8: 프론트 게이트 전부**

```bash
cd frontend
pnpm test && pnpm lint && pnpm exec prettier --check src && pnpm exec vue-tsc --noEmit && pnpm build
```
Expected: 전부 통과.

- [ ] **Step 9: 커밋**

```bash
git add frontend/src/views/PrepareView.vue frontend/src/views/PrepareView.test.ts
git commit -m "fix(frontend): 진행 창으로 가는 링크를 문서 스크롤로 — 요소 스크롤러 전제 제거"
```

---

## 끝낸 뒤

1. `feature/scroll-motion-removal` → `dev` PR. 제목: `fix(frontend): 스크롤 애니메이션 철거 — 평범한 문서 스크롤로`
2. 리뷰 → Squash merge → demomo 자동 재배포(2분)
3. **demomo에서 Review Focus 다섯 가지를 눈으로 확인한다.** 특히 트랙패드와 `prefers-reduced-motion`.
4. 정상이면 `dev → main` PR을 **merge commit**(`gh pr merge <번호> --merge`)으로.
5. 다음 plan: `2026-11-07-modern-retro-shell-design.md`의 plan.
