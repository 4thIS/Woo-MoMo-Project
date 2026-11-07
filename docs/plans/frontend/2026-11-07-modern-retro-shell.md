# 모던 레트로 껍데기 — 구현 계획 (plan)

- 생성일시: 2026-11-07
- 기준 spec: `docs/specs/frontend/2026-11-07-modern-retro-shell-design.md`

**Goal:** 색 토큰을 하나도 바꾸지 않고, 상단 바의 배열과 두 상태(떠 있음 ↔ 판 깔림)를 잡고 긴 글의 글꼴 역할을 나눈다.

**Architecture:** `TopBar.vue` 한 파일이 작업의 절반이다. 떠 있음/판 깔림 전환은 **문서 맨 위에 둔 센티넬**을 `IntersectionObserver`로 지켜보고 클래스를 붙이는 방식이다 — `scrollTop`을 읽지 않는다(1번 spec에서 못 박은 원칙). 글꼴은 **새 웹폰트를 받지 않고** 시스템 한글 산세 스택을 쓴다.

**Tech Stack:** frontend: Vue 3 + TS + Vite + Pinia + Vitest

## Global Constraints

- 계약 변경 **없음**. lockstep 불필요.
- **색 토큰을 한 건도 바꾸지 않는다.** `tokens.css`의 색 구역은 손대지 않는다.
- **`border-radius`를 어디에도 넣지 않는다.** 작업 끝에 전수 검색으로 확인한다.
- **면접실·면접관은 손대지 않는다.** `InterviewView`, `InterviewStage`, 스프라이트, 출근 애니메이션 전부 그대로다.
- 하드 그림자는 흐리게 만들지 않는다. `5px 5px 0` → `3~4px 3~4px 0`으로 줄이기만 한다.
- `docs/`에 prettier를 돌리지 않는다. 커밋 메시지에 Claude/AI 저작 표기를 넣지 않는다.
- 매 Task 끝에 커밋한다.

### 결정: 새 웹폰트를 받지 않는다

spec은 `--font-read`의 실제 글꼴을 plan에서 정하라고 했다. **Pretendard woff2를 자체 호스팅하지 않는다.**

- 지금 `public/fonts/`에 Galmuri 셋이 **450KB** 있다. Pretendard는 한글 서브셋만 해도 비슷하거나 더 크다.
- 이 제품은 이미 첫 면접 전에 **3.1GB**를 받으라고 한다. 본문 글꼴 하나로 1MB를 더 얹는 것은 나쁜 거래다.
- 시스템 한글 산세는 어느 OS에서나 모던하게 보이고, **0바이트**이며, 폰트 로딩 깜빡임이 없다.

```css
--font-read: 'Pretendard Variable', Pretendard, -apple-system, 'Apple SD Gothic Neo',
  'Noto Sans KR', 'Malgun Gothic', sans-serif;
```

Pretendard가 깔린 기기는 그것을 쓰고, 아니면 OS 글꼴로 간다. 나중에 자체 호스팅이 필요해지면 이 토큰 한 줄만 바꾸면 된다.

### 결정: 센티넬의 높이는 `--topbar-h`

spec은 "히어로를 벗어난 뒤"라고 썼다. 구현에서는 **문서 맨 위에 높이 `--topbar-h`짜리 센티넬**을 두고 그것이 화면에서 벗어나면 판을 깐다.

- 히어로를 관찰하려면 `TopBar`가 `LandingView`의 내부를 알아야 한다. 전역 컴포넌트가 특정 화면에 묶인다.
- 센티넬 높이를 `--topbar-h`로 두면 **바가 내용을 덮기 시작하는 바로 그 지점**에서 판이 깔린다. 숫자를 지어내지 않는다.
- 준비·리포트처럼 맨 위부터 내용이 있는 화면에서도 같은 규칙이 통한다.

## Review Focus

테스트가 잡지 못하는 자리. Task를 끝낸 뒤 **demomo에서 눈으로** 확인한다.

- **떠 있는 상태에서 글자가 읽히는가** — 별 배경 위, 그리고 히어로 로고와 가로로 겹치지 않는가.
- **판이 깔릴 때 아래 내용이 밀리지 않는가** — 두 상태의 높이가 모두 64px이어야 한다.
- **1440 → 390px로 줄이는 동안 바가 한 줄을 유지하는가** — 접히면 `--topbar-h` 고정이 깨진다.
- **아이콘만 남은 버튼을 화면 낭독기가 읽는가** — `aria-label`.
- **면접 화면에서 바가 숨는 규칙이 그대로인가** — `interview.phase !== 'interview'`.

---

### Task 1: 토큰 셋 추가와 `--topbar-h` 고정

**Files:**
- Modify: `frontend/src/styles/tokens.css`
- Test: `frontend/src/styles/tokens.test.ts` (없으면 만든다 — `base.test.ts`의 `block()` 헬퍼를 복사해 쓴다)

**Interfaces:**
- Produces: `--font-read`, `--lh-read`, `--gap-card`. `--topbar-h`는 모든 폭에서 `64px`

- [ ] **Step 1: 실패하는 테스트**

`frontend/src/styles/tokens.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(join(__dirname, 'tokens.css'), 'utf8')

describe('tokens.css', () => {
  it('상단바 높이는 화면 폭에 따라 흔들리지 않는다', () => {
    // 아래 화면 전부가 이 숫자를 믿고 비켜 선다. 폭마다 다르면 한 값이 두 뜻이 된다
    expect(css.match(/--topbar-h:/g) ?? []).toHaveLength(1)
  })

  it('읽는 글의 글꼴과 줄간을 토큰으로 가진다', () => {
    expect(css).toMatch(/--font-read:/)
    expect(css).toMatch(/--lh-read:\s*1\.8/)
    expect(css).toMatch(/--gap-card:/)
  })

  it('읽는 글꼴로 새 웹폰트를 받지 않는다 — 시스템 스택만 쓴다', () => {
    const read = css.match(/--font-read:([^;]+);/)?.[1] ?? ''
    expect(read).toMatch(/sans-serif/)
    expect(css).not.toMatch(/@font-face[\s\S]*font-read/)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm test -- tokens.test`
Expected: FAIL 3건 — `--topbar-h`가 2번 나오고, 새 토큰 셋이 없다.

- [ ] **Step 3: 토큰 셋을 더한다**

`tokens.css`의 `--font-mono` 아래에 더한다:

```css
  /* 읽는 글(약관·안내문·리포트 피드백·답변 원문)은 산세로 간다. 픽셀 글꼴은
     로고·제목·버튼·숫자가 맡는다. **새 웹폰트를 받지 않는다** — 이 제품은 이미
     첫 면접 전에 3.1GB를 받으라고 한다 (2026-11-07) */
  --font-read:
    'Pretendard Variable', Pretendard, -apple-system, 'Apple SD Gothic Neo', 'Noto Sans KR',
    'Malgun Gothic', sans-serif;
  --lh-read: 1.8;
```

`--content-w` 옆에 더한다:

```css
  /* 카드 사이 여백. 카드 안쪽 둘레(20)보다 넓어야 한 장으로 읽힌다 */
  --gap-card: 32px;
```

- [ ] **Step 4: `--topbar-h` 재정의를 지운다**

파일 끝의 블록 전체를 지운다:

```css
/* 좁은 화면에서는 전역 상단바가 두 줄로 접힌다(로그인·관리자면 항목이 다섯이다).
   접힌 높이까지 비켜 주지 않으면 아래 화면의 머리글과 글자가 포개진다 */
@media (max-width: 720px) {
  :root {
    --topbar-h: 96px;
  }
}
```

그리고 `--topbar-h` 선언 위 주석에서 접힘 이야기를 뺀다:

```css
  /* 화면 맨 위를 가로지르는 전역 상단바가 차지하는 띠. 그 바는 fixed라 아래 화면의
     자리를 비켜 주지 않는다 — 제 글을 윗줄에 두는 화면은 이만큼 내려와야 한다.
     **모든 폭에서 같은 값이다** — 좁아지면 글자를 떼고 한 줄을 지킨다 (Task 4) */
  --topbar-h: 64px;
```

- [ ] **Step 5: 테스트 통과**

Run: `pnpm test -- tokens.test`
Expected: PASS

- [ ] **Step 6: 전체 테스트**

Run: `pnpm test`
Expected: PASS. 아직 좁은 화면에서 바가 접히지만(Task 4에서 고친다), 테스트가 그것을 보지는 않는다.

- [ ] **Step 7: 커밋**

```bash
git add frontend/src/styles/tokens.css frontend/src/styles/tokens.test.ts
git commit -m "style(frontend): 읽는 글 토큰 셋 추가 · 상단바 높이를 64px로 고정"
```

---

### Task 2: 긴 글을 읽는 글꼴로

**Files:**
- Modify: `frontend/src/components/account/TermsModal.vue`
- Modify: `frontend/src/views/PrepareView.vue` (벤 고지·목소리 동의 문구)
- Test: `frontend/src/components/account/TermsModal.test.ts` (없으면 만든다)

**Interfaces:**
- Consumes: Task 1의 `--font-read`, `--lh-read`
- Produces: 없음

- [ ] **Step 1: 실패하는 테스트**

```ts
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import TermsModal from './TermsModal.vue'

describe('TermsModal', () => {
  it('약관 본문은 읽는 글꼴과 줄간을 쓴다 — 픽셀 글꼴로 긴 글을 읽히지 않는다', () => {
    const style = TermsModal.__file
      ? ''
      : ''
    // 스타일은 scoped라 DOM에서 못 본다. 소스에서 본다
    const src = readFileSync(join(__dirname, 'TermsModal.vue'), 'utf8')
    expect(src).toMatch(/font-family:\s*var\(--font-read\)/)
    expect(src).toMatch(/line-height:\s*var\(--lh-read\)/)
    expect(mount(TermsModal, { props: { open: true, kind: 'service' } }).exists()).toBe(true)
  })
})
```

> 위 테스트에서 `style` 변수는 쓰지 않는다 — 지우고 `readFileSync`·`join` import만 남긴다. 파일 상단에 `import { readFileSync } from 'node:fs'`, `import { join } from 'node:path'`를 더한다. `props`는 `TermsModal.vue`의 실제 props에 맞춘다(열어 보고 이름을 맞출 것).

- [ ] **Step 2: 실패 확인**

Run: `pnpm test -- TermsModal`
Expected: FAIL — `.line`이 아직 `font-size: var(--fs-meta)`에 `line-height: 1.8` 리터럴이다.

- [ ] **Step 3: 약관 본문을 고친다**

`TermsModal.vue`의 scoped 스타일:

```css
.line {
  margin: 0;
  font-size: var(--fs-meta);
  color: var(--text-2);
  line-height: 1.8;
  word-break: keep-all;
}
```
→
```css
/* 긴 글은 산세로. 픽셀 글꼴은 로고·제목·버튼·숫자가 맡는다 (2026-11-07) */
.line {
  margin: 0;
  font-family: var(--font-read);
  font-size: var(--fs-body-sm);
  color: var(--text-2);
  line-height: var(--lh-read);
  word-break: keep-all;
}
```

글자 크기를 `--fs-meta`(13px) → `--fs-body-sm`(15px)로 올린다. 산세는 같은 px에서 픽셀 글꼴보다 작아 보인다.

- [ ] **Step 4: 벤 고지와 동의 문구**

`PrepareView.vue`의 scoped 스타일에서 `.notice`와 `.voice-consent`에 같은 둘을 더한다:

```css
  font-family: var(--font-read);
  line-height: var(--lh-read);
```

**문구 자체는 한 글자도 바꾸지 않는다** — 운영에 나가 있는 동의 문장이다(루트 `CLAUDE.md` 8번).

- [ ] **Step 5: 테스트 통과**

Run: `pnpm test -- TermsModal`
Expected: PASS

- [ ] **Step 6: 눈으로**

Run: `pnpm dev --port 5411 --strictPort`
가입 화면에서 약관 [보기]를 연다.
Expected: 본문이 산세로 나오고 줄 사이가 넓다. 모달 제목과 버튼은 **여전히 픽셀 글꼴**이다.

- [ ] **Step 7: 전체 테스트 + 커밋**

```bash
pnpm test
git add frontend/src/components/account/TermsModal.vue frontend/src/components/account/TermsModal.test.ts frontend/src/views/PrepareView.vue
git commit -m "style(frontend): 약관·동의 문구를 읽는 글꼴로 — 긴 글만 산세로"
```

---

### Task 3: 티켓 픽셀 아이콘과 관리자 링크 이사

**Files:**
- Create: `frontend/src/components/ui/icons/TicketIcon.vue`
- Modify: `frontend/src/components/TopBar.vue` (이모지 → 아이콘, 관리자 링크 제거)
- Modify: `frontend/src/components/account/MeModal.vue` (관리자 링크 추가)
- Test: `frontend/src/components/TopBar.test.ts`, `frontend/src/components/account/MeModal.test.ts`

**Interfaces:**
- Produces: `TicketIcon` — props 없음. `currentColor`로 그린다

- [ ] **Step 1: 실패하는 테스트**

`TopBar.test.ts`에 더한다:

```ts
it('티켓은 이모지가 아니라 픽셀 아이콘으로 그린다 — 기종마다 모양이 달라진다', () => {
  const w = mountSignedIn()
  const tickets = w.find('[data-test=top-tickets]')
  expect(tickets.text()).not.toContain('🎟')
  expect(tickets.find('svg').exists()).toBe(true)
})

it('관리자 링크는 상단바에 두지 않는다 — 쓰는 사람이 둘뿐이다', () => {
  const w = mountSignedIn({ isAdmin: true })
  expect(w.find('[data-test=top-admin]').exists()).toBe(false)
})
```

`MeModal.test.ts`에 더한다:

```ts
it('관리자는 내정보에서 관리자 화면으로 간다', () => {
  const w = mountAdmin()
  expect(w.find('[data-test=me-admin]').attributes('href')).toBe('/admin')
})

it('관리자가 아니면 그 링크가 없다', () => {
  expect(mountSignedIn().find('[data-test=me-admin]').exists()).toBe(false)
})
```

> `mountSignedIn`·`mountAdmin`은 각 테스트 파일의 기존 마운트 방식을 따른다. `isAdmin`은 `account.session.isAdmin`으로 넣는다.

- [ ] **Step 2: 실패 확인**

Run: `pnpm test -- TopBar MeModal`
Expected: FAIL 4건.

- [ ] **Step 3: 아이콘을 만든다**

`frontend/src/components/ui/icons/TicketIcon.vue`:

```vue
<script setup lang="ts">
/** 티켓 한 장. 기존 아이콘들과 같이 currentColor로 그리고 shape-rendering을 각지게 둔다 */
</script>

<template>
  <svg
    width="15"
    height="15"
    viewBox="0 0 15 15"
    fill="none"
    stroke="currentColor"
    stroke-width="1"
    shape-rendering="crispEdges"
    aria-hidden="true"
  >
    <path d="M1 4h13v2h-1v1h1v2h-1v1h1v2H1v-2h1v-1H1V7h1V6H1V4z" />
    <path d="M9 4v2M9 8v2M9 12v0" />
  </svg>
</template>
```

> `frontend/src/components/ui/icons/` 안의 기존 아이콘(`CursorIcon.vue`, `DocIcon.vue`)을 먼저 열어 **같은 작성 방식**(크기·stroke·`aria-hidden`)을 따른다.

- [ ] **Step 4: `TopBar.vue`에서 이모지를 바꾼다**

```vue
          <span aria-hidden="true">🎟</span> {{ account.tickets }}
```
→
```vue
          <TicketIcon /> {{ account.tickets }}
```

`<script setup>`에 `import TicketIcon from '@/components/ui/icons/TicketIcon.vue'`를 더한다.

- [ ] **Step 5: 관리자 링크를 뗀다**

`TopBar.vue`에서 지운다:

```vue
      <a
        v-else-if="account.session?.isAdmin"
        href="/admin"
        class="mono link press"
        data-test="top-admin"
        >관리자</a
      >
```

`onAdmin`일 때의 "모모로" 링크는 **남긴다** — 관리자 화면에서 돌아오는 유일한 길이다.

- [ ] **Step 6: `MeModal.vue`에 관리자 링크를 넣는다**

계정 구역 맨 아래(로그아웃 줄 옆)에 더한다:

```vue
      <a
        v-if="account.session?.isAdmin"
        href="/admin"
        class="mono link press"
        data-test="me-admin"
        >관리자 화면</a
      >
```

- [ ] **Step 7: 테스트 통과**

Run: `pnpm test -- TopBar MeModal`
Expected: PASS

- [ ] **Step 8: 전체 테스트 + 커밋**

```bash
pnpm test
git add frontend/src/components/ui/icons/TicketIcon.vue frontend/src/components/TopBar.vue frontend/src/components/TopBar.test.ts frontend/src/components/account/MeModal.vue frontend/src/components/account/MeModal.test.ts
git commit -m "feat(frontend): 티켓 픽셀 아이콘 · 관리자 링크를 내정보로"
```

---

### Task 4: 상단 바 배열과 좁은 화면

**Files:**
- Modify: `frontend/src/components/TopBar.vue`
- Test: `frontend/src/components/TopBar.test.ts`

**Interfaces:**
- Consumes: Task 1의 `--topbar-h`(64 고정), Task 3의 `TicketIcon`
- Produces: 왼쪽 묶음(워드마크 + 단계)은 `.docked`일 때만 보인다 — Task 5가 그 클래스를 붙인다

- [ ] **Step 1: 실패하는 테스트**

```ts
it('상태(프리미엄·티켓)와 이동(보관함·내정보)을 세로줄로 가른다', () => {
  const w = mountSignedIn()
  const order = w
    .findAll('[data-test^=top-]')
    .map((n) => n.attributes('data-test'))
  expect(order.indexOf('top-premium')).toBeLessThan(order.indexOf('top-archive'))
  expect(order.indexOf('top-tickets')).toBeLessThan(order.indexOf('top-archive'))
  expect(w.find('[data-test=top-divider]').exists()).toBe(true)
})

it('좁은 화면에서 이동 버튼의 글자를 떼고 그림만 남긴다 — 이름은 낭독기에 남는다', () => {
  const w = mountSignedIn()
  for (const t of ['top-archive', 'top-me']) {
    const b = w.find(`[data-test=${t}]`)
    expect(b.attributes('aria-label')).toBeTruthy()
    expect(b.find('svg').exists()).toBe(true)
  }
})

it('왼쪽 묶음은 판이 깔렸을 때만 보인다 — 맨 위에서는 히어로의 큰 이름이 대신한다', () => {
  const w = mountSignedIn()
  expect(w.find('[data-test=top-brand]').exists()).toBe(false)
  w.find('[data-test=topbar]').element.classList.add('docked')
  expect(w.vm.$el.querySelector('[data-test=top-brand]')).toBeNull()
})
```

> 세 번째 테스트는 클래스를 직접 붙여도 Vue가 다시 그리지 않으므로 그대로는 뜻이 없다. **Task 5에서 `docked` 상태를 ref로 만든 뒤** 그 ref를 통해 다시 쓴다. 이 Task에서는 왼쪽 묶음을 `v-if="docked"`로 두고 `docked`를 `ref(false)`로 선언만 해 둔 뒤, 세 번째 테스트는 "맨 위에서는 안 보인다"까지만 단언한다:

```ts
it('왼쪽 묶음은 맨 위에서 보이지 않는다 — 히어로의 큰 이름이 대신한다', () => {
  expect(mountSignedIn().find('[data-test=top-brand]').exists()).toBe(false)
})
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm test -- TopBar`
Expected: FAIL — `top-divider`가 없고, 이동 버튼에 `aria-label`·`svg`가 없다.

- [ ] **Step 3: 배열을 고친다**

`TopBar.vue`의 `.side` 안을 이 순서로 바꾼다.

1. 왼쪽 묶음 — `<div class="brand" v-if="docked" data-test="top-brand">`: 노란 네모 + `모두의 모의면접` + 세로줄 + 현재 단계(`interview.phase` 한글 이름).
2. 오른쪽 묶음 — 프리미엄 램프, 티켓(`TicketIcon` + 수), `<span class="divider" data-test="top-divider" />`, 보관함, 내정보.

`header`를 `justify-content: space-between`으로 바꾸고, 왼쪽 묶음이 없을 때도 오른쪽이 끝에 붙도록 왼쪽 자리에 빈 `<div>`를 둔다.

`const docked = ref(false)`를 선언해 둔다(Task 5에서 채운다).

- [ ] **Step 4: 간격을 벌린다**

```css
.side {
  gap: var(--sp-5); /* 20px */
}
.topbar {
  padding: var(--sp-3) var(--sp-6);
}
```
→
```css
.side {
  gap: var(--sp-5);
}
.topbar {
  padding: var(--sp-3) calc(var(--sp-6) + var(--sp-1)); /* 26px */
}
```

`.link`의 `padding: var(--sp-2)`는 그대로 둔다 — 누를 자리다.

- [ ] **Step 5: 좁은 화면에서 글자를 뗀다**

보관함·내정보를 `<svg> + <span class="label">글자</span>` 구조로 바꾸고, 버튼에 `aria-label`을 단다. 스타일:

```css
@media (max-width: 720px) {
  .link .label {
    /* 글자만 숨긴다 — 이름은 aria-label로 남아 낭독기가 읽는다 */
    display: none;
  }
}
```

아이콘은 `ui/icons/`에 두 개를 더 만든다(`ArchiveIcon.vue`, `MeIcon.vue`). `TicketIcon`과 같은 작성 방식을 따른다.

- [ ] **Step 6: 테스트 통과**

Run: `pnpm test -- TopBar`
Expected: PASS

- [ ] **Step 7: 눈으로**

`pnpm dev`로 띄우고 창 폭을 1440 → 390px로 줄인다.
Expected: 바가 **한 줄을 유지**한다. 720px 아래에서 보관함·내정보가 그림만 남는다.

- [ ] **Step 8: 전체 테스트 + 커밋**

```bash
pnpm test
git add frontend/src/components/TopBar.vue frontend/src/components/TopBar.test.ts frontend/src/components/ui/icons/
git commit -m "feat(frontend): 상단바를 상태·이동 두 묶음으로 · 좁은 화면은 그림만"
```

---

### Task 5: 떠 있음 ↔ 판 깔림

**Files:**
- Modify: `frontend/src/components/TopBar.vue`
- Test: `frontend/src/components/TopBar.test.ts`

**Interfaces:**
- Consumes: Task 4의 `docked` ref와 `top-brand`
- Produces: `.topbar.docked` — `--dock` 배경 + 아래 1px 선. 두 상태 모두 높이 `--topbar-h`

- [ ] **Step 1: 실패하는 테스트**

```ts
it('맨 위에서는 판도 선도 없다 — 별 위에 글자만 떠 있다', () => {
  const w = mountSignedIn()
  expect(w.find('[data-test=topbar]').classes()).not.toContain('docked')
})

it('센티넬이 화면에서 벗어나면 판을 깐다 — scrollTop을 읽지 않는다', async () => {
  let cb: (e: IntersectionObserverEntry[]) => void = () => {}
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(fn: typeof cb) {
        cb = fn
      }
      observe() {}
      disconnect() {}
    },
  )
  const w = mountSignedIn()
  cb([{ isIntersecting: false } as IntersectionObserverEntry])
  await w.vm.$nextTick()
  expect(w.find('[data-test=topbar]').classes()).toContain('docked')
  expect(w.find('[data-test=top-brand]').exists()).toBe(true)
  vi.unstubAllGlobals()
})
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm test -- TopBar`
Expected: FAIL — `docked`가 영영 `false`다.

- [ ] **Step 3: 센티넬과 관찰자**

`TopBar.vue` 템플릿을 두 루트로 만든다 — 센티넬이 **고정이 아닌 보통 흐름**에 있어야 한다:

```vue
  <!-- 문서 맨 위의 자리지기. 이만큼 내려가면 바가 내용을 덮기 시작하므로 판을 깐다.
       scrollTop을 읽지 않는다 — 1번 철거에서 못 박은 원칙 -->
  <div ref="sentinel" class="sentinel" aria-hidden="true" />

  <header v-if="shown" class="topbar" :class="{ docked }" data-test="topbar">
```

```ts
const sentinel = ref<HTMLElement | null>(null)
const docked = ref(false)
let io: IntersectionObserver | null = null
onMounted(() => {
  if (!sentinel.value || typeof IntersectionObserver === 'undefined') return
  io = new IntersectionObserver(([e]) => (docked.value = !e.isIntersecting))
  io.observe(sentinel.value)
})
onBeforeUnmount(() => io?.disconnect())
```

```css
.sentinel {
  height: var(--topbar-h);
  pointer-events: none;
}
```

- [ ] **Step 4: 두 상태의 모양**

```css
.topbar {
  /* 기본은 떠 있다 — 판도 선도 없다. 글자는 제 하드 그림자로 읽힌다 */
  background: none;
}
.topbar .link,
.topbar .tickets,
.topbar .premium {
  text-shadow: 1px 1px 0 var(--ink);
}
.topbar.docked {
  background: var(--dock);
  border-bottom: 1px solid var(--raise);
  box-shadow: inset 0 -1px 0 rgb(236 238 255 / 6%);
}
.topbar.docked .link,
.topbar.docked .tickets,
.topbar.docked .premium {
  text-shadow: none;
}
```

> `rgb(... / 6%)`는 색 리터럴이다. 루트 규약은 색을 `tokens.css`에만 두라고 한다 — **토큰으로 뺀다**: `tokens.css`에 `--edge-hi: rgb(236 238 255 / 6%);`를 더하고 여기서 `var(--edge-hi)`를 쓴다.

- [ ] **Step 5: 센티넬이 레이아웃을 밀지 않는지**

`--topbar-h`만큼 자리를 먹는 요소가 문서 맨 위에 생긴다. 지금 화면들은 이미 `--topbar-h`만큼 비켜 서 있으므로 **그 비킴을 걷어내야** 두 번 밀리지 않는다.

Run: `grep -rn "topbar-h" frontend/src --include=*.vue`
각 화면에서 `padding-top: var(--topbar-h)` 류를 찾아 지운다. 센티넬이 그 일을 대신한다.

- [ ] **Step 6: 테스트 통과**

Run: `pnpm test -- TopBar`
Expected: PASS

- [ ] **Step 7: 눈으로 — Review Focus 전부**

```bash
pnpm dev --port 5411 --strictPort
```

| 확인 | 기대 |
|---|---|
| 랜딩 맨 위 | 바에 배경·테두리 없음. 글자가 별 위에서 읽힌다 |
| 조금 스크롤 | 판이 깔리고 왼쪽에 이름이 들어온다. **아래 내용이 안 밀린다** |
| 1440 → 390px | 한 줄 유지, 720px 아래에서 그림만 |
| 면접 화면 | 바가 숨는다 |

- [ ] **Step 8: 게이트 전부**

```bash
cd frontend
pnpm test && pnpm lint && pnpm exec prettier --check src && pnpm exec vue-tsc --noEmit && pnpm build
grep -rn "border-radius" src | grep -v "\.test\."   # 0건이어야 한다
```

- [ ] **Step 9: 커밋**

```bash
git add frontend/src/components/TopBar.vue frontend/src/components/TopBar.test.ts frontend/src/styles/tokens.css frontend/src/views
git commit -m "feat(frontend): 상단바 두 상태 — 맨 위는 떠 있고, 내려가면 판이 깔린다"
```

---

## 끝낸 뒤

1. `feature/modern-retro-shell` → `dev` PR
2. Squash merge → demomo 재배포(2분) → **Review Focus 다섯 가지를 눈으로**
3. 정상이면 `dev → main` PR을 **merge commit**으로
4. 다음 plan: `2026-11-07-prepare-layout-design.md`의 plan
