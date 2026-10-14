import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BenError, reportStream, startInterview, turnStream } from './benInterview'

let calls: { url: string; init: RequestInit }[] = []
let next: { status?: number; json?: unknown; sse?: string[]; throws?: boolean }[] = []

/** 조각들을 순서대로 흘리는 스트림 본문 */
function stream(chunks: string[]) {
  const enc = new TextEncoder()
  let i = 0
  return {
    getReader: () => ({
      read: () =>
        Promise.resolve(
          i < chunks.length ? { done: false, value: enc.encode(chunks[i++]) } : { done: true },
        ),
      cancel: () => Promise.resolve(),
    }),
  }
}

beforeEach(() => {
  calls = []
  next = []
  vi.stubGlobal('fetch', (url: string, init: RequestInit = {}) => {
    calls.push({ url, init })
    const r = next.shift() ?? {}
    if (r.throws) return Promise.reject(new TypeError('Failed to fetch'))
    const status = r.status ?? 200
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(r.json ?? null),
      body: r.sse ? stream(r.sse) : null,
    } as unknown as Response)
  })
})
afterEach(() => vi.unstubAllGlobals())

const COMPANY = {
  track: 'company' as const,
  resumeText: '이력서 본문',
  company: { field: 'it', job: '백엔드 개발자' },
}

describe('startInterview', () => {
  it('트랙에 맞는 묶음만 보낸다', async () => {
    next = [{ status: 201, json: { interviewId: 'pi_1', session: { tickets: 9 } } }]
    const r = await startInterview(COMPANY)
    expect(r.interviewId).toBe('pi_1')
    expect(calls[0].url).toBe('/api/premium/interviews')
    expect(JSON.parse(String(calls[0].init.body))).toEqual(COMPANY)
  })

  it('티켓이 없으면 no_tickets로 알린다', async () => {
    next = [{ status: 409, json: { error: 'no_tickets' } }]
    const e = await startInterview(COMPANY).catch((x) => x)
    expect(e).toBeInstanceOf(BenError)
    expect(e.code).toBe('no_tickets')
    expect(e.message).toMatch(/\S/)
  })

  it('서버에 키가 없으면 ben_unavailable — 왜 안 되는지 말해 준다', async () => {
    next = [{ status: 503, json: { error: 'ben_unavailable' } }]
    const e = await startInterview(COMPANY).catch((x) => x)
    expect(e.code).toBe('ben_unavailable')
  })
})

describe('turnStream', () => {
  it('delta를 순서대로 흘리고 ended를 돌려준다', async () => {
    next = [
      {
        sse: [
          ': ping\n\n',
          'event: delta\ndata: {"text":"자기소개를 "}\n\n',
          'event: delta\ndata: {"text":"해 주세요."}\n\n',
          'event: done\ndata: {"ended":false}\n\n',
        ],
      },
    ]
    const got: string[] = []
    const r = await turnStream('pi_1', '안녕하세요', (t) => got.push(t))
    expect(got.join('')).toBe('자기소개를 해 주세요.')
    expect(r.ended).toBe(false)
  })

  it('첫 턴은 답변 없이 보낸다 — 서버가 첫 질문을 만든다', async () => {
    next = [{ sse: ['event: done\ndata: {"ended":false}\n\n'] }]
    await turnStream('pi_1', undefined, () => {})
    expect(calls[0].url).toBe('/api/premium/interviews/pi_1/turns')
    expect(JSON.parse(String(calls[0].init.body))).toEqual({})
  })

  it('끝났으면 ended true', async () => {
    next = [{ sse: ['event: done\ndata: {"ended":true}\n\n'] }]
    expect((await turnStream('pi_1', '네', () => {})).ended).toBe(true)
  })

  it('스트림 전 오류는 JSON이다 — 409면 면접이 끝난 것', async () => {
    next = [{ status: 409, json: { error: 'interview_over' } }]
    const e = await turnStream('pi_1', '네', () => {}).catch((x) => x)
    expect(e.code).toBe('interview_over')
  })

  it('스트림 안의 error 이벤트도 같은 오류로 올린다 — 같은 요청을 다시 보내면 된다', async () => {
    next = [
      {
        sse: [
          'event: delta\ndata: {"text":"반쯤"}\n\n',
          'event: error\ndata: {"code":"claude_error"}\n\n',
        ],
      },
    ]
    const got: string[] = []
    const e = await turnStream('pi_1', '네', (t) => got.push(t)).catch((x) => x)
    expect(e.code).toBe('claude_error')
    expect(e.retryable).toBe(true)
  })

  it('안전 분류기 거절은 다시 보내도 소용없다', async () => {
    next = [{ sse: ['event: error\ndata: {"code":"refused"}\n\n'] }]
    const e = await turnStream('pi_1', '네', () => {}).catch((x) => x)
    expect([e.code, e.retryable]).toEqual(['refused', false])
  })

  it('done 없이 스트림이 끊기면 실패로 본다 — 반쪽 턴을 성공이라 하지 않는다', async () => {
    next = [{ sse: ['event: delta\ndata: {"text":"반쯤"}\n\n'] }]
    const e = await turnStream('pi_1', '네', () => {}).catch((x) => x)
    expect(e.code).toBe('stream_broken')
    expect(e.retryable).toBe(true)
  })

  it('연결 자체가 안 되면 network', async () => {
    next = [{ throws: true }]
    const e = await turnStream('pi_1', '네', () => {}).catch((x) => x)
    expect(e.code).toBe('network')
  })
})

describe('reportStream', () => {
  it('원문을 delta로 모아 준다', async () => {
    next = [
      {
        sse: [
          ': ping\n\n',
          'event: delta\ndata: {"text":"[{\\"q\\":1}]"}\n\n',
          'event: done\ndata: {}\n\n',
        ],
      },
    ]
    const got: string[] = []
    await reportStream('pi_1', (t) => got.push(t))
    expect(got.join('')).toBe('[{"q":1}]')
    expect(calls[0].url).toBe('/api/premium/interviews/pi_1/report')
  })

  it('턴이 하나도 없으면 interview_not_started', async () => {
    next = [{ status: 409, json: { error: 'interview_not_started' } }]
    const e = await reportStream('pi_1', () => {}).catch((x) => x)
    expect(e.code).toBe('interview_not_started')
  })
})
