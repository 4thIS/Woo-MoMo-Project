import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useAccountStore, setAccountApi } from './account'
import { makeMockAccount } from '@/services/accountMock'

beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
  setAccountApi(makeMockAccount({ delayMs: 0 }))
})

describe('account 스토어 — 세션', () => {
  it('load()를 겹쳐 부르면 /me는 한 번만 읽는다', async () => {
    let calls = 0
    const mock = makeMockAccount({ delayMs: 0 })
    setAccountApi({
      ...mock,
      me: async () => {
        calls++
        return mock.me()
      },
    })
    const a = useAccountStore()
    const p1 = a.load()
    const p2 = a.load()
    await Promise.all([p1, p2])
    expect(calls).toBe(1)
    await a.load()
    expect(calls).toBe(2)
  })

  it('처음에는 비로그인이다', async () => {
    const a = useAccountStore()
    await a.load()
    expect(a.signedIn).toBe(false)
    expect(a.tier).toBeNull()
    expect(a.error).toBeNull()
  })

  it('가입하면 로그인 상태가 된다', async () => {
    const a = useAccountStore()
    await a.signUp('a@b.com', 'pw123456', '이우진')
    expect(a.signedIn).toBe(true)
    expect(a.tier).toBe('member')
    expect(a.isPremium).toBe(false)
  })

  it('새로고침(load)으로 세션과 이력서를 되찾는다', async () => {
    const a = useAccountStore()
    await a.signUp('a@b.com', 'pw123456', '이우진')
    await a.saveResume({ kind: 'company', title: 'x', text: 'y'.repeat(60) })

    setActivePinia(createPinia())
    const b = useAccountStore()
    await b.load()
    expect(b.signedIn).toBe(true)
    expect(b.resumes).toHaveLength(1)
  })

  it('로그아웃하면 이력서도 비운다 — 다음 사람에게 보이면 안 된다', async () => {
    const a = useAccountStore()
    await a.signUp('a@b.com', 'pw123456', '이우진')
    await a.saveResume({ kind: 'company', title: 'x', text: 'y'.repeat(60) })
    expect(a.resumes).toHaveLength(1)
    await a.signOut()
    expect(a.resumes).toEqual([])
    expect(a.session).toBeNull()
  })

  it('이름·나이를 저장한다', async () => {
    const a = useAccountStore()
    await a.signUp('a@b.com', 'pw123456', '이우진')
    await a.saveProfile({ name: '홍길동', age: 19 })
    expect(a.profile).toEqual({ name: '홍길동', age: 19 })
  })

  it('비로그인의 profile은 빈 값이다', () => {
    expect(useAccountStore().profile).toEqual({ name: null, age: null })
  })
})

describe('account 스토어 — 오류를 던지지 않고 담는다', () => {
  it('실패하면 error에 코드가 담기고 상태는 그대로다', async () => {
    const a = useAccountStore()
    await a.signUp('a@b.com', 'pw123456', '이우진')
    await a.signOut()
    await a.signIn('a@b.com', 'wrongpw1')
    expect(a.error?.code).toBe('bad_credentials')
    expect(a.signedIn).toBe(false)
  })

  it('다음 호출이 시작되면 이전 오류는 지워진다', async () => {
    const a = useAccountStore()
    await a.signIn('none@b.com', 'pw123456')
    expect(a.error).not.toBeNull()
    await a.signUp('a@b.com', 'pw123456', '이우진')
    expect(a.error).toBeNull()
  })

  it('loading은 끝나면 반드시 꺼진다 — 실패해도', async () => {
    const a = useAccountStore()
    await a.signIn('none@b.com', 'pw123456')
    expect(a.loading).toBe(false)
  })

  it('emailTaken은 error를 더럽히지 않는다 — 폼 안내용이다', async () => {
    const a = useAccountStore()
    await a.signIn('none@b.com', 'pw123456')
    const before = a.error
    expect(await a.emailTaken('none@b.com')).toBe(false)
    expect(a.error).toBe(before)
  })
})

describe('account 스토어 — 이력서', () => {
  beforeEach(async () => {
    await useAccountStore().signUp('a@b.com', 'pw123456', '이우진')
  })

  it('종류별 슬롯을 세어 준다', async () => {
    const a = useAccountStore()
    await a.saveResume({ kind: 'admission', title: '자소서', text: 'y'.repeat(60) })
    expect(a.slotsOf('admission')).toHaveLength(1)
    expect(a.slotsOf('company')).toHaveLength(0)
  })

  it('슬롯이 차면 slot_full이 error에 담기고 목록은 그대로다', async () => {
    const a = useAccountStore()
    for (let i = 0; i < 3; i++)
      await a.saveResume({ kind: 'company', title: `${i}`, text: 'y'.repeat(60) })
    await a.saveResume({ kind: 'company', title: '넷째', text: 'y'.repeat(60) })
    expect(a.error?.code).toBe('slot_full')
    expect(a.slotsOf('company')).toHaveLength(3)
  })

  it('지우면 목록에서 빠진다', async () => {
    const a = useAccountStore()
    const slot = await a.saveResume({ kind: 'company', title: 'x', text: 'y'.repeat(60) })
    await a.deleteResume(slot!.id)
    expect(a.resumes).toHaveLength(0)
  })
})

describe('account 스토어 — 프리미엄', () => {
  it('결제하면 프리미엄이 되고 티켓이 10장이다', async () => {
    const a = useAccountStore()
    await a.signUp('a@b.com', 'pw123456', '이우진')
    await a.purchasePremium()
    expect(a.isPremium).toBe(true)
    expect(a.tickets).toBe(10)
  })

  it('비로그인은 티켓이 0이다', () => {
    expect(useAccountStore().tickets).toBe(0)
  })
})

describe('account 스토어 — 보관함', () => {
  const DRAFT = {
    interviewerId: 'm1',
    premium: false,
    track: 'company' as const,
    startedAt: '2026-10-09T00:00:00Z',
    endedAt: '2026-10-09T00:20:00Z',
    questionCount: 5,
    hasRecording: false,
    field: 'it',
    job: '백엔드 개발자',
    messages: [{ role: 'model' as const, text: '자기소개를 해 주세요' }],
    report: [{ question: 'Q1', answerSummary: 'A', feedback: 'F' }],
    reportRaw: '{}',
    recordings: [],
  }

  beforeEach(async () => {
    await useAccountStore().signUp('a@b.com', 'pw123456', '이우진')
  })

  it('저장하면 목록이 갱신된다', async () => {
    const a = useAccountStore()
    await a.saveArchive(DRAFT)
    expect(a.archive).toHaveLength(1)
  })

  it('밀려난 기록을 알려 준다 — 사라졌다고 말해 줘야 한다', async () => {
    const a = useAccountStore()
    for (let i = 0; i < 5; i++)
      await a.saveArchive({ ...DRAFT, startedAt: `2026-10-0${i + 1}T00:00:00Z` })
    const r = await a.saveArchive({ ...DRAFT, startedAt: '2026-10-09T00:00:00Z' })
    expect(r?.evicted).toHaveLength(1)
  })

  it('찼는지 알려 준다', async () => {
    const a = useAccountStore()
    for (let i = 0; i < 5; i++) await a.saveArchive(DRAFT)
    expect(a.archiveFull).toBe(true)
  })

  it('상세를 따로 받아 온다', async () => {
    const a = useAccountStore()
    const saved = await a.saveArchive(DRAFT)
    const full = await a.getArchive(saved!.entry.id)
    expect(full?.messages).toHaveLength(1)
  })

  it('지우면 목록에서 빠진다', async () => {
    const a = useAccountStore()
    const saved = await a.saveArchive(DRAFT)
    await a.deleteArchive(saved!.entry.id)
    expect(a.archive).toEqual([])
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
