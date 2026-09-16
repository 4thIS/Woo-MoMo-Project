import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('@/services/api', () => ({ getQuestions: vi.fn(), getManifest: vi.fn() }))
vi.mock('@/services/llm', () => ({ startSession: vi.fn() }))
import { getQuestions } from '@/services/api'
import { startSession } from '@/services/llm'
import type { LlmSession } from '@/services/llm'
import { useModelStore } from './model'
import { useInterviewStore } from './interview'

beforeEach(() => {
  setActivePinia(createPinia())
  vi.mocked(getQuestions).mockResolvedValue({
    field: 'it',
    questions: ['q1', 'q2', 'q3', 'q4', 'q5'],
  })
})

function fakeSession(replies: string[], tokens = 100): LlmSession & { sent: string[] } {
  const sent: string[] = []
  let i = 0
  return {
    sent,
    async send(text, onToken, signal) {
      sent.push(text)
      const reply = replies[i++] ?? ''
      for (const ch of reply.split(' ')) {
        if (signal?.aborted) break
        onToken(ch + ' ')
        await Promise.resolve()
      }
      return reply + ' '
    },
    async tokenCount() {
      return tokens
    },
    async dispose() {},
  }
}

async function readyStore() {
  const model = useModelStore()
  model.status = 'ready'
  model.manifest = {
    id: 'e4b',
    url: '/models/e4b',
    size: 1,
    template: { turnStart: '', turnEnd: '', roles: {} },
    systemPromptOverride: null,
    fallback: null,
  }
  const s = useInterviewStore()
  await s.setField('it')
  s.setJob('백엔드')
  s.setResume('cv.pdf', '가'.repeat(100))
  return s
}

describe('interview store', () => {
  it('처음은 landing', () => {
    expect(useInterviewStore().phase).toBe('landing')
  })

  it('setField는 폴백 질문을 미리 받아 둔다', async () => {
    const s = useInterviewStore()
    await s.setField('it')
    expect(s.profile.field).toBe('it')
    expect(s.fallbackQuestions).toHaveLength(5)
  })

  it('폴백 질문 실패는 조용히 무시한다', async () => {
    vi.mocked(getQuestions).mockRejectedValue(new Error('down'))
    const s = useInterviewStore()
    await s.setField('finance')
    expect(s.profile.field).toBe('finance')
    expect(s.fallbackQuestions).toEqual([])
  })

  it('setResume은 절단해서 저장한다', () => {
    const s = useInterviewStore()
    s.setResume('cv.pdf', ' 가'.repeat(3000))
    expect(s.resumeName).toBe('cv.pdf')
    expect(s.resumeText).toHaveLength(2000)
    expect(s.resumeDone).toBe(true)
  })

  it('50자 미만이면 resumeDone false', () => {
    const s = useInterviewStore()
    s.setResume('scan.pdf', '짧음')
    expect(s.resumeDone).toBe(false)
  })

  it.each([
    ['ready', 'it', '백엔드', true, null],
    ['downloaded', 'it', '백엔드', false, '면접관이 자리에 앉으면 열립니다'],
    ['ready', null, '백엔드', false, '위 항목을 채우면 열립니다'],
    ['ready', 'it', '', false, '위 항목을 채우면 열립니다'],
    ['downloaded', null, '', false, '면접관이 자리에 앉으면 열립니다'],
  ] as const)(
    'canStart: model=%s field=%s job=%s → %s',
    async (status, field, job, expected, reason) => {
      const m = useModelStore()
      m.status = status
      const s = useInterviewStore()
      if (field) await s.setField(field)
      s.setJob(job)
      s.setResume('cv.pdf', '가'.repeat(60))
      expect(s.canStart).toBe(expected)
      expect(s.startBlockReason).toBe(reason)
    },
  )
})

describe('interview flow', () => {
  it('start는 시스템 프롬프트로 세션을 열고 킥오프를 보내 첫 질문을 받는다', async () => {
    const sess = fakeSession(['자기소개를 해주세요.'])
    vi.mocked(startSession).mockResolvedValue(sess)
    const s = await readyStore()
    await s.start()
    expect(startSession).toHaveBeenCalledWith(expect.stringContaining('IT 분야'))
    expect(sess.sent[0]).toBe('면접을 시작해 주세요.')
    expect(s.phase).toBe('interview')
    expect(s.messages).toEqual([{ role: 'model', text: '자기소개를 해주세요. ' }])
    expect(s.stage).toBe('waiting')
    expect(s.tokenCount).toBe(100)
  })

  it('send는 user 턴을 기록하고 응답을 스트리밍한다', async () => {
    vi.mocked(startSession).mockResolvedValue(fakeSession(['첫 질문', '꼬리 질문']))
    const s = await readyStore()
    await s.start()
    await s.send('제 답변입니다')
    expect(s.messages.map((m) => m.role)).toEqual(['model', 'user', 'model'])
    expect(s.messages[2].text).toBe('꼬리 질문 ')
    expect(s.stage).toBe('waiting')
  })

  it('좋은 답변이면 reactPending', async () => {
    vi.mocked(startSession).mockResolvedValue(fakeSession(['q', 'q2']))
    const s = await readyStore()
    await s.start()
    await s.send('저는 개발자입니다. '.repeat(15))
    expect(s.reactPending).toBe(true)
    s.consumeReact()
    expect(s.reactPending).toBe(false)
  })

  it('종료 문장이 나오면 ended', async () => {
    vi.mocked(startSession).mockResolvedValue(
      fakeSession(['q', '수고하셨습니다. 면접을 마치겠습니다.']),
    )
    const s = await readyStore()
    await s.start()
    await s.send('답')
    expect(s.ended).toBe(true)
  })

  it('setListening은 waiting↔listening만 바꾼다', async () => {
    vi.mocked(startSession).mockResolvedValue(fakeSession(['q']))
    const s = await readyStore()
    await s.start()
    s.setListening(true)
    expect(s.stage).toBe('listening')
    s.setListening(false)
    expect(s.stage).toBe('waiting')
  })

  it('생성 실패는 genError + 마지막 user 턴을 retryLast로 재전송', async () => {
    const sess = fakeSession(['q', '다시 질문']) // 킥오프가 'q'를 쓰고, 재전송이 '다시 질문'을 받는다
    let fail = true
    const origSend = sess.send
    sess.send = async (t, on, sig) => {
      if (fail && t === '답') {
        fail = false
        throw new Error('boom')
      }
      return origSend(t, on, sig)
    }
    vi.mocked(startSession).mockResolvedValue(sess)
    const s = await readyStore()
    await s.start()
    await s.send('답')
    expect(s.genError).toBe('boom')
    expect(s.messages.at(-1)).toEqual({ role: 'user', text: '답' })
    await s.retryLast()
    expect(s.genError).toBeNull()
    expect(s.messages.at(-1)?.role).toBe('model')
  })

  it('finish는 리포트 지시문을 보내고 파싱한다', async () => {
    const json = JSON.stringify([{ question: 'Q', answerSummary: 'A', feedback: 'F' }])
    vi.mocked(startSession).mockResolvedValue(fakeSession(['q', '```json\n' + json + '\n```']))
    const s = await readyStore()
    await s.start()
    await s.finish()
    expect(s.phase).toBe('report')
    expect(s.reportStatus).toBe('done')
    expect(s.report).toEqual([{ question: 'Q', answerSummary: 'A', feedback: 'F' }])
  })

  it('리포트 파싱 실패는 report null + reportRaw 유지', async () => {
    vi.mocked(startSession).mockResolvedValue(fakeSession(['q', '그냥 텍스트']))
    const s = await readyStore()
    await s.start()
    await s.finish()
    expect(s.report).toBeNull()
    expect(s.reportRaw).toContain('그냥 텍스트')
    expect(s.reportStatus).toBe('done')
  })

  it('tokenCount가 -1이면 근사치를 쓴다', async () => {
    vi.mocked(startSession).mockResolvedValue(fakeSession(['가나다'], -1))
    const s = await readyStore()
    await s.start()
    expect(s.tokenCount).toBeGreaterThan(0)
  })

  it('공백만 온 응답은 기록하지 않는다', async () => {
    vi.mocked(startSession).mockResolvedValue(fakeSession(['q', '']))
    const s = await readyStore()
    await s.start()
    await s.send('답')
    expect(s.messages.map((m) => m.role)).toEqual(['model', 'user'])
  })

  it('finish는 진행 중 생성의 중단 정리를 기다린 뒤 리포트를 요청한다', async () => {
    const order: string[] = []
    const sess = fakeSession(['q'])
    sess.send = async (t, on, signal) => {
      if (t === '긴 답') {
        order.push('gen-start')
        await new Promise<void>((r) => signal?.addEventListener('abort', () => r(), { once: true }))
        order.push('gen-aborted')
        return 'partial '
      }
      order.push('send:' + t.slice(0, 6))
      on(t === '면접을 시작해 주세요.' ? 'q ' : '[] ')
      return t === '면접을 시작해 주세요.' ? 'q ' : '[] '
    }
    vi.mocked(startSession).mockResolvedValue(sess)
    const s = await readyStore()
    await s.start()
    const sending = s.send('긴 답')
    await Promise.resolve()
    await s.finish()
    await sending
    expect(order.indexOf('gen-aborted')).toBeLessThan(
      order.findIndex((o) => o.startsWith('send:면접이')),
    )
    expect(s.reportStatus).toBe('done')
  })

  it('reset은 대화·리포트를 비우고 prepare로 간다', async () => {
    vi.mocked(startSession).mockResolvedValue(fakeSession(['q']))
    const s = await readyStore()
    await s.start()
    await s.reset()
    expect(s.phase).toBe('prepare')
    expect(s.messages).toEqual([])
    expect(s.report).toBeNull()
    expect(s.profile.job).toBe('')
  })
})
