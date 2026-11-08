# 보관함 상세 버그 수정과 이력서 파일 채우기 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 보관함 상세에서 목차를 누르면 화면이 닫히던 것과 "← 보관함으로"가 목록으로 돌아가지 않던 것을 고치고, 상세 폭을 넓히며, 내정보의 이력서 칸을 PDF로도 채울 수 있게 한다.

**Architecture:** 해시 네비게이션을 쓰지 않는 앵커 이동 헬퍼 하나(`utils/anchorScroll.ts`)를 만들어 목차와 총평 참조 링크가 같이 쓴다. 돌아가는 길은 `App.vue`의 핸들러 한 곳으로 모은다. 이력서 파일 읽기는 새 컴포넌트(`ResumeFileDrop.vue`)로 떼어 내정보 편집기가 쓴다.

**Tech Stack:** Vue 3 + TS + Pinia, Vitest + @vue/test-utils

**Spec:** 없음(버그 수정). 바탕이 되는 설계는 `docs/specs/frontend/2026-11-07-account-archive-layout-design.md` — 상세를 화면으로 꺼낸 그 문서다. 4번(이력서 파일 채우기)은 기존 기능(이력서 슬롯 저장)에 **입력 경로 하나를 더하는 것**이라 spec을 새로 쓰지 않는다. 계약·개인정보 범위 변화 없음: PDF는 지금도 브라우저 안에서만 읽고, 저장되는 것은 이미 동의받은 이력서 슬롯의 **글**뿐이다.

## 진단 (이미 재현함, 2026-11-08)

| # | 증상 | 뿌리 |
|---|---|---|
| 1 | 목차 `Q1`·`Q2`를 누르면 상세 화면이 **닫힌다** | **해시 링크 클릭이 `popstate`를 쏜다**(`state: null`). `App.vue`의 `onPop`이 그것을 가리지 않고 `archive.close()`를 부른다. 콘솔에서 `<a href="#probe">`를 클릭해 `popstate` → `hashchange` 순서로 발생하는 것을 확인했다 |
| 2 | `← 보관함으로`가 목록이 아니라 **이전 페이지**로 간다 | `@back="archive.close()"`가 상세만 닫는다. 보관함 모달을 다시 열지 않고, 상세를 열 때 민 히스토리 항목도 되감지 않아 그 자리에 남는다 |
| 3 | 상세 폭이 좁다 | `.report`가 `--content-w`(1040px)를 쓴다. 준비 화면은 2026-11-08에 1280px로 넓혔는데 상세는 그대로다 |
| 4 | 내정보의 이력서를 **손으로만** 쓸 수 있다 | `ResumeSlotEditor`에 제목·본문 두 칸뿐이다. 준비 화면에는 PDF 올리기·끌어다 놓기가 있는데 그 길이 여기엔 없다 |

## Global Constraints

- **색 토큰을 새로 만들지 않는다.** 글꼴 토큰도 마찬가지 — 픽셀 글꼴은 `.mono` 클래스로 쓴다.
- **`border-radius`를 쓰지 않는다.**
- **부드러운 스크롤을 쓰지 않는다**(`behavior: 'smooth'` 금지). 16문항 거리에서 멀미가 난다 — 1번 spec에서 못 박은 것이다.
- **`scrollTop`을 읽지 않는다.** 위치를 재는 일은 `IntersectionObserver`가 한다.
- 미디어쿼리는 **창**을 보고 컨테이너는 **칸**이다. 칸 폭에 따라 달라져야 하는 것은 `@container`로 쓴다(2026-11-08 면접관 고르기에서 터진 함정).
- **`.press`를 기본 그림자 없는 요소에 붙이지 않는다.**
- 계약 변경 없음. **PDF는 브라우저를 떠나지 않는다** — `extractPdfText`는 지금도 로컬에서 읽고, 서버로 가는 것은 사용자가 저장을 누른 이력서 슬롯의 글뿐이다(루트 `CLAUDE.md` "절대 하지 말 것" 8번).
- 프론트 게이트: `pnpm test && pnpm lint && pnpm exec prettier --check src && pnpm exec vue-tsc --noEmit && pnpm build`

## Review Focus

테스트가 짚지 않는, 사람이 실제로 밟을 길 다섯.

1. **총평의 문항 참조(`q1` `q2`)를 누를 때** — 레일 목차만 고치면 `ReportV2Cards`의 `#item-Q1` 링크가 같은 병으로 남는다. 벤 리포트에서만 보이는 길이다. (Task 1 Step 6)
2. **리포트 화면의 목차** — 거기엔 `popstate` 리스너가 없어 지금은 멀쩡하다. 같은 헬퍼로 바꾸면서 앵커 이동이 **여전히 동작하는지** 봐야 한다. (Task 1 Step 7)
3. **상세에서 지우고 난 뒤** — 지우면 목록으로 돌아가야 하고, 히스토리 항목도 같이 되감겨야 한다. (Task 2 Step 5)
4. **PDF에서 글자를 못 뽑았을 때**(스캔 이미지 PDF) — 빈 글이 조용히 저장되면 안 된다. (Task 4 Step 5)
5. **제목을 이미 써 둔 칸에 파일을 떨어뜨릴 때** — 써 둔 제목을 파일명으로 덮으면 안 된다. (Task 4 Step 5)

---

## 파일 구조

| 파일 | 몫 |
|---|---|
| `src/utils/anchorScroll.ts` | **새로.** 해시를 건드리지 않고 id로 굴러가는 한 줄짜리 헬퍼 |
| `src/components/account/ResumeFileDrop.vue` | **새로.** PDF 하나를 받아 `{ name, text }`를 올린다 |
| `src/components/report/ReportRail.vue` | 목차 링크가 헬퍼를 쓴다 |
| `src/components/report/ReportV2Cards.vue` | 총평의 문항 참조 링크도 같이 |
| `src/App.vue` | 돌아가는 길 한 곳 + `popstate` 가리기 |
| `src/views/ArchiveDetailView.vue` | 폭 |
| `src/components/account/ResumeSlotEditor.vue` | 파일로 채우기 |

---

### Task 1: 목차를 눌러도 화면이 닫히지 않는다

**Files:**
- Create: `frontend/src/utils/anchorScroll.ts`, `frontend/src/utils/anchorScroll.test.ts`
- Modify: `frontend/src/components/report/ReportRail.vue`, `ReportV2Cards.vue`, `frontend/src/App.vue`
- Test: `ReportRail.test.ts`, `ReportV2Cards.test.ts`, `ArchiveDetailView.test.ts`

**Interfaces:**
- Produces: `scrollToId(id: string): boolean` — 그 id의 요소로 굴러간다. 찾으면 `true`

- [x] **Step 1: 실패하는 테스트 — `anchorScroll.test.ts`**

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { scrollToId } from './anchorScroll'

beforeEach(() => {
  document.body.innerHTML = ''
  location.hash = ''
})

describe('scrollToId', () => {
  it('그 id로 굴러간다', () => {
    const el = document.createElement('div')
    el.id = 'q3'
    const into = vi.fn()
    el.scrollIntoView = into
    document.body.appendChild(el)
    expect(scrollToId('q3')).toBe(true)
    expect(into).toHaveBeenCalled()
  })

  it('해시를 바꾸지 않는다 — 해시 이동은 popstate를 쏘고, 그 자리에 화면을 닫는 리스너가 있다', () => {
    const el = document.createElement('div')
    el.id = 'q3'
    el.scrollIntoView = vi.fn()
    document.body.appendChild(el)
    scrollToId('q3')
    expect(location.hash).toBe('')
  })

  it('부드러운 스크롤을 쓰지 않는다 — 16문항 거리에서 멀미가 난다', () => {
    const el = document.createElement('div')
    el.id = 'q3'
    const into = vi.fn()
    el.scrollIntoView = into
    document.body.appendChild(el)
    scrollToId('q3')
    const arg = into.mock.calls[0][0]
    expect(arg?.behavior === undefined || arg.behavior !== 'smooth').toBe(true)
  })

  it('없는 id면 false를 돌려주고 아무 일도 하지 않는다', () => {
    expect(scrollToId('없다')).toBe(false)
  })
})
```

- [x] **Step 2: 실패 확인**

Run: `pnpm exec vitest run src/utils/anchorScroll.test.ts`
Expected: FAIL — 모듈이 없다

- [x] **Step 3: `utils/anchorScroll.ts`**

```ts
/** 해시를 건드리지 않고 문서 안의 id로 굴러간다 (2026-11-08).
 *
 * `<a href="#q3">`를 그냥 두면 브라우저가 **fragment navigation**을 하고, 그것이
 * `popstate`를 쏜다(`state: null`). 보관함 상세는 `popstate`를 듣고 화면을 닫으므로,
 * 목차를 누를 때마다 화면이 통째로 닫혔다.
 *
 * 링크는 `<a href>` 그대로 둔다 — Tab 차례·우클릭·새 탭으로 열기가 거저 따라온다.
 * 클릭만 가로채 직접 굴린다. 부드러운 스크롤은 쓰지 않는다(1번 철거 원칙).
 * 상단바를 피하는 일은 `html { scroll-padding-top }`이 맡는다.
 */
export function scrollToId(id: string): boolean {
  const el = document.getElementById(id)
  if (!el) return false
  el.scrollIntoView({ block: 'start' })
  return true
}
```

- [x] **Step 4: 통과 확인**

Run: `pnpm exec vitest run src/utils/anchorScroll.test.ts`
Expected: PASS 4/4

- [x] **Step 5: 레일 목차가 헬퍼를 쓴다 — 실패하는 테스트**

`ReportRail.test.ts`에 더한다:

```ts
it('목차를 눌러도 해시가 바뀌지 않는다 — 해시 이동은 보관함 상세를 닫는다', async () => {
  const w = rail()
  const card = document.createElement('div')
  card.id = 'q1'
  card.scrollIntoView = vi.fn()
  document.body.appendChild(card)
  const before = location.hash
  await w.get('[data-test=toc-item]').trigger('click')
  expect(location.hash).toBe(before)
  expect(card.scrollIntoView).toHaveBeenCalled()
  card.remove()
})

it('링크는 여전히 진짜 href다 — Tab 차례와 우클릭이 거저 따라온다', () => {
  expect(rail().get('[data-test=toc-item]').attributes('href')).toBe('#q1')
})
```

- [x] **Step 6: 실패 확인 → 구현**

Run: `pnpm exec vitest run src/components/report/ReportRail.test.ts`
Expected: FAIL — 해시가 `#q1`로 바뀐다

`ReportRail.vue`의 목차 `<a>`에 핸들러를 단다. `href`는 그대로 둔다:

```vue
<a
  class="row"
  :class="{ follow: it.follow, read: read.has(it.id), on: current === it.id }"
  :href="`#${it.id}`"
  :aria-current="current === it.id ? 'true' : undefined"
  data-test="toc-item"
  @click.prevent="scrollToId(it.id)"
>
```

같은 Step에서 `ReportV2Cards.vue`의 총평 문항 참조 링크 **둘**(강점·개선점)도 바꾼다 — 같은 병이다:

```vue
<a v-for="r in p.refs" :key="r" :href="`#item-${r}`" @click.prevent="scrollToId(`item-${r}`)">
  {{ r }}
</a>
```

`ReportV2Cards.test.ts`에도 한 줄 건다:

```ts
it('총평의 문항 참조도 해시를 바꾸지 않는다 — 레일만 고치면 벤 리포트에서 같은 병이 남는다', () => {
  expect(src).toMatch(/href="#item-.*@click\.prevent/s)
})
```

- [x] **Step 7: `popstate`도 단단하게 — 실패하는 테스트**

`src/App.test.ts`가 이미 있다(주소 분기 테스트 둘). 거기에 더한다 — 그 파일은 `fetch`를 막아 두고 `afterEach`로 히스토리를 되돌리므로, 새 테스트도 그 틀을 그대로 쓴다:

```ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const src = readFileSync(join(__dirname, 'App.vue'), 'utf8')

describe('App — 보관함 상세의 뒤로 가기', () => {
  it('상세를 열며 민 항목에서 빠져나올 때만 닫는다 — 해시 이동의 popstate에 닫히면 안 된다', () => {
    expect(src).toMatch(/momoArchive/)
  })
})
```

- [x] **Step 8: 실패 확인 → 구현**

`App.vue`의 `onPop`이 **상세 항목을 빠져나온 경우만** 닫는다:

```ts
/* 해시 이동도 popstate를 쏜다(state: null). 목차는 이제 해시를 쓰지 않지만,
   남이 붙인 앵커 링크 하나에 화면이 닫히는 일이 다시 없도록 state로 가린다:
   상세를 열며 민 항목에는 momoArchive가 있고, 그 항목을 빠져나오면 없다 */
function onPop(e: PopStateEvent) {
  if (archive.detail && !(e.state as { momoArchive?: string } | null)?.momoArchive) archive.close()
}
```

- [x] **Step 9: 게이트 + 커밋**

```bash
cd frontend && pnpm test && pnpm lint && pnpm exec prettier --check src && pnpm exec vue-tsc --noEmit
git add frontend/src && git commit -m "fix(frontend): 목차를 눌러도 보관함 상세가 닫히지 않는다"
```

---

### Task 2: "← 보관함으로"가 목록으로 돌아간다

**Files:**
- Modify: `frontend/src/App.vue`
- Test: `frontend/src/App.test.ts`

**Interfaces:**
- Consumes: `useArchiveViewStore()`, `useModalStore()`, `useAccountStore().deleteArchive`
- Produces: 없음

- [x] **Step 1: 실패하는 테스트**

`App.test.ts`에 마운트 테스트를 더한다. `App.vue`는 화면을 다 끌고 오므로 자식을 stub한다. 그 파일에 이미 있는 `mount`·`createPinia` import와 `fetch` 스텁을 그대로 쓰고, 핀을 테스트마다 새로 꽂는다(`setActivePinia`를 import에 더한다):

```ts
import { useArchiveViewStore } from '@/stores/archiveView'
import { useModalStore } from '@/stores/modal'

const detail = { id: 'a1', report: [], messages: [], recordings: [] }
const app = () =>
  mount(App, { global: { stubs: { ArchiveDetailView: true, TopBar: true, HintBar: true } } })

describe('App — 보관함으로 돌아가기', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('상세를 닫으면 보관함 목록이 다시 열린다 — 이전 페이지로 나가지 않는다', async () => {
    const av = useArchiveViewStore()
    av.$patch({ detail: detail as never })
    const w = app()
    await w.findComponent({ name: 'ArchiveDetailView' }).vm.$emit('back')
    expect(av.detail).toBe(null)
    expect(useModalStore().open).toBe('archive')
  })

  it('상세를 열며 민 히스토리 항목을 되감는다 — 안 그러면 뒤로 가기가 한 번 헛돈다', async () => {
    const back = vi.spyOn(history, 'back').mockImplementation(() => {})
    history.pushState({ momoArchive: 'a1' }, '')
    useArchiveViewStore().$patch({ detail: detail as never })
    const w = app()
    await w.findComponent({ name: 'ArchiveDetailView' }).vm.$emit('back')
    expect(back).toHaveBeenCalled()
    back.mockRestore()
  })

  it('지우고 나서도 목록으로 돌아간다', async () => {
    const av = useArchiveViewStore()
    av.$patch({ detail: detail as never })
    const w = app()
    await w.findComponent({ name: 'ArchiveDetailView' }).vm.$emit('remove')
    expect(av.detail).toBe(null)
    expect(useModalStore().open).toBe('archive')
  })
})
```

- [x] **Step 2: 실패 확인**

Run: `pnpm exec vitest run src/App.test.ts`
Expected: FAIL — 모달이 열리지 않는다(`open`이 `null`)

- [x] **Step 3: 돌아가는 길을 한 곳으로**

```ts
/** 상세에서 목록으로. 셋을 같이 해야 한다 —
 *  ① 상세를 닫고 ② 보관함 모달을 다시 열고 ③ 상세를 열며 민 히스토리 항목을 되감는다.
 *  ③을 빼면 뒤로 가기가 한 번 헛돌고, ②를 빼면 사용자는 어디로 갔는지 모른다 */
function backToArchive() {
  archive.close()
  useModalStore().show('archive')
  if ((history.state as { momoArchive?: string } | null)?.momoArchive) history.back()
}

async function removeArchive() {
  const id = archive.detail?.id
  backToArchive()
  if (id) await useAccountStore().deleteArchive(id)
}
```

템플릿:

```vue
<ArchiveDetailView
  v-else-if="archive.detail"
  :entry="archive.detail"
  @back="backToArchive()"
  @remove="removeArchive()"
/>
```

> `history.back()`이 쏘는 `popstate`는 `onPop`에 닿지만, 그때 `archive.detail`은 이미 `null`이라 아무 일도 하지 않는다.

- [x] **Step 4: 통과 확인**

Run: `pnpm exec vitest run src/App.test.ts`
Expected: PASS 3/3

- [x] **Step 5: Review Focus 3 — 지우고 난 뒤**

Step 1의 세 번째 테스트가 이것이다. 통과하는지 확인한다.

- [x] **Step 6: 게이트 + 커밋**

```bash
cd frontend && pnpm test && pnpm lint && pnpm exec prettier --check src && pnpm exec vue-tsc --noEmit
git add frontend/src && git commit -m "fix(frontend): 보관함으로 버튼이 목록으로 돌아간다"
```

---

### Task 3: 상세 폭을 넓힌다

**Files:**
- Modify: `frontend/src/views/ArchiveDetailView.vue`
- Test: `frontend/src/views/ArchiveDetailView.test.ts`

- [x] **Step 1: 실패하는 테스트**

```ts
describe('ArchiveDetailView — 폭', () => {
  const src = readFileSync(join(__dirname, 'ArchiveDetailView.vue'), 'utf8')

  it('준비 화면과 같은 폭을 쓴다 — 레일 376px을 떼고 나면 본문에 남는 폭이 얼마 안 된다', () => {
    expect(src).toMatch(/max-width:\s*1280px/)
  })
})
```

- [x] **Step 2: 실패 확인 → 구현**

Run: `pnpm exec vitest run src/views/ArchiveDetailView.test.ts`
Expected: FAIL

```css
/* 준비 화면과 같은 폭(2026-11-08). 레일 376px을 떼고 나면 본문에 남는 폭이 얼마 안 된다 —
   리포트 화면은 --content-w(1040px) 그대로다: 거기는 --read-w가 본문을 어차피 묶는다 */
.report {
  max-width: 1280px;
  ...
}
```

> 리포트 화면(`ReportView`)은 **건드리지 않는다.** 보관함 상세는 대화 전문 탭이 있어 넓은 폭이 실제로 일하지만, 리포트는 읽는 화면이라 `--read-w`(68ch)가 본문 줄을 묶는다. 둘이 달라지는 것이 눈에 거슬리면 그때 함께 정한다.

- [x] **Step 3: 통과 확인 + 커밋**

```bash
pnpm exec vitest run src/views/ArchiveDetailView.test.ts
git add frontend/src && git commit -m "fix(frontend): 보관함 상세 폭을 준비 화면과 같게"
```

---

### Task 4: 내정보의 이력서를 PDF로도 채운다

**Files:**
- Create: `frontend/src/components/account/ResumeFileDrop.vue`, `ResumeFileDrop.test.ts`
- Modify: `frontend/src/components/account/ResumeSlotEditor.vue`
- Test: `frontend/src/components/account/MeModal.test.ts`

**Interfaces:**
- Consumes: `extractPdfText`(`services/pdf`), `DocIcon`
- Produces: `ResumeFileDrop` — `@read="{ name: string; text: string }"`를 올린다. 글자를 못 뽑으면 제 자리에서 말하고 올리지 않는다

- [x] **Step 1: 실패하는 테스트 — `ResumeFileDrop.test.ts`**

```ts
import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/services/pdf', () => ({ extractPdfText: vi.fn() }))
import { extractPdfText } from '@/services/pdf'
import ResumeFileDrop from './ResumeFileDrop.vue'

const pdf = (name = '이력서.pdf') => new File(['%PDF-1.4'], name, { type: 'application/pdf' })
const drop = () => mount(ResumeFileDrop)

beforeEach(() => vi.clearAllMocks())

describe('ResumeFileDrop', () => {
  it('PDF에서 뽑은 글을 올린다', async () => {
    vi.mocked(extractPdfText).mockResolvedValue('x'.repeat(200))
    const w = drop()
    await w.vm.$.exposed!.readFile(pdf())
    expect(w.emitted('read')![0][0]).toEqual({ name: '이력서.pdf', text: 'x'.repeat(200) })
  })

  it('글자를 못 뽑으면 올리지 않고 그 자리에서 말한다 — 빈 이력서가 조용히 저장되면 안 된다', async () => {
    vi.mocked(extractPdfText).mockResolvedValue('   ')
    const w = drop()
    await w.vm.$.exposed!.readFile(pdf())
    expect(w.emitted('read')).toBeFalsy()
    expect(w.get('[data-test=drop-error]').text()).toContain('글자')
  })

  it('읽다 실패해도 던지지 않는다 — 망가진 PDF가 있다', async () => {
    vi.mocked(extractPdfText).mockRejectedValue(new Error('broken'))
    const w = drop()
    await w.vm.$.exposed!.readFile(pdf())
    expect(w.emitted('read')).toBeFalsy()
    expect(w.find('[data-test=drop-error]').exists()).toBe(true)
  })

  it('PDF가 아니면 읽지 않는다', async () => {
    const w = drop()
    await w.vm.$.exposed!.readFile(new File(['x'], 'a.txt', { type: 'text/plain' }))
    expect(extractPdfText).not.toHaveBeenCalled()
    expect(w.get('[data-test=drop-error]').text()).toContain('PDF')
  })
})
```

- [x] **Step 2: 실패 확인**

Run: `pnpm exec vitest run src/components/account/ResumeFileDrop.test.ts`
Expected: FAIL — 파일이 없다

- [x] **Step 3: `ResumeFileDrop.vue`**

준비 화면의 드롭존과 같은 어법을 쓴다. 다만 **스토어를 건드리지 않는다** — 읽은 것을 올리기만 한다.

```vue
<script setup lang="ts">
/** PDF 하나를 받아 글을 뽑아 올린다 (2026-11-08).
 *
 * 준비 화면에도 같은 길이 있지만 그쪽은 면접 스토어에 바로 넣고 탭까지 옮긴다.
 * 여기는 **읽어서 올리기만** 한다 — 어디에 쓸지는 받는 쪽이 정한다.
 *
 * 파일은 브라우저를 떠나지 않는다. 서버로 가는 것은 사용자가 저장을 누른 글뿐이다.
 */
import { ref } from 'vue'
import { extractPdfText } from '@/services/pdf'
import DocIcon from '@/components/ui/icons/DocIcon.vue'

const emit = defineEmits<{ read: [{ name: string; text: string }] }>()
const busy = ref(false)
const error = ref('')
const dragging = ref(false)

const isPdf = (f: File) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name)

async function readFile(file: File) {
  error.value = ''
  if (!isPdf(file)) {
    error.value = 'PDF만 읽을 수 있습니다'
    return
  }
  busy.value = true
  try {
    const text = await extractPdfText(file)
    // 스캔한 이미지 PDF는 글자가 없다 — 빈 이력서가 조용히 저장되면 안 된다
    if (!text.trim()) {
      error.value = '글자를 찾지 못했습니다 — 아래에 직접 붙여넣어 주세요'
      return
    }
    emit('read', { name: file.name, text })
  } catch {
    error.value = '읽지 못했습니다 — 아래에 직접 붙여넣어 주세요'
  } finally {
    busy.value = false
  }
}
defineExpose({ readFile })

async function onPick(e: Event) {
  const input = e.target as HTMLInputElement
  const f = input.files?.[0]
  if (f) await readFile(f)
  input.value = '' // 같은 파일을 다시 골라도 change가 나게
}
async function onDrop(e: DragEvent) {
  dragging.value = false
  const f = e.dataTransfer?.files?.[0]
  if (f) await readFile(f)
}
</script>

<template>
  <div class="wrap">
    <!-- 숨긴 input에는 드롭이 닿지 않으므로 라벨이 받는다 -->
    <label
      class="row"
      :class="{ dragging }"
      data-test="slot-drop"
      @dragover.prevent="dragging = true"
      @dragleave="dragging = false"
      @drop.prevent="onDrop"
    >
      <DocIcon />
      <span class="mono name">PDF를 끌어다 놓거나 클릭해서 선택</span>
      <span class="mono pick">파일 선택</span>
      <input data-test="slot-file" type="file" accept="application/pdf" class="sr" @change="onPick" />
    </label>
    <p v-if="busy" class="mono hint">읽는 중…</p>
    <p v-if="error" class="mono err" data-test="drop-error">{{ error }}</p>
  </div>
</template>
```

스타일은 준비 화면의 `.file-row`를 본떠 이 컴포넌트의 `<style scoped>`에 쓴다. **파일 input을 숨기는 `.sr`도 같이 옮겨 적는다** — 그 클래스는 전역이 아니라 `PrepareView.vue`의 scoped 안에만 있어(`PrepareView.vue:1019`) 여기서는 상속되지 않는다. 옮겨 적는 것이 전역으로 끌어올리는 것보다 작다.

```css
/* 파일 input을 화면에서만 치운다 — display: none이면 키보드로 못 연다 */
.sr {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
}
```

- [x] **Step 4: 통과 확인**

Run: `pnpm exec vitest run src/components/account/ResumeFileDrop.test.ts`
Expected: PASS 4/4

- [x] **Step 5: 편집기가 쓴다 — 실패하는 테스트 (Review Focus 4·5)**

`MeModal.test.ts`에:

```ts
describe('MeModal — 이력서를 파일로 채우기 (2026-11-08)', () => {
  it('편집기에 PDF를 넣는 길이 있다 — 손으로만 쓰게 두지 않는다', async () => {
    modal()
    await settle()
    await click('slot-empty')
    expect(document.querySelector('[data-test=slot-drop]')).not.toBeNull()
  })

  it('읽은 글이 본문 칸에 들어간다', async () => {
    modal()
    await settle()
    await click('slot-empty')
    const ed = mountedEditor()
    ed.vm.$emit?.('read', { name: '내 이력서.pdf', text: '뽑아낸 글' })
    await settle()
    expect(q<HTMLTextAreaElement>('slot-text').value).toContain('뽑아낸 글')
  })

  it('제목이 비어 있을 때만 파일명으로 채운다 — 써 둔 제목을 덮지 않는다', async () => {
    // 제목을 먼저 쓴 뒤 파일을 넣으면 제목이 그대로다
  })
})
```

> 마운트한 자식에 이벤트를 쏘는 모양은 이 파일의 다른 테스트와 맞춰 쓴다(`modal()`이 `mount`를 돌려주므로 `findComponent({ name: 'ResumeFileDrop' }).vm.$emit('read', …)`가 가장 곧다).

- [x] **Step 6: 실패 확인 → `ResumeSlotEditor`에 끼운다**

```ts
function onRead({ name, text }: { name: string; text: string }) {
  body.value = text
  // 제목이 비었을 때만 파일명으로 채운다 — 써 둔 제목을 덮으면 안 된다
  if (!title.value.trim()) title.value = name.replace(/\.pdf$/i, '')
  error.value = ''
}
```

```vue
<ResumeFileDrop @read="onRead" />
<span class="mono or">또는 아래에 직접 쓰거나 붙여넣으세요</span>
```

드롭존을 제목 칸 **아래, 본문 칸 위**에 둔다 — 파일을 넣으면 제목과 본문이 함께 차므로 그 사이가 제 자리다.

- [x] **Step 7: 통과 확인**

Run: `pnpm exec vitest run src/components/account/`
Expected: PASS — 새 것 + 기존 전부

- [x] **Step 8: 게이트 전부 + 커밋**

```bash
cd frontend
pnpm test && pnpm lint && pnpm exec prettier --check src && pnpm exec vue-tsc --noEmit && pnpm build
git add frontend/src && git commit -m "feat(frontend): 내정보 이력서를 PDF로도 채운다"
```

---

### Task 5: 눈으로

**Files:** 없음(확인만)

- [x] **Step 1: 목차 (Review Focus 1·2)**

보관함 상세에서 목차 `Q1`~`Q5`를 차례로 누른다.
Expected: 화면이 닫히지 않고 그 문항으로 굴러간다. 상단바에 제목이 가리지 않는다. URL의 해시가 바뀌지 않는다.
벤 리포트가 있으면 총평의 문항 참조(`Q2` 같은 작은 링크)도 눌러 본다.
리포트 화면(면접 직후)의 목차도 같은지 본다.

- [x] **Step 2: 돌아가는 길**

`← 보관함으로`를 누른다.
Expected: 상세가 닫히고 **보관함 목록 모달이 다시 열린다**. 그 상태에서 브라우저 뒤로 가기를 누르면 사이트를 벗어나지 않고 직전 화면으로 간다.

- [x] **Step 3: 폭**

1440px에서 상세를 연다.
Expected: 준비 화면과 같은 폭. 대화 전문 탭에서 글줄이 `--read-w`에 묶여 지나치게 길지 않다.

- [x] **Step 4: 이력서 파일 (Review Focus 4·5)**

내정보 → 이력서 칸 → `새로 쓰기` → PDF를 끌어다 놓는다.
Expected: 제목이 파일명으로, 본문이 뽑은 글로 찬다. 제목을 먼저 써 두고 넣으면 그 제목이 남는다. 글자 없는 PDF(스캔본)를 넣으면 빈 글이 저장되지 않고 그 자리에서 말한다.

- [x] **Step 5: 380px**

Expected: `document.documentElement.scrollWidth === clientWidth`.

---

## 끝낸 뒤

1. `fix/archive-detail-anchors` → `dev` PR (squash)
2. demomo 재배포(2분) → Task 5를 거기서 한 번 더
3. **개편 다섯 + 이 수정까지 확인되면 `dev → main`.** merge commit으로(squash 금지)
