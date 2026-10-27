# 계정·프리미엄 (1/2) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 로그인·등급·프리미엄 결제(목업)·이력서 슬롯을 API 없이 동작하는 상태로 만든다.

**Architecture:** 서버 접점을 `AccountApi` 인터페이스 하나로 좁히고 그 뒤에 `mockAccount`(localStorage)를 둔다. 화면은 `stores/account.ts`만 본다. 모달은 `PixelModal` 하나를 공유하고 한 번에 하나만 뜬다.

**Tech Stack:** Vue 3 + TypeScript, Pinia, Vitest(jsdom) + @vue/test-utils, pnpm

**Spec:** `docs/specs/frontend/2026-10-13-accounts-premium-design.md`
**계약 초안:** `docs/specs/frontend/2026-10-13-accounts-api-contract.md`
**시안(확정):** `C:\Users\Monta\Desktop\momo-시안\final.html` — 내정보 **A** · 보관함 **C** · 상세 **B** · **점수 없음**

**이 계획의 범위:** 1/2 — 계정·등급·결제·이력서.
**2/2(별도 계획):** 리포트 카드 공용화 · 보관함/상세 · 면접관 4명 개편 · 트랙별 준비 화면 · 면접 저장·티켓 차감 · 녹음.

## Global Constraints

- 패키지 매니저는 **pnpm**. 게이트: `pnpm test && pnpm lint && pnpm exec prettier --check src && pnpm exec vue-tsc --noEmit && pnpm build`
- 색 리터럴 금지 — `src/styles/tokens.css`의 토큰만 쓴다. 새 색이 필요하면 토큰을 먼저 추가한다
- `utils/`는 브라우저 API·DOM·스토어를 import하지 않는다. `services/`는 스토어를 import하지 않는다. 화면은 스토어만 본다
- `src/prompts/`·`src/services/llm.ts`·`deploy/`는 **건드리지 않는다**(계층 규율)
- 커밋은 Conventional Commits. `feat(frontend):` / `fix(frontend):` / `test(frontend):`
- 브랜치는 `dev`에서 끊고 PR base도 `dev`
- 모든 테스트는 **목업으로** 돈다. 서버 없이 CI에서 통과해야 한다
- 새 요소에는 `data-test` 속성을 붙인다(기존 화면 규약)
- 커밋 메시지·PR 본문에 AI 저작 표기를 넣지 않는다

## Review Focus

tests가 다루지 않지만 사람이 먼저 밟을 입력들. 각 줄의 테스트는 해당 Task에 넣었다.

1. `localStorage`가 막힌 브라우저(사생활 모드)에서 목업이 던지면 **앱 전체가 죽는다** → Task 1
2. 로그인 모달을 열어 둔 채 `Esc`를 두 번 누르거나 바깥을 빠르게 두 번 클릭 → **닫기가 두 번 호출** → Task 3
3. 결제 중(2초 대기) 모달을 닫거나 버튼을 다시 누르면 **티켓이 20장**이 된다 → Task 6
4. 이력서 슬롯이 3개 찬 상태에서 `새로 만들기`를 눌렀을 때 — 서버가 없으니 프론트가 막아야 한다 → Task 7
5. 로그아웃 후에도 이전 사용자의 이력서가 스토어에 남아 다음 로그인에 보인다 → Task 2

---

## Task 1: 계정 계약과 목업 구현

**Files:**
- Create: `frontend/src/services/account.ts`
- Create: `frontend/src/services/accountMock.ts`
- Test: `frontend/src/services/accountMock.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces: `AccountApi`, `Session`, `Profile`, `ResumeSlot`, `ResumeDraft`, `ResumeKind`, `AccountError`, `mockAccount`, `account`(기본 구현)

- [ ] **Step 1: 실패 테스트 작성**

```ts
// frontend/src/services/accountMock.test.ts
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { makeMockAccount } from './accountMock'
import { AccountError } from './account'

let api: ReturnType<typeof makeMockAccount>
beforeEach(() => {
  localStorage.clear()
  api = makeMockAccount({ delayMs: 0 })
})
afterEach(() => vi.restoreAllMocks())

describe('mockAccount — 인증', () => {
  it('가입하면 세션이 나오고 member 등급이다', async () => {
    const s = await api.signUp('a@b.com', 'pw123456')
    expect(s.email).toBe('a@b.com')
    expect(s.tier).toBe('member')
    expect(s.tickets).toBe(0)
  })

  it('같은 이메일로 또 가입하면 email_taken', async () => {
    await api.signUp('a@b.com', 'pw123456')
    await expect(api.signUp('a@b.com', 'pw999999')).rejects.toMatchObject({ code: 'email_taken' })
  })

  it('중복 검사는 가입 여부를 알려 준다', async () => {
    expect(await api.emailTaken('a@b.com')).toBe(false)
    await api.signUp('a@b.com', 'pw123456')
    expect(await api.emailTaken('a@b.com')).toBe(true)
  })

  it('비밀번호가 짧으면 weak_password', async () => {
    await expect(api.signUp('a@b.com', '123')).rejects.toMatchObject({ code: 'weak_password' })
  })

  it('없는 계정과 틀린 비밀번호는 같은 오류다 — 계정 존재 여부를 흘리지 않는다', async () => {
    await api.signUp('a@b.com', 'pw123456')
    const missing = await api.signIn('none@b.com', 'pw123456').catch((e) => e)
    const wrong = await api.signIn('a@b.com', 'nope1234').catch((e) => e)
    expect(missing.code).toBe('bad_credentials')
    expect(wrong.code).toBe('bad_credentials')
  })

  it('로그인 상태는 새로고침을 넘어 남는다', async () => {
    await api.signUp('a@b.com', 'pw123456')
    expect((await makeMockAccount({ delayMs: 0 }).me())?.email).toBe('a@b.com')
  })

  it('로그아웃하면 me가 null이다 — 비로그인은 오류가 아니다', async () => {
    await api.signUp('a@b.com', 'pw123456')
    await api.signOut()
    expect(await api.me()).toBeNull()
  })

  it('구글 로그인은 같은 이메일이면 기존 계정에 붙는다', async () => {
    const first = await api.signUp('g@b.com', 'pw123456')
    await api.signOut()
    const again = await api.signInWithGoogle('g@b.com')
    expect(again.userId).toBe(first.userId)
  })
})

describe('mockAccount — 프리미엄', () => {
  it('결제하면 프리미엄 + 티켓 10장', async () => {
    await api.signUp('a@b.com', 'pw123456')
    const s = await api.purchasePremium()
    expect(s.tier).toBe('premium')
    expect(s.tickets).toBe(10)
  })

  it('이미 프리미엄이면 10장을 더한다', async () => {
    await api.signUp('a@b.com', 'pw123456')
    await api.purchasePremium()
    expect((await api.purchasePremium()).tickets).toBe(20)
  })

  it('티켓을 쓰면 하나 준다', async () => {
    await api.signUp('a@b.com', 'pw123456')
    await api.purchasePremium()
    expect((await api.spendTicket()).tickets).toBe(9)
  })

  it('티켓이 없으면 no_tickets', async () => {
    await api.signUp('a@b.com', 'pw123456')
    await expect(api.spendTicket()).rejects.toMatchObject({ code: 'no_tickets' })
  })

  it('비로그인은 unauthorized', async () => {
    await expect(api.purchasePremium()).rejects.toMatchObject({ code: 'unauthorized' })
  })
})

describe('mockAccount — 이력서 슬롯', () => {
  beforeEach(async () => { await api.signUp('a@b.com', 'pw123456') })

  it('저장하면 목록에 나온다', async () => {
    await api.saveResume({ kind: 'company', title: '백엔드', text: 'x'.repeat(60) })
    const list = await api.listResumes()
    expect(list).toHaveLength(1)
    expect(list[0].kind).toBe('company')
  })

  it('종류마다 3개까지다', async () => {
    for (let i = 0; i < 3; i++)
      await api.saveResume({ kind: 'admission', title: `자소서 ${i}`, text: 'x'.repeat(60) })
    await expect(
      api.saveResume({ kind: 'admission', title: '넷째', text: 'x'.repeat(60) }),
    ).rejects.toMatchObject({ code: 'slot_full', kind: 'admission' })
    // 다른 종류는 아직 빈다
    await expect(
      api.saveResume({ kind: 'company', title: '이력서', text: 'x'.repeat(60) }),
    ).resolves.toBeTruthy()
  })

  it('id를 주면 덮어쓴다 — 한도를 먹지 않는다', async () => {
    const made = await api.saveResume({ kind: 'company', title: '전', text: 'x'.repeat(60) })
    const again = await api.saveResume({ id: made.id, kind: 'company', title: '후', text: 'y'.repeat(60) })
    expect(again.id).toBe(made.id)
    expect((await api.listResumes())).toHaveLength(1)
  })

  it('지우면 자리가 난다', async () => {
    const made = await api.saveResume({ kind: 'company', title: 'x', text: 'x'.repeat(60) })
    await api.deleteResume(made.id)
    expect(await api.listResumes()).toHaveLength(0)
  })

  it('다른 사람의 이력서는 보이지 않는다', async () => {
    await api.saveResume({ kind: 'company', title: '내 것', text: 'x'.repeat(60) })
    await api.signOut()
    await api.signUp('other@b.com', 'pw123456')
    expect(await api.listResumes()).toHaveLength(0)
  })
})

describe('mockAccount — 저장이 막힌 브라우저', () => {
  it('읽기가 던져도 비로그인으로 뜬다', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied') })
    expect(await makeMockAccount({ delayMs: 0 }).me()).toBeNull()
  })

  it('쓰기가 던져도 가입은 성공한다 — 이번 세션만 유지된다', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied') })
    const s = await makeMockAccount({ delayMs: 0 }).signUp('a@b.com', 'pw123456')
    expect(s.email).toBe('a@b.com')
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `cd frontend && pnpm exec vitest run services/accountMock.test.ts`
Expected: FAIL — `Failed to resolve import "./accountMock"`

- [ ] **Step 3: 타입과 계약 작성**

```ts
// frontend/src/services/account.ts
/** 서버 접점 하나 (spec 9절). 뒤에 목업과 실제 fetch 구현을 갈아 끼운다 */

export type Tier = 'member' | 'premium'
export type ResumeKind = 'admission' | 'company'

/** 대입 면접에서 미리 채울 값. 내정보에서 고친다 */
export interface Profile {
  name: string | null
  age: number | null
}

export interface Session {
  userId: string
  email: string
  tier: Tier
  /** 프리미엄 면접 남은 횟수. member는 항상 0 */
  tickets: number
  profile: Profile
  createdAt: string
}

export interface ResumeSlot {
  id: string
  kind: ResumeKind
  title: string
  /** company면 이력서 원문, admission이면 자기소개서 원문 */
  text: string
  updatedAt: string
}

/** id가 있으면 덮어쓰기, 없으면 새 슬롯 */
export interface ResumeDraft {
  id?: string
  kind: ResumeKind
  title: string
  text: string
}

export type AccountErrorCode =
  | 'email_taken'
  | 'weak_password'
  | 'bad_credentials'
  | 'unauthorized'
  | 'no_tickets'
  | 'slot_full'
  | 'network'

/** 화면이 코드로 분기한다. message는 사람이 읽는 문구 */
export class AccountError extends Error {
  constructor(
    readonly code: AccountErrorCode,
    message: string,
    readonly kind?: ResumeKind,
  ) {
    super(message)
    this.name = 'AccountError'
  }
}

export interface AccountApi {
  me(): Promise<Session | null>
  emailTaken(email: string): Promise<boolean>
  signUp(email: string, password: string): Promise<Session>
  signIn(email: string, password: string): Promise<Session>
  /** 실제 구현은 리다이렉트. 목업은 이메일을 직접 받는다 */
  signInWithGoogle(email?: string): Promise<Session>
  signOut(): Promise<void>
  saveProfile(profile: Profile): Promise<Session>

  listResumes(): Promise<ResumeSlot[]>
  saveResume(draft: ResumeDraft): Promise<ResumeSlot>
  deleteResume(id: string): Promise<void>

  purchasePremium(): Promise<Session>
  spendTicket(): Promise<Session>
}

export const PASSWORD_MIN = 8
export const RESUME_SLOTS = 3
export const PREMIUM_TICKETS = 10
```

- [ ] **Step 4: 목업 구현**

```ts
// frontend/src/services/accountMock.ts
/** localStorage 위의 가짜 서버. 화면을 API 없이 완성하기 위한 것이다(spec 9절).
 *  저장이 막힌 브라우저에서도 던지지 않는다 — 이번 세션만 기억을 잃는다 */
import {
  AccountError, PASSWORD_MIN, PREMIUM_TICKETS, RESUME_SLOTS,
  type AccountApi, type Profile, type ResumeDraft, type ResumeSlot, type Session,
} from './account'

const KEY = 'momo.mock.account'

interface User extends Session { password: string }
interface Db { users: User[]; resumes: ResumeSlot[]; owner: Record<string, string>; sessionId: string | null }

const empty = (): Db => ({ users: [], resumes: [], owner: {}, sessionId: null })

function load(): Db {
  try {
    const raw = localStorage.getItem(KEY)
    const v: unknown = raw ? JSON.parse(raw) : null
    if (!v || typeof v !== 'object') return empty()
    return { ...empty(), ...(v as Db) }
  } catch {
    return empty()
  }
}
function save(db: Db) {
  try {
    localStorage.setItem(KEY, JSON.stringify(db))
  } catch {
    /* 사생활 모드 — 이번 세션만 유지 */
  }
}

const id = (p: string) => `${p}_${Math.random().toString(36).slice(2, 10)}`
const now = () => new Date().toISOString()
const strip = (u: User): Session => {
  const { password: _p, ...rest } = u
  return rest
}

export function makeMockAccount(opts: { delayMs?: number } = {}): AccountApi {
  const wait = () => new Promise((r) => setTimeout(r, opts.delayMs ?? 300))

  /** 로그인한 사용자. db를 함께 돌려 호출부가 저장할 수 있게 한다 */
  function current(db: Db): User {
    const u = db.users.find((x) => x.userId === db.sessionId)
    if (!u) throw new AccountError('unauthorized', '로그인이 필요합니다')
    return u
  }

  return {
    async me() {
      await wait()
      const db = load()
      const u = db.users.find((x) => x.userId === db.sessionId)
      return u ? strip(u) : null
    },

    async emailTaken(email) {
      await wait()
      return load().users.some((u) => u.email === email)
    },

    async signUp(email, password) {
      await wait()
      const db = load()
      if (db.users.some((u) => u.email === email))
        throw new AccountError('email_taken', '이미 가입된 이메일입니다')
      if (password.length < PASSWORD_MIN)
        throw new AccountError('weak_password', `비밀번호는 ${PASSWORD_MIN}자 이상이어야 합니다`)
      const u: User = {
        userId: id('u'), email, password, tier: 'member', tickets: 0,
        profile: { name: null, age: null }, createdAt: now(),
      }
      db.users.push(u)
      db.sessionId = u.userId
      save(db)
      return strip(u)
    },

    async signIn(email, password) {
      await wait()
      const db = load()
      const u = db.users.find((x) => x.email === email && x.password === password)
      // 계정 없음과 비밀번호 틀림을 구분하지 않는다
      if (!u) throw new AccountError('bad_credentials', '이메일 또는 비밀번호가 올바르지 않습니다')
      db.sessionId = u.userId
      save(db)
      return strip(u)
    },

    async signInWithGoogle(email = 'google.user@gmail.com') {
      await wait()
      const db = load()
      let u = db.users.find((x) => x.email === email)
      if (!u) {
        u = {
          userId: id('u'), email, password: '', tier: 'member', tickets: 0,
          profile: { name: null, age: null }, createdAt: now(),
        }
        db.users.push(u)
      }
      db.sessionId = u.userId
      save(db)
      return strip(u)
    },

    async signOut() {
      await wait()
      const db = load()
      db.sessionId = null
      save(db)
    },

    async saveProfile(profile: Profile) {
      await wait()
      const db = load()
      const u = current(db)
      u.profile = profile
      save(db)
      return strip(u)
    },

    async listResumes() {
      await wait()
      const db = load()
      const u = current(db)
      return db.resumes.filter((r) => db.owner[r.id] === u.userId)
    },

    async saveResume(draft: ResumeDraft) {
      await wait()
      const db = load()
      const u = current(db)
      const mine = db.resumes.filter((r) => db.owner[r.id] === u.userId)
      if (draft.id) {
        const found = mine.find((r) => r.id === draft.id)
        if (!found) throw new AccountError('unauthorized', '없는 이력서입니다')
        Object.assign(found, { kind: draft.kind, title: draft.title, text: draft.text, updatedAt: now() })
        save(db)
        return found
      }
      if (mine.filter((r) => r.kind === draft.kind).length >= RESUME_SLOTS)
        throw new AccountError('slot_full', `${RESUME_SLOTS}개를 모두 썼습니다`, draft.kind)
      const slot: ResumeSlot = {
        id: id('r'), kind: draft.kind, title: draft.title, text: draft.text, updatedAt: now(),
      }
      db.resumes.push(slot)
      db.owner[slot.id] = u.userId
      save(db)
      return slot
    },

    async deleteResume(rid) {
      await wait()
      const db = load()
      const u = current(db)
      if (db.owner[rid] !== u.userId) throw new AccountError('unauthorized', '없는 이력서입니다')
      db.resumes = db.resumes.filter((r) => r.id !== rid)
      delete db.owner[rid]
      save(db)
    },

    async purchasePremium() {
      await wait()
      const db = load()
      const u = current(db)
      u.tier = 'premium'
      u.tickets += PREMIUM_TICKETS
      save(db)
      return strip(u)
    },

    async spendTicket() {
      await wait()
      const db = load()
      const u = current(db)
      if (u.tickets <= 0) throw new AccountError('no_tickets', '남은 티켓이 없습니다')
      u.tickets -= 1
      save(db)
      return strip(u)
    },
  }
}

/** 앱이 쓰는 구현. 실제 API가 생기면 여기만 갈아 끼운다 */
export const account: AccountApi = makeMockAccount()
```

- [ ] **Step 5: 통과 확인**

Run: `cd frontend && pnpm exec vitest run services/accountMock.test.ts`
Expected: PASS, 전부 통과

- [ ] **Step 6: 커밋**

```bash
git add frontend/src/services/account.ts frontend/src/services/accountMock.ts frontend/src/services/accountMock.test.ts
git commit -m "feat(frontend): 계정 서비스 계약과 localStorage 목업 — API 없이 화면을 만들기 위한 경계"
```

---

## Task 2: account 스토어

**Files:**
- Create: `frontend/src/stores/account.ts`
- Test: `frontend/src/stores/account.test.ts`

**Interfaces:**
- Consumes: Task 1의 `AccountApi` · `AccountError` · `Session` · `ResumeSlot` · `ResumeDraft`
- Produces: `useAccountStore` — state `{ session, resumes, loading, error }`, getters `{ signedIn, tier, tickets, isPremium, slotsOf(kind) }`, actions `{ load, signUp, signIn, signInWithGoogle, signOut, saveProfile, refreshResumes, saveResume, deleteResume, purchasePremium, spendTicket }`, `setAccountApi(api)`

- [ ] **Step 1: 실패 테스트 작성**

```ts
// frontend/src/stores/account.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useAccountStore, setAccountApi } from './account'
import { makeMockAccount } from '@/services/accountMock'

beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
  setAccountApi(makeMockAccount({ delayMs: 0 }))
})

describe('account 스토어', () => {
  it('처음에는 비로그인이다', async () => {
    const a = useAccountStore()
    await a.load()
    expect(a.signedIn).toBe(false)
    expect(a.tier).toBeNull()
  })

  it('가입하면 로그인 상태가 된다', async () => {
    const a = useAccountStore()
    await a.signUp('a@b.com', 'pw123456')
    expect(a.signedIn).toBe(true)
    expect(a.tier).toBe('member')
    expect(a.isPremium).toBe(false)
  })

  it('결제하면 프리미엄이 되고 티켓이 10장이다', async () => {
    const a = useAccountStore()
    await a.signUp('a@b.com', 'pw123456')
    await a.purchasePremium()
    expect(a.isPremium).toBe(true)
    expect(a.tickets).toBe(10)
  })

  it('실패하면 error에 코드가 담기고 상태는 그대로다', async () => {
    const a = useAccountStore()
    await a.signUp('a@b.com', 'pw123456')
    await a.signOut()
    await a.signIn('a@b.com', 'wrongpw1')
    expect(a.error?.code).toBe('bad_credentials')
    expect(a.signedIn).toBe(false)
  })

  it('다음 호출이 시작되면 이전 오류는 지워진다', async () => {
    const a = useAccountStore()
    await a.signIn('none@b.com', 'pw123456')
    expect(a.error).not.toBeNull()
    await a.signUp('a@b.com', 'pw123456')
    expect(a.error).toBeNull()
  })

  it('로그아웃하면 이력서도 비운다 — 다음 사람에게 보이면 안 된다', async () => {
    const a = useAccountStore()
    await a.signUp('a@b.com', 'pw123456')
    await a.saveResume({ kind: 'company', title: 'x', text: 'y'.repeat(60) })
    expect(a.resumes).toHaveLength(1)
    await a.signOut()
    expect(a.resumes).toEqual([])
    expect(a.session).toBeNull()
  })

  it('종류별 슬롯을 세어 준다', async () => {
    const a = useAccountStore()
    await a.signUp('a@b.com', 'pw123456')
    await a.saveResume({ kind: 'admission', title: '자소서', text: 'y'.repeat(60) })
    expect(a.slotsOf('admission')).toHaveLength(1)
    expect(a.slotsOf('company')).toHaveLength(0)
  })

  it('슬롯이 차면 slot_full이 error에 담긴다', async () => {
    const a = useAccountStore()
    await a.signUp('a@b.com', 'pw123456')
    for (let i = 0; i < 3; i++)
      await a.saveResume({ kind: 'company', title: `${i}`, text: 'y'.repeat(60) })
    await a.saveResume({ kind: 'company', title: '넷째', text: 'y'.repeat(60) })
    expect(a.error?.code).toBe('slot_full')
    expect(a.slotsOf('company')).toHaveLength(3)
  })

  it('티켓이 없으면 no_tickets를 담고 등급은 그대로다', async () => {
    const a = useAccountStore()
    await a.signUp('a@b.com', 'pw123456')
    await a.spendTicket()
    expect(a.error?.code).toBe('no_tickets')
    expect(a.tickets).toBe(0)
  })

  it('loading은 끝나면 반드시 꺼진다 — 실패해도', async () => {
    const a = useAccountStore()
    await a.signIn('none@b.com', 'pw123456')
    expect(a.loading).toBe(false)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `cd frontend && pnpm exec vitest run stores/account.test.ts`
Expected: FAIL — `Failed to resolve import "./account"` (스토어 파일 없음)

- [ ] **Step 3: 구현**

```ts
// frontend/src/stores/account.ts
/** 계정 상태. 서비스(account)를 감싸 화면이 볼 것만 남긴다.
 *  모든 action은 오류를 던지지 않고 error에 담는다 — 화면마다 try/catch를 쓰지 않기 위해서다 */
import { defineStore } from 'pinia'
import { account as defaultApi } from '@/services/accountMock'
import {
  AccountError,
  type AccountApi, type Profile, type ResumeDraft, type ResumeKind,
  type ResumeSlot, type Session,
} from '@/services/account'

let api: AccountApi = defaultApi
/** 테스트·실제 API 전환용 */
export function setAccountApi(next: AccountApi) {
  api = next
}

export const useAccountStore = defineStore('account', {
  state: () => ({
    session: null as Session | null,
    resumes: [] as ResumeSlot[],
    loading: false,
    error: null as AccountError | null,
  }),
  getters: {
    signedIn: (s) => s.session !== null,
    tier: (s) => s.session?.tier ?? null,
    tickets: (s) => s.session?.tickets ?? 0,
    isPremium: (s) => s.session?.tier === 'premium',
    profile: (s): Profile => s.session?.profile ?? { name: null, age: null },
    slotsOf: (s) => (kind: ResumeKind) => s.resumes.filter((r) => r.kind === kind),
  },
  actions: {
    /** 모든 호출의 공통 껍데기 — loading을 켜고 오류를 담는다 */
    async run<T>(fn: () => Promise<T>): Promise<T | null> {
      this.loading = true
      this.error = null
      try {
        return await fn()
      } catch (e) {
        this.error =
          e instanceof AccountError ? e : new AccountError('network', '연결하지 못했습니다')
        return null
      } finally {
        this.loading = false
      }
    },

    async load() {
      const s = await this.run(() => api.me())
      this.session = s ?? null
      if (s) await this.refreshResumes()
    },

    async signUp(email: string, password: string) {
      const s = await this.run(() => api.signUp(email, password))
      if (s) { this.session = s; this.resumes = [] }
    },
    async signIn(email: string, password: string) {
      const s = await this.run(() => api.signIn(email, password))
      if (s) { this.session = s; await this.refreshResumes() }
    },
    async signInWithGoogle(email?: string) {
      const s = await this.run(() => api.signInWithGoogle(email))
      if (s) { this.session = s; await this.refreshResumes() }
    },
    async signOut() {
      await this.run(() => api.signOut())
      // 실패해도 화면에서는 내보낸다 — 남겨 두는 쪽이 더 위험하다
      this.session = null
      this.resumes = []
    },
    async saveProfile(profile: Profile) {
      const s = await this.run(() => api.saveProfile(profile))
      if (s) this.session = s
    },

    async refreshResumes() {
      const list = await this.run(() => api.listResumes())
      if (list) this.resumes = list
    },
    async saveResume(draft: ResumeDraft) {
      const slot = await this.run(() => api.saveResume(draft))
      if (slot) await this.refreshResumes()
      return slot
    },
    async deleteResume(id: string) {
      const ok = await this.run(() => api.deleteResume(id))
      if (ok !== null) await this.refreshResumes()
    },

    async purchasePremium() {
      const s = await this.run(() => api.purchasePremium())
      if (s) this.session = s
    },
    async spendTicket() {
      const s = await this.run(() => api.spendTicket())
      if (s) this.session = s
    },
  },
})
```

- [ ] **Step 4: 통과 확인**

Run: `cd frontend && pnpm exec vitest run stores/account.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add frontend/src/stores/account.ts frontend/src/stores/account.test.ts
git commit -m "feat(frontend): account 스토어 — 오류를 던지지 않고 담는다"
```

---

## Task 3: PixelModal

**Files:**
- Create: `frontend/src/components/ui/PixelModal.vue`
- Test: `frontend/src/components/ui/PixelModal.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces: `PixelModal` — props `{ open: boolean; title?: string; width?: 'md' | 'wide' }`, emit `close`, slots `default` / `head`(기본 제목 줄 대체) / `foot`

**설계 메모:** 시안의 모달 폭은 **md 960px · wide 1160px**, 안쪽 여백 **34px 40px**이다. 내용이 길면 모달이 아니라 **안쪽이** 스크롤한다.

- [ ] **Step 1: 실패 테스트 작성**

```ts
// frontend/src/components/ui/PixelModal.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import PixelModal from './PixelModal.vue'

const open = (props = {}) =>
  mount(PixelModal, {
    props: { open: true, title: '내정보', ...props },
    slots: { default: '<button data-test="inner">안쪽</button>' },
    attachTo: document.body,
  })

beforeEach(() => { document.body.innerHTML = ''; document.body.style.overflow = '' })

describe('PixelModal', () => {
  it('open이 false면 그리지 않는다', () => {
    const w = mount(PixelModal, { props: { open: false } })
    expect(w.find('[data-test=modal]').exists()).toBe(false)
  })

  it('제목과 내용을 보여 준다', () => {
    const w = open()
    expect(w.get('[data-test=modal]').text()).toContain('내정보')
    expect(w.find('[data-test=inner]').exists()).toBe(true)
  })

  it('닫기 버튼이 close를 낸다', async () => {
    const w = open()
    await w.get('[data-test=modal-close]').trigger('click')
    expect(w.emitted('close')).toHaveLength(1)
  })

  it('바깥(덮개)을 누르면 닫힌다', async () => {
    const w = open()
    await w.get('[data-test=modal-veil]').trigger('click')
    expect(w.emitted('close')).toHaveLength(1)
  })

  it('안쪽을 눌러도 닫히지 않는다', async () => {
    const w = open()
    await w.get('[data-test=inner]').trigger('click')
    expect(w.emitted('close')).toBeUndefined()
  })

  it('Esc로 닫힌다', async () => {
    const w = open()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await w.vm.$nextTick()
    expect(w.emitted('close')).toHaveLength(1)
  })

  it('Esc를 두 번 눌러도 close는 한 번이다 — 닫는 중에는 무시한다', async () => {
    const w = open()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await w.vm.$nextTick()
    expect(w.emitted('close')).toHaveLength(1)
  })

  it('열려 있는 동안 뒤 페이지가 스크롤하지 않는다', async () => {
    const w = open()
    expect(document.body.style.overflow).toBe('hidden')
    await w.setProps({ open: false })
    expect(document.body.style.overflow).toBe('')
  })

  it('닫히면 Esc 리스너도 사라진다', async () => {
    const w = open()
    await w.setProps({ open: false })
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await w.vm.$nextTick()
    expect(w.emitted('close')).toBeUndefined()
  })

  it('wide는 넓은 칸을 쓴다', () => {
    expect(open({ width: 'wide' }).get('[data-test=modal]').classes()).toContain('wide')
  })

  it('role과 aria가 붙는다', () => {
    const el = open().get('[data-test=modal]')
    expect(el.attributes('role')).toBe('dialog')
    expect(el.attributes('aria-modal')).toBe('true')
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `cd frontend && pnpm exec vitest run components/ui/PixelModal.test.ts`
Expected: FAIL — `Failed to resolve import "./PixelModal.vue"`

- [ ] **Step 3: 구현**

```vue
<script setup lang="ts">
/** 모달 공통 껍데기 (spec 7.0). 한 번에 하나만 열린다는 규칙은 여는 쪽(TopBar)이 지킨다 */
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'

const props = withDefaults(
  defineProps<{ open: boolean; title?: string; width?: 'md' | 'wide' }>(),
  { title: undefined, width: 'md' },
)
const emit = defineEmits<{ close: [] }>()

const box = ref<HTMLElement | null>(null)
/** 닫는 중 — Esc 연타·덮개 더블클릭으로 close가 두 번 나가지 않게 */
let closing = false

function close() {
  if (closing) return
  closing = true
  emit('close')
}
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') close()
}

watch(
  () => props.open,
  async (on) => {
    closing = false
    if (on) {
      document.addEventListener('keydown', onKey)
      document.body.style.overflow = 'hidden'
      await nextTick()
      box.value?.focus()
    } else {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  },
  { immediate: true },
)
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKey)
  document.body.style.overflow = ''
})
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="veil" data-test="modal-veil" @click.self="close">
      <div
        ref="box"
        class="box"
        :class="width"
        role="dialog"
        aria-modal="true"
        tabindex="-1"
        data-test="modal"
      >
        <slot name="head">
          <header class="head">
            <h2 v-if="title" class="display ttl">{{ title }}</h2>
            <button type="button" class="mono x" data-test="modal-close" @click="close">
              닫기 ✕
            </button>
          </header>
        </slot>
        <div class="body"><slot /></div>
        <footer v-if="$slots.foot" class="foot"><slot name="foot" /></footer>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.veil {
  position: fixed;
  inset: 0;
  z-index: 100;
  background: rgb(0 0 0 / 0.6);
  display: grid;
  place-items: center;
  padding: var(--sp-6) var(--sp-4);
}
.box {
  background: var(--win);
  border: var(--win-border);
  box-shadow: var(--win-inner);
  width: 100%;
  max-width: 960px;
  max-height: calc(100vh - var(--sp-10));
  padding: 34px 40px;
  display: flex;
  flex-direction: column;
  gap: var(--sp-6);
}
.box.wide {
  max-width: 1160px;
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-5);
}
.ttl {
  margin: 0;
  font-size: var(--fs-h2);
}
.x {
  font-size: var(--fs-label);
  color: var(--text-3);
  background: none;
  border: none;
  cursor: pointer;
}
.x:hover,
.x:focus-visible {
  color: var(--text);
}
/* 길어지면 모달이 아니라 안쪽이 스크롤한다 */
.body {
  min-height: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: var(--sp-6);
}
.foot {
  display: flex;
  justify-content: flex-end;
  gap: var(--sp-3);
}
@media (max-width: 720px) {
  .veil {
    padding: var(--sp-3);
  }
  .box {
    padding: var(--sp-6) var(--sp-5);
  }
}
</style>
```

- [ ] **Step 4: 통과 확인**

Run: `cd frontend && pnpm exec vitest run components/ui/PixelModal.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add frontend/src/components/ui/PixelModal.vue frontend/src/components/ui/PixelModal.test.ts
git commit -m "feat(frontend): 모달 공통 껍데기 — Esc·바깥 클릭·뒤 스크롤 잠금"
```

---

## Task 4: 상단 바

**Files:**
- Create: `frontend/src/components/TopBar.vue`
- Modify: `frontend/src/App.vue`
- Test: `frontend/src/components/TopBar.test.ts`

**Interfaces:**
- Consumes: Task 2 `useAccountStore`, 기존 `useInterviewStore`(`phase`)
- Produces: `TopBar` — 내부에 `openModal: 'login' | 'premium' | 'me' | 'archive' | null`을 들고 한 번에 하나만 연다. 모달 본체는 Task 5~7에서 채운다(이 Task에서는 자리만)

**설계 메모:** 랜딩·준비·리포트에서만 보인다. **면접 화면에서는 숨긴다**(spec 6절). `HintBar`와 같은 `fixed`이고 위/아래로 갈려 겹치지 않는다.

- [ ] **Step 1: 실패 테스트 작성**

```ts
// frontend/src/components/TopBar.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import TopBar from './TopBar.vue'
import { useAccountStore, setAccountApi } from '@/stores/account'
import { useInterviewStore } from '@/stores/interview'
import { makeMockAccount } from '@/services/accountMock'

const bar = () => mount(TopBar, { global: { plugins: [createPinia()] }, attachTo: document.body })

beforeEach(() => {
  localStorage.clear()
  document.body.innerHTML = ''
  setActivePinia(createPinia())
  setAccountApi(makeMockAccount({ delayMs: 0 }))
})

describe('TopBar', () => {
  it('비로그인은 로그인 버튼만 있다', () => {
    const w = bar()
    expect(w.find('[data-test=top-login]').exists()).toBe(true)
    expect(w.find('[data-test=top-me]').exists()).toBe(false)
    expect(w.find('[data-test=top-archive]').exists()).toBe(false)
    expect(w.find('[data-test=top-premium]').exists()).toBe(false)
  })

  it('로그인하면 프리미엄·보관함·내정보가 나온다', async () => {
    const w = bar()
    await useAccountStore().signUp('a@b.com', 'pw123456')
    await w.vm.$nextTick()
    expect(w.find('[data-test=top-login]').exists()).toBe(false)
    for (const k of ['top-premium', 'top-archive', 'top-me'])
      expect(w.find(`[data-test=${k}]`).exists()).toBe(true)
  })

  it('프리미엄이면 등급 표시가 붙는다', async () => {
    const w = bar()
    const a = useAccountStore()
    await a.signUp('a@b.com', 'pw123456')
    await a.purchasePremium()
    await w.vm.$nextTick()
    expect(w.get('[data-test=top-premium]').text()).toContain('★')
  })

  it('면접 화면에서는 숨는다', async () => {
    const w = bar()
    useInterviewStore().phase = 'interview'
    await w.vm.$nextTick()
    expect(w.find('[data-test=topbar]').exists()).toBe(false)
  })

  it('리포트 화면에서는 보인다 — 가입 전환이 일어나는 자리다', async () => {
    const w = bar()
    useInterviewStore().phase = 'report'
    await w.vm.$nextTick()
    expect(w.find('[data-test=topbar]').exists()).toBe(true)
  })

  it('로그인 버튼이 모달을 연다', async () => {
    const w = bar()
    await w.get('[data-test=top-login]').trigger('click')
    expect(w.find('[data-test=modal]').exists()).toBe(true)
  })

  it('한 번에 하나만 열린다', async () => {
    const w = bar()
    await useAccountStore().signUp('a@b.com', 'pw123456')
    await w.vm.$nextTick()
    await w.get('[data-test=top-me]').trigger('click')
    await w.get('[data-test=top-premium]').trigger('click')
    expect(document.querySelectorAll('[data-test=modal]')).toHaveLength(1)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `cd frontend && pnpm exec vitest run components/TopBar.test.ts`
Expected: FAIL — `Failed to resolve import "./TopBar.vue"`

- [ ] **Step 3: 구현 (모달 자리는 비워 둔다)**

```vue
<script setup lang="ts">
/** 상단 바 (spec 6절). 면접 화면에서는 숨는다 — 100vh 레이아웃이라 자리가 없고 중에 열 일도 없다 */
import { computed, onMounted, ref } from 'vue'
import { useAccountStore } from '@/stores/account'
import { useInterviewStore } from '@/stores/interview'
import PixelModal from '@/components/ui/PixelModal.vue'

type Which = 'login' | 'premium' | 'me' | 'archive'

const account = useAccountStore()
const interview = useInterviewStore()
/** 한 번에 하나 — 여기서 지킨다 */
const open = ref<Which | null>(null)
const shown = computed(() => interview.phase !== 'interview')

onMounted(() => void account.load())
</script>

<template>
  <header v-if="shown" class="topbar" data-test="topbar">
    <div class="left">
      <button
        v-if="account.signedIn"
        type="button"
        class="mono link press"
        data-test="top-premium"
        @click="open = 'premium'"
      >
        {{ account.isPremium ? '★ 모모 프리미엄' : '모모 프리미엄' }}
      </button>
    </div>
    <div class="right">
      <template v-if="account.signedIn">
        <button type="button" class="mono link press" data-test="top-archive" @click="open = 'archive'">
          보관함
        </button>
        <button type="button" class="mono link press" data-test="top-me" @click="open = 'me'">
          내정보
        </button>
      </template>
      <button v-else type="button" class="mono link press" data-test="top-login" @click="open = 'login'">
        로그인
      </button>
    </div>
  </header>

  <!-- 내용은 Task 5~7에서 채운다. 지금은 껍데기만 열린다 -->
  <PixelModal :open="open !== null" :title="open ?? ''" @close="open = null" />
</template>

<style scoped>
.topbar {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 40;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-4);
  padding: var(--sp-3) var(--sp-6);
}
.left,
.right {
  display: flex;
  align-items: center;
  gap: var(--sp-5);
}
.link {
  font-size: var(--fs-label);
  color: var(--text-2);
  background: none;
  border: none;
  cursor: pointer;
  padding: var(--sp-2);
}
.link:hover,
.link:focus-visible {
  color: var(--accent);
}
</style>
```

`App.vue`에 한 줄 더한다(`HintBar` 위):

```vue
<TopBar />
<component :is="view" />
<HintBar />
```

- [ ] **Step 4: 통과 확인**

Run: `cd frontend && pnpm exec vitest run components/TopBar.test.ts`
Expected: PASS

- [ ] **Step 5: 기존 화면이 상단 바에 가리지 않는지 확인**

Run: `cd frontend && pnpm test`
Expected: 전부 통과. 랜딩·준비·리포트의 맨 위 요소가 `TopBar`(높이 약 44px) 아래로 들어가면 `base.css`의 `body`에 `padding-top`을 더한다 — `--hint-space`와 같은 방식으로 `--top-space`를 둔다.

- [ ] **Step 6: 커밋**

```bash
git add frontend/src/components/TopBar.vue frontend/src/components/TopBar.test.ts frontend/src/App.vue
git commit -m "feat(frontend): 상단 바 — 등급별 버튼, 면접 화면에서는 숨김"
```

---

## Task 5: 로그인 / 회원가입 모달

**Files:**
- Create: `frontend/src/components/account/AuthModal.vue`
- Modify: `frontend/src/components/TopBar.vue`
- Test: `frontend/src/components/account/AuthModal.test.ts`

**Interfaces:**
- Consumes: Task 2 `useAccountStore`, Task 3 `PixelModal`
- Produces: `AuthModal` — props `{ open: boolean }`, emit `close`

**문구(그대로 쓴다):**
- 저장 동의: `로그인하면 이력서·면접 대화·리포트가 서버에 저장됩니다. 로그인하지 않으면 이 브라우저를 떠나지 않습니다.`
- 로그인 실패: `이메일 또는 비밀번호가 올바르지 않습니다`

- [ ] **Step 1: 실패 테스트 작성**

```ts
// frontend/src/components/account/AuthModal.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import AuthModal from './AuthModal.vue'
import { useAccountStore, setAccountApi } from '@/stores/account'
import { makeMockAccount } from '@/services/accountMock'

const modal = () =>
  mount(AuthModal, { props: { open: true }, global: { plugins: [createPinia()] }, attachTo: document.body })

beforeEach(() => {
  localStorage.clear()
  document.body.innerHTML = ''
  setActivePinia(createPinia())
  setAccountApi(makeMockAccount({ delayMs: 0 }))
})

const fill = async (w: ReturnType<typeof modal>, email: string, pw: string, pw2?: string) => {
  await w.get('[data-test=auth-email]').setValue(email)
  await w.get('[data-test=auth-password]').setValue(pw)
  if (pw2 !== undefined) await w.get('[data-test=auth-password2]').setValue(pw2)
}

describe('AuthModal', () => {
  it('기본은 로그인 탭이다', () => {
    expect(modal().find('[data-test=auth-password2]').exists()).toBe(false)
  })

  it('회원가입 탭에는 비밀번호 확인과 저장 동의가 있다', async () => {
    const w = modal()
    await w.get('[data-test=auth-tab-signup]').trigger('click')
    expect(w.find('[data-test=auth-password2]').exists()).toBe(true)
    expect(w.get('[data-test=auth-consent]').text()).toContain('서버에 저장')
  })

  it('가입하면 로그인되고 닫힌다', async () => {
    const w = modal()
    await w.get('[data-test=auth-tab-signup]').trigger('click')
    await fill(w, 'a@b.com', 'pw123456', 'pw123456')
    await w.get('[data-test=auth-submit]').trigger('click')
    await flushPromises()
    expect(useAccountStore().signedIn).toBe(true)
    expect(w.emitted('close')).toHaveLength(1)
  })

  it('비밀번호 확인이 다르면 보내지 않는다', async () => {
    const w = modal()
    await w.get('[data-test=auth-tab-signup]').trigger('click')
    await fill(w, 'a@b.com', 'pw123456', 'different')
    await w.get('[data-test=auth-submit]').trigger('click')
    await flushPromises()
    expect(w.get('[data-test=auth-error]').text()).toContain('비밀번호가 서로 다릅니다')
    expect(useAccountStore().signedIn).toBe(false)
  })

  it('이미 쓰는 이메일이면 알려 준다', async () => {
    await useAccountStore().signUp('a@b.com', 'pw123456')
    await useAccountStore().signOut()
    const w = modal()
    await w.get('[data-test=auth-tab-signup]').trigger('click')
    await fill(w, 'a@b.com', 'pw123456', 'pw123456')
    await w.get('[data-test=auth-submit]').trigger('click')
    await flushPromises()
    expect(w.get('[data-test=auth-error]').text()).toContain('이미 가입된')
  })

  it('입력을 떠나면 중복을 미리 알려 준다', async () => {
    await useAccountStore().signUp('a@b.com', 'pw123456')
    await useAccountStore().signOut()
    const w = modal()
    await w.get('[data-test=auth-tab-signup]').trigger('click')
    await w.get('[data-test=auth-email]').setValue('a@b.com')
    await w.get('[data-test=auth-email]').trigger('blur')
    await flushPromises()
    expect(w.get('[data-test=auth-error]').text()).toContain('이미 가입된')
  })

  it('로그인 실패 문구는 계정 존재 여부를 흘리지 않는다', async () => {
    const w = modal()
    await fill(w, 'none@b.com', 'pw123456')
    await w.get('[data-test=auth-submit]').trigger('click')
    await flushPromises()
    expect(w.get('[data-test=auth-error]').text()).toBe('이메일 또는 비밀번호가 올바르지 않습니다')
  })

  it('구글로 계속하기도 로그인시킨다', async () => {
    const w = modal()
    await w.get('[data-test=auth-google]').trigger('click')
    await flushPromises()
    expect(useAccountStore().signedIn).toBe(true)
  })

  it('보내는 동안 버튼이 잠긴다', async () => {
    setAccountApi(makeMockAccount({ delayMs: 20 }))
    const w = modal()
    await fill(w, 'a@b.com', 'pw123456')
    await w.get('[data-test=auth-submit]').trigger('click')
    expect((w.get('[data-test=auth-submit]').element as HTMLButtonElement).disabled).toBe(true)
    await flushPromises()
  })

  it('탭을 바꾸면 오류가 지워진다', async () => {
    const w = modal()
    await fill(w, 'none@b.com', 'pw123456')
    await w.get('[data-test=auth-submit]').trigger('click')
    await flushPromises()
    await w.get('[data-test=auth-tab-signup]').trigger('click')
    expect(w.find('[data-test=auth-error]').exists()).toBe(false)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `cd frontend && pnpm exec vitest run components/account/AuthModal.test.ts`
Expected: FAIL — 파일 없음

- [ ] **Step 3: 구현**

핵심만 적는다. 나머지(마크업·스타일)는 `PixelModal` 안에 넣고 기존 폼 스타일(`PrepareView`의 입력 칸)을 따른다.

```ts
const mode = ref<'signin' | 'signup'>('signin')
const email = ref(''), pw = ref(''), pw2 = ref('')
const localError = ref('')
const busy = computed(() => account.loading)
const error = computed(() => localError.value || account.error?.message || '')

watch(mode, () => { localError.value = ''; account.error = null })

async function onEmailBlur() {
  if (mode.value !== 'signup' || !email.value) return
  if (await apiEmailTaken(email.value)) localError.value = '이미 가입된 이메일입니다'
}

async function submit() {
  localError.value = ''
  if (mode.value === 'signup' && pw.value !== pw2.value) {
    localError.value = '비밀번호가 서로 다릅니다'
    return
  }
  if (mode.value === 'signup') await account.signUp(email.value, pw.value)
  else await account.signIn(email.value, pw.value)
  if (account.signedIn) emit('close')
}
```

- `auth-tab-signin` / `auth-tab-signup` / `auth-email` / `auth-password` / `auth-password2` / `auth-consent` / `auth-error` / `auth-submit` / `auth-google` 에 `data-test`를 붙인다
- `onEmailBlur`의 중복 검사는 스토어를 거치지 않고 서비스의 `emailTaken`을 직접 쓴다(스토어 `error`를 더럽히지 않기 위해). 그러려면 `stores/account.ts`에 `emailTaken(email)` 액션을 더하고 `error`를 건드리지 않게 한다

- [ ] **Step 4: 통과 확인**

Run: `cd frontend && pnpm exec vitest run components/account/AuthModal.test.ts`
Expected: PASS

- [ ] **Step 5: TopBar에 연결**

`TopBar.vue`의 자리 모달을 `<AuthModal :open="open === 'login'" @close="open = null" />`로 바꾼다. Task 4의 TopBar 테스트가 계속 통과해야 한다.

Run: `cd frontend && pnpm exec vitest run components/TopBar.test.ts components/account/AuthModal.test.ts`
Expected: PASS

- [ ] **Step 6: 커밋**

```bash
git add frontend/src/components/account/AuthModal.vue frontend/src/components/account/AuthModal.test.ts frontend/src/components/TopBar.vue frontend/src/stores/account.ts
git commit -m "feat(frontend): 로그인·회원가입 모달 — 저장 동의 문구와 중복 미리 검사"
```

---

## Task 6: 모모 프리미엄 모달 (비교표 + 토스 결제 목업)

**Files:**
- Create: `frontend/src/utils/plans.ts`
- Create: `frontend/src/components/account/PremiumModal.vue`
- Modify: `frontend/src/components/TopBar.vue`
- Test: `frontend/src/utils/plans.test.ts`, `frontend/src/components/account/PremiumModal.test.ts`

**Interfaces:**
- Consumes: Task 2 `useAccountStore`, Task 3 `PixelModal`, Task 5(비로그인이면 로그인으로 갈아 끼움)
- Produces: `PLAN_ROWS`(순수 데이터), `PremiumModal` — props `{ open }`, emit `close` · `need-login`

- [ ] **Step 1: 비교표 데이터 테스트**

```ts
// frontend/src/utils/plans.test.ts
import { describe, it, expect } from 'vitest'
import { PLAN_ROWS, PLAN_COLUMNS } from './plans'

describe('등급 비교표', () => {
  it('칸은 비로그인·로그인·프리미엄 셋이다', () => {
    expect(PLAN_COLUMNS.map((c) => c.key)).toEqual(['guest', 'member', 'premium'])
  })

  it('모든 줄이 세 칸을 다 채운다', () => {
    for (const r of PLAN_ROWS) {
      expect(r.label.length, r.label).toBeGreaterThan(0)
      for (const c of PLAN_COLUMNS) expect(r.cells[c.key], `${r.label}/${c.key}`).toBeTruthy()
    }
  })

  it('프리미엄 면접관은 프리미엄에서만 된다', () => {
    const row = PLAN_ROWS.find((r) => r.label.includes('벤'))!
    expect(row.cells.guest).toBe('—')
    expect(row.cells.member).toBe('—')
    expect(row.cells.premium).toContain('10')
  })

  it('보관함 한도가 등급마다 다르게 적힌다', () => {
    const row = PLAN_ROWS.find((r) => r.label.includes('보관함'))!
    expect(row.cells.guest).toBe('—')
    expect(row.cells.member).toContain('5')
  })
})
```

```ts
// frontend/src/utils/plans.ts
/** 등급 비교표 (spec 4절). 순수 데이터 — 화면은 이걸 그리기만 한다 */
export type PlanKey = 'guest' | 'member' | 'premium'

export const PLAN_COLUMNS: readonly { key: PlanKey; label: string }[] = [
  { key: 'guest', label: '비로그인' },
  { key: 'member', label: '로그인' },
  { key: 'premium', label: '모모 프리미엄' },
]

export interface PlanRow {
  label: string
  cells: Record<PlanKey, string>
}

export const PLAN_ROWS: readonly PlanRow[] = [
  { label: '무료 면접관 3명 (데이빗·쥴리·올리비아)', cells: { guest: 'O', member: 'O', premium: 'O' } },
  { label: '프리미엄 면접관 벤', cells: { guest: '—', member: '—', premium: '티켓 10회' } },
  { label: '면접 기록 저장', cells: { guest: '—', member: 'O', premium: 'O' } },
  { label: '리포트 다시 보기', cells: { guest: '화면을 벗어나면 사라짐', member: '보관함에서', premium: '보관함에서' } },
  { label: '이력서 미리 작성', cells: { guest: '—', member: '대입 3 + 회사 3', premium: '대입 3 + 회사 3' } },
  { label: '보관함 한도', cells: { guest: '—', member: '5개', premium: '5개 (프리미엄 기록은 제외)' } },
  { label: '내 목소리 녹음', cells: { guest: '—', member: '—', premium: 'O' } },
]
```

- [ ] **Step 2: 모달 테스트 작성**

```ts
// frontend/src/components/account/PremiumModal.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import PremiumModal from './PremiumModal.vue'
import { useAccountStore, setAccountApi } from '@/stores/account'
import { makeMockAccount } from '@/services/accountMock'

const modal = () =>
  mount(PremiumModal, { props: { open: true }, global: { plugins: [createPinia()] }, attachTo: document.body })

beforeEach(() => {
  localStorage.clear()
  document.body.innerHTML = ''
  vi.useFakeTimers()
  setActivePinia(createPinia())
  setAccountApi(makeMockAccount({ delayMs: 0 }))
})

/** 결제 목업의 "처리 중" 2초를 건너뛴다 */
const settle = async () => { await vi.runAllTimersAsync(); await flushPromises() }

describe('PremiumModal', () => {
  it('비교표 세 칸을 그린다', () => {
    const w = modal()
    expect(w.findAll('[data-test=plan-col]')).toHaveLength(3)
    expect(w.findAll('[data-test=plan-row]').length).toBeGreaterThan(4)
  })

  it('지금 내 등급 칸을 강조한다', async () => {
    const w = modal()
    await useAccountStore().signUp('a@b.com', 'pw123456')
    await w.vm.$nextTick()
    expect(w.get('[data-test=plan-col].now').text()).toContain('로그인')
  })

  it('비로그인이 결제를 누르면 로그인을 요청한다', async () => {
    const w = modal()
    await w.get('[data-test=premium-start]').trigger('click')
    expect(w.emitted('need-login')).toHaveLength(1)
  })

  it('결제 목업을 마치면 프리미엄이 되고 티켓 10장이다', async () => {
    const w = modal()
    const a = useAccountStore()
    await a.signUp('a@b.com', 'pw123456')
    await w.vm.$nextTick()
    await w.get('[data-test=premium-start]').trigger('click')
    await w.get('[data-test=pay-confirm]').trigger('click')
    await settle()
    expect(a.isPremium).toBe(true)
    expect(a.tickets).toBe(10)
    expect(w.get('[data-test=pay-done]').text()).toContain('실제 결제가 아닙니다')
  })

  it('처리 중에 결제 버튼을 또 눌러도 한 번만 결제된다', async () => {
    const w = modal()
    const a = useAccountStore()
    await a.signUp('a@b.com', 'pw123456')
    await w.vm.$nextTick()
    await w.get('[data-test=premium-start]').trigger('click')
    await w.get('[data-test=pay-confirm]').trigger('click')
    await w.get('[data-test=pay-confirm]').trigger('click')
    await settle()
    expect(a.tickets).toBe(10)
  })

  it('처리 중에 닫아도 티켓이 두 번 들어오지 않는다', async () => {
    const w = modal()
    const a = useAccountStore()
    await a.signUp('a@b.com', 'pw123456')
    await w.vm.$nextTick()
    await w.get('[data-test=premium-start]').trigger('click')
    await w.get('[data-test=pay-confirm]').trigger('click')
    await w.setProps({ open: false })
    await settle()
    expect(a.tickets).toBeLessThanOrEqual(10)
  })

  it('이미 프리미엄이면 남은 티켓과 추가 결제를 보여 준다', async () => {
    const w = modal()
    const a = useAccountStore()
    await a.signUp('a@b.com', 'pw123456')
    await a.purchasePremium()
    await w.vm.$nextTick()
    expect(w.get('[data-test=premium-start]').text()).toContain('티켓 더 받기')
  })
})
```

- [ ] **Step 3: 실패 확인**

Run: `cd frontend && pnpm exec vitest run utils/plans.test.ts components/account/PremiumModal.test.ts`
Expected: FAIL — 두 파일 모두 없음

- [ ] **Step 4: 구현**

```ts
// PremiumModal.vue — 핵심 상태
type Step = 'compare' | 'pay' | 'paying' | 'done'
const step = ref<Step>('compare')
/** 중복 결제 가드 — 처리 중에는 다시 받지 않는다 */
let paying = false

function start() {
  if (!account.signedIn) return emit('need-login')
  step.value = 'pay'
}

async function pay() {
  if (paying) return
  paying = true
  step.value = 'paying'
  // 토스 결제창을 흉내 내는 대기. 흉내는 내되 속이지 않는다
  await new Promise((r) => setTimeout(r, 2000))
  await account.purchasePremium()
  paying = false
  step.value = 'done'
}

watch(() => props.open, (on) => { if (!on) { step.value = 'compare'; paying = false } })
```

- `plan-col`(현재 등급이면 `now` 클래스) · `plan-row` · `premium-start` · `pay-confirm` · `pay-done`에 `data-test`
- `done` 화면 문구: `결제가 끝났습니다 · 티켓 10장이 들어왔습니다` + `※ 실제 결제가 아닙니다 (데모)`
- 이미 프리미엄이면 버튼 문구는 `티켓 더 받기`, 아니면 `프리미엄 시작하기`

- [ ] **Step 5: 통과 확인**

Run: `cd frontend && pnpm exec vitest run utils/plans.test.ts components/account/PremiumModal.test.ts`
Expected: PASS

- [ ] **Step 6: TopBar에 연결**

```vue
<PremiumModal :open="open === 'premium'" @close="open = null" @need-login="open = 'login'" />
```

- [ ] **Step 7: 커밋**

```bash
git add frontend/src/utils/plans.ts frontend/src/utils/plans.test.ts frontend/src/components/account/PremiumModal.vue frontend/src/components/account/PremiumModal.test.ts frontend/src/components/TopBar.vue
git commit -m "feat(frontend): 모모 프리미엄 모달 — 등급 비교표와 토스 결제 목업(중복 결제 가드)"
```

---

## Task 7: 내정보 모달 (시안 A)

**Files:**
- Create: `frontend/src/components/account/MeModal.vue`
- Create: `frontend/src/components/account/ResumeSlotEditor.vue`
- Modify: `frontend/src/components/TopBar.vue`
- Test: `frontend/src/components/account/MeModal.test.ts`

**Interfaces:**
- Consumes: Task 2 `useAccountStore`, Task 3 `PixelModal`
- Produces: `MeModal` — props `{ open }`, emit `close`

**시안 A의 구조(위에서 아래로):** 계정 `kv` 띠 → 구분선 → `대입 · 자기소개서 n/3` / `회사 · 이력서 n/3` 탭 → 슬롯 목록 + `＋ 새 …` → 맨 아래 오른쪽 `로그아웃`.

- [ ] **Step 1: 실패 테스트 작성**

```ts
// frontend/src/components/account/MeModal.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import MeModal from './MeModal.vue'
import { useAccountStore, setAccountApi } from '@/stores/account'
import { makeMockAccount } from '@/services/accountMock'

const modal = () =>
  mount(MeModal, { props: { open: true }, global: { plugins: [createPinia()] }, attachTo: document.body })

beforeEach(async () => {
  localStorage.clear()
  document.body.innerHTML = ''
  setActivePinia(createPinia())
  setAccountApi(makeMockAccount({ delayMs: 0 }))
  await useAccountStore().signUp('a@b.com', 'pw123456')
})

describe('MeModal', () => {
  it('계정 정보를 보여 준다', async () => {
    const w = modal()
    await flushPromises()
    expect(w.get('[data-test=me-account]').text()).toContain('a@b.com')
    expect(w.get('[data-test=me-account]').text()).toContain('로그인')
  })

  it('프리미엄이면 남은 티켓을 보여 준다', async () => {
    await useAccountStore().purchasePremium()
    const w = modal()
    await flushPromises()
    expect(w.get('[data-test=me-account]').text()).toContain('10')
  })

  it('기본 탭은 대입이고 슬롯 수가 적힌다', async () => {
    const w = modal()
    await flushPromises()
    expect(w.get('[data-test=me-tab-admission]').text()).toContain('0/3')
  })

  it('저장하면 목록에 나오고 수가 는다', async () => {
    const w = modal()
    await flushPromises()
    await w.get('[data-test=slot-new]').trigger('click')
    await w.get('[data-test=slot-title]').setValue('한국대 컴공 지원')
    await w.get('[data-test=slot-text]').setValue('x'.repeat(80))
    await w.get('[data-test=slot-save]').trigger('click')
    await flushPromises()
    expect(w.findAll('[data-test=slot-row]')).toHaveLength(1)
    expect(w.get('[data-test=me-tab-admission]').text()).toContain('1/3')
  })

  it('3개가 차면 새로 만들기가 잠긴다', async () => {
    const a = useAccountStore()
    for (let i = 0; i < 3; i++)
      await a.saveResume({ kind: 'admission', title: `${i}`, text: 'x'.repeat(80) })
    const w = modal()
    await flushPromises()
    expect((w.get('[data-test=slot-new]').element as HTMLButtonElement).disabled).toBe(true)
    expect(w.get('[data-test=slot-full-note]').text()).toContain('하나를 지워야')
  })

  it('지우면 자리가 난다', async () => {
    await useAccountStore().saveResume({ kind: 'admission', title: 'x', text: 'x'.repeat(80) })
    const w = modal()
    await flushPromises()
    await w.get('[data-test=slot-delete]').trigger('click')
    await flushPromises()
    expect(w.findAll('[data-test=slot-row]')).toHaveLength(0)
  })

  it('탭을 바꾸면 그 종류만 보인다', async () => {
    const a = useAccountStore()
    await a.saveResume({ kind: 'admission', title: '자소서', text: 'x'.repeat(80) })
    await a.saveResume({ kind: 'company', title: '이력서', text: 'x'.repeat(80) })
    const w = modal()
    await flushPromises()
    expect(w.get('[data-test=slot-row]').text()).toContain('자소서')
    await w.get('[data-test=me-tab-company]').trigger('click')
    expect(w.get('[data-test=slot-row]').text()).toContain('이력서')
  })

  it('이름·나이를 고치면 저장된다 — 대입 면접에서 미리 채울 값이다', async () => {
    const w = modal()
    await flushPromises()
    await w.get('[data-test=me-profile-edit]').trigger('click')
    await w.get('[data-test=me-name]').setValue('홍길동')
    await w.get('[data-test=me-age]').setValue('19')
    await w.get('[data-test=me-profile-save]').trigger('click')
    await flushPromises()
    expect(useAccountStore().profile).toEqual({ name: '홍길동', age: 19 })
  })

  it('로그아웃하면 닫힌다', async () => {
    const w = modal()
    await flushPromises()
    await w.get('[data-test=me-signout]').trigger('click')
    await flushPromises()
    expect(useAccountStore().signedIn).toBe(false)
    expect(w.emitted('close')).toHaveLength(1)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `cd frontend && pnpm exec vitest run components/account/MeModal.test.ts`
Expected: FAIL — 파일 없음

- [ ] **Step 3: 구현**

```ts
// MeModal.vue — 핵심 상태
const kind = ref<ResumeKind>('admission')
const editing = ref<ResumeSlot | 'new' | null>(null)
const full = computed(() => account.slotsOf(kind.value).length >= RESUME_SLOTS)

watch(() => props.open, (on) => { if (on) void account.refreshResumes(); else editing.value = null })

async function signOut() {
  await account.signOut()
  emit('close')
}
```

- `ResumeSlotEditor.vue`는 제목 + 긴 글(`textarea`) 두 칸과 `slot-save` / `slot-cancel`. **준비 화면의 간단 이력서 폼과 같은 스타일**을 쓴다(두 벌을 만들지 않는다 — 공통화는 2/2 계획에서 `PrepareView`를 고칠 때 한다)
- `data-test`: `me-account` · `me-profile-edit` · `me-name` · `me-age` · `me-profile-save` · `me-tab-admission` · `me-tab-company` · `slot-row` · `slot-new` · `slot-full-note` · `slot-title` · `slot-text` · `slot-save` · `slot-delete` · `me-signout`
- 탭 문구: `대입 · 자기소개서 {n}/3`, `회사 · 이력서 {n}/3`
- 꽉 찼을 때 문구: `3개를 모두 썼습니다 — 하나를 지워야 새로 만들 수 있습니다`

- [ ] **Step 4: 통과 확인**

Run: `cd frontend && pnpm exec vitest run components/account/MeModal.test.ts`
Expected: PASS

- [ ] **Step 5: TopBar에 연결**

```vue
<MeModal :open="open === 'me'" @close="open = null" />
```

- [ ] **Step 6: 전체 게이트**

Run:
```bash
cd frontend && pnpm test && pnpm lint && pnpm exec prettier --check src && pnpm exec vue-tsc --noEmit && pnpm build
```
Expected: 전부 통과. 경고는 기존 4건 그대로

- [ ] **Step 7: 커밋**

```bash
git add frontend/src/components/account/MeModal.vue frontend/src/components/account/ResumeSlotEditor.vue frontend/src/components/account/MeModal.test.ts frontend/src/components/TopBar.vue
git commit -m "feat(frontend): 내정보 모달 — 계정 띠와 이력서 슬롯(대입 3·회사 3)"
```

---

## 마무리

- [ ] 브라우저에서 직접 확인: 랜딩에서 `로그인` → 가입 → 상단 바가 바뀐다 → `모모 프리미엄` → 결제 목업 → 티켓 10장 → `내정보`에서 자기소개서 저장 → 새로고침해도 남아 있다
- [ ] 상단 바가 네 화면에서 아무것도 가리지 않는지 (면접 화면에서는 숨는지)
- [ ] `docs/demo-checklist.md`에 "계정·프리미엄" 절 추가
- [ ] PR base는 `dev`. 본문에 시안 선택(내정보 A · 보관함 C · 상세 B · 점수 없음)과 **API 목업이라는 점**을 적는다

**2/2 계획:** `docs/plans/frontend/2026-10-13-archive-interview.md` — `ReportCards` 추출 · 보관함 모달(탭 C안) · 기록 상세(2단 B안) · 면접관 4명 개편(이름·순서·벤 게이트·P 배지) · 준비 화면 트랙별 입력 · 면접 끝나면 저장 + 티켓 차감 · 프리미엄 녹음.
