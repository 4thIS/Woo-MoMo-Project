import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/services/modelCache', () => ({
  cacheKey: (id: string, url: string) => `/models-cache/${id}${url}`,
  hasModel: vi.fn(async () => false),
  downloadModel: vi.fn(
    async (_id: string, _url: string, size: number, onProgress: (r: number) => void) => {
      onProgress(size)
    },
  ),
}))
import { downloadModel, hasModel } from '@/services/modelCache'
import { __setWorkerFactory, disposeTts, initTts, setTtsVoice, synthesize } from './tts'
import type { MainToWorker, WorkerToMain } from '@/workers/ttsProtocol'

/** 가짜 워커: 보낸 메시지를 기록하고, 테스트가 응답을 주입한다 */
class FakeWorker {
  sent: MainToWorker[] = []
  onmessage: ((e: MessageEvent<WorkerToMain>) => void) | null = null
  onerror: ((e: ErrorEvent) => void) | null = null
  terminated = false
  postMessage(m: MainToWorker) {
    this.sent.push(m)
  }
  terminate() {
    this.terminated = true
  }
  reply(m: WorkerToMain) {
    this.onmessage?.({ data: m } as MessageEvent<WorkerToMain>)
  }
}

const cfg = {
  id: 'supertonic-3',
  baseUrl: '/models/tts/supertonic-3/',
  files: [
    { path: 'onnx/text_encoder.onnx', size: 30 },
    { path: 'onnx/tts.json', size: 10 },
    { path: 'voice_styles/M2.json', size: 20 },
  ],
  voice: 'M2',
  lang: 'ko',
}
let w: FakeWorker
beforeEach(() => {
  w = new FakeWorker()
  // 매 spawn()마다 새 인스턴스를 만든다 — 동시 initTts 테스트에서 두 워커를 구분해야 한다
  __setWorkerFactory(() => {
    w = new FakeWorker()
    return w as unknown as Worker
  })
  vi.mocked(hasModel).mockResolvedValue(false)
})
afterEach(() => {
  disposeTts()
  __setWorkerFactory(null)
  vi.clearAllMocks()
})

/**
 * initTts를 시작하고 워커의 load 메시지가 갈 때까지 기다린다.
 * initTts의 promise(p)를 { p }로 감싸 반환한다 — async 함수가 promise를 그대로 반환하면
 * 호출부의 await가 p 자체의 해결까지 흡수해버려(promise flattening), startInit이 끝난
 * 뒤에도 onmessage가 아직 안 걸린 채로 반환될 수 있다. 래핑하면 "load 전송 확인 후 반환"이
 * 보장되어, 호출부가 안전하게 그다음 줄에서 동기적으로 w.reply()를 호출할 수 있다.
 */
async function startInit(onProgress?: (r: number, t: number) => void) {
  const before = w // 세대 가드 테스트에서 이전 워커의 남은 'load'와 헷갈리지 않도록 참조가 바뀌었는지도 함께 확인한다
  const p = initTts(cfg, onProgress)
  await vi.waitFor(() => expect(w !== before && w.sent.some((m) => m.type === 'load')).toBe(true))
  return { p }
}

describe('initTts', () => {
  it('파일을 순서대로 내려받고(캐시 히트는 건너뜀) 진행률을 합산한 뒤 워커에 load를 보낸다', async () => {
    vi.mocked(hasModel).mockImplementation(async (_id, url) => url.endsWith('tts.json'))
    const prog: [number, number][] = []
    const { p } = await startInit((r, t) => prog.push([r, t]))
    w.reply({ type: 'loaded' })
    await p
    const calls = vi.mocked(downloadModel).mock.calls.map((c) => c[1])
    expect(calls).toEqual([
      '/models/tts/supertonic-3/onnx/text_encoder.onnx',
      '/models/tts/supertonic-3/voice_styles/M2.json',
    ])
    // 다운로드 중 콜백(done+r)과 파일 완료 후 콜백(done)이 파일마다 누적되어 온다.
    // f1(30, 다운로드): [30,60] → 완료 후 [30,60] / f2(10, 캐시 히트: 다운로드 콜백 없음) → 완료 후 [40,60]
    // f3(20, 다운로드): [60,60] → 완료 후 [60,60]
    expect(prog).toEqual([
      [30, 60],
      [30, 60],
      [40, 60],
      [60, 60],
      [60, 60],
    ])
    const load = w.sent.find((m) => m.type === 'load') as Extract<MainToWorker, { type: 'load' }>
    expect(load.files.map((f) => f.cacheKey)).toEqual([
      '/models-cache/supertonic-3/models/tts/supertonic-3/onnx/text_encoder.onnx',
      '/models-cache/supertonic-3/models/tts/supertonic-3/onnx/tts.json',
      '/models-cache/supertonic-3/models/tts/supertonic-3/voice_styles/M2.json',
    ])
    expect(load.wasmPaths).toBe('/ort-wasm/')
    expect(load.voice).toBe('M2')
  })
  it('다운로드 무결성 실패는 그대로 전파되고 워커는 만들지 않는다', async () => {
    vi.mocked(downloadModel).mockRejectedValueOnce(new Error('incomplete: 10/30'))
    await expect(initTts(cfg)).rejects.toThrow(/incomplete/)
    expect(w.sent).toHaveLength(0)
  })
  it('워커가 error로 답하면 initTts가 거부되고 워커를 정리한다(다음 init까지 죽은 워커를 남기지 않음)', async () => {
    const { p } = await startInit()
    w.reply({ type: 'error', message: 'WebGPU 없음' })
    await expect(p).rejects.toThrow(/WebGPU 없음/)
    expect(w.terminated).toBe(true)
    await expect(synthesize('그다음')).rejects.toThrow(/not loaded|초기화/)
  })
  it('동시에 initTts를 두 번 호출하면 나중 것만 유효하다 — 이전 워커는 terminate되고 응답은 무시된다', async () => {
    const { p: pA } = await startInit()
    pA.catch(() => {}) // B가 A를 거부시키는 시점과 아래 rejects 단언 사이의 창에서 unhandledRejection 경고를 막는다
    const workerA = w
    const { p: pB } = await startInit() // A가 아직 loaded 응답을 받기 전에 B를 시작
    const workerB = w
    expect(workerA).not.toBe(workerB)
    expect(workerA.terminated).toBe(true) // B의 disposeTts()가 A를 정리했다

    workerB.reply({ type: 'loaded' })
    await pB

    // 지연되어 도착한 A의 응답은 세대 가드가 무시한다 — 전역 상태를 건드리지 않는다
    expect(() => workerA.reply({ type: 'loaded' })).not.toThrow()
    await expect(pA).rejects.toThrow(/superseded/) // B가 시작되며 A는 즉시 거부된다 — 무한 대기하지 않는다

    const s = synthesize('안녕')
    const req = workerB.sent.find((m) => m.type === 'synthesize') as Extract<
      MainToWorker,
      { type: 'synthesize' }
    >
    expect(req).toBeTruthy()
    expect(workerA.sent.some((m) => m.type === 'synthesize')).toBe(false)
    workerB.reply({ type: 'audio', id: req.id, samples: new Float32Array(10), sampleRate: 44100 })
    await s
  })
  it('다운로드 중 disposeTts()를 호출하면 init은 disposed로 거부되고 load는 끝내 보내지지 않는다', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => {
      release = r
    })
    vi.mocked(downloadModel).mockImplementationOnce(
      async (_id: string, _url: string, size: number, onProgress: (r: number) => void) => {
        await gate
        onProgress(size)
      },
    )
    const p = initTts(cfg)
    await vi.waitFor(() => expect(vi.mocked(downloadModel)).toHaveBeenCalled())
    disposeTts()
    await expect(p).rejects.toThrow(/disposed/)
    release() // 남은 다운로드가 마저 끝나도 이미 거부된 뒤라 워커는 스폰되지 않는다
    await vi.waitFor(() => expect(vi.mocked(downloadModel)).toHaveBeenCalledTimes(3))
    expect(w.sent.some((m) => m.type === 'load')).toBe(false)
  })
})

describe('synthesize', () => {
  async function ready() {
    const { p } = await startInit()
    w.reply({ type: 'loaded' })
    await p
  }
  it('로드 전엔 거부', async () => {
    await expect(synthesize('안녕')).rejects.toThrow(/not loaded|초기화/)
  })
  it('빈 문자열/공백만 있는 텍스트는 워커에 아무것도 보내지 않고 즉시 거부한다', async () => {
    await ready()
    const before = w.sent.length
    await expect(synthesize('   ')).rejects.toThrow()
    expect(w.sent).toHaveLength(before)
  })
  it('요청 id로 응답을 매칭해 AudioClip을 만든다(durationMs = samples/sampleRate)', async () => {
    await ready()
    const p1 = synthesize('하나')
    const p2 = synthesize('둘')
    const [m1, m2] = w.sent.filter((m) => m.type === 'synthesize') as Extract<
      MainToWorker,
      { type: 'synthesize' }
    >[]
    expect(m1.id).not.toBe(m2.id)
    w.reply({ type: 'audio', id: m2.id, samples: new Float32Array(44100), sampleRate: 44100 })
    w.reply({ type: 'audio', id: m1.id, samples: new Float32Array(22050), sampleRate: 44100 })
    const [c1, c2] = await Promise.all([p1, p2])
    expect(c1.durationMs).toBe(500)
    expect(c2.durationMs).toBe(1000)
    expect(c2.samples).toHaveLength(44100)
  })
  it('abort하면 워커에 cancel을 보내고 AbortError로 거부하며, 늦게 온 audio는 무시한다', async () => {
    await ready()
    const ac = new AbortController()
    const p = synthesize('취소될 문장', ac.signal)
    const req = w.sent.find((m) => m.type === 'synthesize') as Extract<
      MainToWorker,
      { type: 'synthesize' }
    >
    ac.abort()
    await expect(p).rejects.toMatchObject({ name: 'AbortError' })
    expect(w.sent).toContainEqual({ type: 'cancel', id: req.id })
    expect(() =>
      w.reply({ type: 'audio', id: req.id, samples: new Float32Array(1), sampleRate: 44100 }),
    ).not.toThrow()
  })
  it('이미 abort된 signal로 호출하면 워커에 아무것도 보내지 않고 바로 AbortError로 거부한다', async () => {
    await ready()
    const ac = new AbortController()
    ac.abort()
    const before = w.sent.length
    await expect(synthesize('시작 전에 취소', ac.signal)).rejects.toMatchObject({
      name: 'AbortError',
    })
    expect(w.sent).toHaveLength(before) // synthesize도 cancel도 보내지 않음(애초에 id를 보낸 적이 없다)
  })
  it('워커 onerror 발생 시 워커를 terminate하고 loaded/worker를 정리해 이후 synthesize가 거부된다', async () => {
    await ready()
    w.onerror?.({ message: '워커 크래시' } as ErrorEvent)
    expect(w.terminated).toBe(true)
    await expect(synthesize('그다음')).rejects.toThrow(/not loaded|초기화/)
  })
  it('워커 error(id 있음)는 해당 요청만 거부한다', async () => {
    await ready()
    const p = synthesize('실패')
    const req = w.sent.find((m) => m.type === 'synthesize') as Extract<
      MainToWorker,
      { type: 'synthesize' }
    >
    w.reply({ type: 'error', id: req.id, message: 'run failed' })
    await expect(p).rejects.toThrow(/run failed/)
  })
  it('disposeTts는 워커를 terminate하고 대기 중 요청을 거부한다', async () => {
    await ready()
    const p = synthesize('중단')
    disposeTts()
    expect(w.terminated).toBe(true)
    await expect(p).rejects.toThrow()
  })
})

const voiceFile = {
  path: 'voice_styles/F1.json',
  size: 11,
  url: '/models/tts/supertonic-3/voice_styles/F1.json',
  cacheKey: '/models-cache/supertonic-3/models/tts/supertonic-3/voice_styles/F1.json',
}
async function loadedWorker() {
  const { p } = await startInit()
  w.reply({ type: 'loaded' })
  await p
  return w
}

describe('setTtsVoice', () => {
  it('로드 전이면 거부한다', async () => {
    await expect(setTtsVoice('F1', voiceFile)).rejects.toThrow('not loaded')
  })
  it('워커에 setVoice를 보내고 voiceSet이면 끝난다', async () => {
    const worker = await loadedWorker()
    const p = setTtsVoice('F1', voiceFile)
    expect(worker.sent.at(-1)).toEqual({ type: 'setVoice', voice: 'F1', file: voiceFile })
    worker.reply({ type: 'voiceSet', voice: 'F1' })
    await expect(p).resolves.toBeUndefined()
  })
  it('voiceError면 거부하지만 워커는 살아 있고 합성은 계속된다', async () => {
    const worker = await loadedWorker()
    const p = setTtsVoice('F1', voiceFile)
    worker.reply({ type: 'voiceError', voice: 'F1', message: 'bad style' })
    await expect(p).rejects.toThrow('bad style')
    expect(worker.terminated).toBe(false)
    const s = synthesize('안녕하세요')
    const id = (worker.sent.at(-1) as { id: number }).id
    worker.reply({ type: 'audio', id, samples: new Float32Array(10), sampleRate: 10 })
    await expect(s).resolves.toMatchObject({ durationMs: 1000 })
  })
  it('새 setTtsVoice가 오면 이전 요청은 superseded로 거부된다', async () => {
    const worker = await loadedWorker()
    const first = setTtsVoice('F1', voiceFile)
    const second = setTtsVoice('M4', { ...voiceFile, path: 'voice_styles/M4.json' })
    await expect(first).rejects.toThrow('superseded')
    worker.reply({ type: 'voiceSet', voice: 'M4' })
    await expect(second).resolves.toBeUndefined()
  })
  it('disposeTts는 대기 중인 setTtsVoice를 거부한다', async () => {
    await loadedWorker()
    const p = setTtsVoice('F1', voiceFile)
    disposeTts()
    await expect(p).rejects.toThrow('disposed')
  })
})
