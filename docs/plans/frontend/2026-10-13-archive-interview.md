# 보관함·면접 연결 (2/2) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 면접관 4명을 이름·등급으로 바꾸고, 면접이 끝나면 보관함에 남고, 보관함에서 다시 볼 수 있게 한다.

**Architecture:** 1/2에서 만든 `AccountApi` 목업 위에 얹는다. 리포트 본문을 공용 컴포넌트로 떼어 리포트 화면과 보관함 상세가 같은 것을 쓴다. 트랙(회사/대입)은 고른 면접관에서 끌어내고 스토어에 따로 들고 있지 않는다.

**Tech Stack:** Vue 3 + TypeScript, Pinia, Vitest(jsdom) + @vue/test-utils, pnpm

**Spec:** `docs/specs/frontend/2026-10-13-accounts-premium-design.md`
**계약 초안:** `docs/specs/frontend/2026-10-13-accounts-api-contract.md`
**앞 계획:** `docs/plans/frontend/2026-10-13-accounts-premium.md` (1/2 — 머지 완료 전제)

**시안(확정):** 보관함 **C(탭)** · 기록 상세 **B(좌우 2단)** · **점수 없음**
**디자인:** 야간 CRT — 흰색은 글자에만, 테두리는 `--line`, 켜짐/꺼짐은 LED 램프

## Global Constraints

- 게이트: `pnpm test && pnpm lint && pnpm exec prettier --check src && pnpm exec vue-tsc --noEmit && pnpm build`
- 색 리터럴 금지 — `tokens.css`의 토큰만. 새 색은 토큰을 먼저 추가한다(테스트가 막는다)
- `utils/`는 브라우저 API·DOM·스토어를 import하지 않는다. `services/`는 스토어를 모른다
- **`src/prompts/`·`src/services/llm.ts`·`deploy/`는 건드리지 않는다**(계층 규율). 페르소나 문구는 cw 몫
- 브랜치는 `dev`에서, PR base도 `dev`. 커밋은 Conventional Commits
- 새 요소에는 `data-test`. 모든 테스트는 목업으로 돌아 서버 없이 CI에서 통과해야 한다
- 커밋 메시지·PR 본문에 AI 저작 표기를 넣지 않는다
- **모션**: 계단식(`steps`)은 스프라이트·커서에만. UI 전환은 `var(--ease)`/`var(--dur-*)`

## Review Focus

tests가 다루지 않지만 사람이 먼저 밟을 입력들. 각 줄의 테스트는 해당 Task에 넣었다.

1. 비로그인이 면접을 마치면 **저장을 시도하다 조용히 실패**하거나 리포트가 안 보인다 → Task 6
2. 저장이 실패했는데 **성공한 것처럼 보여** 사용자가 보관함에 갔다가 없다 → Task 6
3. 벤을 고르고 트랙을 안 고른 채 **면접이 시작**된다 → Task 4
4. 회사 → 대입으로 면접관을 바꾸면 **앞 트랙의 입력이 남아** 엉뚱한 값으로 시작한다 → Task 5
5. 녹음 권한을 거절했는데 **면접이 막히거나** 티켓만 날아간다 → Task 7

---

## Task 1: 보관함 한도 계산 (순수 함수)

**Files:**
- Create: `frontend/src/utils/archive.ts`
- Test: `frontend/src/utils/archive.test.ts`

**Interfaces:**
- Consumes: 1/2의 `ArchiveEntry`(아직 없으면 이 Task에서 `services/account.ts`에 추가)
- Produces: `ARCHIVE_LIMIT`, `freeEntries`, `premiumEntries`, `willEvict`, `isFull`

**설계 메모:** 한도는 **일반 기록에만** 걸린다. 지우는 주체는 서버지만, 프론트도 "곧 하나가 사라집니다"를 미리 보여 줘야 해서 같은 계산이 필요하다.

- [x] **Step 1: `services/account.ts`에 보관함 타입 추가**

```ts
export type Track = 'company' | 'admission'

export interface ArchiveEntry {
  id: string
  interviewerId: string
  /** 벤으로 본 면접인가 — 한도에서 빠진다 */
  premium: boolean
  track: Track
  startedAt: string
  endedAt: string
  questionCount: number
  hasRecording: boolean
  /** track === 'company' */
  field?: string
  job?: string
  /** track === 'admission' */
  name?: string
  age?: number
  university?: string
  department?: string
}

export interface ArchiveDetail extends ArchiveEntry {
  messages: { role: 'user' | 'model'; text: string; at?: number }[]
  report: ReportItem[]
  reportRaw: string
  recordings: { turn: number; url: string }[]
}
```

`ReportItem`은 `utils/reportParser.ts`가 이미 내보낸다 — **새로 만들지 말고 import 한다**(`{ question, answerSummary, feedback }`).

`AccountApi`에 더한다:

```ts
  listArchive(): Promise<ArchiveEntry[]>
  getArchive(id: string): Promise<ArchiveDetail>
  saveArchive(draft: Omit<ArchiveDetail, 'id'>): Promise<{ entry: ArchiveEntry; evicted: string[] }>
  deleteArchive(id: string): Promise<void>
```

- [x] **Step 2: 실패 테스트 작성**

```ts
// frontend/src/utils/archive.test.ts
import { describe, it, expect } from 'vitest'
import { ARCHIVE_LIMIT, freeEntries, premiumEntries, willEvict, isFull } from './archive'
import type { ArchiveEntry } from '@/services/account'

/** 최신순 목록을 만든다(서버가 최신순으로 준다) */
const make = (n: number, premium = false): ArchiveEntry[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `${premium ? 'p' : 'f'}${i}`,
    interviewerId: 'm1',
    premium,
    track: 'company' as const,
    startedAt: `2026-10-${String(20 - i).padStart(2, '0')}T00:00:00Z`,
    endedAt: `2026-10-${String(20 - i).padStart(2, '0')}T00:20:00Z`,
    questionCount: 5,
    hasRecording: false,
  }))

describe('보관함 — 갈라 세기', () => {
  it('일반과 프리미엄을 갈라 센다', () => {
    const list = [...make(2), ...make(3, true)]
    expect(freeEntries(list)).toHaveLength(2)
    expect(premiumEntries(list)).toHaveLength(3)
  })

  it('빈 목록도 던지지 않는다', () => {
    expect(freeEntries([])).toEqual([])
    expect(isFull([])).toBe(false)
  })
})

describe('보관함 — 한도는 일반에만', () => {
  it(`일반이 ${ARCHIVE_LIMIT}개면 찼다`, () => {
    expect(isFull(make(ARCHIVE_LIMIT))).toBe(true)
  })

  it('하나 모자라면 아직 아니다', () => {
    expect(isFull(make(ARCHIVE_LIMIT - 1))).toBe(false)
  })

  it('프리미엄이 아무리 많아도 한도와 무관하다', () => {
    expect(isFull([...make(2), ...make(99, true)])).toBe(false)
  })
})

describe('willEvict — 다음에 무엇이 밀려나나', () => {
  it('차 있으면 가장 오래된 일반 하나다', () => {
    const list = make(ARCHIVE_LIMIT)
    expect(willEvict(list)?.id).toBe(`f${ARCHIVE_LIMIT - 1}`)
  })

  it('자리가 남으면 아무것도 안 밀려난다', () => {
    expect(willEvict(make(ARCHIVE_LIMIT - 1))).toBeNull()
  })

  it('프리미엄은 밀려나지 않는다 — 가장 오래된 게 프리미엄이어도', () => {
    const old = make(1, true).map((e) => ({ ...e, startedAt: '2020-01-01T00:00:00Z' }))
    const list = [...make(ARCHIVE_LIMIT), ...old]
    expect(willEvict(list)?.premium).toBe(false)
  })

  it('저장할 기록이 프리미엄이면 아무것도 안 밀려난다', () => {
    expect(willEvict(make(ARCHIVE_LIMIT), { premium: true })).toBeNull()
  })
})
```

- [x] **Step 3: 실패 확인**

Run: `cd frontend && pnpm exec vitest run utils/archive.test.ts`
Expected: FAIL — `Failed to resolve import "./archive"`

- [x] **Step 4: 구현**

```ts
// frontend/src/utils/archive.ts
/** 보관함 한도 (spec 4절). 한도는 **일반 기록에만** 걸린다.
 *  지우는 주체는 서버지만 "곧 하나가 사라집니다"를 미리 보여 주려면 프론트도 같은 계산이 필요하다. */
import type { ArchiveEntry } from '@/services/account'

export const ARCHIVE_LIMIT = 5

export const freeEntries = (list: readonly ArchiveEntry[]) => list.filter((e) => !e.premium)
export const premiumEntries = (list: readonly ArchiveEntry[]) => list.filter((e) => e.premium)

export const isFull = (list: readonly ArchiveEntry[]) => freeEntries(list).length >= ARCHIVE_LIMIT

/** 다음 기록을 저장하면 무엇이 밀려나나. 없으면 null */
export function willEvict(
  list: readonly ArchiveEntry[],
  next: { premium: boolean } = { premium: false },
): ArchiveEntry | null {
  if (next.premium || !isFull(list)) return null
  const free = freeEntries(list)
  // 서버가 최신순으로 준다. 가장 오래된 것은 끝
  return free[free.length - 1] ?? null
}
```

- [x] **Step 5: 통과 확인**

Run: `cd frontend && pnpm exec vitest run utils/archive.test.ts`
Expected: PASS

- [x] **Step 6: 커밋**

```bash
git add frontend/src/utils/archive.ts frontend/src/utils/archive.test.ts frontend/src/services/account.ts
git commit -m "feat(frontend): 보관함 한도 계산 — 한도는 일반 기록에만 걸린다"
```

---

## Task 2: 보관함 목업 + 스토어

**Files:**
- Modify: `frontend/src/services/accountMock.ts`, `frontend/src/stores/account.ts`
- Test: `frontend/src/services/accountMock.test.ts`, `frontend/src/stores/account.test.ts`

**Interfaces:**
- Consumes: Task 1의 타입과 `ARCHIVE_LIMIT`
- Produces: 목업의 보관함 네 메서드, 스토어 state `archive`, actions `refreshArchive` · `saveArchive` · `getArchive` · `deleteArchive`, getter `archiveFull`

- [x] **Step 1: 실패 테스트 작성 (목업)**

`accountMock.test.ts`에 더한다:

```ts
describe('mockAccount — 보관함', () => {
  const draft = (premium = false) => ({
    interviewerId: premium ? 'm2' : 'm1',
    premium,
    track: 'company' as const,
    startedAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
    questionCount: 5,
    hasRecording: false,
    field: 'it',
    job: '백엔드 개발자',
    messages: [{ role: 'model' as const, text: '자기소개를 해 주세요' }],
    report: [{ question: 'Q1', answerSummary: 'A', feedback: 'F' }],
    reportRaw: '{}',
    recordings: [],
  })

  beforeEach(async () => { await api.signUp('a@b.com', 'pw123456') })

  it('저장하면 목록에 나온다', async () => {
    await api.saveArchive(draft())
    expect(await api.listArchive()).toHaveLength(1)
  })

  it('목록은 최신순이다', async () => {
    const first = await api.saveArchive({ ...draft(), startedAt: '2026-10-01T00:00:00Z' })
    const second = await api.saveArchive({ ...draft(), startedAt: '2026-10-09T00:00:00Z' })
    expect((await api.listArchive())[0].id).toBe(second.entry.id)
    expect((await api.listArchive())[1].id).toBe(first.entry.id)
  })

  it('목록은 가볍다 — 대화·리포트는 담기지 않는다', async () => {
    await api.saveArchive(draft())
    const row = (await api.listArchive())[0] as Record<string, unknown>
    expect(row.messages).toBeUndefined()
    expect(row.report).toBeUndefined()
  })

  it('상세는 대화와 리포트를 담는다', async () => {
    const { entry } = await api.saveArchive(draft())
    const full = await api.getArchive(entry.id)
    expect(full.report).toHaveLength(1)
    expect(full.messages).toHaveLength(1)
  })

  it('일반이 5개를 넘으면 가장 오래된 것이 밀려난다 — 서버가 지운다', async () => {
    const ids: string[] = []
    for (let i = 0; i < 5; i++)
      ids.push((await api.saveArchive({ ...draft(), startedAt: `2026-10-0${i + 1}T00:00:00Z` })).entry.id)
    const r = await api.saveArchive({ ...draft(), startedAt: '2026-10-09T00:00:00Z' })
    expect(r.evicted).toEqual([ids[0]])
    expect(await api.listArchive()).toHaveLength(5)
  })

  it('프리미엄 기록은 한도에 들어가지 않는다', async () => {
    for (let i = 0; i < 5; i++) await api.saveArchive(draft())
    const r = await api.saveArchive(draft(true))
    expect(r.evicted).toEqual([])
    expect(await api.listArchive()).toHaveLength(6)
  })

  it('지우면 사라진다', async () => {
    const { entry } = await api.saveArchive(draft())
    await api.deleteArchive(entry.id)
    expect(await api.listArchive()).toHaveLength(0)
  })

  it('남의 기록은 보이지도 지워지지도 않는다', async () => {
    const { entry } = await api.saveArchive(draft())
    await api.signOut()
    await api.signUp('other@b.com', 'pw123456')
    expect(await api.listArchive()).toHaveLength(0)
    await expect(api.getArchive(entry.id)).rejects.toMatchObject({ code: 'unauthorized' })
  })

  it('비로그인은 저장하지 못한다', async () => {
    await api.signOut()
    await expect(api.saveArchive(draft())).rejects.toMatchObject({ code: 'unauthorized' })
  })
})
```

`stores/account.test.ts`에 더한다:

```ts
describe('account 스토어 — 보관함', () => {
  beforeEach(async () => { await useAccountStore().signUp('a@b.com', 'pw123456') })

  it('저장하면 목록이 갱신된다', async () => {
    const a = useAccountStore()
    await a.saveArchive(DRAFT)
    expect(a.archive).toHaveLength(1)
  })

  it('밀려난 기록을 알려 준다 — 사라졌다고 말해 줘야 한다', async () => {
    const a = useAccountStore()
    for (let i = 0; i < 5; i++) await a.saveArchive({ ...DRAFT, startedAt: `2026-10-0${i + 1}T00:00:00Z` })
    const r = await a.saveArchive({ ...DRAFT, startedAt: '2026-10-09T00:00:00Z' })
    expect(r?.evicted).toHaveLength(1)
  })

  it('찼는지 알려 준다', async () => {
    const a = useAccountStore()
    for (let i = 0; i < 5; i++) await a.saveArchive(DRAFT)
    expect(a.archiveFull).toBe(true)
  })

  it('로그아웃하면 보관함도 비운다', async () => {
    const a = useAccountStore()
    await a.saveArchive(DRAFT)
    await a.signOut()
    expect(a.archive).toEqual([])
  })

  it('저장이 실패하면 null을 돌려주고 error에 담는다 — 성공한 척하지 않는다', async () => {
    const a = useAccountStore()
    await a.signOut()
    expect(await a.saveArchive(DRAFT)).toBeNull()
    expect(a.error?.code).toBe('unauthorized')
  })
})
```

- [x] **Step 2: 실패 확인**

Run: `cd frontend && pnpm exec vitest run services/accountMock.test.ts stores/account.test.ts`
Expected: FAIL — `api.saveArchive is not a function`

- [x] **Step 3: 목업 구현**

`Db`에 `archive: ArchiveDetail[]` 를 더하고 `owner`를 그대로 쓴다. `saveArchive`는:

```ts
async saveArchive(d) {
  await wait()
  const db = load()
  const u = current(db)
  const entry: ArchiveDetail = { ...d, id: newId('a') }
  db.archive.push(entry)
  db.owner[entry.id] = u.userId
  // 한도는 서버가 집행한다. 두 곳에서 세면 어긋난다
  const mine = db.archive.filter((e) => db.owner[e.id] === u.userId)
  const free = mine.filter((e) => !e.premium).sort((a, b) => b.startedAt.localeCompare(a.startedAt))
  const evicted = free.slice(ARCHIVE_LIMIT).map((e) => e.id)
  for (const id of evicted) {
    db.archive = db.archive.filter((e) => e.id !== id)
    delete db.owner[id]
  }
  save(db)
  return { entry: strip(entry), evicted }
}
```

`strip`은 상세에서 목록용 필드만 남긴다(`messages`·`report`·`reportRaw`·`recordings` 제거). 목록이 가벼워야 상세를 따로 받는 뜻이 있다.

- [x] **Step 4: 스토어 구현**

state에 `archive: [] as ArchiveEntry[]`, getter `archiveFull: (s) => isFull(s.archive)`,
actions `refreshArchive` · `saveArchive`(저장 후 `refreshArchive`) · `getArchive` · `deleteArchive`.
`signOut`과 `load`에서 `archive`도 함께 비우고 채운다.

- [x] **Step 5: 통과 확인**

Run: `cd frontend && pnpm exec vitest run services stores`
Expected: PASS

- [x] **Step 6: 커밋**

```bash
git add frontend/src/services frontend/src/stores
git commit -m "feat(frontend): 보관함 목업과 스토어 — 한도는 서버(목업)가 집행한다"
```

---

## Task 3: 리포트 본문을 공용 컴포넌트로

**Files:**
- Create: `frontend/src/components/report/ReportCards.vue`
- Modify: `frontend/src/views/ReportView.vue`
- Test: `frontend/src/components/report/ReportCards.test.ts`

**Interfaces:**
- Consumes: `ReportItem`(`utils/reportParser`), `answersForReport`
- Produces: `ReportCards` — props `{ report: ReportItem[]; answers: string[][] }`

**설계 메모:** 리포트 화면과 보관함 상세가 **같은 것**을 보여 준다. 두 벌을 만들면 둘이 어긋난다. 지금 `ReportView`의 `v-for="(it, i) in s.report"` 블록을 그대로 떼어 낸다 — 모양을 바꾸지 않는다.

- [x] **Step 1: 실패 테스트 작성**

```ts
// frontend/src/components/report/ReportCards.test.ts
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import ReportCards from './ReportCards.vue'

const report = [
  { question: '지원 동기는?', answerSummary: '동아리 경험', feedback: '구체적입니다' },
  { question: '어려웠던 점은?', answerSummary: '일정 지연', feedback: '본인 역할이 흐립니다' },
]
const answers = [['동아리에서 웹을 만들었습니다'], []]
const w = () => mount(ReportCards, { props: { report, answers } })

describe('ReportCards', () => {
  it('문항 수만큼 카드를 그린다', () => {
    expect(w().findAll('[data-test=card]')).toHaveLength(2)
  })

  it('질문에 번호를 붙인다', () => {
    expect(w().get('[data-test=card]').text()).toContain('Q1')
  })

  it('내 답변과 피드백을 보여 준다', () => {
    const t = w().get('[data-test=card]').text()
    expect(t).toContain('동아리에서 웹을 만들었습니다')
    expect(t).toContain('구체적입니다')
  })

  it('답변이 없으면 없다고 적는다 — 빈칸이면 버그처럼 보인다', () => {
    expect(w().findAll('[data-test=card]')[1].text()).toContain('답변 없음')
  })

  it('답변 목록이 짧아도 던지지 않는다', () => {
    const short = mount(ReportCards, { props: { report, answers: [] } })
    expect(short.findAll('[data-test=card]')).toHaveLength(2)
  })
})
```

- [x] **Step 2: 실패 확인**

Run: `cd frontend && pnpm exec vitest run components/report/ReportCards.test.ts`
Expected: FAIL — 파일 없음

- [x] **Step 3: `ReportView`에서 떼어 내기**

`ReportView.vue`의 `<template v-else-if="s.report">` 안쪽 `PixelWindow v-for` 블록과 그에 딸린 `.kv`·`.answers`·`.strong` 스타일을 `ReportCards.vue`로 옮긴다. `splitEmphasis`도 함께 옮긴다.

`ReportView`는 이렇게 줄어든다:

```vue
<ReportCards v-else-if="s.report" :report="s.report" :answers="answers" />
```

- [x] **Step 4: 통과 확인 — 리포트 화면이 그대로인지**

Run: `cd frontend && pnpm exec vitest run components/report views/ReportView.test.ts`
Expected: PASS. **`ReportView.test.ts`를 고치지 않고 통과해야 한다** — 고쳐야 한다면 모양이 바뀐 것이다

- [x] **Step 5: 커밋**

```bash
git add frontend/src/components/report frontend/src/views/ReportView.vue
git commit -m "refactor(frontend): 리포트 본문을 공용 컴포넌트로 — 보관함 상세와 같은 것을 쓴다"
```

---

## Task 4: 면접관 4명 — 이름·순서·등급·벤 게이트

**Files:**
- Modify: `frontend/src/interviewers/index.ts`, `frontend/src/components/InterviewerPicker.vue`
- Create: `frontend/src/utils/track.ts`
- Test: `frontend/src/utils/track.test.ts`, `frontend/src/components/InterviewerPicker.test.ts`

**Interfaces:**
- Consumes: 1/2의 `useAccountStore`
- Produces: `Interviewer`에 `displayName` · `track` · `premium` 추가, `trackOf(id, chosen)`, `canStartWith(ctx)`

**설계 메모 (spec 3·5절):**

| 순서 | 이름 | 기존 id | 트랙 | 등급 |
|---|---|---|---|---|
| 1 | 데이빗 | `m1` | 회사 | 무료 |
| 2 | 쥴리 | `f2` | 회사 | 무료 |
| 3 | 올리비아 | `f3` | 대입 | 무료 |
| 4 | 벤 | `m2` | **둘 다** | **프리미엄** |

기본 면접관은 **데이빗(`m1`)**. 스프라이트·목소리는 그대로 쓴다. **페르소나 문구는 건드리지 않는다**(cw 몫).

- [x] **Step 1: `utils/track.ts` 실패 테스트**

```ts
// frontend/src/utils/track.test.ts
import { describe, it, expect } from 'vitest'
import { trackOf, canStartWith } from './track'

describe('trackOf — 고른 면접관이 트랙을 정한다', () => {
  it.each([
    ['m1', 'company'],
    ['f2', 'company'],
    ['f3', 'admission'],
  ] as const)('%s는 %s', (id, want) => {
    expect(trackOf(id, null)).toBe(want)
  })

  it('벤은 고를 때까지 트랙이 없다 — 둘 다 보기 때문이다', () => {
    expect(trackOf('m2', null)).toBeNull()
  })

  it('벤은 사용자가 고른 쪽을 따른다', () => {
    expect(trackOf('m2', 'admission')).toBe('admission')
    expect(trackOf('m2', 'company')).toBe('company')
  })

  it('벤이 아니면 고른 값을 무시한다 — 올리비아는 늘 대입이다', () => {
    expect(trackOf('f3', 'company')).toBe('admission')
  })

  it('면접관을 안 골랐으면 트랙도 없다', () => {
    expect(trackOf(null, null)).toBeNull()
  })
})

describe('canStartWith — 트랙별 시작 조건', () => {
  const base = { modelReady: true, resumeDone: true }
  const company = { ...base, track: 'company' as const, field: 'it', job: '백엔드' }
  const admission = {
    ...base, track: 'admission' as const,
    name: '홍길동', age: 19, university: '한국대', department: '컴퓨터공학과',
  }

  it('회사는 분야·직무·이력서가 차면 시작한다', () => {
    expect(canStartWith(company)).toBe(true)
  })

  it('회사는 직무가 비면 못 시작한다', () => {
    expect(canStartWith({ ...company, job: '  ' })).toBe(false)
  })

  it('대입은 다섯 칸이 다 차야 시작한다', () => {
    expect(canStartWith(admission)).toBe(true)
    expect(canStartWith({ ...admission, university: '' })).toBe(false)
    expect(canStartWith({ ...admission, age: null })).toBe(false)
  })

  it('트랙이 없으면 못 시작한다 — 벤을 고르고 트랙을 안 골랐을 때', () => {
    expect(canStartWith({ ...company, track: null })).toBe(false)
  })

  it('모델이 안 됐으면 못 시작한다', () => {
    expect(canStartWith({ ...company, modelReady: false })).toBe(false)
  })

  it('이력서가 없으면 못 시작한다', () => {
    expect(canStartWith({ ...admission, resumeDone: false })).toBe(false)
  })
})
```

- [x] **Step 2: 실패 확인 → 구현**

Run: `cd frontend && pnpm exec vitest run utils/track.test.ts` → FAIL

```ts
// frontend/src/utils/track.ts
/** 트랙은 고른 면접관이 정한다 (spec 5절). 둘 다 보는 벤만 사용자가 고른다.
 *  스토어에 트랙을 따로 들고 있지 않는다 — 두 군데에 있으면 어긋난다. */
import type { Track } from '@/services/account'
import { interviewerById, type InterviewerId } from '@/interviewers'

export function trackOf(id: InterviewerId | null, chosen: Track | null): Track | null {
  const iv = interviewerById(id)
  if (!iv) return null
  return iv.track ?? chosen
}

export interface StartContext {
  track: Track | null
  modelReady: boolean
  resumeDone: boolean
  field?: string | null
  job?: string
  name?: string
  age?: number | null
  university?: string
  department?: string
}

const filled = (v?: string) => (v ?? '').trim().length > 0

export function canStartWith(c: StartContext): boolean {
  if (!c.track || !c.modelReady || !c.resumeDone) return false
  if (c.track === 'company') return Boolean(c.field) && filled(c.job)
  return filled(c.name) && c.age !== null && c.age !== undefined &&
    filled(c.university) && filled(c.department)
}
```

`interviewers/index.ts`의 `Interviewer`에 `displayName: string`, `track: Track | null`, `premium: boolean`을 더하고 목록을 위 표 순서로 바꾼다. `DEFAULT_INTERVIEWER = 'm1'`.

- [x] **Step 3: 고르기 화면 실패 테스트**

```ts
it('카드 순서가 데이빗·쥴리·올리비아·벤이다', () => { /* data-test 순서 확인 */ })
it('벤 카드에 프리미엄 배지가 붙는다', () => { /* [data-test=badge-premium] */ })
it('비로그인이 벤을 누르면 선택되지 않고 요금제를 띄운다', async () => {
  /* iv.id는 그대로, emit('need-premium') 한 번 */
})
it('티켓이 0장이면 프리미엄이어도 요금제를 띄운다 — 다 쓰면 다시 사야 한다', async () => {})
it('티켓이 있으면 벤이 선택되고 남은 수가 보인다', async () => { /* 티켓 7 */ })
it('티켓이 없어도 카드를 흐리게 하지 않는다 — 누를 수 있어야 길이 열린다', () => {})
it('벤을 고르면 대입/회사 선택이 펼쳐진다', async () => { /* [data-test=track-pick] */ })
it('트랙을 고르기 전에는 선택이 끝나지 않는다', async () => { /* trackOf → null */ })
it('다른 면접관을 고르면 트랙 선택이 사라진다', async () => { /* 숨김 */ })
```

- [x] **Step 4: 구현 → 통과 확인**

**확정된 모양(2026-10-13 시안):** 가로 4열 유지 · 벤에 **모서리 리본 배지**(사선 삼각형 + `P`, CSS로 그린다) · 카드에 남은 티켓 램프.

**흐리게 하거나 잠그지 않는다.** 티켓이 없어도 평범하게 눌리고, 조건에 따라 요금제 모달로 보낸다 — 막는 버튼이 아니라 길을 여는 버튼이다.

```
비로그인          → need-premium emit (선택 안 됨)
로그인 · 티켓 0장  → need-premium emit (선택 안 됨)
티켓 1장 이상      → 선택되고 대입/회사 선택이 펼쳐진다
```

조건은 **등급이 아니라 티켓 수**다(`account.tickets > 0`). 프리미엄인데 다 쓴 사람도 다시 사야 한다.

Run: `cd frontend && pnpm exec vitest run utils/track.test.ts components/InterviewerPicker.test.ts`
Expected: PASS

- [x] **Step 5: 커밋**

```bash
git add frontend/src/interviewers frontend/src/utils/track.ts frontend/src/utils/track.test.ts frontend/src/components/InterviewerPicker.vue frontend/src/components/InterviewerPicker.test.ts
git commit -m "feat(frontend): 면접관 4명 — 이름·순서·트랙·벤 프리미엄 게이트"
```

---

## Task 5: 준비 화면 — 트랙별 입력

**Files:**
- Modify: `frontend/src/stores/interview.ts`, `frontend/src/views/PrepareView.vue`
- Test: `frontend/src/views/PrepareView.test.ts`, `frontend/src/stores/interview.test.ts`

**Interfaces:**
- Consumes: Task 4의 `trackOf` · `canStartWith`
- Produces: 스토어 `profile`이 트랙별 모양, getter `track` · `canStart`가 `canStartWith`를 쓴다

**설계 메모 (spec 5절):** 2단계 구조(`지원 정보` → `이력서`)는 그대로 두고 **안의 칸만** 바꾼다.

| 트랙 | 1단계 | 2단계 |
|---|---|---|
| 회사 | 기업 분야 · 지원 직무 | 이력서 |
| 대입 | 이름 · 나이 · **지원 대학** · **지원 학과** | 자기소개서 |

- [x] **Step 1: 스토어 실패 테스트**

```ts
it('면접관에서 트랙을 끌어낸다 — 따로 들고 있지 않는다', () => { /* iv=f3 → 'admission' */ })
it('대입 입력이 다 차야 시작할 수 있다', () => { /* 5칸 */ })
it('면접관을 바꿔 트랙이 바뀌면 앞 트랙의 입력은 쓰지 않는다', () => {
  /* 회사 입력을 채운 뒤 올리비아로 바꾸면 canStart=false */
})
it('로그인 사용자의 이름·나이로 대입 입력을 미리 채운다', () => { /* prefillFromProfile */ })
```

- [x] **Step 2: 실패 확인 → 구현**

```ts
// stores/interview.ts
profile: {
  field: null as Field | null,
  job: '',
  name: '',
  age: null as number | null,
  university: '',
  department: '',
},
```

한 덩어리로 두고 트랙이 쓰는 칸만 본다. 유니온 타입으로 가르면 화면에서 분기가 늘기만 한다 — `canStartWith`가 트랙별로 볼 칸을 이미 안다.

getter:

```ts
track(): Track | null {
  return trackOf(useInterviewerStore().id, this.chosenTrack)
},
canStart(): boolean {
  return canStartWith({
    track: this.track,
    modelReady: useModelStore().ready,
    resumeDone: this.resumeDone,
    ...this.profile,
  })
},
```

- [x] **Step 3: 화면 실패 테스트**

```ts
it('올리비아를 고르면 대입 5칸이 나온다', async () => { /* me-name 등 */ })
it('데이빗을 고르면 회사 칸이 나온다', async () => { /* 분야 칩 + job */ })
it('2단계 제목이 트랙에 따라 이력서/자기소개서로 바뀐다', async () => {})
it('대입에서 다섯 칸을 다 채워야 시작 버튼이 열린다', async () => {})
it('로그인 사용자는 저장한 이력서를 불러올 수 있다', async () => { /* [data-test=load-resume] */ })
```

- [x] **Step 4: 구현 → 통과 확인**

`지원 직무` 칸 자리에 트랙별 칸을 넣는다. **라벨은 `지원 대학`**(출신 고교가 아니다).
로그인 사용자는 `account.profile`로 이름·나이를 미리 채우고, 저장한 이력서를 고르는 줄을 2단계에 둔다.

Run: `cd frontend && pnpm exec vitest run views/PrepareView.test.ts stores/interview.test.ts`
Expected: PASS

- [x] **Step 5: 커밋**

```bash
git add frontend/src/stores/interview.ts frontend/src/views/PrepareView.vue frontend/src/views/PrepareView.test.ts frontend/src/stores/interview.test.ts
git commit -m "feat(frontend): 준비 화면 트랙별 입력 — 회사 3칸 / 대입 5칸"
```

---

## Task 6: 면접이 끝나면 보관함에 남긴다

**Files:**
- Modify: `frontend/src/stores/interview.ts`, `frontend/src/views/ReportView.vue`
- Test: `frontend/src/stores/interview.test.ts`, `frontend/src/views/ReportView.test.ts`

**Interfaces:**
- Consumes: Task 2의 `useAccountStore.saveArchive`, Task 1의 `willEvict`
- Produces: `finish()`가 리포트를 받은 뒤 저장, state `archiveSaved` · `archiveEvicted`

**설계 메모:** 리포트가 **다 나온 뒤** 저장한다. 중간에 저장하면 반쪽짜리가 남는다. 비로그인은 저장하지 않고, 대신 리포트 화면에서 **로그인하면 보관할 수 있다**고 알린다 — 전환이 가장 잘 일어나는 자리다(spec 6절).

- [x] **Step 1: 실패 테스트**

```ts
it('로그인 상태로 면접을 마치면 보관함에 남는다', async () => { /* account.archive 1개 */ })
it('비로그인은 저장하지 않는다 — 조용히 실패하지도 않는다', async () => {
  /* archive 0, error 없음, reportStatus는 done */
})
it('리포트가 실패하면 저장하지 않는다 — 반쪽짜리를 남기지 않는다', async () => {})
it('저장이 실패하면 리포트는 그대로 보이고 안내만 뜬다', async () => {
  /* reportStatus done, archiveSaved false */
})
it('밀려난 기록이 있으면 알려 준다', async () => { /* archiveEvicted 1 */ })
it('벤으로 본 면접은 premium: true로 저장된다', async () => {})
it('finish가 두 번 불려도 한 번만 저장한다', async () => {})
```

ReportView:

```ts
it('비로그인에게 로그인하면 보관할 수 있다고 알린다', () => { /* [data-test=save-cta] */ })
it('저장되면 보관함에 남았다고 알린다', () => { /* [data-test=saved] */ })
it('밀려난 기록이 있으면 사라졌다고 알린다', () => { /* [data-test=evicted] */ })
it('저장에 실패하면 실패했다고 말한다 — 성공한 척하지 않는다', () => {})
```

- [x] **Step 2: 실패 확인 → 구현**

`finish()` 끝(`reportStatus = 'done'` 직후)에서:

```ts
// 리포트가 다 나온 뒤에만 남긴다. 중간에 저장하면 반쪽짜리가 된다
const account = useAccountStore()
if (!account.signedIn) return
const r = await account.saveArchive({ ...this.archiveDraft() })
this.archiveSaved = r !== null
this.archiveEvicted = r?.evicted ?? []
```

`archiveDraft()`는 스토어가 이미 가진 값으로 `ArchiveDetail`을 만든다(트랙별 칸 포함, `questionCount = report.length`).

- [x] **Step 3: 통과 확인**

Run: `cd frontend && pnpm exec vitest run stores/interview.test.ts views/ReportView.test.ts`
Expected: PASS

- [x] **Step 4: 커밋**

```bash
git add frontend/src/stores/interview.ts frontend/src/views/ReportView.vue frontend/src/stores/interview.test.ts frontend/src/views/ReportView.test.ts
git commit -m "feat(frontend): 면접이 끝나면 보관함에 남긴다 — 리포트가 다 나온 뒤에만"
```

---

## Task 7: 보관함 모달 (탭 C) + 기록 상세 (2단 B)

**Files:**
- Create: `frontend/src/components/account/ArchiveModal.vue`, `frontend/src/components/account/ArchiveDetail.vue`
- Modify: `frontend/src/components/TopBar.vue`
- Test: `frontend/src/components/account/ArchiveModal.test.ts`

**Interfaces:**
- Consumes: Task 2 스토어, Task 3 `ReportCards`, Task 1 `freeEntries`/`premiumEntries`
- Produces: `ArchiveModal` — props `{ open }`, emit `close` · `need-premium`

**설계 메모 — 시안 C+B:**
- 탭 `전체 n` / `일반 n/5` / `★ 프리미엄 n`
- 줄: 면접관 스프라이트(92px) · 이름 · 트랙 대상 · 메타(날짜 · 소요 시간 · 분야 · 질문 수 · 녹음) · 오른쪽 끝 `›`
- **점수는 없다.** 리포트 파서가 내지 않는 값이다
- 프리미엄 탭이 비어도 **숨기지 않고** 권유 자리로 쓴다
- 상세는 같은 모달 안에서 갈아 낀다. 왼쪽 위 `← 보관함`, 왼쪽에 문항 목록, 오른쪽에 `ReportCards` 한 장

- [x] **Step 1: 실패 테스트**

```ts
it('탭 셋을 그리고 개수를 적는다', () => {})
it('전체 탭에서 프리미엄 줄에 P 배지가 붙는다', () => {})
it('일반 탭은 일반만, 프리미엄 탭은 프리미엄만 보여 준다', async () => {})
it('비었으면 아직 없다고 적는다', () => {})
it('프리미엄 탭이 비면 숨기지 않고 권유를 띄운다', async () => { /* [data-test=premium-cta] */ })
it('권유를 누르면 요금제를 연다', async () => { /* emit need-premium */ })
it('줄을 누르면 상세로 갈아 낀다 — 모달은 하나다', async () => {})
it('상세의 뒤로가기로 목록에 돌아온다', async () => {})
it('상세가 리포트 카드를 그린다', async () => {})
it('상세에서 지우면 목록으로 돌아가고 줄이 사라진다', async () => {})
it('닫았다 열면 목록부터 시작한다', async () => {})
it('5개가 차면 다음에 하나가 사라진다고 미리 알린다', async () => {})
```

- [x] **Step 2: 실패 확인 → 구현**

`PixelModal`을 `width="wide"`로 쓴다. 상세는 **같은 모달 안에서** `view` 상태로 갈아 끼운다(쌓지 않는다).
목록·상세 모두 **요금 카드와 같이 `clamp`로 높이를 묶어** 작은 화면에서 스크롤이 덜 생기게 한다.

- [x] **Step 3: TopBar에 연결**

```vue
<ArchiveModal :open="open === 'archive'" @close="open = null" @need-premium="open = 'premium'" />
```

`TopBar.test.ts`의 "빈 모달" 전제가 있으면 함께 고친다.

- [x] **Step 4: 통과 확인**

Run: `cd frontend && pnpm exec vitest run components`
Expected: PASS

- [x] **Step 5: 커밋**

```bash
git add frontend/src/components
git commit -m "feat(frontend): 보관함 모달과 기록 상세 — 탭으로 가르고 리포트는 공용 컴포넌트로"
```

---

## Task 8: 프리미엄 녹음

**Files:**
- Create: `frontend/src/services/recorder.ts`
- Modify: `frontend/src/stores/interview.ts`, `frontend/src/components/interview/AnswerInput.vue`, `frontend/src/components/account/ArchiveDetail.vue`
- Test: `frontend/src/services/recorder.test.ts`, `frontend/src/stores/interview.test.ts`

**Interfaces:**
- Consumes: `MediaRecorder`, Task 2의 `uploadRecording`(목업은 Blob URL)
- Produces: `startRecording(): Promise<Recorder | null>` — 권한 거절·미지원이면 `null`

**설계 메모:** 녹음은 **프리미엄 면접에서만**. 권한을 거절해도 **면접은 그대로 진행된다** — 녹음은 덤이지 조건이 아니다. 티켓은 이미 썼으니 막으면 안 된다.

- [x] **Step 1: 실패 테스트**

```ts
it('지원하지 않는 브라우저에서는 null을 준다', async () => { /* MediaRecorder 없음 */ })
it('권한을 거절하면 null을 준다 — 던지지 않는다', async () => {})
it('녹음을 멈추면 Blob을 돌려준다', async () => {})
```

스토어:

```ts
it('프리미엄 면접이 아니면 녹음을 시작하지 않는다', async () => {})
it('권한을 거절해도 면접은 시작된다', async () => { /* stage가 진행된다 */ })
it('녹음이 없으면 hasRecording: false로 저장된다', async () => {})
```

- [x] **Step 2: 실패 확인 → 구현**

`services/recorder.ts`는 `navigator.mediaDevices.getUserMedia`와 `MediaRecorder`를 감싸고 **어떤 실패에도 던지지 않는다**(`null`). 스토어는 `null`이면 그냥 녹음 없이 간다.

답변 턴마다 끊어 저장하고(`turn` 번호), 면접이 끝나면 `uploadRecording`으로 올린다.
**상한**: 한 기록당 합계가 30MB를 넘으면 더 녹음하지 않고 안내한다(cw가 정한 값이 오면 그 값으로).

- [x] **Step 3: 상세에서 재생**

`ArchiveDetail`의 문항마다 녹음이 있으면 재생 줄을 둔다. 없으면 그 줄을 그리지 않는다.

- [x] **Step 4: 통과 확인 + 전체 게이트**

Run:
```bash
cd frontend && pnpm test && pnpm lint && pnpm exec prettier --check src && pnpm exec vue-tsc --noEmit && pnpm build
```
Expected: 전부 통과. 린트 경고는 기존 4건 그대로

- [x] **Step 5: 커밋**

```bash
git add frontend/src
git commit -m "feat(frontend): 프리미엄 면접 녹음 — 거절해도 면접은 그대로 간다"
```

---

## 마무리

- [ ] 브라우저에서 완주: 벤 고르기(비프리미엄 → 요금제) → 결제 → 벤 + 대입 → 5칸 입력 → 면접 → 리포트 → 보관함에 남음 → 상세에서 다시 보기 → 녹음 재생
- [ ] 일반 면접 6번째를 마치면 가장 오래된 것이 사라지고 **사라졌다고 알려 주는지**
- [ ] 비로그인으로 면접을 마치면 **로그인 권유**가 뜨고 기록은 안 남는지
- [ ] 창을 작게 줄여도 보관함·상세에 스크롤이 과하지 않은지
- [ ] `docs/demo-checklist.md`에 "보관함·면접 연결" 절 추가
- [ ] PR base는 `dev`. 본문에 **아직 목업**이라는 점과 cw에게 남은 질문 셋(벤 엔드포인트·녹음 상한·`CLAUDE.md` 8번)을 다시 적는다

**이 계획 뒤에 남는 것:** cw의 실제 API가 나오면 `services/account.ts`의 구현만 `httpAccount`로 갈아 끼운다. 화면 코드는 바뀌지 않는다.
