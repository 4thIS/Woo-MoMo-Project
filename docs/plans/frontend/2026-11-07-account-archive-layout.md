# 내정보와 보관함 레이아웃 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 보관함 목록을 열로 세우고, 보관함 상세를 모달에서 꺼내 리포트 화면의 레일을 그대로 쓰게 하며, 내정보의 빈자리를 이미 있는 숫자로 채운다.

**Architecture:** 새 화면 하나(`ArchiveDetailView`)와 새 상태 하나(`archiveView` 스토어)를 더한다. 레일은 새로 만들지 않고 `ReportRail`을 슬롯으로 채워 쓴다. `ArchiveDetail.vue`(2열 모달)는 지운다. 계약 변경 없음.

**Tech Stack:** Vue 3 + TS + Pinia, Vitest + @vue/test-utils

**Spec:** `docs/specs/frontend/2026-11-07-account-archive-layout-design.md`

## Global Constraints

- **색 토큰을 새로 만들지 않는다.** 있는 것만 쓴다(`--accent` `--accent-2` `--ok` `--danger` `--line` `--raise` `--win` `--ink` `--text` `--text-2` `--text-3` `--edge-hi`). 글꼴 토큰도 마찬가지 — 픽셀 글꼴은 `.mono` 클래스로 쓴다.
- **`border-radius`를 쓰지 않는다.** 모서리는 0이다.
- **`height: 100vh`를 쓰지 않는다.** 1번 spec(`scroll-motion-removal`)에서 철거한 것이다.
- **스크롤을 가로채지 않고 `scrollTop`을 읽지 않는다.** 상태 전환은 `IntersectionObserver`로만. 부드러운 스크롤 금지.
- **스프라이트는 정수 배율 또는 1/2배만.** 그 사이 값은 픽셀이 뭉개진다.
- **`.press`를 탭이나 카드에 붙이지 않는다.** `.press`는 "기본 그림자 → hover면 2px 떠오르며 6px"을 전제한다. 기본 그림자가 없는 요소에 붙이면 hover에서만 그림자가 튀어나와 옆을 덮는다(2026-11-08 이력서 탭에서 터진 것).
- **`flex: 1 1 0`을 높이가 auto인 기둥 안에서 쓰지 않는다.** 가정 크기가 0으로 잡혀 통째로 접힌다(2026-11-08 리포트 레일에서 터진 것). `flex: 0 1 auto` + `min-height: 0`.
- 계약 변경 없음 — `/api` 응답을 그대로 읽는다. 가입일·누적 면접 횟수는 **넣지 않는다**(서버가 주지 않는다).
- 프론트 게이트: `pnpm test && pnpm lint && pnpm exec prettier --check src && pnpm exec vue-tsc --noEmit && pnpm build`

## Review Focus

테스트가 짚지 않는, 사람이 실제로 밟을 길 다섯. 각 줄의 테스트는 해당 Task 안에 넣어 두었다.

1. **녹음이 있는데 `reportV2`가 없는 기록** — 카드 바닥 재생바가 어느 카드에도 안 붙거나 전부 1번 카드에 몰릴 수 있다. (Task 4 Step 8)
2. **면접 중에 보관함 상세로 들어가기** — 면접 도중 상단바에서 보관함을 열고 한 줄을 누르면 면접이 날아간다. 막혀 있어야 한다. (Task 2 Step 1)
3. **뒤로 가기를 두 번** — 상세에서 목차 앵커를 누른 뒤 뒤로 가기. 앵커가 먼저 되감기고 그다음 목록으로 돌아와야 한다. (Task 7 Step 2)
4. **이력서 칸이 꽉 찬 사람** — 6칸을 다 쓴 사람에게 `+ 새로 쓰기` 칸이 보이면 눌렀다 거절당한다. 칸 자체가 없어야 한다. (Task 6 Step 1)
5. **이름·나이가 둘 다 비어 있는 사람** — 가입 직후. `— · —`만 떠 허전해지는 자리다. (Task 5 Step 1)

---

## 파일 구조

| 파일 | 몫 |
|---|---|
| `src/stores/archiveView.ts` | **새로.** 지금 열려 있는 보관함 상세 하나. 히스토리 항목도 여기서 민다 |
| `src/views/ArchiveDetailView.vue` | **새로.** 상세 화면. `ReportRail` + 리포트/대화 전문 |
| `src/utils/archiveClips.ts` | **새로.** 카드 번호 → 그 카드에 속한 녹음들. 순수 함수 |
| `src/composables/useReadingToc.ts` | **새로.** 읽음·지금 보는 문항. `ReportView`에서 빼내 둘이 쓴다 |
| `src/components/account/ArchiveRow.vue` | 열로 세운다 |
| `src/components/account/ArchiveModal.vue` | 한도 안내 상시, 상세 띄우기를 스토어로 넘긴다 |
| `src/components/account/ArchiveDetail.vue` | **지운다.** 2열 모달은 끝 |
| `src/components/account/MeModal.vue` | 윗덩이 재배치 + 이력서 칸 3열 |
| `src/components/report/ReportCards.vue`, `ReportV2Cards.vue` | 카드 바닥 슬롯 하나 |
| `src/App.vue` | 상세 화면 분기 + `popstate` |

---

### Task 1: 보관함 목록을 열로 세운다

**Files:**
- Modify: `frontend/src/components/account/ArchiveRow.vue`
- Modify: `frontend/src/components/account/ArchiveModal.vue`
- Test: `frontend/src/components/account/ArchiveRow.test.ts` (새로), `ArchiveModal.test.ts`

**Interfaces:**
- Consumes: `ArchiveEntry`(`services/account`), `interviewerById`·`CENTER_FRAME_PX`·`DEFAULT_INTERVIEWER`(`@/interviewers`), `formatDuration`(`utils/timing`), `FIELD_LABELS`·`Field`(`stores/interview`)
- Produces: 없음(화면만)

- [x] **Step 1: 실패하는 테스트 — `ArchiveRow.test.ts`**

```ts
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ArchiveRow from './ArchiveRow.vue'
import type { ArchiveEntry } from '@/services/account'

const entry = {
  id: 'a1',
  interviewerId: 'm2',
  track: 'company',
  field: 'it',
  job: '백엔드 개발자',
  university: null,
  department: null,
  startedAt: '2026-11-01T10:00:00Z',
  endedAt: '2026-11-01T10:12:34Z',
  questionCount: 8,
  premium: true,
  hasRecording: true,
} as unknown as ArchiveEntry

const row = (over: Partial<ArchiveEntry> = {}) =>
  mount(ArchiveRow, { props: { entry: { ...entry, ...over } } })

describe('ArchiveRow — 열로 세운다 (2026-11-07)', () => {
  it('지원 직무가 제목 자리다 — 같은 면접관으로 셋을 봐도 구분된다', () => {
    expect(row().get('[data-test=row-subject]').text()).toContain('백엔드 개발자')
  })

  it('대입이면 제목 자리에 학과가 온다', () => {
    const w = row({ track: 'admission', university: '명지전문대', department: '컴퓨터공학과' })
    expect(w.get('[data-test=row-subject]').text()).toContain('컴퓨터공학과')
  })

  it('숫자는 제 열에 선다 — 자릿수가 줄 맞아야 세로로 비교된다', () => {
    const w = row()
    expect(w.get('[data-test=row-count]').text()).toBe('8문항')
    expect(w.get('[data-test=row-took]').text()).toBe('12분 34초')
  })

  it('녹음·프리미엄은 표식이다 — 문장에 끼워 넣지 않는다', () => {
    const w = row()
    expect(w.find('[data-test=row-premium]').exists()).toBe(true)
    expect(w.find('[data-test=row-rec]').exists()).toBe(true)
    expect(w.text()).not.toContain('· 녹음')
  })

  it('표식이 없는 기록에는 표식 자리를 그리지 않는다', () => {
    const w = row({ premium: false, hasRecording: false })
    expect(w.find('[data-test=row-premium]').exists()).toBe(false)
    expect(w.find('[data-test=row-rec]').exists()).toBe(false)
  })

  it('면접관 얼굴은 1/2배로 줄인다 — 92px 시트라 0.6배는 픽셀이 뭉개진다', () => {
    expect(row().findComponent({ name: 'SpriteFrame' }).props('scale')).toBe(0.5)
  })
})
```

- [x] **Step 2: 실패 확인**

Run: `pnpm exec vitest run src/components/account/ArchiveRow.test.ts`
Expected: FAIL — `[data-test=row-subject]`를 찾지 못한다

- [x] **Step 3: `ArchiveRow.vue` 다시 쓰기**

`ROW_SCALE`을 `0.5`로 고친다. 시트는 92×92이므로 46px이 된다 — 1/2배는 픽셀이 정확히 2:1로 줄어 또렷하고, 지금의 0.6배(55.2px)는 뭉갠다.

`subject`를 둘로 가른다:

```ts
/** 제목 자리에 오는 말. 찾을 때 기억하는 것은 "토스 백엔드 면접"이다 */
const title = computed(() =>
  props.entry.track === 'company' ? (props.entry.job ?? '면접') : (props.entry.department ?? '면접'),
)
/** 제목 아래 작게 — 회사는 분야, 대입은 대학 */
const sub = computed(() =>
  props.entry.track === 'company'
    ? props.entry.field
      ? FIELD_LABELS[props.entry.field as Field]
      : ''
    : (props.entry.university ?? ''),
)
/** 목록에서는 짧게 — 연도는 같은 해가 대부분이라 자리만 먹는다 */
const when = computed(() => {
  const d = new Date(props.entry.startedAt)
  return `${d.getMonth() + 1}. ${d.getDate()}.`
})
```

템플릿을 열로 세운다:

```vue
<template>
  <button type="button" class="row" data-test="archive-row" @click="$emit('open')">
    <SpriteFrame
      class="face"
      :src="iv.sprites.idle.file"
      :frame-w="CENTER_FRAME_PX"
      :frame-h="CENTER_FRAME_PX"
      :frames="iv.sprites.idle.frames"
      :scale="ROW_SCALE"
    />
    <span class="who">
      <span class="nm">{{ iv.displayName }}</span>
      <span class="marks">
        <span v-if="entry.premium" class="mono mk p" data-test="row-premium">★</span>
        <span v-if="entry.hasRecording" class="mono mk r" data-test="row-rec">녹음</span>
      </span>
    </span>
    <span class="mono trk">{{ entry.track === 'company' ? '회사' : '대입' }}</span>
    <span class="subject" data-test="row-subject">
      <span class="ttl">{{ title }}</span>
      <span v-if="sub" class="mono sub">{{ sub }}</span>
    </span>
    <span class="mono num" data-test="row-count">{{ entry.questionCount }}문항</span>
    <span class="mono num" data-test="row-took">{{ took }}</span>
    <span class="mono num" data-test="row-when">{{ when }}</span>
  </button>
</template>
```

스타일 — `grid`로 열을 고정한다:

```css
/* 다섯이 가운뎃점으로 이어 붙어 있으면 눈이 매번 처음부터 읽는다 — 열로 세운다 */
.row {
  display: grid;
  grid-template-columns: auto minmax(104px, auto) auto 1fr auto auto auto;
  align-items: center;
  gap: var(--sp-4);
  width: 100%;
  text-align: left;
  background: none;
  border: 2px solid var(--raise);
  padding: var(--sp-2) var(--sp-4);
  cursor: pointer;
  color: var(--text);
}
.row:hover,
.row:focus-visible {
  border-color: var(--accent);
}
.who {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  min-width: 0;
}
.nm {
  font-size: var(--fs-body-sm);
}
.mk {
  font-size: var(--fs-meta);
  padding: 0 var(--sp-1);
  border: 2px solid var(--raise);
  color: var(--text-3);
}
.mk.p {
  border-color: var(--accent);
  color: var(--accent);
}
.subject {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.subject .ttl {
  font-size: var(--fs-body-sm);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.subject .sub,
.trk {
  font-size: var(--fs-meta);
  color: var(--text-3);
}
/* 숫자는 자릿수 고정 — 그래야 세로로 훑어 비교된다 */
.num {
  text-align: right;
  font-size: var(--fs-meta);
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
}
/* 640px 아래에서는 열이 안 선다 — 두 줄로 돌아가되 지원 직무가 첫 줄이다 */
@media (max-width: 640px) {
  .row {
    grid-template-columns: auto 1fr;
    row-gap: var(--sp-1);
  }
  .who,
  .trk {
    display: none;
  }
  .subject {
    grid-column: 2;
  }
  .num {
    grid-column: 2;
    text-align: left;
    display: inline;
  }
}
```

좁은 화면에서는 `.who`(면접관 이름)를 감추므로 이름이 사라진다. **span 둘을 두고 미디어쿼리로 하나씩 감춘다** — `matchMedia`로 글을 갈아 끼우면 테스트에서 jsdom이 그 함수를 갖지 않아 또 가드를 달아야 한다.

```vue
<span v-if="sub" class="mono sub wide">{{ sub }}</span>
<span class="mono sub narrow">{{ [sub, iv.displayName].filter(Boolean).join(' · ') }}</span>
```

```css
.sub.narrow {
  display: none;
}
@media (max-width: 640px) {
  .sub.wide {
    display: none;
  }
  .sub.narrow {
    display: inline;
  }
}
```

- [x] **Step 4: 통과 확인**

Run: `pnpm exec vitest run src/components/account/ArchiveRow.test.ts`
Expected: PASS 6/6

- [x] **Step 5: 한도 안내를 상시로 — 실패하는 테스트**

`ArchiveModal.test.ts`에 더한다:

```ts
it('한도는 꽉 차기 전에도 적는다 — 꽉 찼을 때만 말하면 그전까지는 한도가 있는 줄 모른다', () => {
  const w = mount(ArchiveModal, { props: { open: true } })
  expect(w.get('[data-test=archive-limit]').text()).toContain('5')
})
```

- [x] **Step 6: 실패 확인 → 구현**

Run: `pnpm exec vitest run src/components/account/ArchiveModal.test.ts`
Expected: FAIL — `archive-limit`이 없다

`ArchiveModal.vue`의 `.pane` 머리에 상시 한 줄을 둔다. 지금 있는 `archive-full` 경고는 **꽉 찼을 때만** 그 줄의 말을 바꾸는 것으로 합친다:

```vue
<!-- 한도는 일반 기록 얘기다. 프리미엄 탭에서 꺼내면 엉뚱한 자리에서 겁을 준다 -->
<p v-if="tab !== 'premium'" class="mono limit" data-test="archive-limit">
  <template v-if="account.archiveFull">
    일반 기록이 {{ ARCHIVE_LIMIT }}개로 찼습니다 — 다음 면접을 마치면 가장 오래된 하나가
    사라집니다.
  </template>
  <template v-else>
    일반 기록은 {{ ARCHIVE_LIMIT }}개까지 남습니다 — 넘으면 오래된 것부터 밀려납니다.
  </template>
</p>
```

기존 `data-test="archive-full"`을 보던 테스트는 `archive-limit`의 **글**로 옮겨 쓴다(단언을 지우지 않는다).

- [x] **Step 7: 게이트 + 커밋**

```bash
cd frontend && pnpm test && pnpm lint && pnpm exec prettier --check src && pnpm exec vue-tsc --noEmit
git add frontend/src && git commit -m "feat(frontend): 보관함 목록을 열로 세운다 — 지원 직무가 제목 자리"
```

---

### Task 2: 보관함 상세를 화면으로 꺼낸다 (상태와 길)

**Files:**
- Create: `frontend/src/stores/archiveView.ts`
- Modify: `frontend/src/App.vue`, `frontend/src/components/account/ArchiveModal.vue`
- Delete: `frontend/src/components/account/ArchiveDetail.vue`, `ArchiveDetail.test.ts`
- Test: `frontend/src/stores/archiveView.test.ts` (새로)

**Interfaces:**
- Consumes: `ArchiveDetail`(`services/account`), `useAccountStore().getArchive(id)`, `useInterviewStore().phase`, `useModalStore()`
- Produces: `useArchiveViewStore()` — `{ detail: ArchiveDetail | null, open(id: string): Promise<void>, close(): void }`

- [x] **Step 1: 실패하는 테스트 — `archiveView.test.ts`**

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('@/services/llm', () => ({ startSession: vi.fn() }))
vi.mock('@/services/api', () => ({ getQuestions: vi.fn(), getManifest: vi.fn() }))
import { useArchiveViewStore } from './archiveView'
import { useAccountStore } from './account'
import { useInterviewStore } from './interview'
import { useModalStore } from './modal'

const detail = { id: 'a1', report: [], messages: [], recordings: [] }

beforeEach(() => setActivePinia(createPinia()))

describe('archiveView', () => {
  it('열면 상세를 받아 들고 모달을 닫는다 — 한 번에 하나만 연다', async () => {
    vi.spyOn(useAccountStore(), 'getArchive').mockResolvedValue(detail as never)
    useModalStore().show('archive')
    const v = useArchiveViewStore()
    await v.open('a1')
    expect(v.detail?.id).toBe('a1')
    expect(useModalStore().open).toBe(null)
  })

  it('면접 중에는 열지 않는다 — 면접이 날아간다', async () => {
    const get = vi.spyOn(useAccountStore(), 'getArchive').mockResolvedValue(detail as never)
    useInterviewStore().$patch({ phase: 'interview' })
    const v = useArchiveViewStore()
    await v.open('a1')
    expect(v.detail).toBe(null)
    expect(get).not.toHaveBeenCalled()
  })

  it('열면 히스토리 항목을 하나 민다 — 뒤로 가기로 목록에 돌아온다', async () => {
    const push = vi.spyOn(history, 'pushState')
    vi.spyOn(useAccountStore(), 'getArchive').mockResolvedValue(detail as never)
    await useArchiveViewStore().open('a1')
    expect(push).toHaveBeenCalled()
  })

  it('URL은 건드리지 않는다 — 목차 앵커(#q4)와 해시를 다투면 서로 덮어쓴다', async () => {
    const push = vi.spyOn(history, 'pushState')
    vi.spyOn(useAccountStore(), 'getArchive').mockResolvedValue(detail as never)
    await useArchiveViewStore().open('a1')
    const url = push.mock.calls[0][2]
    expect(url === undefined || url === null || url === '').toBe(true)
  })

  it('받아 오지 못하면 열지 않는다 — 빈 화면이 뜨면 고장처럼 보인다', async () => {
    vi.spyOn(useAccountStore(), 'getArchive').mockResolvedValue(null as never)
    const v = useArchiveViewStore()
    await v.open('a1')
    expect(v.detail).toBe(null)
  })

  it('닫으면 상세를 버린다', async () => {
    vi.spyOn(useAccountStore(), 'getArchive').mockResolvedValue(detail as never)
    const v = useArchiveViewStore()
    await v.open('a1')
    v.close()
    expect(v.detail).toBe(null)
  })
})
```

- [x] **Step 2: 실패 확인**

Run: `pnpm exec vitest run src/stores/archiveView.test.ts`
Expected: FAIL — `./archiveView` 모듈이 없다

- [x] **Step 3: `stores/archiveView.ts`**

```ts
/** 지금 보고 있는 보관함 상세 하나.
 *
 * 상세는 모달이 아니라 **화면**이다 — 같은 내용을 두 레이아웃으로 그리던 일을 끝낸다.
 * 화면이므로 뒤로 가기로 목록에 돌아와야 한다. URL은 건드리지 않고 히스토리 항목만 민다:
 * 목차 앵커(`#q4`)가 해시를 쓰므로 여기서 또 쓰면 서로 덮어쓴다.
 */
import { defineStore } from 'pinia'
import type { ArchiveDetail } from '@/services/account'
import { useAccountStore } from './account'
import { useInterviewStore } from './interview'
import { useModalStore } from './modal'

export const useArchiveViewStore = defineStore('archiveView', {
  state: () => ({ detail: null as ArchiveDetail | null }),
  actions: {
    async open(id: string) {
      // 면접 도중에 열면 면접이 날아간다
      if (useInterviewStore().phase === 'interview') return
      const d = await useAccountStore().getArchive(id)
      if (!d) return
      this.detail = d
      useModalStore().close()
      history.pushState({ momoArchive: id }, '')
    },
    close() {
      this.detail = null
    },
  },
})
```

- [x] **Step 4: 통과 확인**

Run: `pnpm exec vitest run src/stores/archiveView.test.ts`
Expected: PASS 6/6

- [x] **Step 5: 뒤로 가기와 화면 분기 — `App.vue`**

`popstate`를 듣는 곳은 앱 하나다. 스토어가 전역 리스너를 달면 테스트마다 쌓인다.

```ts
import { onBeforeUnmount, onMounted } from 'vue'
import { useArchiveViewStore } from '@/stores/archiveView'
import ArchiveDetailView from '@/views/ArchiveDetailView.vue'

const archive = useArchiveViewStore()
function onPop() {
  if (archive.detail) archive.close()
}
onMounted(() => window.addEventListener('popstate', onPop))
onBeforeUnmount(() => window.removeEventListener('popstate', onPop))
```

화면 분기 — 상세는 `interview.phase`보다 **앞선다**:

```vue
<AdminView v-if="onAdmin" />
<ArchiveDetailView
  v-else-if="archive.detail"
  :entry="archive.detail"
  @back="archive.close()"
  @remove="onRemove()"
/>
<Transition v-else name="view" mode="out-in">
  <component :is="view" :key="interview.phase" />
</Transition>
```

```ts
async function onRemove() {
  const id = archive.detail?.id
  archive.close()
  if (id) await useAccountStore().deleteArchive(id)
}
```

`ArchiveDetailView`는 Task 3에서 채운다. 이 Step에서는 `<main>{{ entry.id }}</main>`짜리 껍데기로 두고 `defineProps`/`defineEmits`만 맞춘다.

- [x] **Step 6: `ArchiveModal`이 스토어로 넘긴다**

`ArchiveModal.vue`에서 `detail` ref, `ArchiveDetail` import, `openDetail`, `remove`를 걷는다. 줄 클릭을 스토어로 보낸다:

```vue
<ArchiveRow v-for="e in shown" :key="e.id" :entry="e" @open="archiveView.open(e.id)" />
```

`ArchiveDetail.vue`와 `ArchiveDetail.test.ts`를 `git rm`한다.

- [x] **Step 7: 게이트 + 커밋**

```bash
cd frontend && pnpm test && pnpm lint && pnpm exec prettier --check src && pnpm exec vue-tsc --noEmit
git add -A frontend/src && git commit -m "feat(frontend): 보관함 상세를 모달에서 꺼내 화면으로"
```

---

### Task 3: 상세 화면 본문 — 레일을 그대로 쓴다

**Files:**
- Create: `frontend/src/views/ArchiveDetailView.vue`, `frontend/src/composables/useReadingToc.ts`
- Modify: `frontend/src/views/ReportView.vue` (읽음 추적을 composable로 뺀다)
- Test: `frontend/src/views/ArchiveDetailView.test.ts`

**Interfaces:**
- Consumes: `ReportRail`(+`TocItem`), `ReportCards`, `ReportV2Cards`, `answersForReport`(`utils/reportAnswers`), `asReportV2`·`itemsInOrder`(`utils/reportV2`), `formatDuration`
- Produces: `useReadingToc(bodyRef, tocItems)` — `{ current: Ref<string|undefined>, read: Ref<Set<string>> }`

- [x] **Step 1: 읽음 추적을 composable로 — 먼저 옮기고 기존 테스트로 확인**

`ReportView.vue`의 `current`/`read`/`watchCards` 블록을 그대로 `composables/useReadingToc.ts`로 옮긴다. 동작은 바꾸지 않는다.

Run: `pnpm exec vitest run src/views/ReportView.test.ts`
Expected: PASS — 기존 전부. 하나라도 깨지면 옮기다 바꾼 것이다

- [x] **Step 2: 실패하는 테스트 — `ArchiveDetailView.test.ts`**

```ts
import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('@/services/llm', () => ({ startSession: vi.fn() }))
vi.mock('@/services/api', () => ({ getQuestions: vi.fn(), getManifest: vi.fn() }))
import ArchiveDetailView from './ArchiveDetailView.vue'
import type { ArchiveDetail } from '@/services/account'

const entry = {
  id: 'a1',
  interviewerId: 'm2',
  track: 'company',
  field: 'it',
  job: '백엔드 개발자',
  university: null,
  department: null,
  startedAt: '2026-11-01T10:00:00Z',
  endedAt: '2026-11-01T10:12:34Z',
  report: [
    { question: '자기소개', answerSummary: '요약', feedback: '좋습니다' },
    { question: '어려웠던 점', answerSummary: '요약', feedback: '구체적으로' },
  ],
  messages: [
    { role: 'model', text: '자기소개' },
    { role: 'user', text: '안녕하세요' },
    { role: 'model', text: '어려웠던 점' },
    { role: 'user', text: '일정이요' },
  ],
  recordings: [],
  reportV2: null,
} as unknown as ArchiveDetail

beforeEach(() => setActivePinia(createPinia()))
const view = (over: Partial<ArchiveDetail> = {}) =>
  mount(ArchiveDetailView, { props: { entry: { ...entry, ...over } } })

describe('ArchiveDetailView', () => {
  it('리포트 화면과 같은 레일을 쓴다 — 두 벌을 만들면 둘이 어긋난다', () => {
    expect(view().find('[data-test=report-rail]').exists()).toBe(true)
  })

  it('목차가 문항 수만큼 선다', () => {
    expect(view().findAll('[data-test=toc-item]')).toHaveLength(2)
  })

  it('레일 머리에 지원 직무와 면접관, 돌아가는 길이 있다', () => {
    const w = view()
    const t = w.get('[data-test=report-rail]').text()
    expect(t).toContain('백엔드 개발자')
    expect(w.find('[data-test=archive-back]').exists()).toBe(true)
  })

  it('기본은 리포트 탭이다', () => {
    const w = view()
    expect(w.findAll('[data-test=card]')).toHaveLength(2)
    expect(w.find('[data-test=transcript]').exists()).toBe(false)
  })

  it('대화 전문 탭으로 바꾸면 대화가 나오고 카드는 사라진다', async () => {
    const w = view()
    await w.get('[data-test=tab-transcript]').trigger('click')
    expect(w.get('[data-test=transcript]').text()).toContain('안녕하세요')
    expect(w.findAll('[data-test=card]')).toHaveLength(0)
  })

  it('대화 전문에서도 같은 목차 앵커가 선다 — 탭을 바꿔도 목차가 죽지 않는다', async () => {
    const w = view()
    await w.get('[data-test=tab-transcript]').trigger('click')
    const href = w.get('[data-test=toc-item]').attributes('href')!
    expect(w.find(href).exists()).toBe(true)
  })

  it('돌아가기를 누르면 back을 올린다', async () => {
    const w = view()
    await w.get('[data-test=archive-back]').trigger('click')
    expect(w.emitted('back')).toBeTruthy()
  })

  it('지우기는 한 번 더 묻는다 — 되돌릴 수 없다', async () => {
    const w = view()
    await w.get('[data-test=archive-delete]').trigger('click')
    expect(w.find('[data-test=archive-delete-ask]').exists()).toBe(true)
    expect(w.emitted('remove')).toBeFalsy()
    await w.get('[data-test=archive-delete-confirm]').trigger('click')
    expect(w.emitted('remove')).toBeTruthy()
  })

  it('리포트가 남지 않은 기록도 열린다 — 빈 화면 대신 그렇다고 말한다', () => {
    const w = view({ report: [] })
    expect(w.text()).toContain('리포트가 남지 않았습니다')
  })

  it('탭에 .press를 붙이지 않는다 — hover에서만 그림자가 튀어나와 옆을 덮는다', () => {
    expect(view().get('[data-test=tab-report]').classes()).not.toContain('press')
  })
})
```

- [x] **Step 3: 실패 확인**

Run: `pnpm exec vitest run src/views/ArchiveDetailView.test.ts`
Expected: FAIL — 파일이 없다

- [x] **Step 4: `ArchiveDetailView.vue`**

`ReportView.vue`의 두 기둥 어법을 그대로 따른다. 다른 것은 머리 슬롯·액션 슬롯·탭뿐이다.

```vue
<script setup lang="ts">
/** 보관함 상세 — **리포트 화면과 같은 것**을 보여 준다 (2026-11-07).
 *
 * 2열 모달을 버린 이유: 가독성이 나빴던 진짜 원인은 2열이 아니라 같은 내용을
 * 두 레이아웃으로 그리고 있다는 것이었다. 레일은 `ReportRail`을 그대로 쓴다.
 */
import { computed, ref } from 'vue'
import type { ArchiveDetail } from '@/services/account'
import ReportRail, { type TocItem } from '@/components/report/ReportRail.vue'
import ReportCards from '@/components/report/ReportCards.vue'
import ReportV2Cards from '@/components/report/ReportV2Cards.vue'
import PixelButton from '@/components/ui/PixelButton.vue'
import { answersForReport } from '@/utils/reportAnswers'
import { asReportV2, itemsInOrder } from '@/utils/reportV2'
import { useReadingToc } from '@/composables/useReadingToc'
import { interviewerById, DEFAULT_INTERVIEWER } from '@/interviewers'
import { formatDuration } from '@/utils/timing'
import { FIELD_LABELS, type Field } from '@/stores/interview'

const props = defineProps<{ entry: ArchiveDetail }>()
defineEmits<{ back: []; remove: [] }>()

type Tab = 'report' | 'transcript'
const tab = ref<Tab>('report')
const asking = ref(false)
const body = ref<HTMLElement | null>(null)

const reportV2 = computed(() => asReportV2(props.entry.reportV2))
const answers = computed(() => answersForReport(props.entry.report, props.entry.messages))
const iv = computed(
  () => interviewerById(props.entry.interviewerId) ?? interviewerById(DEFAULT_INTERVIEWER)!,
)
const title = computed(() =>
  props.entry.track === 'company' ? (props.entry.job ?? '면접') : (props.entry.department ?? '면접'),
)

/** 보관함 기록의 메시지에는 시각(at)이 없다 — 문항별 시간은 비워 둔다.
 *  `docs/API.md`의 보관함 응답에 `at`이 생기면 그때 채운다 */
const tocItems = computed<TocItem[]>(() => {
  if (reportV2.value) {
    return itemsInOrder(reportV2.value.items).map((it) => ({
      id: `item-${it.id}`,
      question: it.question,
      ms: null,
      follow: it.kind === 'follow',
    }))
  }
  return props.entry.report.map((it, i) => ({
    id: `q${i + 1}`,
    question: it.question,
    ms: null,
    follow: false,
  }))
})

const { current, read } = useReadingToc(body, tocItems)

/** 이 메시지가 몇 번째 면접관 턴인가 — 대화 전문에서도 같은 앵커를 쓴다 */
function anchorOf(i: number): string | undefined {
  if (props.entry.messages[i].role !== 'model') return undefined
  const n = props.entry.messages.slice(0, i + 1).filter((m) => m.role === 'model').length
  return `q${n}`
}
</script>
```

머리 슬롯:

```vue
<template #head>
  <button type="button" class="mono link" data-test="archive-back" @click="$emit('back')">
    ← 보관함으로
  </button>
  <h1 class="display ttl">{{ title }}</h1>
  <p class="mono sub">{{ iv.displayName }} · {{ when }} · {{ took }}</p>
  <!-- 목차 위에 탭. .press를 붙이지 않는다 — 기본 그림자가 없어 hover에서만 튀어나온다 -->
  <div class="tabs" role="tablist">
    <button
      type="button"
      class="mono tab"
      :class="{ on: tab === 'report' }"
      data-test="tab-report"
      @click="tab = 'report'"
    >
      리포트
    </button>
    <button
      type="button"
      class="mono tab"
      :class="{ on: tab === 'transcript' }"
      data-test="tab-transcript"
      @click="tab = 'transcript'"
    >
      대화 전문
    </button>
  </div>
</template>
```

액션 슬롯은 `PDF로 저장`과 `지우기`. 묻는 단계는 지금 `ArchiveDetail.vue`에 있는 것을 그대로 옮긴다 — **강조는 안전한 쪽에** 준다(`그대로 두기`가 기본 variant).

본문:

```vue
<div ref="body" class="body">
  <template v-if="tab === 'report'">
    <ReportV2Cards v-if="reportV2" :report="reportV2" />
    <ReportCards v-else-if="entry.report.length" :report="entry.report" :answers="answers" />
    <PixelWindow v-else title="리포트"><p class="mono">리포트가 남지 않았습니다.</p></PixelWindow>
  </template>
  <ol v-else class="log" data-test="transcript">
    <li v-for="(m, i) in entry.messages" :id="anchorOf(i)" :key="i" :class="m.role">
      <span class="mono who">{{ m.role === 'model' ? iv.displayName : '나' }}</span>
      <p class="read">{{ m.text }}</p>
    </li>
  </ol>
</div>
```

`.read`는 리포트 카드와 같은 읽기 꼴을 쓴다(`--font-read` · `--lh-read` · `--read-w`).
`.cols`/`.body` 스타일은 `ReportView.vue`의 것과 같은 값으로 둔다 — 둘이 어긋나면 "같은 화면"이 아니게 된다.

- [x] **Step 5: 통과 확인**

Run: `pnpm exec vitest run src/views/ArchiveDetailView.test.ts src/views/ReportView.test.ts`
Expected: PASS — 새 10건 + 기존 ReportView 전부

- [x] **Step 6: 게이트 + 커밋**

```bash
cd frontend && pnpm test && pnpm lint && pnpm exec prettier --check src && pnpm exec vue-tsc --noEmit && pnpm build
git add -A frontend/src && git commit -m "feat(frontend): 보관함 상세 화면 — 레일·목차를 리포트와 같게"
```

---

### Task 4: 녹음을 그 문항 카드 바닥으로

**Files:**
- Create: `frontend/src/utils/archiveClips.ts`
- Modify: `frontend/src/components/report/ReportCards.vue`, `ReportV2Cards.vue`, `frontend/src/views/ArchiveDetailView.vue`
- Test: `frontend/src/utils/archiveClips.test.ts`, `ReportCards.test.ts`, `ArchiveDetailView.test.ts`

**Interfaces:**
- Consumes: `matchQuestions`(`utils/reportAnswers`)
- Produces: `clipsByCard(report, messages, recordings): Clip[][]`

- [x] **Step 1: 실패하는 테스트 — `archiveClips.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import { clipsByCard } from './archiveClips'

const report = [{ question: 'q1' }, { question: 'q2' }]
const messages = [
  { role: 'model' as const, text: 'q1' },
  { role: 'user' as const, text: 'a1' },
  { role: 'model' as const, text: 'q1 꼬리' },
  { role: 'user' as const, text: 'a2' },
  { role: 'model' as const, text: 'q2' },
  { role: 'user' as const, text: 'a3' },
]
const recordings = [
  { turn: 0, url: 'u0', durationSec: 10 },
  { turn: 1, url: 'u1', durationSec: 20 },
  { turn: 2, url: 'u2', durationSec: 30 },
]

describe('clipsByCard', () => {
  it('꼬리질문 답변은 제 카드에 함께 붙는다 — 리포트가 둘을 한 장에 합치기 때문이다', () => {
    const out = clipsByCard(report, messages, recordings)
    expect(out[0].map((c) => c.url)).toEqual(['u0', 'u1'])
    expect(out[1].map((c) => c.url)).toEqual(['u2'])
  })

  it('녹음이 없으면 빈 배열이다 — 빈 플레이어는 고장처럼 보인다', () => {
    expect(clipsByCard(report, messages, [])).toEqual([[], []])
  })

  it('녹음이 답변보다 적어도 던지지 않는다 — 중간에 끊긴 기록이 있다', () => {
    const out = clipsByCard(report, messages, [{ turn: 2, url: 'u2', durationSec: 1 }])
    expect(out[0]).toEqual([])
    expect(out[1].map((c) => c.url)).toEqual(['u2'])
  })

  it('카드가 대화와 짝지어지지 않아도 던지지 않는다', () => {
    expect(clipsByCard([{ question: 'x' }], [], recordings)).toEqual([[]])
  })
})
```

- [x] **Step 2: 실패 확인**

Run: `pnpm exec vitest run src/utils/archiveClips.test.ts`
Expected: FAIL — 모듈이 없다

- [x] **Step 3: `utils/archiveClips.ts`**

```ts
/** 녹음을 리포트 카드에 나눠 붙인다.
 *
 * 녹음은 **답변 순번**(`turn`)으로 저장되고, 리포트 카드는 꼬리질문을 한 장에 합친다.
 * 그래서 카드 번호로는 바로 못 찾는다 — 카드가 차지하는 답변 구간을 구해 그 안의 녹음을 모은다.
 */
import { matchQuestions } from './reportAnswers'

export interface Clip {
  turn: number
  url: string
  durationSec?: number | null
}
type Msg = { role: 'user' | 'model'; text: string }

export function clipsByCard(
  report: { question: string }[],
  messages: Msg[],
  recordings: Clip[],
): Clip[][] {
  const qIdx = messages.flatMap((m, i) => (m.role === 'model' ? [i] : []))
  const starts = matchQuestions(
    report,
    qIdx.map((i) => messages[i].text),
  )
  /** 메시지 자리 → 몇 번째 답변인가 */
  const answerAt = new Map<number, number>()
  let n = 0
  messages.forEach((m, i) => {
    if (m.role === 'user') answerAt.set(i, n++)
  })

  return report.map((_, i) => {
    const s = starts[i]
    if (s < 0) return []
    const next = starts.slice(i + 1).find((v) => v >= 0)
    const from = qIdx[s]
    const to = next === undefined ? messages.length : qIdx[next]
    const turns = new Set<number>()
    for (let k = from; k < to; k++) {
      const a = answerAt.get(k)
      if (a !== undefined) turns.add(a)
    }
    return recordings.filter((r) => turns.has(r.turn))
  })
}
```

- [x] **Step 4: 통과 확인**

Run: `pnpm exec vitest run src/utils/archiveClips.test.ts`
Expected: PASS 4/4

- [x] **Step 5: 카드 바닥 슬롯 — 실패하는 테스트**

`ReportCards.test.ts`에 더한다:

```ts
it('카드 바닥에 끼울 자리를 연다 — 보관함이 녹음 재생바를 여기 붙인다', () => {
  const c = mount(ReportCards, {
    props: { report, answers },
    slots: { foot: '<b data-test="x-foot">끼운 것</b>' },
  })
  expect(c.findAll('[data-test=x-foot]')).toHaveLength(2)
})
```

- [x] **Step 6: 실패 확인 → 구현**

Run: `pnpm exec vitest run src/components/report/ReportCards.test.ts`
Expected: FAIL — 슬롯이 없다

`ReportCards.vue`의 `PixelWindow` 안 맨 끝에:

```vue
    <!-- 카드 바닥. 보관함이 그 문항의 녹음 재생바를 여기 붙인다 — 대화 옆에 흩어 두지 않는다 -->
    <slot name="foot" :i="i" />
```

`ReportV2Cards.vue`에도 같은 슬롯을 연다. **벤 기록이 녹음을 갖는 쪽**이므로 여기가 더 중요하다. 슬롯 인자는 카드 순번(`i`)으로 같게 맞춘다.

- [x] **Step 7: 상세 화면에서 채운다**

`ArchiveDetailView.vue`:

```ts
import { clipsByCard } from '@/utils/archiveClips'
import PixelAudio from '@/components/ui/PixelAudio.vue'

/** v2 리포트는 문항이 따로 있으므로 그 질문 목록으로 짝짓는다 */
const clips = computed(() =>
  clipsByCard(
    reportV2.value
      ? itemsInOrder(reportV2.value.items).map((it) => ({ question: it.question }))
      : props.entry.report,
    props.entry.messages,
    props.entry.recordings,
  ),
)
```

```vue
<template #foot="{ i }">
  <PixelAudio
    v-for="c in clips[i]"
    :key="c.url"
    class="clip"
    data-test="archive-clip"
    :src="c.url"
    :duration="c.durationSec ?? null"
    :label="`답변 ${c.turn + 1} 녹음`"
  />
</template>
```

- [x] **Step 8: Review Focus 1 — 옛 벤 기록**

`ArchiveDetailView.test.ts`에:

```ts
it('reportV2가 없는 기록도 녹음이 제 카드에 붙는다 — 한 카드에 몰리지 않는다', () => {
  const w = view({ recordings: [{ turn: 1, url: 'u1', durationSec: 5 }] as never })
  const cards = w.findAll('[data-test=card]')
  expect(cards[0].find('[data-test=archive-clip]').exists()).toBe(false)
  expect(cards[1].find('[data-test=archive-clip]').exists()).toBe(true)
})

it('녹음이 없는 기록에는 재생바를 그리지 않는다', () => {
  expect(view().find('[data-test=archive-clip]').exists()).toBe(false)
})
```

- [x] **Step 9: 게이트 + 커밋**

```bash
cd frontend && pnpm test && pnpm lint && pnpm exec prettier --check src && pnpm exec vue-tsc --noEmit
git add -A frontend/src && git commit -m "feat(frontend): 녹음을 그 문항 카드 바닥으로"
```

---

### Task 5: 내정보 윗덩이 — 빈자리를 숫자로 채운다

**Files:**
- Modify: `frontend/src/components/account/MeModal.vue`
- Test: `frontend/src/components/account/MeModal.test.ts`

**Interfaces:**
- Consumes: `useAccountStore()`(`session`·`profile`·`tickets`·`isPremium`·`archive`), `SpriteFrame`, `ARCHIVE_LIMIT`(`utils/archive`), `useModalStore()`
- Produces: 없음

- [x] **Step 1: 실패하는 테스트**

기존 `MeModal.test.ts`의 마운트 헬퍼를 그대로 쓴다(없으면 `me(patch)` 하나를 만든다 — `account.$patch` 후 `mount(MeModal, { props: { open: true } })`).

```ts
describe('MeModal — 윗덩이 (2026-11-07)', () => {
  it('이름·나이·등급이 한 줄로 흐른다 — 셋을 3분의 1씩 나누지 않는다', () => {
    const w = me({ profile: { name: '이우진', age: 26 } })
    const line = w.get('[data-test=me-identity]').text()
    expect(line).toContain('이우진')
    expect(line).toContain('26세')
  })

  it('고치기를 눌러도 초상이 움직이지 않는다 — 줄 높이가 두 상태에서 같다', async () => {
    const w = me({ profile: { name: '이우진', age: 26 } })
    await w.get('[data-test=me-profile-edit]').trigger('click')
    // 보기/고치기 두 상태가 같은 최소 높이를 쓰는지 규칙으로 고정한다
    expect(src).toMatch(/\.identity \{[^}]*min-height/)
  })

  it('나이 칸은 이메일과 같은 폭을 받지 않는다 — 두 글자가 한 줄을 다 먹으면 허전하다', async () => {
    const w = me({ profile: { name: '이우진', age: 26 } })
    await w.get('[data-test=me-profile-edit]').trigger('click')
    expect(w.get('[data-test=me-age]').classes()).toContain('age')
    expect(src).toMatch(/\.age \{[^}]*width:\s*44px/)
  })

  it('티켓과 보관함 수를 숫자 칸으로 보여 준다 — 이미 있는 값만 쓴다', () => {
    const w = me({ tickets: 3, archive: [{}, {}] })
    expect(w.get('[data-test=me-tickets]').text()).toContain('3')
    expect(w.get('[data-test=me-archive-count]').text()).toContain('2')
  })

  it('이름과 나이가 둘 다 비어도 허전하지 않게 말한다 — 가입 직후다', () => {
    const w = me({ profile: { name: null, age: null } })
    expect(w.get('[data-test=me-identity]').text()).toContain('면접 중에 쓸 이름')
  })

  it('지원자 초상은 2배로만 키운다 — 44px 시트라 72px은 정수 배율이 아니다', () => {
    expect(me().findComponent({ name: 'SpriteFrame' }).props('scale')).toBe(2)
  })
})
```

> `src`는 `readFileSync(join(__dirname, 'MeModal.vue'), 'utf8')`. 줄 높이·칸 폭은 마운트로 잴 수 없어(jsdom에 레이아웃이 없다) 규칙으로 고정한다.

- [x] **Step 2: 실패 확인**

Run: `pnpm exec vitest run src/components/account/MeModal.test.ts`
Expected: FAIL — `me-identity`가 없다

- [x] **Step 3: 윗덩이를 다시 짠다**

`dl.kv`를 버리고 셋으로 가른다: **신원(초상+이름 줄+이메일)** · **티켓 칸** · **보관함 칸**.

```vue
<div class="top" data-test="me-account">
  <div class="who">
    <!-- 72px은 44px 시트의 정수 배율이 아니다 — 2배(88px)로 간다 -->
    <SpriteFrame
      class="portrait"
      data-test="me-portrait"
      src="/sprites/look_up.png"
      :frame-w="44"
      :frame-h="44"
      :frames="12"
      :scale="2"
    />
    <div class="lines">
      <p class="identity" data-test="me-identity">
        <template v-if="!editingProfile">
          <template v-if="account.profile.name || account.profile.age !== null">
            <span class="nm">{{ account.profile.name ?? '이름 없음' }}</span>
            <span v-if="account.profile.age !== null" class="mono">
              {{ account.profile.age }}세
            </span>
          </template>
          <span v-else class="mono dim">면접 중에 쓸 이름과 나이를 적어 두세요</span>
          <span class="mono tag" :class="{ p: account.isPremium }">{{ tierLabel }}</span>
          <button
            type="button"
            class="mono link"
            data-test="me-profile-edit"
            @click="startProfile"
          >
            고치기
          </button>
        </template>
        <template v-else>
          <input
            v-model="name"
            type="text"
            class="input mono sm nm-in"
            placeholder="이름"
            data-test="me-name"
          />
          <input
            v-model="age"
            type="number"
            class="input mono sm age"
            placeholder="나이"
            data-test="me-age"
          />
          <button type="button" class="mono link" data-test="me-profile-save" @click="saveProfile">
            저장
          </button>
        </template>
      </p>
      <p class="mono mail">{{ account.session?.email }}</p>
    </div>
  </div>

  <div class="stat" data-test="me-tickets">
    <span class="mono lbl">남은 티켓</span>
    <span class="mono big">{{ account.tickets }}</span>
    <PixelButton variant="secondary" data-test="me-buy" @click="modal.show('premium')">
      티켓 더 사기
    </PixelButton>
  </div>
  <div class="stat" data-test="me-archive-count">
    <span class="mono lbl">보관함</span>
    <span class="mono big">{{ account.archive.length }}</span>
    <span class="mono note">무료는 {{ ARCHIVE_LIMIT }}개까지</span>
  </div>
</div>
```

```css
.top {
  display: grid;
  grid-template-columns: 1fr auto auto;
  gap: var(--sp-4);
  align-items: stretch;
}
.who {
  display: flex;
  align-items: center;
  gap: var(--sp-4);
  min-width: 0;
}
.identity {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--sp-3);
  margin: 0;
  /* 보기와 고치기의 줄 높이를 묶는다 — 칸이 생길 때 초상이 따라 움직이면 안 된다 */
  min-height: 40px;
}
/* 칸은 내용 길이만큼. 두 글자 나이가 이메일과 같은 폭을 받으면 허전해 보인다 */
.nm-in {
  width: 92px;
}
.age {
  width: 44px;
}
.mail {
  margin: var(--sp-1) 0 0;
  font-size: var(--fs-meta);
  color: var(--text-3);
}
.stat {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  padding: var(--sp-3) var(--sp-4);
  border: var(--win-border);
  background: var(--win);
}
.stat .lbl,
.stat .note {
  font-size: var(--fs-meta);
  color: var(--text-3);
}
/* 상자 하나를 숫자 하나가 채운다 */
.big {
  font-size: 34px;
  line-height: 1;
  color: var(--accent);
  font-variant-numeric: tabular-nums;
}
@media (max-width: 640px) {
  .top {
    grid-template-columns: 1fr;
  }
}
```

티켓 더 사기는 `useModalStore().show('premium')`을 부른다 — 모달 하나 규칙(`stores/modal.ts`)을 따른다.

- [x] **Step 4: 통과 확인**

Run: `pnpm exec vitest run src/components/account/MeModal.test.ts`
Expected: PASS — 새 6건 + 기존 전부

- [x] **Step 5: 게이트 + 커밋**

```bash
cd frontend && pnpm test && pnpm lint && pnpm exec prettier --check src && pnpm exec vue-tsc --noEmit
git add frontend/src && git commit -m "feat(frontend): 내정보 윗덩이 — 초상과 숫자로 빈자리를 채운다"
```

---

### Task 6: 내정보 이력서 칸 — 3열 카드와 `···`

**Files:**
- Modify: `frontend/src/components/account/MeModal.vue`
- Test: `frontend/src/components/account/MeModal.test.ts`

**Interfaces:**
- Consumes: `RESUME_SLOTS`·`ResumeSlot`(`services/account`), `account.slotsOf(kind)`, `ResumeSlotEditor`
- Produces: 없음

- [x] **Step 1: 실패하는 테스트**

```ts
describe('MeModal — 이력서 칸 (2026-11-07)', () => {
  const slot = (id: string, title: string, len: number) => ({
    id,
    kind: 'admission' as const,
    title,
    text: 'x'.repeat(len),
    updatedAt: '2026-11-01T00:00:00Z',
  })
  const two = [slot('s1', '신입 백엔드', 2480), slot('s2', '포트폴리오용', 3120)]

  it('쓴 칸은 카드로, 남은 칸은 점선 하나로 보여 준다 — 빈 상자를 넷 늘어놓지 않는다', async () => {
    const w = await meWithSlots(two)
    expect(w.findAll('[data-test=slot-card]')).toHaveLength(2)
    expect(w.findAll('[data-test=slot-empty]')).toHaveLength(1)
    expect(w.get('[data-test=slot-empty]').text()).toContain('4칸 남음')
  })

  it('카드에 글자 수를 적는다 — 제목만으로는 어느 것이 긴지 모른다', async () => {
    const w = await meWithSlots(two)
    expect(w.findAll('[data-test=slot-card]')[0].text()).toContain('2,480자')
  })

  it('지우기는 ··· 안에 있다 — 되돌릴 수 없는 일이 열기와 같은 무게로 보이면 안 된다', async () => {
    const w = await meWithSlots(two)
    expect(w.find('[data-test=slot-delete]').exists()).toBe(false)
    await w.findAll('[data-test=slot-more]')[0].trigger('click')
    expect(w.find('[data-test=slot-delete]').exists()).toBe(true)
  })

  it('··· 는 한 번에 하나만 열린다', async () => {
    const w = await meWithSlots(two)
    await w.findAll('[data-test=slot-more]')[0].trigger('click')
    await w.findAll('[data-test=slot-more]')[1].trigger('click')
    expect(w.findAll('[data-test=slot-delete]')).toHaveLength(1)
  })

  it('지우기를 눌러도 한 번 더 묻는다', async () => {
    const w = await meWithSlots(two)
    await w.findAll('[data-test=slot-more]')[0].trigger('click')
    await w.get('[data-test=slot-delete]').trigger('click')
    expect(w.find('[data-test=slot-delete-ask]').exists()).toBe(true)
  })

  it('여섯 칸을 다 쓰면 빈 칸 자체가 없다 — 눌렀다 거절당하지 않게', async () => {
    const six = Array.from({ length: 6 }, (_, i) => slot(`s${i}`, `이력서 ${i}`, 100))
    const w = await meWithSlots(six)
    expect(w.find('[data-test=slot-empty]').exists()).toBe(false)
    expect(w.find('[data-test=slot-full-note]').exists()).toBe(true)
  })
})
```

- [x] **Step 2: 실패 확인**

Run: `pnpm exec vitest run src/components/account/MeModal.test.ts`
Expected: FAIL — `slot-card`가 없다(지금은 `slot-row`)

- [x] **Step 3: 슬롯을 카드로**

`moreOpen`을 더한다(한 번에 하나만):

```ts
/** 열려 있는 ··· 하나. 둘이 열리면 어느 줄을 지우는지 흐려진다 */
const moreOpen = ref<string | null>(null)
watch(kind, () => {
  asking.value = null
  moreOpen.value = null
})
```

```vue
<div class="slots">
  <div v-for="s in slots" :key="s.id" class="card" data-test="slot-card">
    <span class="nm">{{ s.title }}</span>
    <span class="mono meta">{{ s.text.length.toLocaleString() }}자</span>
    <div class="acts">
      <PixelButton variant="secondary" data-test="slot-open" @click="editing = s">열기</PixelButton>
      <button
        type="button"
        class="mono more"
        data-test="slot-more"
        :aria-expanded="moreOpen === s.id"
        aria-label="더 보기"
        @click="moreOpen = moreOpen === s.id ? null : s.id"
      >
        ···
      </button>
    </div>
    <div v-if="moreOpen === s.id" class="menu">
      <template v-if="asking === s.id">
        <span class="mono ask" data-test="slot-delete-ask">지울까요? 되돌릴 수 없습니다</span>
        <!-- 강조는 안전한 쪽에 준다 -->
        <PixelButton data-test="slot-delete-cancel" @click="asking = null">그대로 두기</PixelButton>
        <PixelButton
          variant="secondary"
          data-test="slot-delete-confirm"
          @click="removeSlot(s.id)"
        >
          삭제
        </PixelButton>
      </template>
      <button v-else type="button" class="mono del" data-test="slot-delete" @click="asking = s.id">
        지우기
      </button>
    </div>
  </div>

  <!-- 빈 칸은 점선 하나. 넷을 늘어놓으면 "다 비었다"처럼 읽힌다 -->
  <button
    v-if="!full"
    type="button"
    class="card empty"
    data-test="slot-empty"
    @click="editing = 'new'"
  >
    <span class="plus">＋</span>
    <span class="mono">새로 쓰기</span>
    <span class="mono meta">{{ RESUME_SLOTS - slots.length }}칸 남음</span>
  </button>
</div>
<p v-if="full" class="mono note" data-test="slot-full-note">
  {{ RESUME_SLOTS }}개를 모두 썼습니다 — 하나를 지워야 새로 만들 수 있습니다
</p>
```

```css
.slots {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--sp-3);
}
.card {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  padding: var(--sp-3);
  border: var(--win-border);
  background: var(--win);
  min-width: 0;
}
.card .nm {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.card .meta {
  font-size: var(--fs-meta);
  color: var(--text-3);
}
.acts {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
}
.more {
  margin-left: auto;
  background: none;
  border: 2px solid var(--raise);
  color: var(--text-3);
  cursor: pointer;
  padding: 0 var(--sp-2);
}
.del {
  background: none;
  border: 2px solid var(--danger);
  color: var(--danger);
  cursor: pointer;
  padding: var(--sp-1) var(--sp-2);
}
.card.empty {
  border-style: dashed;
  background: none;
  align-items: flex-start;
  color: var(--text-3);
  cursor: pointer;
}
/* 좁으면 1열. 이때도 빈 칸은 하나다 */
@media (max-width: 640px) {
  .slots {
    grid-template-columns: 1fr;
  }
}
```

`ResumeSlotEditor`는 격자 **아래**에 그대로 둔다 — 카드 안에 넣으면 한 칸이 세로로 길어져 격자가 무너진다.

- [x] **Step 4: 통과 확인**

Run: `pnpm exec vitest run src/components/account/MeModal.test.ts`
Expected: PASS — 새 6건 + 기존 전부

- [x] **Step 5: 로그아웃을 바닥 오른쪽으로**

`#foot` 슬롯: 왼쪽에 `계정을 지우려면 메일로 알려 주세요`, 오른쪽에 빨간 테두리 `로그아웃`.

```css
.foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-4);
}
.signout {
  border-color: var(--danger);
  color: var(--danger);
}
```

- [x] **Step 6: 게이트 전부 + 커밋**

```bash
cd frontend
pnpm test && pnpm lint && pnpm exec prettier --check src && pnpm exec vue-tsc --noEmit && pnpm build
git add frontend/src && git commit -m "feat(frontend): 내정보 이력서 칸 — 3열 카드와 ··· 메뉴"
```

---

### Task 7: 눈으로

**Files:** 없음(확인만)

- [x] **Step 1: 1440 / 900 / 380px에서 세 화면**

개발 서버를 띄우고 보관함 목록 · 보관함 상세 · 내정보를 본다.
Expected: 380px에서 `document.documentElement.scrollWidth === clientWidth`, 보관함 줄이 두 줄로 눕고 지원 직무가 첫 줄, 내정보가 1열, 빈 이력서 칸은 하나.

- [x] **Step 2: 뒤로 가기 두 번 (Review Focus 3)**

상세에서 목차 앵커를 누른 뒤 뒤로 가기를 두 번.
Expected: 첫 번째는 앵커가 되감기고 두 번째에 목록으로 돌아온다.

- [x] **Step 3: 면접 중 차단 (Review Focus 2)**

면접을 시작한 상태에서 상단바 → 보관함 → 한 줄 클릭.
Expected: 아무 일도 일어나지 않는다. 면접 화면 그대로.

- [x] **Step 4: 인쇄**

상세 화면에서 인쇄 미리보기.
Expected: 레일의 목차·액션·탭이 빠지고 한 줄기로 이어진다(리포트 화면과 같다).

---

## 끝낸 뒤

1. `feature/account-archive-layout` → `dev` PR (squash)
2. demomo 재배포(2분) → **저장된 면접을 무료·벤 각 1건 열어** 확인. 벤 기록은 녹음 재생바가 카드 바닥에 붙었는지 본다
3. 이력서 칸이 둘 이상 있는 계정으로 내정보를 연다. 없으면 두 개 만들어 본다
4. **여기서 개편 다섯이 끝난다.** `dev → main`은 다섯을 모두 demomo에서 확인한 뒤 사용자가 지시할 때 한다 — 이 개편은 그 전까지 `dev`에만 둔다
