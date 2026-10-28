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
      // 인증을 쓰지 않는 서버는 이 칸을 무시한다(`docs/API.md`)
      code: '',
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

describe('httpAccount — 녹음', () => {
  it('multipart로 올린다 — Content-Type을 직접 붙이면 경계가 깨진다', async () => {
    answer({ status: 201, body: { id: 'rec1', url: '/api/recordings/rec1' } })
    const clip = new Blob(['x'], { type: 'audio/webm' })
    const r = await api().uploadRecording('a1', 2, clip)
    expect(r.url).toBe('/api/recordings/rec1')
    const init = calls[0].init
    expect(calls[0].url).toBe('/api/recordings')
    expect(init.method).toBe('POST')
    expect(init.body).toBeInstanceOf(FormData)
    expect((init.headers as Record<string, string>) ?? {}).not.toHaveProperty('Content-Type')
    const fd = init.body as FormData
    expect(fd.get('archiveId')).toBe('a1')
    expect(fd.get('turn')).toBe('2')
    expect(fd.get('clip')).toBeInstanceOf(Blob)
  })

  it('너무 크면 too_large — nginx가 JSON이 아닌 본문으로 막아도 상태로 판단한다', async () => {
    answer({ status: 413 })
    const e = await api()
      .uploadRecording('a1', 0, new Blob(['x']))
      .catch((x) => x)
    expect(e.code).toBe('too_large')
  })

  it('지원하지 않는 형식은 unsupported_media', async () => {
    answer({ status: 415, body: { error: 'unsupported_media' } })
    const e = await api()
      .uploadRecording('a1', 0, new Blob(['x']))
      .catch((x) => x)
    expect(e.code).toBe('unsupported_media')
  })
})

describe('httpAccount — 가입 이메일 인증', () => {
  it('인증 사용 여부를 묻는다', async () => {
    answer({ body: { emailVerify: true } })
    expect(await api().signupConfig()).toEqual({ emailVerify: true })
    expect(calls[0].url).toBe('/api/auth/signup/config')
  })

  it('인증번호를 보내고 두 시간을 받는다', async () => {
    answer({ status: 202, body: { expiresInSec: 600, resendInSec: 60 } })
    expect(await api().sendSignupCode('a@b.com')).toEqual({ expiresInSec: 600, resendInSec: 60 })
    expect(calls[0].url).toBe('/api/auth/signup/code')
    expect(calls[0].init.method).toBe('POST')
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ email: 'a@b.com' })
  })

  it('code를 문자열로 보낸다 — 숫자로 보내면 앞자리 0이 사라진다', async () => {
    answer({ status: 201, body: SESSION })
    await api().signUp('a@b.com', 'pw123456', '이우진', { code: '012345' })
    const body = JSON.parse(calls[0].init.body as string)
    expect(body.code).toBe('012345')
    expect(typeof body.code).toBe('string')
  })

  it('code가 없으면 빈 문자열로 간다 — 인증이 꺼진 서버는 무시한다', async () => {
    answer({ status: 201, body: SESSION })
    await api().signUp('a@b.com', 'pw123456', '이우진')
    expect(JSON.parse(calls[0].init.body as string).code).toBe('')
  })

  it('다시 받기 대기 시간을 담아 온다', async () => {
    answer({ status: 429, body: { error: 'code_cooldown', retryAfterSec: 40 } })
    const e = await api()
      .sendSignupCode('a@b.com')
      .catch((x) => x)
    expect(e.code).toBe('code_cooldown')
    expect(e.retryAfterSec).toBe(40)
  })

  it('틀린 인증번호는 남은 시도 수와 칸 이름을 함께 준다', async () => {
    answer({ status: 422, body: { error: 'code_invalid', field: 'code', attemptsLeft: 3 } })
    const e = await api()
      .signUp('a@b.com', 'pw123456', '이우진', { code: '111111' })
      .catch((x) => x)
    expect(e.code).toBe('code_invalid')
    expect(e.attemptsLeft).toBe(3)
    expect(e.field).toBe('code')
  })

  it('메일을 못 보낸 것과 키가 없는 것을 구분한다', async () => {
    answer({ status: 502, body: { error: 'mail_failed' } })
    expect(
      (
        await api()
          .sendSignupCode('a@b.com')
          .catch((x) => x)
      ).code,
    ).toBe('mail_failed')
    answer({ status: 503, body: { error: 'mail_unavailable' } })
    expect(
      (
        await api()
          .sendSignupCode('a@b.com')
          .catch((x) => x)
      ).code,
    ).toBe('mail_unavailable')
  })

  it('새 코드에도 사람이 읽을 문구가 붙는다', async () => {
    for (const code of ['code_required', 'code_expired', 'code_limit', 'verify_disabled']) {
      answer({ status: 422, body: { error: code } })
      const e = await api()
        .sendSignupCode('a@b.com')
        .catch((x) => x)
      expect(e.code).toBe(code)
      expect(e.message).not.toBe('')
      expect(e.message).not.toBe('요청을 처리하지 못했습니다')
    }
  })
})

describe('httpAccount — 비밀번호 규칙·약관', () => {
  it('config는 약관 설정도 함께 준다', async () => {
    answer({ body: { emailVerify: true, termsRequired: true, termsVersion: '2026-10-28' } })
    expect(await api().signupConfig()).toEqual({
      emailVerify: true,
      termsRequired: true,
      termsVersion: '2026-10-28',
    })
  })

  it('약관 칸이 없는 옛 서버도 그대로 읽는다', async () => {
    answer({ body: { emailVerify: false } })
    expect((await api().signupConfig()).termsRequired).toBeUndefined()
  })

  it('weak_password의 rule을 담아 온다 — 어느 조건이 틀렸는지 알려 준다', async () => {
    answer({ status: 422, body: { error: 'weak_password', field: 'password', rule: 'whitespace' } })
    const e = await api()
      .signUp('a@b.com', 'pw 12345', '이우진')
      .catch((x) => x)
    expect(e.code).toBe('weak_password')
    expect(e.rule).toBe('whitespace')
  })

  it('동의 두 가지를 그대로 보낸다 — 자동으로 true를 넣지 않는다', async () => {
    answer({ status: 201, body: SESSION })
    await api().signUp('a@b.com', 'pw123456', '이우진', {
      code: '123456',
      consent: true,
      termsAgreed: true,
    })
    const body = JSON.parse(calls[0].init.body as string)
    expect(body.consent).toBe(true)
    expect(body.termsAgreed).toBe(true)
    expect(body.code).toBe('123456')
  })

  it('동의를 안 넘기면 보내지 않는다 — 약관을 쓰지 않는 서버와 같게', async () => {
    answer({ status: 201, body: SESSION })
    await api().signUp('a@b.com', 'pw123456', '이우진')
    const body = JSON.parse(calls[0].init.body as string)
    expect(body.consent).toBe(true)
    expect(body.termsAgreed).toBeUndefined()
  })

  it('약관 미동의에도 문구가 붙는다', async () => {
    answer({ status: 422, body: { error: 'terms_required', field: 'termsAgreed' } })
    const e = await api()
      .signUp('a@b.com', 'pw123456', '이우진')
      .catch((x) => x)
    expect(e.code).toBe('terms_required')
    expect(e.field).toBe('termsAgreed')
    expect(e.message).not.toBe('요청을 처리하지 못했습니다')
  })
})
