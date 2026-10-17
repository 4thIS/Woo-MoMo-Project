import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AdminError, adminApi } from './adminApi'

type Reply = { status?: number; body?: unknown; throws?: boolean }
let replies: Reply[] = []
let calls: { url: string; init: RequestInit }[] = []

beforeEach(() => {
  calls = []
  replies = []
  vi.stubGlobal('fetch', (url: string, init: RequestInit = {}) => {
    calls.push({ url, init })
    const r = replies.shift() ?? { status: 200, body: {} }
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

describe('adminApi — 요청 모양', () => {
  it('개요는 쿠키를 싣고 GET /api/admin/overview', async () => {
    replies = [{ body: { users: { total: 1 } } }]
    const r = await adminApi.overview()
    expect(calls[0].url).toBe('/api/admin/overview')
    expect(calls[0].init.credentials).toBe('include')
    expect(calls[0].init.method).toBe('GET')
    expect(r).toEqual({ users: { total: 1 } })
  })

  it('사용자 목록은 q를 인코딩하고 page를 붙인다', async () => {
    await adminApi.users('a b&c', 2)
    expect(calls[0].url).toBe('/api/admin/users?q=a%20b%26c&page=2')
  })

  it('사용자 상세', async () => {
    await adminApi.user('u_1')
    expect(calls[0].url).toBe('/api/admin/users/u_1')
  })

  it('티켓 조정은 JSON POST이고 남은 티켓 수를 돌려준다', async () => {
    replies = [{ body: { tickets: 8 } }]
    const n = await adminApi.adjustTickets('u_1', 5, '이벤트')
    expect(calls[0].url).toBe('/api/admin/users/u_1/tickets')
    expect(calls[0].init.method).toBe('POST')
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ delta: 5, reason: '이벤트' })
    expect(calls[0].init.credentials).toBe('include')
    expect(n).toBe(8)
  })

  it('사용량·감사 로그', async () => {
    await adminApi.usage(7)
    await adminApi.audit(3)
    expect(calls[0].url).toBe('/api/admin/usage?days=7')
    expect(calls[1].url).toBe('/api/admin/audit?page=3')
  })
})

describe('adminApi — 오류', () => {
  const cases: [number, string, string][] = [
    [401, 'unauthorized', '로그인이 필요합니다'],
    [403, 'admin_required', '관리자만 볼 수 있습니다'],
    [409, 'insufficient_tickets', '회수할 티켓이 부족합니다'],
    [422, 'invalid', '입력한 값을 다시 확인해 주세요'],
    [404, 'not_found', '없는 사용자입니다'],
  ]
  for (const [status, code, message] of cases) {
    it(`${code} → ${message}`, async () => {
      replies = [{ status, body: { error: code } }]
      const e = await adminApi.overview().catch((x) => x)
      expect(e).toBeInstanceOf(AdminError)
      expect(e.code).toBe(code)
      expect(e.message).toBe(message)
    })
  }

  it('모르는 코드·본문 없음은 unknown', async () => {
    replies = [{ status: 500, body: { error: 'boom' } }, { status: 502 }]
    const a = await adminApi.overview().catch((x) => x)
    const b = await adminApi.overview().catch((x) => x)
    expect(a.code).toBe('unknown')
    expect(b.code).toBe('unknown')
    expect(a.message).toBe('요청을 처리하지 못했습니다')
  })

  it('연결 실패는 network', async () => {
    replies = [{ throws: true }]
    const e = await adminApi.overview().catch((x) => x)
    expect(e.code).toBe('network')
    expect(e.message).toBe('연결하지 못했습니다')
  })
})
