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
import { __setWorkerFactory, disposeTts, initTts, synthesize } from './tts'
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
  __setWorkerFactory(() => w as unknown as Worker)
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
  const p = initTts(cfg, onProgress)
  await vi.waitFor(() => expect(w.sent.some((m) => m.type === 'load')).toBe(true))
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
    expect(prog.at(-1)).toEqual([60, 60]) // 캐시 히트 파일도 total·received에 포함
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
  it('워커가 error로 답하면 initTts가 거부된다', async () => {
    const { p } = await startInit()
    w.reply({ type: 'error', message: 'WebGPU 없음' })
    await expect(p).rejects.toThrow(/WebGPU 없음/)
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
