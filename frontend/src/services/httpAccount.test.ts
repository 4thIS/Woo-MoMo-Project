import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeHttpAccount } from './httpAccount'

type Reply = { status?: number; body?: unknown; throws?: boolean }
let replies: Reply[] = []
let calls: { url: string; init: RequestInit }[] = []

function answer(...rs: Reply[]) {
  replies = rs
}

beforeEach(() => {
  calls = []
  replies = []
  vi.stubGlobal('fetch', (url: string, init: RequestInit = {}) => {
    calls.push({ url, init })
    const r = replies.shift() ?? { status: 200, body: null }
    if (r.throws) return Promise.reject(new TypeError('Failed to fetch'))
    const status = r.status ?? 200
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: () =>
        r.body === undefined ? Promise.reject(new Error('no body')) : Promise.resolve(r.body),
    } as Response)
  })
})
afterEach(() => vi.unstubAllGlobals())

const api = () => makeHttpAccount()
const SESSION = {
  userId: 'u1',
  email: 'a@b.com',
  tier: 'member' as const,
  tickets: 0,
  isAdmin: false,
  profile: { name: '이우진', age: null },
  createdAt: '2026-10-13T04:00:00.000Z',
}

describe('httpAccount — 요청 모양', () => {
  it('쿠키를 함께 보낸다 — 안 보내면 로그인이 유지되지 않는다', async () => {
    answer({ body: SESSION })
    await api().me()
    expect(calls[0].init.credentials).toBe('include')
  })

  it('같은 오리진의 /api로 부른다 — 쿠키가 실리려면 교차 오리진이면 안 된다', async () => {
    answer({ body: SESSION })
    await api().me()
    expect(calls[0].url).toBe('/api/me')
  })

  it('가입에는 동의를 함께 보낸다 — 서버가 없으면 422로 막는다', async () => {
    answer({ status: 201, body: SESSION })
    await api().signUp('a@b.com', 'pw123456', '이우진')
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      email: 'a@b.com',
      password: 'pw123456',
      name: '이우진',
      consent: true,
    })
  })

  it('이력서는 id가 있으면 고치고 없으면 새로 만든다', async () => {
    const slot = { id: 'r1', kind: 'company', title: 't', text: 'x', updatedAt: '2026-10-13' }
    answer({ status: 201, body: slot }, { body: slot })
    const a = api()
    await a.saveResume({ kind: 'company', title: 't', text: 'x' })
    expect([calls[0].init.method, calls[0].url]).toEqual(['POST', '/api/resumes'])
    await a.saveResume({ id: 'r1', kind: 'company', title: 't', text: 'x' })
    expect([calls[1].init.method, calls[1].url]).toEqual(['PUT', '/api/resumes/r1'])
  })

  it('이메일 중복 확인은 쿼리로 보내고 taken만 꺼낸다', async () => {
    answer({ body: { taken: true } })
    expect(await api().emailTaken('A@b.com ')).toBe(true)
    expect(calls[0].url).toBe('/api/auth/email-taken?email=A%40b.com%20')
  })
})

describe('httpAccount — 응답 다루기', () => {
  it('비로그인은 null이다 — 오류가 아니다', async () => {
    answer({ body: null })
    expect(await api().me()).toBeNull()
  })

  it('204에는 본문이 없다 — 파싱하려 들지 않는다', async () => {
    answer({ status: 204 })
    await expect(api().signOut()).resolves.toBeUndefined()
  })

  it('보관함 저장은 entry와 evicted를 그대로 돌려준다', async () => {
    answer({ status: 201, body: { entry: { id: 'a1' }, evicted: ['a0'] } })
    const r = await api().saveArchive({} as never)
    expect(r.evicted).toEqual(['a0'])
  })
})

describe('httpAccount — 오류', () => {
  it('서버 코드를 사람이 읽을 문구로 바꾼다 — 코드만 보여 주면 안 된다', async () => {
    answer({ status: 409, body: { error: 'email_taken' } })
    const e = await api()
      .signUp('a@b.com', 'pw123456', '이우진')
      .catch((x) => x)
    expect(e.code).toBe('email_taken')
    expect(e.message).toContain('이미 가입')
  })

  it('슬롯이 차면 어느 종류인지 함께 전한다', async () => {
    answer({ status: 409, body: { error: 'slot_full', kind: 'admission' } })
    const e = await api()
      .saveResume({ kind: 'admission', title: 't', text: 'x' })
      .catch((x) => x)
    expect([e.code, e.kind]).toEqual(['slot_full', 'admission'])
  })

  it('모르는 코드는 지어내지 않는다 — unknown으로 두고 일반 문구를 쓴다', async () => {
    answer({ status: 400, body: { error: '처음_보는_코드' } })
    const e = await api()
      .listResumes()
      .catch((x) => x)
    expect(e.code).toBe('unknown')
    expect(e.message).toMatch(/\S/)
  })

  it('본문이 JSON이 아니어도 던지다 말지 않는다', async () => {
    answer({ status: 500 })
    const e = await api()
      .listResumes()
      .catch((x) => x)
    expect(e.code).toBe('unknown')
  })

  it('연결 자체가 안 되면 network다', async () => {
    answer({ throws: true })
    const e = await api()
      .listResumes()
      .catch((x) => x)
    expect(e.code).toBe('network')
  })

  it('없는 것과 남의 것은 같은 404다', async () => {
    answer({ status: 404, body: { error: 'not_found' } })
    const e = await api()
      .getArchive('a9')
      .catch((x) => x)
    expect(e.code).toBe('not_found')
    expect(e.message).toContain('없')
  })

  it('일반 계정의 결제는 막혀 있다고 말한다', async () => {
    answer({ status: 403, body: { error: 'purchase_disabled' } })
    const e = await api()
      .purchasePremium()
      .catch((x) => x)
    expect(e.code).toBe('purchase_disabled')
  })

  it('구글 로그인은 아직 없다 — 조용히 실패하지 않고 준비 중이라고 말한다', async () => {
    const e = await api()
      .signInWithGoogle()
      .catch((x) => x)
    expect(e.code).toBe('unavailable')
    expect(e.message).toContain('준비 중')
    expect(calls).toHaveLength(0)
  })
})
