import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { makeMockAccount } from './accountMock'

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
    expect(missing.message).toBe(wrong.message)
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

  it('구글 로그인은 처음이면 계정을 만든다', async () => {
    const s = await api.signInWithGoogle('new@gmail.com')
    expect(s.email).toBe('new@gmail.com')
    expect(s.tier).toBe('member')
  })

  it('이름·나이를 저장한다', async () => {
    await api.signUp('a@b.com', 'pw123456')
    const s = await api.saveProfile({ name: '홍길동', age: 19 })
    expect(s.profile).toEqual({ name: '홍길동', age: 19 })
    expect((await api.me())?.profile.name).toBe('홍길동')
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
  beforeEach(async () => {
    await api.signUp('a@b.com', 'pw123456')
  })

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
    const again = await api.saveResume({
      id: made.id,
      kind: 'company',
      title: '후',
      text: 'y'.repeat(60),
    })
    expect(again.id).toBe(made.id)
    expect(again.title).toBe('후')
    expect(await api.listResumes()).toHaveLength(1)
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

  it('남의 이력서는 지우지 못한다', async () => {
    const made = await api.saveResume({ kind: 'company', title: '내 것', text: 'x'.repeat(60) })
    await api.signOut()
    await api.signUp('other@b.com', 'pw123456')
    await expect(api.deleteResume(made.id)).rejects.toMatchObject({ code: 'unauthorized' })
  })

  it('비로그인은 목록을 못 본다', async () => {
    await api.signOut()
    await expect(api.listResumes()).rejects.toMatchObject({ code: 'unauthorized' })
  })
})

describe('mockAccount — 저장이 막힌 브라우저', () => {
  it('읽기가 던져도 비로그인으로 뜬다', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    expect(await makeMockAccount({ delayMs: 0 }).me()).toBeNull()
  })

  it('저장된 값이 깨져 있어도 던지지 않는다', async () => {
    localStorage.setItem('momo.mock.account', '{not json')
    expect(await makeMockAccount({ delayMs: 0 }).me()).toBeNull()
  })

  it('쓰기가 던져도 가입은 성공한다 — 이번 세션만 유지된다', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied')
    })
    const s = await makeMockAccount({ delayMs: 0 }).signUp('a@b.com', 'pw123456')
    expect(s.email).toBe('a@b.com')
  })
})
