import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('@/services/api', () => ({ getQuestions: vi.fn(), getManifest: vi.fn() }))
vi.mock('@/services/llm', () => ({ startSession: vi.fn() }))
vi.mock('@/services/tts', () => ({ synthesize: vi.fn(), initTts: vi.fn(), disposeTts: vi.fn() }))
vi.mock('@/services/audio', () => ({ playClip: vi.fn(), setMuted: vi.fn(), warmUpAudio: vi.fn() }))
import { getQuestions } from '@/services/api'
import { startSession } from '@/services/llm'
import type { LlmSession } from '@/services/llm'
import { useModelStore } from './model'
import { synthesize } from '@/services/tts'
import { playClip, setMuted } from '@/services/audio'
import { PLAY_GRACE_MS, SYNTH_TIMEOUT_MS, TTS_WARNING, useInterviewStore } from './interview'
import { REPORT_INSTRUCTION } from '@/prompts/report'
import { approxTokens } from '@/utils/tokens'

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
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
    expect(s.messages).toEqual([
      expect.objectContaining({ role: 'model', text: '자기소개를 해주세요. ' }),
    ])
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
    expect(s.messages.at(-1)).toEqual(expect.objectContaining({ role: 'user', text: '답' }))
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

  it('근사치는 시스템 프롬프트를 포함한다', async () => {
    vi.mocked(startSession).mockResolvedValue(fakeSession(['가나다'], -1))
    const s = await readyStore()
    await s.start()
    expect(s.tokenCount).toBeGreaterThan(approxTokens(s.messages.map((m) => m.text).join('\n')))
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

  it('finish는 두 번 겹쳐 불러도 리포트를 한 번만 요청한다', async () => {
    const json = JSON.stringify([{ question: 'Q', answerSummary: 'A', feedback: 'F' }])
    const sess = fakeSession(['q', '```json\n' + json + '\n```'])
    vi.mocked(startSession).mockResolvedValue(sess)
    const s = await readyStore()
    await s.start()
    const p1 = s.finish()
    const p2 = s.finish()
    await Promise.all([p1, p2])
    expect(sess.sent.filter((t) => t === REPORT_INSTRUCTION)).toHaveLength(1)
    expect(s.reportStatus).toBe('done')
  })

  it('종료 문장이 generate 경로로 오면 ended가 true이고 generating은 false다', async () => {
    vi.mocked(startSession).mockResolvedValue(
      fakeSession(['q', '수고하셨습니다. 면접을 마치겠습니다.']),
    )
    const s = await readyStore()
    await s.start()
    await s.send('답')
    expect(s.ended).toBe(true)
    expect(s.generating).toBe(false)
    expect(s.stage).toBe('waiting')
  })

  it('start를 연달아 두 번 불러도 세션은 한 번만 만든다', async () => {
    vi.mocked(startSession).mockResolvedValue(fakeSession(['q']))
    const s = await readyStore()
    const p1 = s.start()
    const p2 = s.start()
    await Promise.all([p1, p2])
    expect(startSession).toHaveBeenCalledTimes(1)
    expect(s.messages).toHaveLength(1)
    expect(s.messages[0].role).toBe('model')
  })

  it('첫 질문 생성이 실패하면 retryLast가 킥오프를 다시 보낸다', async () => {
    const sess = fakeSession(['q'])
    let attempts = 0
    let fail = true
    const origSend = sess.send
    sess.send = async (t, on, sig) => {
      if (t === '면접을 시작해 주세요.') attempts++
      if (fail && t === '면접을 시작해 주세요.') {
        fail = false
        throw new Error('boom')
      }
      return origSend(t, on, sig)
    }
    vi.mocked(startSession).mockResolvedValue(sess)
    const s = await readyStore()
    await s.start()
    expect(s.genError).toBe('boom')
    expect(s.messages).toEqual([])
    await s.retryLast()
    expect(attempts).toBe(2)
    expect(s.messages).toHaveLength(1)
    expect(s.messages[0].role).toBe('model')
    expect(s.genError).toBeNull()
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

  it('start·send·종료 시각을 기록한다', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
    vi.mocked(startSession).mockResolvedValue(fakeSession(['자기소개를 해주세요.']))
    const s = await readyStore()
    await s.start()
    expect(s.startedAt).toBe(1_000_000)
    expect(s.messages.at(-1)?.role).toBe('model')
    expect(s.messages.at(-1)?.at).toBe(1_000_000)
    vi.setSystemTime(1_090_000)
    await s.send('답변입니다')
    expect(s.messages.find((m) => m.role === 'user')?.at).toBe(1_090_000)
    expect(s.endedAt).toBeNull()
    vi.useRealTimers()
  })

  it('종료 문장이 오면 endedAt이 찍히고, finish가 먼저 불려도 endedAt은 한 번만', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(2_000_000)
    vi.mocked(startSession).mockResolvedValue(
      fakeSession(['q', '수고하셨습니다. 면접을 마치겠습니다.']),
    )
    const s = await readyStore()
    await s.start()
    await s.send('마지막 답')
    expect(s.ended).toBe(true)
    expect(s.endedAt).toBe(2_000_000)
    vi.setSystemTime(2_005_000)
    await s.finish()
    expect(s.endedAt).toBe(2_000_000)
    vi.useRealTimers()
  })
})

const TTS = {
  id: 'tts',
  baseUrl: '/models/tts/',
  files: [{ path: 'a', size: 1 }],
  voice: 'M2',
  lang: 'ko',
}
async function voiceStore() {
  const s = await readyStore()
  const m = useModelStore()
  m.manifest = { ...m.manifest!, tts: TTS }
  m.ttsStatus = 'ready'
  return s
}
const clip = (durationMs: number) => ({
  samples: new Float32Array(4),
  sampleRate: 44100,
  durationMs,
})
function fakePlay() {
  let end!: () => void
  const done = new Promise<void>((r) => (end = r))
  return { done, stop: vi.fn(() => end()), end }
}

describe('interview flow — 음성', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('TTS가 없으면 합성 없이 텍스트를 즉시 보인다', async () => {
    vi.mocked(startSession).mockResolvedValue(fakeSession(['첫 질문']))
    const s = await readyStore()
    await s.start()
    expect(synthesize).not.toHaveBeenCalled()
    expect(s.revealed).toBe('첫 질문 ')
    expect(s.stage).toBe('waiting')
  })

  it('생성 중엔 revealed가 비고(…), 합성 뒤 재생과 함께 글자가 균등하게 차오르며 끝나면 waiting', async () => {
    vi.mocked(synthesize).mockResolvedValue(clip(1000))
    const play = fakePlay()
    vi.mocked(playClip).mockReturnValue(play)
    vi.mocked(startSession).mockResolvedValue(fakeSession(['가나다라']))
    const s = await voiceStore()
    const p = s.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(s.stage).toBe('speaking')
    expect(s.speaking).toBe(true)
    expect(s.revealed).toBe('')
    expect(playClip).toHaveBeenCalledWith(expect.objectContaining({ durationMs: 1000 }), {
      muted: false,
    })
    await vi.advanceTimersByTimeAsync(500)
    expect(s.revealed).toBe('가나') // '가나다라 ' 5자 중 절반
    play.end()
    await vi.advanceTimersByTimeAsync(0)
    expect(s.revealed).toBe('가나다라 ')
    expect(s.speaking).toBe(false)
    expect(s.stage).toBe('waiting')
    expect(s.messages[0].at).toBe(Date.now()) // 답변 타이머 기준 = 재생이 끝난 시각
    await p
  })

  it('onended가 오지 않아도(suspended) durationMs + 여유 뒤에 끝난다', async () => {
    vi.mocked(synthesize).mockResolvedValue(clip(1000))
    vi.mocked(playClip).mockReturnValue(fakePlay())
    vi.mocked(startSession).mockResolvedValue(fakeSession(['q']))
    const s = await voiceStore()
    const p = s.start()
    await vi.advanceTimersByTimeAsync(1000 + PLAY_GRACE_MS)
    expect(s.speaking).toBe(false)
    expect(s.stage).toBe('waiting')
    await p
  })

  it('합성 실패는 텍스트 즉시 + 경고 한 줄, 다음 턴에 경고를 지운다', async () => {
    vi.mocked(synthesize).mockRejectedValueOnce(new Error('boom')).mockResolvedValue(clip(0))
    vi.mocked(playClip).mockImplementation(() => ({ done: Promise.resolve(), stop: vi.fn() }))
    vi.mocked(startSession).mockResolvedValue(fakeSession(['q1', 'q2']))
    const s = await voiceStore()
    await s.start()
    expect(s.revealed).toBe('q1 ')
    expect(s.ttsWarning).toBe(TTS_WARNING)
    expect(s.stage).toBe('waiting')
    expect(playClip).not.toHaveBeenCalled()
    const p = s.send('답')
    await vi.advanceTimersByTimeAsync(0)
    expect(s.ttsWarning).toBeNull()
    await vi.advanceTimersByTimeAsync(PLAY_GRACE_MS)
    await p
  })

  it('15초 안에 합성이 끝나지 않으면 abort 신호를 보내고 텍스트만 보인다', async () => {
    vi.mocked(synthesize).mockImplementation(
      (_t, signal) =>
        new Promise((_res, rej) =>
          signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError'))),
        ),
    )
    vi.mocked(startSession).mockResolvedValue(fakeSession(['q']))
    const s = await voiceStore()
    const p = s.start()
    await vi.advanceTimersByTimeAsync(SYNTH_TIMEOUT_MS - 1)
    expect(s.stage).toBe('thinking')
    await vi.advanceTimersByTimeAsync(1)
    expect(s.revealed).toBe('q ')
    expect(s.ttsWarning).toBe(TTS_WARNING)
    expect(s.stage).toBe('waiting')
    await p
  })

  it('재생 중 abort()는 소리를 멈추고 텍스트를 전부 보인다 (경고 없음)', async () => {
    vi.mocked(synthesize).mockResolvedValue(clip(5000))
    const play = fakePlay()
    vi.mocked(playClip).mockReturnValue(play)
    vi.mocked(startSession).mockResolvedValue(fakeSession(['긴 질문']))
    const s = await voiceStore()
    const p = s.start()
    await vi.advanceTimersByTimeAsync(100)
    expect(s.speaking).toBe(true)
    await s.abort()
    expect(play.stop).toHaveBeenCalled()
    expect(s.speaking).toBe(false)
    expect(s.revealed).toBe('긴 질문 ')
    expect(s.ttsWarning).toBeNull()
    expect(s.stage).toBe('waiting')
    await p
  })

  it('재생 중엔 send·setListening이 막힌다', async () => {
    vi.mocked(synthesize).mockResolvedValue(clip(5000))
    const play = fakePlay()
    vi.mocked(playClip).mockReturnValue(play)
    const sess = fakeSession(['q', 'q2'])
    vi.mocked(startSession).mockResolvedValue(sess)
    const s = await voiceStore()
    const p = s.start()
    await vi.advanceTimersByTimeAsync(100)
    await s.send('끼어들기')
    expect(sess.sent).toHaveLength(1)
    s.setListening(true)
    expect(s.stage).toBe('speaking')
    play.end()
    await vi.advanceTimersByTimeAsync(0)
    await p
  })

  it('finish()는 재생을 멈추고 리포트를 요청한다 (리포트는 합성하지 않는다)', async () => {
    vi.mocked(synthesize).mockResolvedValue(clip(5000))
    const play = fakePlay()
    vi.mocked(playClip).mockReturnValue(play)
    vi.mocked(startSession).mockResolvedValue(fakeSession(['q', '[]']))
    const s = await voiceStore()
    const p = s.start()
    await vi.advanceTimersByTimeAsync(100)
    await s.finish()
    expect(play.stop).toHaveBeenCalled()
    expect(s.reportStatus).toBe('done')
    expect(synthesize).toHaveBeenCalledTimes(1)
    await p
  })

  it('toggleMuted는 setMuted를 부르고 momo.muted에 기억한다. 새 스토어는 저장값을 읽는다', async () => {
    const s = await voiceStore()
    expect(s.muted).toBe(false)
    s.toggleMuted()
    expect(s.muted).toBe(true)
    expect(setMuted).toHaveBeenCalledWith(true)
    expect(localStorage.getItem('momo.muted')).toBe('1')
    setActivePinia(createPinia())
    expect(useInterviewStore().muted).toBe(true)
  })

  it('muted면 playClip에 muted:true로 넘긴다', async () => {
    localStorage.setItem('momo.muted', '1')
    vi.mocked(synthesize).mockResolvedValue(clip(0))
    vi.mocked(playClip).mockImplementation(() => ({ done: Promise.resolve(), stop: vi.fn() }))
    vi.mocked(startSession).mockResolvedValue(fakeSession(['q']))
    const s = await voiceStore()
    const p = s.start()
    await vi.advanceTimersByTimeAsync(PLAY_GRACE_MS)
    expect(playClip).toHaveBeenCalledWith(expect.anything(), { muted: true })
    await p
  })

  it('reset은 재생을 멈추고 revealed·ttsWarning을 비운다', async () => {
    vi.mocked(synthesize).mockResolvedValue(clip(5000))
    const play = fakePlay()
    vi.mocked(playClip).mockReturnValue(play)
    vi.mocked(startSession).mockResolvedValue(fakeSession(['q']))
    const s = await voiceStore()
    const p = s.start()
    await vi.advanceTimersByTimeAsync(100)
    await s.reset()
    expect(play.stop).toHaveBeenCalled()
    expect(s.speaking).toBe(false)
    expect(s.revealed).toBe('')
    expect(s.stage).toBe('idle')
    await p
  })
})

describe('canStart — TTS', () => {
  it('manifest.tts가 있고 ttsStatus가 ready가 아니면 잠기고 이유를 말한다', async () => {
    const s = await readyStore()
    const m = useModelStore()
    m.manifest = { ...m.manifest!, tts: TTS }
    m.ttsStatus = 'downloading'
    expect(s.canStart).toBe(false)
    expect(s.startBlockReason).toBe('면접관 목소리를 준비하면 열립니다')
    m.ttsStatus = 'ready'
    expect(s.canStart).toBe(true)
  })
})

describe('interview flow — 음성 재생 실패', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('playClip이 던지면 텍스트만 보이고 경고, waiting으로 간다 (thinking에 갇히지 않음)', async () => {
    vi.mocked(synthesize).mockResolvedValue(clip(1000))
    vi.mocked(playClip).mockImplementation(() => {
      throw new Error('NotSupportedError')
    })
    vi.mocked(startSession).mockResolvedValue(fakeSession(['q']))
    const s = await voiceStore()
    await s.start()
    expect(s.revealed).toBe('q ')
    expect(s.ttsWarning).toBe(TTS_WARNING)
    expect(s.speaking).toBe(false)
    expect(s.stage).toBe('waiting')
  })
})

describe('interview flow — 합성 대기 중', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('생성이 끝나고 합성을 기다리는 동안(thinking)도 면접관 차례라 send·setListening이 막힌다', async () => {
    let release!: (c: ReturnType<typeof clip>) => void
    vi.mocked(synthesize).mockReturnValue(new Promise((r) => (release = r)))
    vi.mocked(playClip).mockImplementation(() => ({ done: Promise.resolve(), stop: vi.fn() }))
    const sess = fakeSession(['q', 'q2'])
    vi.mocked(startSession).mockResolvedValue(sess)
    const s = await voiceStore()
    const p = s.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(s.generating).toBe(false)
    expect(s.speaking).toBe(false)
    expect(s.stage).toBe('thinking')
    expect(s.interviewerTurn).toBe(true)
    await s.send('끼어들기')
    expect(sess.sent).toHaveLength(1)
    s.setListening(true)
    expect(s.stage).toBe('thinking')
    release(clip(0))
    await vi.advanceTimersByTimeAsync(PLAY_GRACE_MS)
    await p
    expect(s.interviewerTurn).toBe(false)
  })
})
