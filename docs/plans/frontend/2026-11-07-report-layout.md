# 리포트 레이아웃 — 구현 계획 (plan)

- 생성일시: 2026-11-07
- 기준 spec: `docs/specs/frontend/2026-11-07-report-layout-design.md`

**Goal:** 결론과 목차를 늘 보이는 자리에 두어, 문항이 열여섯이어도 끝까지 읽히는 리포트로 만든다.

**Architecture:** 신규 `ReportRail.vue`가 머리글·총평·문항 목차·액션을 맡고, `ReportView.vue`가 그것을 왼쪽에 세운다. 카드 두 벌(`ReportCards` 무료 / `ReportV2Cards` 벤)은 **안쪽 배치만** 바꾼다 — props는 그대로라 보관함이 같이 따라온다. 레일은 **보관함 상세(5번 spec)가 그대로 재사용**하므로 슬롯으로 열어 둔다.

**Tech Stack:** frontend: Vue 3 + TS + Vite + Pinia + Vitest

## Global Constraints

- **리포트 내용을 바꾸지 않는다.** 피드백 문구·육각형 축·측정 규칙은 백엔드·프롬프트 계약 그대로다. `/api` 변경 **없음** → lockstep 불필요.
- **예전에 저장된 리포트에 `profile`이 없다**(`docs/API.md` 396행). 그때 측정값 표를 그리는 현재 분기를 **그대로 유지**한다.
- `border-radius`를 쓰지 않는다. 색 리터럴은 `tokens.css`에만.
- 스크롤을 가로채지 않는다. `height: 100vh`를 쓰지 않는다(1번 철거 원칙).
- 부드러운 스크롤을 쓰지 않는다 — 16문항 거리에서 멀미가 난다.
- `ReportCards.vue`는 **보관함 상세도 쓴다.** 여기서 바꾼 것이 거기에 바로 나타난다.
- 매 Task 끝에 커밋한다. 커밋 메시지에 Claude/AI 저작 표기를 넣지 않는다.

## Review Focus

테스트가 잡지 못하는 자리. Task를 끝낸 뒤 **로컬 브라우저**, 전부 끝나면 **demomo**에서 본다.

- **목차를 눌러 간 뒤 브라우저 뒤로 가기가 읽던 자리로 돌아오는가** — 진짜 `<a href="#…">`여야만 된다.
- **PDF로 저장했을 때 접힌 축의 근거가 전부 들어가는가** — 종이에는 펴기 버튼이 없다.
- **예전에 저장한(프로필 없는) 벤 리포트**를 보관함에서 열어도 깨지지 않는가.
- **1920px에서 한 줄이 68자를 넘지 않는가.**
- **무료 리포트에서 레일이 헐겁지 않은가** — 총평·측정값이 없어 목차와 버튼만 남는다.

---

### Task 1: 읽기 토큰과 카드 속 배치

**Files:**
- Modify: `frontend/src/components/report/ReportCards.vue`
- Test: `frontend/src/components/report/ReportCards.test.ts`

**Interfaces:**
- Consumes: 2번 spec이 만든 `--font-read` · `--lh-read` · `--gap-card`
- Produces: 카드 한 장의 모양. `ReportV2Cards`가 Task 3에서 같은 모양을 따른다

- [ ] **Step 1: 실패하는 테스트**

```ts
it('질문이 제목 줄이 되고 시간이 그 줄 오른쪽에 붙는다 — "시간" 창이 사라지는 자리다', () => {
  const w = mount(ReportCards, {
    props: { report: [{ question: '자기소개를 해 주세요', feedback: '좋습니다' }], answers: [['네']], durations: [52_000] },
  })
  const head = w.get('[data-test=card-head]')
  expect(head.text()).toContain('Q1')
  expect(head.text()).toContain('자기소개를 해 주세요')
  expect(head.find('[data-test=card-time]').text()).toBe('0:52')
})

it('라벨을 본문 위로 올려 본문이 폭을 다 쓴다', () => {
  const src = readFileSync(join(__dirname, 'ReportCards.vue'), 'utf8')
  expect(src).not.toMatch(/grid-template-columns:\s*\d+px/) // 라벨이 가로폭을 먹던 자리
  expect(src).toMatch(/line-height:\s*var\(--lh-read\)/)
  expect(src).toMatch(/max-width:\s*var\(--read-w\)/)
})
```

> `durations` prop은 신규다. 없으면 시간 줄을 그리지 않는다(보관함은 아직 안 넘긴다).

- [ ] **Step 2: 실패 확인**

Run: `pnpm test -- ReportCards`
Expected: FAIL — `card-head`가 없고 `dl.kv`가 가로 배치다.

- [ ] **Step 3: `--read-w` 토큰을 더한다**

`styles/tokens.css`의 `--gap-card` 옆:

```css
  /* 읽는 글 한 줄의 상한. 넓은 모니터에서 폭을 다 쓰면 줄 끝에서 다음 줄 머리를 못 찾는다 */
  --read-w: 68ch;
```

`styles/tokens.test.ts`에 단언을 더한다: `expect(css).toMatch(/--read-w:/)`.

- [ ] **Step 4: 카드 속을 다시 짠다**

`PixelWindow`의 `:title`을 쓰지 않고 **카드 머리 줄**을 직접 그린다:

```vue
<div class="head" data-test="card-head">
  <span class="mono no">Q{{ i + 1 }}</span>
  <span class="display q">{{ it.question }}</span>
  <span v-if="durations?.[i] != null" class="mono t" data-test="card-time">
    {{ formatDuration(durations[i]) }}
  </span>
</div>
```

`dl.kv`를 세로 묶음으로 바꾼다 — 라벨은 본문 **위**에:

```vue
<div class="block">
  <span class="mono lbl">내 답변</span>
  <p v-for="(a, j) in answers[i]" :key="j" class="read">{{ a }}</p>
</div>
```

```css
.read {
  margin: 0;
  max-width: var(--read-w);
  font-family: var(--font-read);
  line-height: var(--lh-read);
}
```

카드 사이 여백은 `--gap-card`, 카드 안쪽 둘레 `--sp-5`, 블록 사이 `--sp-4`, 라벨·본문 사이 `--sp-1`. **바깥이 안보다 넓어야** 한 장으로 읽힌다.

- [ ] **Step 5: 강조는 카드마다 하나**

`splitEmphasis`가 `**…**`를 전부 칠한다. **첫 번째만** 칠한다:

```ts
/** 강조가 여럿이면 아무것도 강조되지 않는다 — 가장 앞의 하나만 남긴다 (2026-11-07) */
function firstEmphasis(parts: { text: string; strong: boolean }[]) {
  let used = false
  return parts.map((p) => {
    if (!p.strong) return p
    if (used) return { ...p, strong: false }
    used = true
    return p
  })
}
```

테스트로 묶는다:

```ts
it('강조는 카드마다 하나다 — 넷이 칠해지면 아무것도 강조되지 않는다', () => {
  const w = mount(ReportCards, {
    props: { report: [{ question: 'q', feedback: '**하나** 그리고 **둘**' }], answers: [[]] },
  })
  expect(w.findAll('.strong')).toHaveLength(1)
})
```

- [ ] **Step 6: 테스트 + 전체 + 커밋**

```bash
pnpm test
git add frontend/src/components/report/ReportCards.vue frontend/src/components/report/ReportCards.test.ts frontend/src/styles/tokens.css frontend/src/styles/tokens.test.ts
git commit -m "feat(frontend): 리포트 카드 속 — 라벨을 위로, 질문을 제목 줄로, 강조는 하나"
```

---

### Task 2: 레일

**Files:**
- Create: `frontend/src/components/report/ReportRail.vue`
- Create: `frontend/src/components/report/ReportRail.test.ts`

**Interfaces:**
- Produces: `<ReportRail :title :meta :summary :items :read :actions>`
  - `items`: `{ id: string; question: string; ms: number | null; follow: boolean }[]`
  - `summary`: `ReportV2Summary | null` — 무료는 `null`
  - `read`: `Set<string>` — 읽은 항목 id. Task 4가 채운다
  - 슬롯 `head`(머리글)와 `actions`(버튼) — **보관함 상세가 다른 것을 끼운다**

- [ ] **Step 1: 실패하는 테스트**

```ts
it('문항 목차를 진짜 링크로 만든다 — Tab 차례와 뒤로 가기가 거저 따라온다', () => {
  const w = rail()
  const a = w.findAll('[data-test=toc-item]')
  expect(a).toHaveLength(3)
  expect(a[0].element.tagName).toBe('A')
  expect(a[0].attributes('href')).toBe('#q1')
})

it('꼬리질문은 들여쓴다 — 16개가 평평하게 늘어서지 않게', () => {
  expect(rail().findAll('[data-test=toc-item].follow')).toHaveLength(1)
})

it('60초를 넘은 문항은 빨강으로, 개수는 목차 머리에 한 줄로', () => {
  const w = rail()
  expect(w.get('[data-test=toc-over]').text()).toContain('2')
  expect(w.findAll('[data-test=toc-item] .over')).toHaveLength(2)
})

it('읽은 문항을 표시하고 몇 개까지 읽었는지 적는다 — 끝이 보이면 덜 지친다', () => {
  const w = rail({ read: new Set(['q1']) })
  expect(w.get('[data-test=toc-read]').text()).toContain('1')
  expect(w.findAll('[data-test=toc-item].read')).toHaveLength(1)
})

it('총평이 없으면 그 자리를 비운다 — 무료 리포트에는 총평이 없다', () => {
  expect(rail({ summary: null }).find('[data-test=rail-summary]').exists()).toBe(false)
})
```

- [ ] **Step 2: 실패 확인** → 파일이 없다

- [ ] **Step 3: 컴포넌트**

머리글(슬롯) → 총평(`v-if="summary"`) → 목차 → 액션(슬롯). 목차는 `<nav aria-label="문항 목차">` 안의 `<a :href="'#' + it.id">`이고, 지금 보는 항목에 `aria-current="true"`를 단다.

```css
.rail {
  flex: none;
  width: 336px;
  position: sticky;
  top: calc(var(--topbar-h) + var(--sp-4));
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
  /* 목차만 따로 스크롤한다. 화면을 넘기면 레일 안에서만 움직인다 */
  max-height: calc(100svh - var(--topbar-h) - var(--sp-8));
}
.toc {
  flex: 1 1 0;
  min-height: 0;
  overflow-y: auto;
}
```

총평은 `<details>`로 접을 수 있게 둔다 — 긴 리포트에서 목차에 자리를 내준다. 기본은 펼친 채(`open`).

- [ ] **Step 4: 테스트 + 커밋**

```bash
pnpm test -- ReportRail
git add frontend/src/components/report/ReportRail.vue frontend/src/components/report/ReportRail.test.ts
git commit -m "feat(frontend): 리포트 레일 — 총평·문항 목차·액션을 한 기둥에"
```

---

### Task 3: 벤 카드의 측정값 접기

**Files:**
- Modify: `frontend/src/components/report/ReportV2Cards.vue`
- Modify: `frontend/src/components/report/ProfileHex.vue`
- Test: `frontend/src/components/report/ReportV2Cards.test.ts`

**Interfaces:**
- Consumes: Task 1의 카드 모양
- Produces: 없음

- [ ] **Step 1: 실패하는 테스트**

```ts
it('눈에 띄는 축은 근거까지 펼치고, 보통인 축은 이름만 한 줄로', () => {
  const w = cards(withVoice({
    confidence: { level: '보통', reason: '고른 음량' },
    tone: { level: '긴장', reason: '첫 문장에서 호흡이 짧음' },
    tremor: { present: false, reason: '고른 음높이' },
    trailingOff: { present: true, reason: '문장 끝 음량이 떨어짐' },
    clarity: { level: '좋음', reason: '자음이 또렷함' },
  }))
  // 긴장·끝 흐려짐은 근거까지
  expect(w.get('[data-test=voice-flag]').text()).toContain('첫 문장에서 호흡이 짧음')
  expect(w.findAll('[data-test=voice-flag]')).toHaveLength(2)
  // 나머지 셋은 이름만, 근거는 접힌 채
  expect(w.get('[data-test=voice-plain]').text()).toContain('자신감 보통')
  expect(w.text()).not.toContain('고른 음량')
})

it('접는 것은 보통인 축뿐이다 — "자신감 낮음"만 보이고 근거가 접히면 고칠 수가 없다', () => {
  const w = cards(withVoice({ confidence: { level: '낮음', reason: '수치를 말한 뒤 작아짐' } }))
  expect(w.text()).toContain('수치를 말한 뒤 작아짐')
})

it('예전에 저장된 리포트(프로필 없음)는 지금처럼 측정값 표를 그린다', () => {
  const w = cards({ profile: null })
  expect(w.find('[data-test=measure-rows]').exists()).toBe(true)
})
```

- [ ] **Step 2: 실패 확인** → FAIL

- [ ] **Step 3: "눈에 띄는가"를 한 곳에서 정한다**

```ts
/** 고칠 거리가 되는 축인가. 이 판단이 접기의 유일한 기준이다 —
 *  정상 범위는 이름만, 눈에 띄는 것은 근거까지 (2026-11-07) */
const PLAIN_LEVELS = new Set(['보통', '좋음', '적음', '없음'])
function isFlag(v: { level?: string; present?: boolean }) {
  if (typeof v.present === 'boolean') return v.present
  return !PLAIN_LEVELS.has(v.level ?? '')
}
```

- [ ] **Step 4: 카드 바닥 한 줄 + 펴기**

측정값 숫자(분당 음절·쉼·첫마디·군말)는 **가로 한 줄**로 편다. 목소리 다섯 축은 `isFlag`로 갈라, 눈에 띄는 것만 `data-test="voice-flag"`로 근거까지 그리고 나머지는 `data-test="voice-plain"` 한 줄로 모은다. `나머지 축 펴기 ▾`(`<details>`)를 바닥에 둔다.

- [ ] **Step 5: 육각형을 작게**

`ProfileHex`에 `size` prop(기본 180)을 더하고 카드에서는 110을 넘긴다. **`SIZE` 상수만 prop으로 빼고 계산식은 건드리지 않는다.**

- [ ] **Step 6: 테스트 + 전체 + 커밋**

```bash
pnpm test
git add frontend/src/components/report
git commit -m "feat(frontend): 벤 카드 측정값 접기 — 눈에 띄는 축만 근거까지"
```

---

### Task 4: 리포트 화면을 레일 배치로

**Files:**
- Modify: `frontend/src/views/ReportView.vue`
- Test: `frontend/src/views/ReportView.test.ts`

**Interfaces:**
- Consumes: Task 1~3
- Produces: 최종 배치. 5번 spec(보관함 상세)이 이 화면을 재사용한다

- [ ] **Step 1: 실패하는 테스트**

```ts
it('액션 묶음은 화면에 한 번만 나온다 — 길어서 생긴 땜질을 걷는다', () => {
  const w = view()
  expect(w.findAll('[data-test=copy]')).toHaveLength(1)
  expect(w.findAll('[data-test=print]')).toHaveLength(1)
  expect(w.findAll('[data-test=restart]')).toHaveLength(1)
})

it('"시간"이라는 창이 없다 — 문항별 시간은 목차 줄로 갔다', () => {
  const w = view()
  expect(w.find('[data-test=timing]').exists()).toBe(false)
  expect(w.get('[data-test=toc-over]').exists()).toBe(true)
})

it('레일에 총평·목차·액션이 모두 있다', () => {
  const rail = view().get('[data-test=report-rail]')
  expect(rail.find('[data-test=toc-item]').exists()).toBe(true)
  expect(rail.find('[data-test=print]').exists()).toBe(true)
})
```

- [ ] **Step 2: 실패 확인** → FAIL

- [ ] **Step 3: 두 기둥으로**

준비 화면과 같은 어법이다 — `.cols` / `.rail` / `.body`. 레일에 `ReportRail`을 세우고 머리글·액션 슬롯을 채운다. 본문에는 카드만 남긴다.

`items`는 `s.report`(또는 `s.reportV2`)와 `turnDurations`를 엮어 만든다:

```ts
const tocItems = computed(() =>
  (s.reportV2?.items ?? s.report ?? []).map((it, i) => ({
    id: s.reportV2 ? it.id : `q${i + 1}`,
    question: it.question,
    ms: turns.value[i]?.ms ?? null,
    follow: s.reportV2 ? it.kind === 'follow' : false,
  })),
)
```

**`overBy`·`overCount` 계산을 잃지 않는다** — "시간" 창을 없애면서 목차와 머리로 옮긴다.

- [ ] **Step 4: 지금 문항이 위에 붙는다**

본문 머리에 얇은 줄(`data-test="now"`)을 두고 번호·질문·시간·`n / 전체`를 적는다. 어느 카드를 보고 있는지는 `IntersectionObserver`로 정한다 — **`scrollTop`을 읽지 않는다.**

읽은 항목도 같은 관찰자가 모은다(한 번 읽으면 지우지 않는다).

- [ ] **Step 5: 목차 이동**

카드에 `:id="it.id"`를 달면 `<a href="#q4">`가 그대로 동작한다. **부드러운 스크롤을 넣지 않는다.** 도착한 카드에 `.landed`를 잠깐 붙여 노란 테두리를 켠다:

```css
.card.landed {
  outline: 2px solid var(--accent);
}
@media (prefers-reduced-motion: reduce) {
  /* 꺼지지 않고 켜진 채로 둔다 — 움직임을 줄이는 것이지 표시를 없애는 게 아니다 */
  .card.landed {
    outline: 2px solid var(--accent);
  }
}
```

- [ ] **Step 6: 테스트 + 눈으로**

| 확인 | 기대 |
|---|---|
| 1440px | 레일 336 + 본문 나란히, 레일이 붙어 따라온다 |
| 목차 클릭 | 그 카드로 **즉시** 이동, 테두리 켜짐 |
| 뒤로 가기 | 읽던 자리로 |
| 무료 리포트 | 총평 자리가 비고 목차·버튼만 |

- [ ] **Step 7: 커밋**

```bash
pnpm test
git add frontend/src/views/ReportView.vue frontend/src/views/ReportView.test.ts
git commit -m "feat(frontend): 리포트 두 기둥 — 결론과 목차를 늘 보이는 자리에"
```

---

### Task 5: 인쇄

**Files:**
- Modify: `frontend/src/styles/base.css` (`@media print`)
- Modify: `frontend/src/components/report/ReportV2Cards.vue` (접힌 것 펴기)
- Test: `frontend/src/styles/base.test.ts`

**Interfaces:**
- Consumes: Task 2~4

- [ ] **Step 1: 실패하는 테스트**

```ts
it('인쇄에서는 접힌 것을 전부 편다 — 종이에는 펴기 버튼이 없다', () => {
  expect(base).toMatch(/@media print[\s\S]*details\[open\]|@media print[\s\S]*details > \*/)
})

it('인쇄에서 레일과 목차를 뺀다 — 종이에는 고정 기둥이 없다', () => {
  expect(base).toMatch(/@media print[\s\S]*\.rail/)
})
```

- [ ] **Step 2: 실패 확인** → FAIL

- [ ] **Step 3: `@media print` 블록**

```css
@media print {
  /* 종이에는 고정 기둥도 목차도 없다 — 총평 → 문항 한 줄기로 편다 */
  .cols {
    display: block;
  }
  .rail .toc,
  .rail .actions {
    display: none;
  }
  /* 접힌 것은 전부 펴서 인쇄한다 — 펴기 버튼이 없으니 */
  details > summary {
    display: none;
  }
  details > *:not(summary) {
    display: revert;
  }
}
```

- [ ] **Step 4: 육각형은 선만**

인쇄 토큰에서 `--line`이 검정이므로 채움색만 뺀다:

```css
@media print {
  .hex .shape {
    fill: none;
  }
}
```

(`ProfileHex`의 값 다각형 클래스 이름을 먼저 확인해 맞춘다.)

- [ ] **Step 5: 눈으로**

브라우저에서 <kbd>Ctrl</kbd>+<kbd>P</kbd> 미리보기.
Expected: 레일 없음, 총평 → 문항 순서, **접혀 있던 목소리 축의 근거가 전부 보인다**, 육각형이 선으로 읽힌다.

- [ ] **Step 6: 게이트 전부 + 커밋**

```bash
cd frontend
pnpm test && pnpm lint && pnpm exec prettier --check src && pnpm exec vue-tsc --noEmit && pnpm build
git add frontend/src
git commit -m "feat(frontend): 리포트 인쇄 — 레일을 빼고 접힌 것을 전부 편다"
```

---

## 끝낸 뒤

1. `feature/report-layout` → `dev` PR
2. Squash merge → demomo 재배포(2분)
3. **demomo에서 Review Focus 다섯 가지.** 무료 리포트와 벤 리포트를 **모두** 연다(벤은 티켓 1장 소모). 예전에 저장한 프로필 없는 리포트도 보관함에서 한 번 연다.
4. 다음 plan: `2026-11-07-account-archive-layout-design.md`의 plan — 보관함 상세가 이 레일을 그대로 쓴다.
