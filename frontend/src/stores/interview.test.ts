import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('@/services/api', () => ({ getQuestions: vi.fn(), getManifest: vi.fn() }))
vi.mock('@/services/llm', () => ({ startSession: vi.fn() }))
vi.mock('@/services/tts', () => ({ synthesize: vi.fn(), initTts: vi.fn(), disposeTts: vi.fn() }))
vi.mock('@/services/audio', () => ({ playClip: vi.fn(), setMuted: vi.fn(), warmUpAudio: vi.fn() }))
vi.mock('@/services/recorder', () => ({ startRecording: vi.fn() }))
vi.mock('@/services/benInterview', async (orig) => ({
  ...(await orig<typeof import('@/services/benInterview')>()),
  startInterview: vi.fn(),
  turnStream: vi.fn(),
  reportStream: vi.fn(),
}))
import { getQuestions } from '@/services/api'
import { startSession } from '@/services/llm'
import type { LlmSession } from '@/services/llm'
import { useModelStore } from './model'
import { synthesize } from '@/services/tts'
import { playClip, setMuted } from '@/services/audio'
import { startRecording } from '@/services/recorder'
import { BenError, reportStream, startInterview, turnStream } from '@/services/benInterview'
import {
  PLAY_GRACE_MS,
  RECORDING_FULL,
  RECORDING_MAX_BYTES,
  RESUME_MIN,
  SYNTH_TIMEOUT_MS,
  TTS_WARNING,
  useInterviewStore,
} from './interview'
import { REPORT_INSTRUCTION } from '@/prompts/report'
import { approxTokens } from '@/utils/tokens'
import { useAccountStore, setAccountApi } from './account'
import { makeMockAccount } from '@/services/accountMock'

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

/** 리포트 JSON을 모델이 내놓는 코드펜스로 감싼다 */
const fenced = (json: string) => ['```json', json, '```'].join('\n')

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

describe('interview flow — 생성 중단과 음성', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  /** 킥오프는 즉시 답하고, '긴 답'은 abort 신호가 올 때까지 토큰을 흘리다 부분 텍스트로 resolve(실제 llm.ts와 같음) */
  function slowSession() {
    const sess = fakeSession(['q'])
    sess.send = async (t, on, signal) => {
      sess.sent.push(t)
      if (t !== '긴 답') {
        on(t === '면접을 시작해 주세요.' ? 'q ' : '[] ')
        return t === '면접을 시작해 주세요.' ? 'q ' : '[] '
      }
      on('부분 ')
      await new Promise<void>((r) => signal?.addEventListener('abort', () => r(), { once: true }))
      return '부분 '
    }
    return sess
  }

  it('생성 중 abort()로 끝난 부분 텍스트는 읽지 않고 바로 보인다', async () => {
    vi.mocked(synthesize).mockResolvedValue(clip(0))
    vi.mocked(playClip).mockImplementation(() => ({ done: Promise.resolve(), stop: vi.fn() }))
    const sess = slowSession()
    vi.mocked(startSession).mockResolvedValue(sess)
    const s = await voiceStore()
    const p = s.start()
    await vi.advanceTimersByTimeAsync(PLAY_GRACE_MS)
    await p
    expect(synthesize).toHaveBeenCalledTimes(1) // 킥오프 질문만
    const sending = s.send('긴 답')
    await vi.advanceTimersByTimeAsync(0)
    await s.abort()
    await sending
    expect(synthesize).toHaveBeenCalledTimes(1)
    expect(s.revealed).toBe('부분 ')
    expect(s.stage).toBe('waiting')
  })

  it('생성 중 finish()는 부분 텍스트를 읽지 않고 바로 리포트를 요청한다', async () => {
    vi.mocked(synthesize).mockResolvedValue(clip(0))
    vi.mocked(playClip).mockImplementation(() => ({ done: Promise.resolve(), stop: vi.fn() }))
    const sess = slowSession()
    vi.mocked(startSession).mockResolvedValue(sess)
    const s = await voiceStore()
    const p = s.start()
    await vi.advanceTimersByTimeAsync(PLAY_GRACE_MS)
    await p
    const sending = s.send('긴 답')
    await vi.advanceTimersByTimeAsync(0)
    await s.finish()
    await sending
    expect(synthesize).toHaveBeenCalledTimes(1)
    expect(playClip).toHaveBeenCalledTimes(1)
    expect(s.reportStatus).toBe('done')
  })

  it('합성 실패로 바로 보인 질문도 at은 그 시각으로 다시 찍힌다 (답변 타이머 기준)', async () => {
    vi.mocked(synthesize).mockImplementation(
      () => new Promise((_r, rej) => setTimeout(() => rej(new Error('slow fail')), 3000)),
    )
    vi.mocked(startSession).mockResolvedValue(fakeSession(['q']))
    const s = await voiceStore()
    const p = s.start()
    await vi.advanceTimersByTimeAsync(0)
    const genAt = s.messages[0].at!
    await vi.advanceTimersByTimeAsync(3000)
    await p
    expect(s.messages[0].at).toBe(genAt + 3000)
  })
})

describe('startBlockReason — 실패와 대기를 구분한다 (#41)', () => {
  it('Gemma 실패', async () => {
    const s = await readyStore()
    useModelStore().status = 'error'
    expect(s.startBlockReason).toBe('면접관을 준비하지 못했습니다 — 위 진행 창에서 다시 시도')
  })
  it('TTS 실패 vs 준비 중', async () => {
    const s = await readyStore()
    const m = useModelStore()
    m.manifest = { ...m.manifest!, tts: TTS }
    m.ttsStatus = 'error'
    expect(s.startBlockReason).toBe(
      '목소리를 준비하지 못했습니다 — 다시 시도하거나 목소리 없이 시작',
    )
    m.ttsStatus = 'initializing'
    expect(s.startBlockReason).toBe('면접관 목소리를 준비하면 열립니다')
  })
})

import { useInterviewerStore } from './interviewer'
import { PERSONAS } from '@/prompts/personas'
import { buildReportInstruction } from '@/prompts/report'

describe('interview store — 면접관 페르소나', () => {
  it('시작할 때 고른 면접관을 고정하고 그 면접관의 페르소나로 프롬프트를 만든다(이후 선택을 바꿔도 그대로)', async () => {
    // 벤(m2)은 서버가 프롬프트를 가지므로 여기서는 브라우저 모델을 쓰는 면접관으로 본다
    useInterviewerStore().select('f2')
    vi.mocked(startSession).mockResolvedValue(fakeSession(['q']))
    const s = await readyStore()
    await s.start()
    expect(s.interviewerId).toBe('f2')
    expect(s.sessionInterviewer.displayName).toBe('쥴리')
    expect(startSession).toHaveBeenCalledWith(expect.stringContaining(PERSONAS.sharp.character!))
    useInterviewerStore().select('m1')
    expect(s.sessionInterviewer.id).toBe('f2')
  })
  it('면접관 id가 아니라 persona로 페르소나를 찾는다: 압박 면접관(여) f2도 sharp', async () => {
    useInterviewerStore().select('f2')
    vi.mocked(startSession).mockResolvedValue(fakeSession(['q']))
    const s = await readyStore()
    await s.start()
    expect(s.interviewerId).toBe('f2')
    expect(startSession).toHaveBeenCalledWith(expect.stringContaining(PERSONAS.sharp.character!))
  })
  it('기본 면접관(남) m1은 standard — 성격 문장이 없다', async () => {
    useInterviewerStore().select('m1')
    vi.mocked(startSession).mockResolvedValue(fakeSession(['q']))
    const s = await readyStore()
    await s.start()
    const prompt = vi.mocked(startSession).mock.calls.at(-1)![0]
    expect(prompt).not.toContain(PERSONAS.gentle.character!)
    expect(prompt).not.toContain(PERSONAS.sharp.character!)
  })
  it('선택이 없으면 기본 면접관(m1·데이빗, standard) — 온화·압박 성격 문장이 없다', async () => {
    vi.mocked(startSession).mockResolvedValue(fakeSession(['q']))
    const s = await readyStore()
    await s.start()
    expect(s.interviewerId).toBe('m1')
    const prompt = vi.mocked(startSession).mock.calls.at(-1)![0]
    expect(prompt).not.toContain(PERSONAS.gentle.character!)
    expect(prompt).not.toContain(PERSONAS.sharp.character!)
  })
  it('리포트는 면접관 페르소나의 말투 지시문으로 요청한다', async () => {
    useInterviewerStore().select('f2')
    const json = JSON.stringify([{ question: 'Q', answerSummary: 'A', feedback: 'F' }])
    const sess = fakeSession(['q', json])
    vi.mocked(startSession).mockResolvedValue(sess)
    const s = await readyStore()
    await s.start()
    await s.finish()
    expect(sess.sent).toContain(buildReportInstruction(PERSONAS.sharp))
    expect(sess.sent).not.toContain(REPORT_INSTRUCTION)
  })
  it('기본 면접관(standard)의 리포트 지시문은 기존 지시문 그대로', async () => {
    useInterviewerStore().select('m1')
    const json = JSON.stringify([{ question: 'Q', answerSummary: 'A', feedback: 'F' }])
    const sess = fakeSession(['q', json])
    vi.mocked(startSession).mockResolvedValue(sess)
    const s = await readyStore()
    await s.start()
    await s.finish()
    expect(sess.sent.at(-1)).toBe(buildReportInstruction(PERSONAS.standard))
  })
  it('매니페스트에 systemPromptOverride가 있으면 리포트도 말투 없이 기본 지시문 그대로(spec 5.1·7절)', async () => {
    // 리포트 지시문은 브라우저 모델 쪽 이야기다 — 벤은 서버가 리포트를 쓴다
    useInterviewerStore().select('f2')
    const json = JSON.stringify([{ question: 'Q', answerSummary: 'A', feedback: 'F' }])
    const sess = fakeSession(['q', json])
    vi.mocked(startSession).mockResolvedValue(sess)
    const s = await readyStore()
    useModelStore().manifest!.systemPromptOverride = '파인튜닝 모델 전용 프롬프트'
    await s.start()
    await s.finish()
    expect(sess.sent.at(-1)).toBe(REPORT_INSTRUCTION)
  })
  it('시작하면 미리 듣기를 멈추고, reset은 면접관 스냅샷을 비운다', async () => {
    const iv = useInterviewerStore()
    iv.$patch({ playingId: 'm1' })
    vi.mocked(startSession).mockResolvedValue(fakeSession(['q']))
    const s = await readyStore()
    await s.start()
    expect(iv.playingId).toBeNull()
    await s.reset()
    expect(s.interviewerId).toBeNull()
  })
})

describe('interview store — 트랙별 입력', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  const ready = () => {
    const m = useModelStore()
    m.status = 'ready'
    m.ttsStatus = 'ready'
  }

  it('트랙은 고른 면접관에서 끌어낸다 — 따로 들고 있지 않는다', () => {
    const s = useInterviewStore()
    // 선택이 없으면 기본 면접관(데이빗)으로 떨어진다 — 칩·프롬프트와 같다
    expect(s.track).toBe('company')
    useInterviewerStore().select('f3')
    expect(s.track).toBe('admission')
    useInterviewerStore().select('m1')
    expect(s.track).toBe('company')
  })

  it('벤은 트랙을 고르기 전에는 null이다', () => {
    const s = useInterviewStore()
    useInterviewerStore().select('m2')
    expect(s.track).toBeNull()
    s.setTrack('admission')
    expect(s.track).toBe('admission')
  })

  it('대입은 다섯 칸이 다 차야 시작할 수 있다', () => {
    const s = useInterviewStore()
    ready()
    useInterviewerStore().select('f3')
    s.setResume('자소서.pdf', 'x'.repeat(RESUME_MIN))
    expect(s.canStart).toBe(false)
    s.setAdmission({ name: '홍길동', age: 19, university: '한국대', department: '컴퓨터공학과' })
    expect(s.canStart).toBe(true)
  })

  it('대입은 칸을 다 채우면 실제로 면접이 열린다 — 버튼만 켜지고 안 열리면 안 된다', async () => {
    const sess = fakeSession(['자기소개를 해주세요.'])
    vi.mocked(startSession).mockResolvedValue(sess)
    const s = useInterviewStore()
    ready()
    useInterviewerStore().select('f3')
    s.setResume('자소서.pdf', 'x'.repeat(RESUME_MIN))
    s.setAdmission({ name: '홍길동', age: 19, university: '한국대', department: '컴퓨터공학과' })
    expect(s.canStart).toBe(true)
    await s.start()
    expect(s.phase).toBe('interview')
  })

  it('대입 프롬프트는 학교·학과·이름을 담고 자기소개서라고 부른다', async () => {
    vi.mocked(startSession).mockResolvedValue(fakeSession(['자기소개를 해주세요.']))
    const s = useInterviewStore()
    ready()
    useInterviewerStore().select('f3')
    s.setResume('자소서.pdf', 'x'.repeat(RESUME_MIN))
    s.setAdmission({ name: '홍길동', age: 19, university: '한국대', department: '컴퓨터공학과' })
    await s.start()
    const prompt = vi.mocked(startSession).mock.calls.at(-1)![0]
    expect(prompt).toContain('한국대 컴퓨터공학과')
    expect(prompt).toContain('홍길동')
    expect(prompt).toContain('자기소개서')
    expect(prompt).not.toContain('분야 기업의 채용 면접관') // 회사용 문구가 새면 안 된다
  })

  it('면접관을 바꿔 트랙이 바뀌면 앞 트랙의 입력은 쓰지 않는다', () => {
    const s = useInterviewStore()
    ready()
    useInterviewerStore().select('m1')
    s.setResume('이력서.pdf', 'x'.repeat(RESUME_MIN))
    s.setField('it')
    s.setJob('백엔드 개발자')
    expect(s.canStart).toBe(true)
    // 대입으로 바꾸면 회사 입력만으로는 못 간다
    useInterviewerStore().select('f3')
    expect(s.canStart).toBe(false)
  })

  it('벤으로 트랙을 고르면 그 트랙의 조건을 본다', () => {
    const s = useInterviewStore()
    ready()
    useInterviewerStore().select('m2')
    s.setResume('이력서.pdf', 'x'.repeat(RESUME_MIN))
    s.setField('it')
    s.setJob('백엔드 개발자')
    expect(s.canStart).toBe(false) // 트랙 미선택
    s.setTrack('company')
    expect(s.canStart).toBe(true)
  })

  it('면접관을 바꾸면 벤에서 고른 트랙은 지워진다', () => {
    const s = useInterviewStore()
    useInterviewerStore().select('m2')
    s.setTrack('admission')
    useInterviewerStore().select('m1')
    s.setTrack(null)
    expect(s.track).toBe('company')
  })
})

describe('면접이 끝나면 보관함에 남긴다', () => {
  const REPORT = JSON.stringify([{ question: 'Q', answerSummary: 'A', feedback: 'F' }])
  const withReport = () => fakeSession(['q', '```json\n' + REPORT + '\n```'])

  beforeEach(() => {
    setAccountApi(makeMockAccount({ delayMs: 0 }))
  })

  async function signedIn() {
    const a = useAccountStore()
    await a.signUp('a@b.com', 'pw123456', '이우진')
    return a
  }

  it('로그인 상태로 면접을 마치면 보관함에 남는다', async () => {
    const a = await signedIn()
    vi.mocked(startSession).mockResolvedValue(withReport())
    const s = await readyStore()
    await s.start()
    await s.finish()
    expect(a.archive).toHaveLength(1)
    expect(s.archiveSaved).toBe(true)
    expect(a.archive[0]).toMatchObject({ interviewerId: 'm1', premium: false, track: 'company' })
  })

  it('대화와 리포트를 함께 남긴다 — 상세로 다시 볼 수 있어야 한다', async () => {
    const a = await signedIn()
    vi.mocked(startSession).mockResolvedValue(withReport())
    const s = await readyStore()
    await s.start()
    await s.finish()
    const full = await a.getArchive(a.archive[0].id)
    expect(full?.report).toHaveLength(1)
    expect(full?.messages.length).toBeGreaterThan(0)
    expect(full?.field).toBe('it')
    expect(full?.job).toBe('백엔드')
  })

  it('비로그인은 저장하지 않는다 — 조용히 실패하지도 않는다', async () => {
    const a = useAccountStore()
    vi.mocked(startSession).mockResolvedValue(withReport())
    const s = await readyStore()
    await s.start()
    await s.finish()
    expect(a.archive).toEqual([])
    expect(a.error).toBeNull()
    expect(s.reportStatus).toBe('done')
    expect(s.archiveSaved).toBe(false)
  })

  it('리포트가 실패하면 저장하지 않는다 — 반쪽짜리를 남기지 않는다', async () => {
    const a = await signedIn()
    vi.mocked(startSession).mockResolvedValue({
      ...withReport(),
      send: vi.fn().mockRejectedValue(new Error('down')),
    } as unknown as LlmSession)
    const s = await readyStore()
    await s.start()
    await s.finish()
    expect(s.reportStatus).toBe('error')
    expect(a.archive).toEqual([])
    expect(s.archiveSaved).toBe(false)
  })

  it('저장이 실패하면 리포트는 그대로 보이고 저장만 안 된 것으로 둔다', async () => {
    const a = await signedIn()
    vi.mocked(startSession).mockResolvedValue(withReport())
    const s = await readyStore()
    await s.start()
    vi.spyOn(a, 'saveArchive').mockResolvedValue(null)
    await s.finish()
    expect(s.reportStatus).toBe('done')
    expect(s.report).toHaveLength(1)
    expect(s.archiveSaved).toBe(false)
  })

  it('밀려난 기록이 있으면 알려 준다', async () => {
    const a = await signedIn()
    vi.mocked(startSession).mockResolvedValue(withReport())
    const s = await readyStore()
    await s.start()
    vi.spyOn(a, 'saveArchive').mockResolvedValue({
      entry: a.archive[0] ?? ({ id: 'a1' } as never),
      evicted: ['old1'],
    })
    await s.finish()
    expect(s.archiveEvicted).toEqual(['old1'])
  })

  it('벤으로 본 면접은 premium: true로 저장된다', async () => {
    const a = await signedIn()
    useInterviewerStore().select('m2')
    vi.mocked(startSession).mockResolvedValue(withReport())
    const s = await readyStore()
    s.setTrack('company')
    await s.start()
    await s.finish()
    expect(a.archive[0]).toMatchObject({ interviewerId: 'm2', premium: true })
  })

  it('finish가 두 번 불려도 한 번만 저장한다', async () => {
    const a = await signedIn()
    vi.mocked(startSession).mockResolvedValue(withReport())
    const s = await readyStore()
    await s.start()
    await s.finish()
    await s.finish()
    expect(a.archive).toHaveLength(1)
  })

  it('reset은 저장 흔적을 지운다 — 다음 면접에 남으면 안 된다', async () => {
    await signedIn()
    vi.mocked(startSession).mockResolvedValue(withReport())
    const s = await readyStore()
    await s.start()
    await s.finish()
    await s.reset()
    expect(s.archiveSaved).toBe(false)
    expect(s.archiveEvicted).toEqual([])
  })
})

describe('프리미엄 면접 녹음', () => {
  const REPORT = JSON.stringify([{ question: 'Q', answerSummary: 'A', feedback: 'F' }])
  /** 질문 → (답변) → 질문 → 리포트 */
  const replies = () => fakeSession(['q1', 'q2', '```json\n' + REPORT + '\n```'])

  function fakeRecorder(size = 10) {
    const cut = vi.fn(async () => new Blob([new Uint8Array(size)], { type: 'audio/webm' }))
    const stop = vi.fn(async () => null)
    return { cut, stop }
  }

  beforeEach(() => {
    setAccountApi(makeMockAccount({ delayMs: 0 }))
    vi.mocked(startRecording).mockReset()
    // 벤은 서버 면접이다 — 녹음은 엔진과 무관하지만 면접이 열려야 볼 수 있다
    vi.mocked(startInterview).mockResolvedValue({
      interviewId: 'pi_rec',
      session: {
        userId: 'u1',
        email: 'a@b.com',
        tier: 'premium',
        tickets: 9,
        isAdmin: false,
        profile: { name: null, age: null },
        createdAt: '2026-10-13T00:00:00.000Z',
      },
    })
    vi.mocked(turnStream).mockImplementation(async (_id, _a, onDelta) => {
      onDelta('질문입니다.')
      return { ended: false }
    })
    vi.mocked(reportStream).mockImplementation(async (_id, onDelta) => {
      onDelta(fenced(REPORT))
    })
  })

  async function premiumStore() {
    useInterviewerStore().select('m2')
    const s = await readyStore()
    s.setTrack('company')
    return s
  }

  it('프리미엄 면접이 아니면 녹음을 시작하지 않는다', async () => {
    vi.mocked(startSession).mockResolvedValue(replies())
    const s = await readyStore()
    await s.start()
    expect(startRecording).not.toHaveBeenCalled()
    expect(s.recordingCount).toBe(0)
  })

  it('프리미엄 면접이면 녹음을 시작한다', async () => {
    vi.mocked(startRecording).mockResolvedValue(fakeRecorder())
    vi.mocked(startSession).mockResolvedValue(replies())
    const s = await premiumStore()
    await s.start()
    expect(startRecording).toHaveBeenCalledOnce()
  })

  it('권한을 거절해도 면접은 그대로 간다 — 티켓은 이미 썼다', async () => {
    vi.mocked(startRecording).mockResolvedValue(null)
    vi.mocked(startSession).mockResolvedValue(replies())
    const s = await premiumStore()
    await s.start()
    expect(s.stage).toBe('waiting')
    await s.send('답변입니다')
    expect(s.messages.filter((m) => m.role === 'model')).toHaveLength(2)
    expect(s.recordingCount).toBe(0)
  })

  it('답변마다 조각을 남긴다 — 면접관 말은 버린다', async () => {
    const rec = fakeRecorder()
    vi.mocked(startRecording).mockResolvedValue(rec)
    vi.mocked(startSession).mockResolvedValue(replies())
    const s = await premiumStore()
    await s.start()
    await s.send('답변입니다')
    expect(s.recordingCount).toBe(1)
    // 질문 2번 + 답변 1번 = cut 3번. 질문 조각은 버려진다
    expect(rec.cut).toHaveBeenCalledTimes(3)
  })

  it('상한을 넘으면 더 녹음하지 않고 알린다', async () => {
    vi.mocked(startRecording).mockResolvedValue(fakeRecorder(RECORDING_MAX_BYTES + 1))
    vi.mocked(startSession).mockResolvedValue(replies())
    const s = await premiumStore()
    await s.start()
    await s.send('답변입니다')
    expect(s.recordingWarning).toBe(RECORDING_FULL)
    await s.send('두 번째 답변')
    expect(s.recordingCount).toBe(1)
  })

  it('녹음이 있으면 hasRecording: true로 저장된다', async () => {
    const a = useAccountStore()
    await a.signUp('a@b.com', 'pw123456', '이우진')
    vi.mocked(startRecording).mockResolvedValue(fakeRecorder())
    vi.mocked(startSession).mockResolvedValue(replies())
    const s = await premiumStore()
    await s.start()
    await s.send('답변입니다')
    await s.finish()
    expect(a.archive[0]).toMatchObject({ hasRecording: true, premium: true })
  })

  it('녹음이 없으면 hasRecording: false로 저장된다', async () => {
    const a = useAccountStore()
    await a.signUp('a@b.com', 'pw123456', '이우진')
    vi.mocked(startRecording).mockResolvedValue(null)
    vi.mocked(startSession).mockResolvedValue(replies())
    const s = await premiumStore()
    await s.start()
    await s.finish()
    expect(a.archive[0]).toMatchObject({ hasRecording: false })
  })

  it('면접이 끝나면 마이크를 놓는다 — 빨간 점이 계속 켜져 있으면 안 된다', async () => {
    const rec = fakeRecorder()
    vi.mocked(startRecording).mockResolvedValue(rec)
    vi.mocked(startSession).mockResolvedValue(replies())
    const s = await premiumStore()
    await s.start()
    await s.finish()
    expect(rec.stop).toHaveBeenCalled()
  })

  it('reset은 녹음 흔적을 지운다', async () => {
    vi.mocked(startRecording).mockResolvedValue(fakeRecorder())
    vi.mocked(startSession).mockResolvedValue(replies())
    const s = await premiumStore()
    await s.start()
    await s.send('답변입니다')
    await s.reset()
    expect(s.recordingCount).toBe(0)
    expect(s.recordingWarning).toBeNull()
  })
})

describe('벤 면접 — 서버가 대화를 가진다', () => {
  const REPORT = JSON.stringify([{ question: 'Q', answerSummary: 'A', feedback: 'F' }])

  beforeEach(() => {
    setAccountApi(makeMockAccount({ delayMs: 0 }))
    vi.mocked(startInterview).mockReset()
    vi.mocked(turnStream).mockReset()
    vi.mocked(reportStream).mockReset()
    vi.mocked(startInterview).mockResolvedValue({
      interviewId: 'pi_1',
      session: {
        userId: 'u1',
        email: 'a@b.com',
        tier: 'premium',
        tickets: 9,
        isAdmin: false,
        profile: { name: null, age: null },
        createdAt: '2026-10-13T00:00:00.000Z',
      },
    })
    vi.mocked(turnStream).mockImplementation(async (_id, _answer, onDelta) => {
      onDelta('자기소개를 해 주세요.')
      return { ended: false }
    })
    vi.mocked(reportStream).mockImplementation(async (_id, onDelta) => {
      onDelta('```json\n' + REPORT + '\n```')
    })
  })

  async function benStore() {
    useInterviewerStore().select('m2')
    const s = await readyStore()
    s.setTrack('company')
    return s
  }

  it('벤이면 서버 면접을 시작하고 브라우저 모델은 부르지 않는다', async () => {
    const s = await benStore()
    await s.start()
    expect(startInterview).toHaveBeenCalledOnce()
    expect(startSession).not.toHaveBeenCalled()
    expect(s.phase).toBe('interview')
  })

  it('트랙에 맞는 묶음을 보낸다', async () => {
    const s = await benStore()
    await s.start()
    expect(vi.mocked(startInterview).mock.calls[0][0]).toMatchObject({
      track: 'company',
      company: { field: 'it', job: '백엔드' },
    })
  })

  it('벤의 대입 면접도 열린다 — 대입은 분야 칸을 쓰지 않는다', async () => {
    const m = useModelStore()
    m.status = 'ready'
    m.ttsStatus = 'ready'
    useInterviewerStore().select('m2')
    const s = useInterviewStore()
    s.setTrack('admission')
    s.setResume('자소서.pdf', 'x'.repeat(RESUME_MIN))
    s.setAdmission({ name: '홍길동', age: 19, university: '한국대', department: '컴퓨터공학과' })
    expect(s.profile.field).toBeNull() // 대입은 분야를 고르는 칸이 없다
    expect(s.canStart).toBe(true)
    await s.start()
    expect(s.phase).toBe('interview')
    expect(vi.mocked(startInterview).mock.calls[0][0]).toMatchObject({
      track: 'admission',
      admission: { name: '홍길동', age: 19, university: '한국대', department: '컴퓨터공학과' },
    })
  })

  it('첫 질문은 답변 없이 받아 와 대화에 남는다', async () => {
    const s = await benStore()
    await s.start()
    expect(vi.mocked(turnStream).mock.calls[0][1]).toBeUndefined()
    expect(s.messages.at(-1)).toMatchObject({ role: 'model', text: '자기소개를 해 주세요.' })
  })

  it('답변은 서버로 간다', async () => {
    const s = await benStore()
    await s.start()
    await s.send('안녕하세요')
    expect(vi.mocked(turnStream).mock.calls[1][1]).toBe('안녕하세요')
    expect(s.messages.filter((m) => m.role === 'user')).toHaveLength(1)
  })

  it('서버가 끝났다고 하면 끝난다 — 종료 문장을 프론트가 다시 찾지 않는다', async () => {
    const s = await benStore()
    await s.start()
    vi.mocked(turnStream).mockImplementation(async (_id, _a, onDelta) => {
      onDelta('수고하셨습니다.')
      return { ended: true }
    })
    await s.send('네')
    expect(s.ended).toBe(true)
  })

  it('티켓이 없으면 면접이 시작되지 않고 이유를 남긴다', async () => {
    vi.mocked(startInterview).mockRejectedValue(new BenError('no_tickets'))
    const s = await benStore()
    await s.start()
    expect(s.phase).not.toBe('interview')
    expect(s.genError).toContain('티켓')
  })

  it('턴이 실패해도 면접은 살아 있다 — 같은 답변을 다시 보낼 수 있다', async () => {
    const s = await benStore()
    await s.start()
    vi.mocked(turnStream).mockRejectedValueOnce(new BenError('claude_error'))
    await s.send('안녕하세요')
    expect(s.genError).toMatch(/\S/)
    expect(s.ended).toBe(false)
    await s.retryLast()
    expect(s.genError).toBeNull()
  })

  it('리포트는 서버가 쓴다 — 원문을 파서에 넣는다', async () => {
    const s = await benStore()
    await s.start()
    await s.finish()
    expect(reportStream).toHaveBeenCalledOnce()
    expect(s.reportStatus).toBe('done')
    expect(s.report).toEqual([{ question: 'Q', answerSummary: 'A', feedback: 'F' }])
  })

  it('보관함에 어느 벤 면접인지 함께 남긴다 — 없으면 서버가 거절한다', async () => {
    const a = useAccountStore()
    await a.signUp('a@b.com', 'pw123456', '이우진')
    const s = await benStore()
    await s.start()
    await s.finish()
    expect(s.archiveDraft()).toMatchObject({ premium: true, premiumInterviewId: 'pi_1' })
  })

  it('무료 면접관은 서버를 부르지 않는다', async () => {
    vi.mocked(startSession).mockResolvedValue(fakeSession(['q']))
    const s = await readyStore()
    await s.start()
    expect(startInterview).not.toHaveBeenCalled()
  })

  it('reset은 서버 면접 id를 지운다 — 다음 면접이 남의 id로 가면 안 된다', async () => {
    const s = await benStore()
    await s.start()
    await s.reset()
    await s.finish()
    // 지운 뒤에는 부를 면접이 없다 — 남은 id로 남의 리포트를 받아 오면 안 된다
    expect(reportStream).not.toHaveBeenCalled()
  })
})

describe('녹음은 보관함에 올라가야 남는다', () => {
  const REPORT = JSON.stringify([{ question: 'Q', answerSummary: 'A', feedback: 'F' }])

  function fakeRecorder() {
    return {
      cut: vi.fn(async () => new Blob([new Uint8Array(32)], { type: 'audio/webm' })),
      stop: vi.fn(async () => null),
    }
  }

  beforeEach(() => {
    setAccountApi(makeMockAccount({ delayMs: 0 }))
    vi.mocked(startRecording).mockReset().mockResolvedValue(fakeRecorder())
    vi.mocked(startInterview)
      .mockReset()
      .mockResolvedValue({
        interviewId: 'pi_rec',
        session: {
          userId: 'u1',
          email: 'a@b.com',
          tier: 'premium',
          tickets: 9,
          isAdmin: false,
          profile: { name: null, age: null },
          createdAt: '2026-10-13T00:00:00.000Z',
        },
      })
    vi.mocked(turnStream)
      .mockReset()
      .mockImplementation(async (_id, _a, onDelta) => {
        onDelta('질문입니다.')
        return { ended: false }
      })
    vi.mocked(reportStream)
      .mockReset()
      .mockImplementation(async (_id, onDelta) => {
        onDelta(fenced(REPORT))
      })
  })

  async function benWithClip() {
    const a = useAccountStore()
    await a.signUp('a@b.com', 'pw123456', '이우진')
    // 서버는 **그 계정의** 세션을 돌려준다 — 지어낸 세션을 넣으면 뒤따르는 저장이 남의 것이 된다
    vi.mocked(startInterview).mockResolvedValue({ interviewId: 'pi_rec', session: a.session! })
    useInterviewerStore().select('m2')
    const s = await readyStore()
    s.setTrack('company')
    await s.start()
    await s.send('답변입니다')
    return { s, a }
  }

  it('기록을 만든 뒤에 올린다 — 기록 id가 있어야 서버가 받는다', async () => {
    const { s, a } = await benWithClip()
    const spy = vi.spyOn(a, 'uploadRecording')
    await s.finish()
    expect(spy).toHaveBeenCalledOnce()
    const [archiveId, turn, clip] = spy.mock.calls[0]
    expect(archiveId).toBe(a.archive[0].id)
    expect(turn).toBe(0)
    expect(clip).toBeInstanceOf(Blob)
  })

  it('올린 녹음이 상세에 보인다', async () => {
    const { s, a } = await benWithClip()
    await s.finish()
    const full = await a.getArchive(a.archive[0].id)
    expect(full?.recordings).toHaveLength(1)
    expect(full?.hasRecording).toBe(true)
  })

  it('기록을 못 남겼으면 올리지 않는다 — 붙일 기록이 없다', async () => {
    const { s, a } = await benWithClip()
    vi.spyOn(a, 'saveArchive').mockResolvedValue(null)
    const up = vi.spyOn(a, 'uploadRecording')
    await s.finish()
    expect(up).not.toHaveBeenCalled()
    expect(s.reportStatus).toBe('done')
  })

  it('업로드가 실패해도 리포트는 그대로 보인다 — 녹음은 덤이다', async () => {
    const { s, a } = await benWithClip()
    vi.spyOn(a, 'uploadRecording').mockRejectedValue(new Error('too large'))
    await s.finish()
    expect(s.reportStatus).toBe('done')
    expect(s.archiveSaved).toBe(true)
    expect(s.recordingWarning).toMatch(/\S/)
  })

  it('reset은 들고 있던 녹음을 버린다', async () => {
    const { s } = await benWithClip()
    expect(s.recordingCount).toBe(1)
    await s.reset()
    expect(s.recordingCount).toBe(0)
  })
})
