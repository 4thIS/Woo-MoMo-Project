# 준비 화면 레이아웃 + 벤 조절 — 구현 계획 (plan)

- 생성일시: 2026-11-07
- 기준 spec: `docs/specs/frontend/2026-11-07-prepare-layout-design.md`

**Goal:** 모델을 받는 4분 동안 입력이 끝나게 준비 화면을 두 기둥으로 다시 짜고, 서버에만 있고 화면이 없던 벤 성향 다섯 축을 쓸 수 있게 한다.

**Architecture:** `PrepareView.vue` 하나를 거의 새로 쓴다. 왼쪽 상황판(출근 장면 + 진행바 + 체크리스트 + 시작)과 오른쪽 입력을 `flex`로 세우고, 1024px 아래에서 상황판이 위로 눕는다. 벤 성향은 신규 `BenSettings.vue`가 다섯 줄을 그리고, 값은 `interview` 스토어가 들고 있다가 시작 요청 때만 API 이름으로 옮긴다. **진행바와 출근 애니메이션(`PixelProgress`)은 건드리지 않는다.**

**Tech Stack:** frontend: Vue 3 + TS + Vite + Pinia + Vitest

## Global Constraints

- **`PixelProgress`를 바꾸지 않는다.** props도 그대로. 담기는 자리만 옮긴다.
- **계약을 바꾸지 않는다.** `benSettings`는 이미 배포된 선택 필드를 쓰기 시작하는 것뿐이다. lockstep 불필요.
- **벤 동의·고지 문구는 한 글자도 바꾸지 않는다.** 운영에 나가 있는 문장이다(루트 `CLAUDE.md` 8번).
- **다섯 칸이 전부 기본이면 `benSettings`를 아예 보내지 않는다.** 이 조건이 깨지면 기존 벤 면접의 성격이 조용히 바뀐다.
- `border-radius`를 쓰지 않는다. 색 리터럴은 `tokens.css`에만.
- 스크롤을 가로채지 않는다. `height: 100vh`를 쓰지 않는다(1번 철거 원칙).
- 면접실·면접관·`InterviewerPicker`는 손대지 않는다.
- 매 Task 끝에 커밋한다. 커밋 메시지에 Claude/AI 저작 표기를 넣지 않는다.

## Review Focus

테스트가 잡지 못하는 자리. Task를 끝낸 뒤 **로컬 브라우저**에서, 전부 끝나면 **demomo**에서 본다.

- **모델이 다 받아지는 순간 레이아웃이 움직이지 않는가** — 왼쪽 버튼이 그 자리에서 켜져야 한다.
- **출근 장면이 376px 안에 정수 배율로 들어가는가** — 소수 배율로 줄이면 뭉개진다(루트 `CLAUDE.md`).
- **1024px 아래에서 상황판이 눕고도 입력이 쓸 만한가.**
- **벤 성향을 안 건드리고 시작했을 때 요청에 `benSettings`가 없는가** — 네트워크 탭으로.
- **다른 값이 있다는 걸 알 수 있는가** — 눈금 어법의 유일한 약점이다. 처음 보는 사람에게 보여 주고 물어본다.

---

### Task 1: 2단계 전환을 없애고 한 흐름으로

**Files:**
- Modify: `frontend/src/views/PrepareView.vue`
- Test: `frontend/src/views/PrepareView.test.ts`

**Interfaces:**
- Produces: 지원 정보와 이력서가 한 화면에 함께 있다. 뒤 Task가 이 구조 위에 쌓인다

- [ ] **Step 1: 실패하는 테스트**

```ts
it('지원 정보와 이력서를 한 화면에 둔다 — 단계를 나누지 않는다', async () => {
  const w = mountView()
  await filled(w)
  expect(w.find('[data-test=step-profile]').exists()).toBe(true)
  expect(w.find('[data-test=step-resume]').exists()).toBe(true)
  expect(w.find('[data-test=step-next]').exists()).toBe(false)
  expect(w.find('[data-test=step-prev]').exists()).toBe(false)
})
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm test -- PrepareView`
Expected: FAIL — 지금은 `step === 1`일 때 `step-resume`이 없고 화살표가 있다.

- [ ] **Step 3: `step` 상태와 화살표를 걷어낸다**

`<script setup>`에서 `step`·`goNext`·`goBack`과 그 `watch`를 지운다. 템플릿에서 `#tag` 안의 `.stepnav`(화살표 둘 + `1 / 2`)를 통째로 지우고, `<Transition name="fade" mode="out-in">` 래퍼도 뗀다. 두 `<div class="step">`을 **나란히** 둔다.

`PixelWindow`의 `:title`은 `"어디에 지원하시나요?"`로 고정한다. 이력서는 그 창 안에서 `<h3>` 한 줄로 가른다.

- [ ] **Step 4: 입력 완료 태그를 옮긴다**

`#tag`에 남기는 것은 둘뿐이다:

```vue
<PixelTag v-if="infoDone" tone="ok">입력 완료</PixelTag>
<PixelTag v-if="interview.resumeDone" tone="ok">
  {{ interview.resumeText.length.toLocaleString() }}자 추출
</PixelTag>
```

- [ ] **Step 5: 테스트**

Run: `pnpm test -- PrepareView`
Expected: PASS. **다른 단언이 깨지면 그 테스트도 이 구조에 맞게 고친다** — `step-next`를 눌러 2단계로 가던 헬퍼가 있으면 그 호출을 지운다.

- [ ] **Step 6: 전체 테스트 + 커밋**

```bash
pnpm test
git add frontend/src/views/PrepareView.vue frontend/src/views/PrepareView.test.ts
git commit -m "fix(frontend): 준비 화면 2단계 전환 제거 — 칸이 넷 이하라 나눌 이유가 없다"
```

---

### Task 2: 이력서 입력 넷을 탭으로

**Files:**
- Modify: `frontend/src/views/PrepareView.vue`
- Test: `frontend/src/views/PrepareView.test.ts`

**Interfaces:**
- Consumes: Task 1의 한 흐름 구조
- Produces: `resumeTab` — `'file' | 'saved' | 'form' | 'paste'`

- [ ] **Step 1: 실패하는 테스트**

```ts
it('이력서 넣는 방법을 탭으로 접는다 — 한 번에 하나만 보인다', async () => {
  const w = mountView()
  await filled(w)
  expect(w.findAll('[data-test=resume-tab]').length).toBe(3) // 비로그인은 저장본 탭이 없다
  expect(w.find('[data-test=drop]').exists()).toBe(true)
  expect(w.find('[data-test=paste]').exists()).toBe(false)
  await w.findAll('[data-test=resume-tab]').at(-1)!.trigger('click')
  expect(w.find('[data-test=paste]').exists()).toBe(true)
  expect(w.find('[data-test=drop]').exists()).toBe(false)
})

it('로그인하면 저장본 탭이 생기고 그게 기본이다', async () => {
  const w = mountSignedInWithSlots()
  await filled(w)
  expect(w.findAll('[data-test=resume-tab]').length).toBe(4)
  expect(w.find('[data-test=saved-resumes]').exists()).toBe(true)
})
```

> `mountSignedInWithSlots`는 이 파일의 기존 로그인 마운트 방식을 따른다. 없으면 `account` 스토어에 슬롯을 하나 넣고 마운트하는 헬퍼를 만든다.

- [ ] **Step 2: 실패 확인**

Run: `pnpm test -- PrepareView`
Expected: FAIL — 탭이 없고 넷이 한꺼번에 보인다.

- [ ] **Step 3: 탭 상태**

```ts
type ResumeTab = 'saved' | 'file' | 'form' | 'paste'
/** 로그인해 슬롯이 있으면 거기서 꺼내 쓰는 게 가장 빠르다 — 그걸 기본 탭으로 */
const resumeTab = ref<ResumeTab>('file')
watch(
  savedResumes,
  (list) => {
    if (list.length && resumeTab.value === 'file') resumeTab.value = 'saved'
  },
  { immediate: true },
)
const resumeTabs = computed(() =>
  (savedResumes.value.length ? (['saved'] as ResumeTab[]) : []).concat([
    'file',
    'form',
    'paste',
  ]),
)
const TAB_LABEL: Record<ResumeTab, string> = {
  saved: '저장본에서',
  file: '파일 올리기',
  form: '직접 쓰기',
  paste: '붙여넣기',
}
```

- [ ] **Step 4: 탭 줄과 패널**

이력서 머리 아래에 탭 줄을 둔다:

```vue
<div class="tabs" role="tablist">
  <button
    v-for="t in resumeTabs"
    :key="t"
    type="button"
    role="tab"
    class="mono tab press"
    :class="{ on: resumeTab === t }"
    :aria-selected="resumeTab === t"
    data-test="resume-tab"
    @click="resumeTab = t"
  >
    {{ TAB_LABEL[t] }}
    <span v-if="t === 'saved'" class="mono count">{{ savedResumes.length }}</span>
  </button>
</div>
```

기존 네 덩이(저장본 목록 · 드롭존 · `ResumeForm` · 붙여넣기)를 각각 `v-if="resumeTab === '…'"`로 감싼다. **`ResumeForm`의 props·emit은 그대로 둔다** — 자리만 탭 안으로 옮긴다. `formOpen` 상태는 탭이 대신하므로 지운다.

- [ ] **Step 5: 테스트 + 전체**

Run: `pnpm test -- PrepareView` → PASS, 이어서 `pnpm test`

- [ ] **Step 6: 커밋**

```bash
git add frontend/src/views/PrepareView.vue frontend/src/views/PrepareView.test.ts
git commit -m "feat(frontend): 이력서 넣는 방법 넷을 탭으로 — 쓰지 않을 셋이 자리를 먹지 않게"
```

---

### Task 3: 시작 영역을 세 덩이로

**Files:**
- Modify: `frontend/src/views/PrepareView.vue`
- Test: `frontend/src/views/PrepareView.test.ts`

**Interfaces:**
- Produces: `.ben-box`(벤 전용 고지·동의 묶음), 가로 체크리스트, 시작 버튼 하나

- [ ] **Step 1: 실패하는 테스트**

```ts
it('벤 고지와 목소리 동의를 한 상자로 묶고, 벤일 때만 띄운다', async () => {
  const free = mountView()
  await filled(free)
  expect(free.find('[data-test=ben-box]').exists()).toBe(false)
  const ben = mountViewWithBen()
  await filled(ben)
  const box = ben.get('[data-test=ben-box]')
  expect(box.find('[data-test=ben-notice]').exists()).toBe(true)
  expect(box.find('[data-test=voice-consent-row]').exists()).toBe(true)
})

it('"목소리 없이 시작"은 버튼이 아니라 곁가지 링크다', async () => {
  const w = mountViewVoicePending()
  await filled(w)
  const alt = w.get('[data-test=start-voiceless]')
  expect(alt.element.tagName).toBe('BUTTON')
  expect(alt.classes()).toContain('link')
})
```

> `mountViewWithBen`·`mountViewVoicePending`은 기존 테스트가 벤·목소리 대기를 만드는 방식을 따른다(`interviewer` 스토어에 벤, `model.voicePending = true`).

- [ ] **Step 2: 실패 확인**

Run: `pnpm test -- PrepareView` → FAIL

- [ ] **Step 3: 벤 묶음**

면접관 안내(`.notice`)와 목소리 동의(`.voice-consent`)를 하나로 감싼다. **문구는 그대로 옮기기만 한다.**

```vue
<div v-if="iv.current?.premium" class="ben-box" data-test="ben-box">
  <p class="mono head">
    <span class="led" aria-hidden="true" />벤 면접이라 알려 드립니다
  </p>
  <!-- 아래 두 줄은 지금 문구 그대로 -->
  …
</div>
```

- [ ] **Step 4: 체크리스트를 가로로, 버튼은 하나로**

`.start-row` 안을 다시 짠다 — 체크리스트 `ul`에 `flex-direction: row; flex-wrap: wrap`, 그 아래 시작 버튼 하나. `목소리 없이 시작`은 `class="mono link press"`로 바꿔 버튼 옆 곁가지로 두고, `v-if="model.voicePending"`는 그대로다.

면접관 칩·`힌트 켜기`는 **입력 창 머리**로 올린다(Task 1에서 만든 `#tag` 옆).

- [ ] **Step 5: 테스트 + 전체 + 커밋**

```bash
pnpm test
git add frontend/src/views/PrepareView.vue frontend/src/views/PrepareView.test.ts
git commit -m "feat(frontend): 시작 영역을 세 덩이로 — 안내 여섯 줄 아래 묻혀 있던 버튼을 꺼낸다"
```

---

### Task 4: 두 기둥 배치

**Files:**
- Modify: `frontend/src/views/PrepareView.vue`
- Test: `frontend/src/views/PrepareView.test.ts`

**Interfaces:**
- Consumes: Task 1~3이 만든 내용 덩이들
- Produces: 최종 배치. Task 5·6의 벤 조절이 오른쪽 기둥 안으로 들어간다

- [ ] **Step 1: 실패하는 테스트**

```ts
it('상황판과 입력이 한 화면에 나란히 선다 — 기다리는 동안 입력한다', async () => {
  const w = mountView()
  await filled(w)
  expect(w.find('[data-test=status-rail]').exists()).toBe(true)
  const rail = w.get('[data-test=status-rail]')
  expect(rail.find('[data-test=progress]').exists()).toBe(true)
  expect(rail.find('[data-test=checklist]').exists()).toBe(true)
  expect(rail.find('[data-test=start]').exists()).toBe(true)
})
```

> `PixelProgress`에 `data-test="progress"`가 없으면 **감싸는 요소**에 붙인다. 컴포넌트 자체는 건드리지 않는다.

- [ ] **Step 2: 실패 확인** → FAIL

- [ ] **Step 3: 두 기둥으로 감싼다**

두 `<section class="snap">`을 하나로 합치고 안을 가른다:

```vue
<div class="cols">
  <aside class="rail" data-test="status-rail">
    <PixelWindow :title="TITLE[phase]" padding="sm"> … PixelProgress 그대로 … </PixelWindow>
    <div class="go"> … 체크리스트 · 시작 버튼 … </div>
  </aside>
  <div class="form"> … 입력 창 … </div>
</div>
```

```css
.cols {
  display: flex;
  gap: var(--sp-6);
  align-items: flex-start;
  max-width: var(--content-w);
  margin: 0 auto;
  padding: var(--sp-8) var(--sp-4);
}
.rail {
  flex: none;
  width: 376px;
  position: sticky;
  /* 전역 상단바 아래에 붙는다. 100vh는 쓰지 않는다 */
  top: calc(var(--topbar-h) + var(--sp-4));
  display: flex;
  flex-direction: column;
  gap: var(--sp-4);
}
.form {
  flex: 1 1 0;
  min-width: 0;
}
/* 좁으면 두 기둥이 안 선다 — 상황판이 위로 올라가 가로로 눕는다 */
@media (max-width: 1024px) {
  .cols {
    flex-direction: column;
  }
  .rail {
    width: 100%;
    position: static;
  }
}
```

- [ ] **Step 4: 출근 장면 배율 확인**

Run: `pnpm dev --port 5413 --strictPort`
브라우저에서 장면 요소의 실제 폭을 재고, **정수 배율**로 376px 안에 들어가는지 본다. 안 들어가면 **상황판 폭을 장면에 맞춰 올린다**(소수 배율로 줄이지 않는다).

- [ ] **Step 5: 테스트 + 눈으로**

| 확인 | 기대 |
|---|---|
| 1440px | 스크롤 없이 지원 정보·이력서를 다 넣을 수 있다 |
| 모델 완료 순간 | 왼쪽 버튼이 그 자리에서 켜지고 **레이아웃이 안 움직인다** |
| 1024px 아래 | 상황판이 위로 눕고 입력이 그대로 쓸 만하다 |

- [ ] **Step 6: 커밋**

```bash
pnpm test
git add frontend/src/views/PrepareView.vue frontend/src/views/PrepareView.test.ts
git commit -m "feat(frontend): 준비 화면 두 기둥 — 기다리는 4분을 입력하는 4분으로"
```

---

### Task 5: 벤 조절 — 다섯 줄 컴포넌트

**Files:**
- Create: `frontend/src/components/BenSettings.vue`
- Create: `frontend/src/components/BenSettings.test.ts`

**Interfaces:**
- Produces: `<BenSettings v-model="…" :show-company="…" />`
  - `modelValue`: `BenAxisValues` = `{ warmth: 0|1|2; followUp: 0|1|2; questionMix: 0|1|2; difficulty: 0|1|2; companyWeight: 0|1|2 }` — **눈금 위치**를 들고 있다(API 이름이 아니다)
  - `showCompany: boolean` — 거짓이면 회사 이야기 줄을 **아예 그리지 않는다**

- [ ] **Step 1: 실패하는 테스트**

```ts
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import BenSettings, { BEN_AXES, DEFAULT_BEN } from './BenSettings.vue'

const at = (w: ReturnType<typeof mount>, i: number) =>
  w.findAll('[data-test=ben-axis]')[i]

describe('BenSettings', () => {
  it('회사 트랙이면 다섯 줄, 아니면 넷 — 무시되는 칸을 고르게 두지 않는다', () => {
    const on = mount(BenSettings, { props: { modelValue: DEFAULT_BEN, showCompany: true } })
    expect(on.findAll('[data-test=ben-axis]')).toHaveLength(5)
    const off = mount(BenSettings, { props: { modelValue: DEFAULT_BEN, showCompany: false } })
    expect(off.findAll('[data-test=ben-axis]')).toHaveLength(4)
    expect(off.text()).not.toContain('회사 이야기')
  })

  it('고른 값의 이름과 한 줄 설명을 늘 띄운다 — 눈금만으로는 뭘 골랐는지 모른다', () => {
    const w = mount(BenSettings, { props: { modelValue: DEFAULT_BEN, showCompany: true } })
    expect(at(w, 0).find('[data-test=ben-value]').text()).toBe('날카롭게')
    expect(at(w, 0).find('[data-test=ben-hint]').text()).toContain('칭찬')
  })

  it('눈금을 옮기면 그 축만 바뀐 값을 올려 보낸다', async () => {
    const w = mount(BenSettings, { props: { modelValue: DEFAULT_BEN, showCompany: true } })
    const range = at(w, 0).get('input[type=range]')
    await range.setValue('2')
    expect(w.emitted('update:modelValue')![0][0]).toEqual({ ...DEFAULT_BEN, warmth: 2 })
  })

  it('화면 낭독기가 축 이름과 지금 값을 읽는다', () => {
    const w = mount(BenSettings, { props: { modelValue: DEFAULT_BEN, showCompany: true } })
    const range = at(w, 1).get('input[type=range]')
    expect(range.attributes('aria-label')).toBe('꼬리질문')
    expect(range.attributes('aria-valuetext')).toBe('보통')
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm test -- BenSettings`
Expected: FAIL — 파일이 없다.

- [ ] **Step 3: 축 표를 만든다**

`BenSettings.vue`의 `<script setup>` 위에 named export로 둔다(테스트와 스토어가 함께 쓴다):

```ts
/** 눈금 위치 0·1·2. API 이름은 보낼 때만 쓴다 — 화면은 위치만 안다 */
export type Notch = 0 | 1 | 2
export interface BenAxisValues {
  warmth: Notch
  followUp: Notch
  questionMix: Notch
  difficulty: Notch
  companyWeight: Notch
}
export interface BenAxis {
  key: keyof BenAxisValues
  label: string
  /** API 값 이름. 눈금 위치 그대로의 차례 */
  api: readonly [string, string, string]
  names: readonly [string, string, string]
  hints: readonly [string, string, string]
  /** 기본 눈금 — `docs/API.md`의 기본값과 같아야 한다 */
  base: Notch
}
export const BEN_AXES: readonly BenAxis[] = [
  {
    key: 'warmth',
    label: '말투',
    api: ['low', 'mid', 'high'],
    names: ['날카롭게', '보통', '부드럽게'],
    hints: ['칭찬 없이 짚고 넘어갑니다', '표준 말투입니다', '격려하며 묻습니다'],
    base: 0,
  },
  {
    key: 'followUp',
    label: '꼬리질문',
    api: ['low', 'mid', 'high'],
    names: ['적게', '보통', '많이'],
    hints: ['너무 짧을 때만', '질문당 2개까지', '근거가 안 보이면 파고듭니다'],
    base: 1,
  },
  {
    key: 'questionMix',
    label: '질문 성격',
    api: ['technical', 'balanced', 'personal'],
    names: ['직무 지식', '고루', '사람 · 동기'],
    hints: ['아는 것과 푸는 법을', '한쪽으로 몰지 않습니다', '협업 · 갈등 · 동기를'],
    base: 1,
  },
  {
    key: 'difficulty',
    label: '난이도',
    api: ['basic', 'practical', 'advanced'],
    names: ['기초', '실무', '심화'],
    hints: ['개념을 확인합니다', '해 본 일을 묻습니다', '왜 그걸 골랐는지까지'],
    base: 1,
  },
  {
    key: 'companyWeight',
    label: '회사 이야기',
    api: ['low', 'mid', 'high'],
    names: ['적게', '보통', '많이'],
    hints: ['회사 소식 1개', '회사 소식 1~2개', '회사 소식 2~3개'],
    base: 1,
  },
] as const
export const DEFAULT_BEN: BenAxisValues = Object.fromEntries(
  BEN_AXES.map((a) => [a.key, a.base]),
) as BenAxisValues
```

- [ ] **Step 4: 다섯 줄을 그린다**

```vue
<script setup lang="ts">
const props = defineProps<{ modelValue: BenAxisValues; showCompany: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [BenAxisValues] }>()
const axes = computed(() =>
  BEN_AXES.filter((a) => props.showCompany || a.key !== 'companyWeight'),
)
function move(key: keyof BenAxisValues, raw: string) {
  emit('update:modelValue', { ...props.modelValue, [key]: Number(raw) as Notch })
}
</script>

<template>
  <div class="axes">
    <div v-for="a in axes" :key="a.key" class="axis" data-test="ben-axis">
      <span class="mono label">{{ a.label }}</span>
      <input
        type="range"
        min="0"
        max="2"
        step="1"
        class="notch"
        :value="modelValue[a.key]"
        :aria-label="a.label"
        :aria-valuetext="a.names[modelValue[a.key]]"
        @input="move(a.key, ($event.target as HTMLInputElement).value)"
      />
      <span class="display value" data-test="ben-value">{{ a.names[modelValue[a.key]] }}</span>
      <span class="mono hint" data-test="ben-hint">{{ a.hints[modelValue[a.key]] }}</span>
    </div>
  </div>
</template>
```

스타일은 **눈금 셋이 보이게** 한다 — `input[type=range]`의 트랙에 `repeating-linear-gradient`로 세 칸을 긋고, 썸은 각진 노란 사각형(`::-webkit-slider-thumb`, `::-moz-range-thumb`). `border-radius`를 쓰지 않는다. 좁은 화면(≤720px)에서는 라벨과 값을 윗줄로 올리고 눈금이 가로를 다 쓰게 한다.

- [ ] **Step 5: 테스트**

Run: `pnpm test -- BenSettings` → PASS

- [ ] **Step 6: 커밋**

```bash
git add frontend/src/components/BenSettings.vue frontend/src/components/BenSettings.test.ts
git commit -m "feat(frontend): 벤 성향 다섯 줄 — 게임 설정 화면 어법의 눈금 셋"
```

---

### Task 6: 벤 조절 — 상태와 전송

**Files:**
- Modify: `frontend/src/views/PrepareView.vue` (펼치기 버튼과 자리)
- Modify: `frontend/src/stores/interview.ts` (값 보관)
- Modify: `frontend/src/services/benInterview.ts` (`StartCommon`에 `benSettings`)
- Test: `frontend/src/stores/interview.test.ts`, `frontend/src/views/PrepareView.test.ts`

**Interfaces:**
- Consumes: Task 5의 `BEN_AXES`·`DEFAULT_BEN`·`BenAxisValues`
- Produces: `benSettingsPayload(values)` — 기본과 다른 칸만 담은 객체, 없으면 `undefined`

- [ ] **Step 1: 실패하는 테스트 (변환이 핵심이다)**

`frontend/src/stores/interview.test.ts`에 더한다:

```ts
import { benSettingsPayload } from '@/stores/interview'
import { DEFAULT_BEN } from '@/components/BenSettings.vue'

describe('benSettingsPayload', () => {
  it('전부 기본이면 아무것도 보내지 않는다 — 지금 벤과 프롬프트가 글자까지 같아야 한다', () => {
    expect(benSettingsPayload(DEFAULT_BEN)).toBeUndefined()
  })

  it('바꾼 칸만 담는다', () => {
    expect(benSettingsPayload({ ...DEFAULT_BEN, warmth: 2 })).toEqual({ warmth: 'high' })
    expect(benSettingsPayload({ ...DEFAULT_BEN, difficulty: 0, followUp: 2 })).toEqual({
      followUp: 'high',
      difficulty: 'basic',
    })
  })

  it('눈금 위치를 API 이름으로 옮긴다', () => {
    expect(benSettingsPayload({ ...DEFAULT_BEN, questionMix: 0 })).toEqual({
      questionMix: 'technical',
    })
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm test -- interview`
Expected: FAIL — `benSettingsPayload`가 없다.

- [ ] **Step 3: 변환 함수**

`stores/interview.ts`에 둔다:

```ts
import { BEN_AXES, DEFAULT_BEN, type BenAxisValues } from '@/components/BenSettings.vue'

/** 기본과 다른 칸만 API 이름으로 담는다. 전부 기본이면 `undefined` —
 *  보내지 않아야 지금 벤과 프롬프트가 글자까지 같다(`docs/API.md`, 2026-11-07) */
export function benSettingsPayload(v: BenAxisValues): Record<string, string> | undefined {
  const out: Record<string, string> = {}
  for (const a of BEN_AXES) if (v[a.key] !== a.base) out[a.key] = a.api[v[a.key]]
  return Object.keys(out).length ? out : undefined
}
```

스토어 상태에 `benSettings: { ...DEFAULT_BEN }`을 더하고, `reset()`에서 기본으로 되돌린다.

- [ ] **Step 4: 요청에 싣는다**

`services/benInterview.ts`의 `StartCommon`에 더한다:

```ts
  /** 벤 성향(2026-11-07, 선택). 바꾼 칸만 보낸다 — 빠진 칸은 서버가 기본값으로 채운다 */
  benSettings?: Record<string, string>
```

면접을 시작하는 자리에서 `benSettingsPayload(this.benSettings)`를 넣는다. **`undefined`면 키 자체가 `JSON.stringify`에서 빠진다** — 그것이 "보내지 않는다"의 구현이다.

- [ ] **Step 5: 화면에 붙인다**

`PrepareView.vue` 면접관 줄에 `성향 ▾` 버튼(`data-test="ben-toggle"`, `v-if="iv.current?.premium"`)을 두고, 펼치면 `<BenSettings v-model="interview.benSettings" :show-company="benCompany && !!interview.profile.companyName" />`를 입력 창 머리 아래에 그린다. 머리에 `시작하면 잠깁니다`와 `전부 기본값으로` 링크를 둔다.

> `showCompany`에 넘길 조건은 **회사 트랙이고 회사 이름이 있을 때**다. 실제 필드 이름은 `interview.profile`에서 확인해 맞춘다.

- [ ] **Step 6: 화면 테스트**

```ts
it('무료 면접관에는 성향 버튼이 없다', async () => {
  const w = mountView()
  await filled(w)
  expect(w.find('[data-test=ben-toggle]').exists()).toBe(false)
})

it('벤이면 성향 버튼이 있고, 기본은 접혀 있다', async () => {
  const w = mountViewWithBen()
  await filled(w)
  expect(w.find('[data-test=ben-toggle]').exists()).toBe(true)
  expect(w.find('[data-test=ben-axis]').exists()).toBe(false)
  await w.get('[data-test=ben-toggle]').trigger('click')
  expect(w.findAll('[data-test=ben-axis]').length).toBeGreaterThan(0)
})
```

- [ ] **Step 7: 전체 테스트 + 게이트**

```bash
cd frontend
pnpm test && pnpm lint && pnpm exec prettier --check src && pnpm exec vue-tsc --noEmit && pnpm build
grep -rn "border-radius" src | grep -v "\.test\."   # base.css 리셋과 InterviewView 녹음 점 둘만
```

- [ ] **Step 8: 네트워크로 확인**

`pnpm dev`로 띄우고 벤 면접을 시작한다(목업 계정).
- 아무것도 안 건드리고 시작 → 요청 본문에 **`benSettings` 키가 없다**
- 말투만 옮기고 시작 → `{"benSettings":{"warmth":"high"}}`

- [ ] **Step 9: 커밋**

```bash
git add frontend/src
git commit -m "feat(frontend): 벤 성향을 시작 요청에 — 바꾼 칸만, 전부 기본이면 보내지 않는다"
```

---

## 끝낸 뒤

1. `feature/prepare-layout` → `dev` PR
2. Squash merge → demomo 재배포(2분)
3. **demomo에서 Review Focus 다섯 가지**. 특히 벤 면접을 **말투 `부드럽게`로 한 번 완주**해 면접관·리포트 말투가 실제로 달라지는지 본다(티켓 1장 소모).
4. 다음 plan: `2026-11-07-report-layout-design.md`의 plan.
