import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BenError, reportStream, startInterview, turnStream, uploadVoice } from './benInterview'

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

  it('어느 칸이 잘못됐는지 함께 알린다 — 화면이 그 칸 옆에 붙여 보여 준다', async () => {
    next = [{ status: 422, json: { error: 'invalid', field: 'postingUrl' } }]
    const e = await startInterview(COMPANY).catch((x) => x)
    expect(e.code).toBe('invalid')
    expect(e.field).toBe('postingUrl')
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

  it('회사 브리핑 status 이벤트를 흘린다 — 조사 중 표시에 쓴다', async () => {
    next = [
      {
        sse: [
          ': ping\n\n',
          'event: status\ndata: {"phase":"researching"}\n\n',
          'event: status\ndata: {"phase":"briefing","ok":true}\n\n',
          'event: delta\ndata: {"text":"자기소개를 해 주세요."}\n\n',
          'event: done\ndata: {"ended":false}\n\n',
        ],
      },
    ]
    const seen: unknown[] = []
    const got: string[] = []
    await turnStream(
      'pi_1',
      undefined,
      (t) => got.push(t),
      undefined,
      (st) => seen.push(st),
    )
    expect(seen).toEqual([{ phase: 'researching' }, { phase: 'briefing', ok: true }])
    expect(got.join('')).toBe('자기소개를 해 주세요.')
  })

  it('조사에 실패하면 ok:false로 온다 — 면접은 그대로 이어진다', async () => {
    next = [
      {
        sse: [
          'event: status\ndata: {"phase":"briefing","ok":false}\n\n',
          'event: delta\ndata: {"text":"자기소개를 해 주세요."}\n\n',
          'event: done\ndata: {"ended":false}\n\n',
        ],
      },
    ]
    const seen: unknown[] = []
    const r = await turnStream(
      'pi_1',
      undefined,
      () => {},
      undefined,
      (st) => seen.push(st),
    )
    expect(seen).toEqual([{ phase: 'briefing', ok: false }])
    expect(r.ended).toBe(false)
  })

  it('모르는 status는 무시하고 이어 간다 — 계약이 늘어도 깨지지 않는다', async () => {
    next = [
      {
        sse: [
          'event: status\ndata: {"phase":"무언가새것"}\n\n',
          'event: done\ndata: {"ended":false}\n\n',
        ],
      },
    ]
    const seen: unknown[] = []
    await expect(
      turnStream(
        'pi_1',
        undefined,
        () => {},
        undefined,
        (st) => seen.push(st),
      ),
    ).resolves.toEqual({ ended: false })
    expect(seen).toEqual([{ phase: '무언가새것' }])
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

  it('버전 2 report 이벤트를 넘겨준다 — 화면은 원문이 아니라 이것으로 그린다', async () => {
    const payload = {
      version: 2,
      items: [
        {
          id: 'Q1',
          parent: null,
          answer: 1,
          kind: 'main',
          question: '자기소개',
          answerSummary: '요약',
          feedback: '피드백',
          delivery: null,
          measurements: null,
          profile: null,
        },
      ],
      summary: { strengths: [], improvements: [], delivery: null, postingFit: null },
    }
    next = [
      {
        sse: [
          'event: delta\ndata: {"text":"{\\"items\\""}\n\n',
          `event: report\ndata: ${JSON.stringify(payload)}\n\n`,
          'event: done\ndata: {}\n\n',
        ],
      },
    ]
    let got: unknown = null
    await reportStream('pi_1', () => {}, undefined, undefined, { onReport: (r) => (got = r) })
    expect(got).toEqual(payload)
  })

  it('reset이 오면 그때까지 받은 원문을 버리라고 알린다', async () => {
    next = [
      {
        sse: [
          'event: delta\ndata: {"text":"쓰다 만 것"}\n\n',
          'event: reset\ndata: {}\n\n',
          'event: delta\ndata: {"text":"다시"}\n\n',
          'event: done\ndata: {}\n\n',
        ],
      },
    ]
    const seen: string[] = []
    let resets = 0
    await reportStream('pi_1', (t) => seen.push(t), undefined, undefined, {
      onReset: () => {
        resets++
        seen.length = 0
      },
    })
    expect(resets).toBe(1)
    expect(seen.join('')).toBe('다시')
  })

  it('버전 2 전용 오류도 코드로 알린다', async () => {
    for (const code of ['bad_report', 'too_long']) {
      next = [{ sse: [`event: error\ndata: {"code":"${code}"}\n\n`] }]
      const e = await reportStream('pi_1', () => {}).catch((x) => x)
      expect(e.code).toBe(code)
    }
  })

  it('답변이 하나도 없으면 no_answers', async () => {
    next = [{ status: 409, json: { error: 'no_answers' } }]
    const e = await reportStream('pi_1', () => {}).catch((x) => x)
    expect(e.code).toBe('no_answers')
    expect(e.message).toMatch(/\S/)
  })

  const ok = () => [{ sse: ['event: delta\ndata: {"text":"[]"}\n\n', 'event: done\ndata: {}\n\n'] }]
  const metric = (answer: number) => ({
    answer,
    speechSec: 20,
    syllables: 100,
    longPauses: 1,
    longestPauseSec: 2.4,
    firstWordSec: 0.8,
    fillerLevel: 'low' as const,
  })
  const sentBody = () => JSON.parse(String(calls[0].init.body))

  it('측정값을 싣는다', async () => {
    next = ok()
    await reportStream('pi_1', () => {}, undefined, [metric(1)])
    expect(sentBody()).toEqual({ delivery: [metric(1)] })
  })

  it('측정이 없으면 본문은 {} — 예전과 같은 요청이다', async () => {
    next = ok()
    await reportStream('pi_1', () => {}, undefined, [])
    expect(sentBody()).toEqual({})
    next = ok()
    calls = []
    await reportStream('pi_1', () => {})
    expect(sentBody()).toEqual({})
  })

  it('서버 상한(8개)을 넘겨 보내지 않는다 — 한 개가 넘쳐도 통째로 422가 된다', async () => {
    next = ok()
    await reportStream('pi_1', () => {}, undefined, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(metric))
    expect(sentBody().delivery.map((d: { answer: number }) => d.answer)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8,
    ])
  })
})

describe('uploadVoice', () => {
  const wav = () => new ArrayBuffer(44)

  it('답변 번호별 주소로 WAV를 올린다', async () => {
    next = [{ status: 202, json: { status: 'queued' } }]
    expect(await uploadVoice('pi_1', 3, wav())).toBe(true)
    expect(calls[0].url).toBe('/api/premium/interviews/pi_1/voice/3')
    const body = calls[0].init.body as FormData
    expect(body.get('file')).toBeInstanceOf(Blob)
  })

  it('퇴짜를 맞아도 조용히 넘어간다 — 면접은 계속돼야 한다', async () => {
    for (const status of [403, 409, 413, 415, 429, 503]) {
      next = [{ status, json: { error: 'x' } }]
      expect(await uploadVoice('pi_1', 1, wav())).toBe(false)
    }
  })

  it('망이 끊겨도 터지지 않는다', async () => {
    next = [{ throws: true }]
    expect(await uploadVoice('pi_1', 1, wav())).toBe(false)
  })
})
