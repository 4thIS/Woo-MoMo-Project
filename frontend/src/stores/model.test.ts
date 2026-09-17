import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('@/services/api', () => ({ getManifest: vi.fn() }))
vi.mock('@/services/modelCache', () => ({
  hasModel: vi.fn(),
  downloadModel: vi.fn(),
  clearModels: vi.fn(),
  getModelBlob: vi.fn(),
  pruneModels: vi.fn(async () => 0),
  cacheKey: (id: string, url: string) => `/models-cache/${id}${url}`,
}))
vi.mock('@/services/llm', () => ({ initEngine: vi.fn(), disposeEngine: vi.fn() }))
vi.mock('@/services/tts', () => ({ initTts: vi.fn(), synthesize: vi.fn(), disposeTts: vi.fn() }))

import { getManifest } from '@/services/api'
import { downloadModel, getModelBlob, hasModel, pruneModels } from '@/services/modelCache'
import { initEngine } from '@/services/llm'
import { disposeTts, initTts, synthesize } from '@/services/tts'
import { TTS_WARMUP_TEXT, useModelStore } from './model'

const manifest = {
  id: 'e4b',
  url: '/models/e4b.litertlm',
  size: 100,
  template: { turnStart: '<|turn>', turnEnd: '<turn|>', roles: {} },
  systemPromptOverride: null,
  fallback: { id: 'e2b', url: '/models/e2b.litertlm', size: 50 },
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.mocked(getManifest).mockResolvedValue(manifest)
  vi.mocked(hasModel).mockResolvedValue(false)
  vi.mocked(downloadModel).mockImplementation(async (_id, _url, _size, onProgress) => {
    onProgress(50)
    onProgress(100)
  })
  vi.mocked(getModelBlob).mockResolvedValue(new Blob(['x']))
  vi.mocked(initEngine).mockResolvedValue(undefined)
  vi.mocked(initTts).mockResolvedValue(undefined)
  vi.mocked(synthesize).mockResolvedValue({
    samples: new Float32Array(1),
    sampleRate: 44100,
    durationMs: 0,
  })
})

describe('model store', () => {
  it('매니페스트를 읽어 total을 세팅한다', async () => {
    const s = useModelStore()
    await s.loadManifest()
    expect(s.manifest?.id).toBe('e4b')
    expect(s.total).toBe(100)
    expect(s.status).toBe('idle')
  })

  it('download는 진행률을 반영하고 downloaded로 끝난다', async () => {
    const s = useModelStore()
    await s.loadManifest()
    const statuses: string[] = []
    s.$subscribe((_m, state) => statuses.push(state.status), { detached: true })
    const p = s.download()
    await p
    expect(s.received).toBe(100)
    expect(s.progress).toBe(100)
    expect(s.status).toBe('ready')
    expect(statuses).toContain('downloading')
  })

  it('캐시에 있으면 다운로드를 건너뛰고 downloading 상태를 거치지 않는다', async () => {
    vi.mocked(hasModel).mockResolvedValue(true)
    const s = useModelStore()
    await s.loadManifest()
    const statuses: string[] = []
    s.$subscribe((_m, state) => statuses.push(state.status), { detached: true })
    await s.download()
    expect(downloadModel).not.toHaveBeenCalled()
    expect(s.status).toBe('ready')
    expect(statuses).not.toContain('downloading')
  })

  it('실패하면 error와 메시지', async () => {
    vi.mocked(downloadModel).mockRejectedValue(new Error('incomplete: 3/100'))
    const s = useModelStore()
    await s.loadManifest()
    await s.download()
    expect(s.status).toBe('error')
    expect(s.error).toContain('incomplete')
  })

  it('useFallback은 폴백 모델로 바꿔 다시 받는다', async () => {
    const s = useModelStore()
    await s.loadManifest()
    await s.useFallback()
    expect(s.active?.id).toBe('e2b')
    expect(downloadModel).toHaveBeenCalledWith(
      'e2b',
      '/models/e2b.litertlm',
      50,
      expect.any(Function),
      undefined,
    )
  })

  it('매니페스트 실패는 manifestError에 남는다', async () => {
    vi.mocked(getManifest).mockRejectedValue(new Error('/api/manifest 500'))
    const s = useModelStore()
    await s.loadManifest()
    expect(s.manifestError).toContain('500')
  })

  it('active 없이 download를 호출하면 error 상태로 남는다', async () => {
    const s = useModelStore()
    await s.download()
    expect(s.status).toBe('error')
    expect(s.error).toContain('manifest')
  })

  it('download 후 init이 이어져 ready가 된다', async () => {
    const s = useModelStore()
    await s.loadManifest()
    await s.download()
    expect(initEngine).toHaveBeenCalledWith(expect.any(Blob), { maxNumTokens: 8192 })
    expect(s.status).toBe('ready')
  })

  it('init 실패는 error + initFailed', async () => {
    vi.mocked(initEngine).mockRejectedValue(new Error('gpu oom'))
    const s = useModelStore()
    await s.loadManifest()
    await s.download()
    expect(s.status).toBe('error')
    expect(s.error).toBe('gpu oom')
    expect(s.initFailed).toBe(true)
  })

  it('캐시에 Blob이 없으면 error', async () => {
    vi.mocked(getModelBlob).mockResolvedValue(null)
    const s = useModelStore()
    await s.loadManifest()
    await s.download()
    expect(s.status).toBe('error')
  })
})

const tts = {
  id: 'supertonic-3',
  baseUrl: '/models/tts/supertonic-3/',
  files: [
    { path: 'a.onnx', size: 60 },
    { path: 'b.onnx', size: 40 },
  ],
  voice: 'M2',
  lang: 'ko',
}

describe('model store — TTS', () => {
  it('manifest.tts가 없으면 initTts 없이 ttsStatus도 ready (텍스트 전용)', async () => {
    const s = useModelStore()
    await s.loadManifest()
    await s.download()
    expect(s.status).toBe('ready')
    expect(s.ttsEnabled).toBe(false)
    expect(s.ttsStatus).toBe('ready')
    expect(s.ready).toBe(true)
    expect(initTts).not.toHaveBeenCalled()
  })

  it('manifest.tts가 있으면 Gemma ready 뒤 다운로드 → 초기화 → 워밍업 → ready', async () => {
    vi.mocked(getManifest).mockResolvedValue({ ...manifest, tts })
    vi.mocked(initTts).mockImplementation(async (_cfg, onProgress) => {
      onProgress?.(60, 100)
      onProgress?.(100, 100)
    })
    const s = useModelStore()
    await s.loadManifest()
    const seen: string[] = []
    // flush: 'sync' — onProgress(60,100)와 onProgress(100,100)이 같은 tick에서 연달아 호출되므로
    // 기본 flush('pre')는 두 변경을 한 번의 콜백으로 묶어 'downloading'을 놓친다.
    s.$subscribe((_m, st) => seen.push(st.ttsStatus), { detached: true, flush: 'sync' })
    await s.download()
    expect(s.status).toBe('ready')
    expect(seen).toContain('downloading')
    expect(seen).toContain('initializing')
    expect(initTts).toHaveBeenCalledWith(tts, expect.any(Function))
    expect(synthesize).toHaveBeenCalledWith(TTS_WARMUP_TEXT, expect.any(AbortSignal))
    expect(s.ttsReceived).toBe(100)
    expect(s.ttsTotal).toBe(100)
    expect(s.ttsProgress).toBe(100)
    expect(s.ttsStatus).toBe('ready')
    expect(s.ready).toBe(true)
  })

  it('TTS 준비 전에는 ready가 false다 (Gemma는 ready여도)', async () => {
    vi.mocked(getManifest).mockResolvedValue({ ...manifest, tts })
    let release!: () => void
    vi.mocked(initTts).mockReturnValue(new Promise<void>((r) => (release = r)))
    const s = useModelStore()
    await s.loadManifest()
    const p = s.download()
    await vi.waitFor(() => expect(s.status).toBe('ready'))
    expect(s.ready).toBe(false)
    release()
    await p
    expect(s.ready).toBe(true)
  })

  it('initTts 실패 → ttsStatus error + 원인. retryTts로 TTS만 다시', async () => {
    vi.mocked(getManifest).mockResolvedValue({ ...manifest, tts })
    vi.mocked(initTts).mockRejectedValueOnce(new Error('size mismatch'))
    const s = useModelStore()
    await s.loadManifest()
    await s.download()
    expect(s.status).toBe('ready')
    expect(s.ttsStatus).toBe('error')
    expect(s.ttsError).toBe('size mismatch')
    expect(s.ready).toBe(false)
    await s.retryTts()
    expect(initTts).toHaveBeenCalledTimes(2)
    expect(initEngine).toHaveBeenCalledTimes(1) // Gemma는 다시 올리지 않는다
    expect(s.ttsStatus).toBe('ready')
  })

  it('워밍업 합성 실패는 무시한다', async () => {
    vi.mocked(getManifest).mockResolvedValue({ ...manifest, tts })
    vi.mocked(synthesize).mockRejectedValueOnce(new Error('warm'))
    const s = useModelStore()
    await s.loadManifest()
    await s.download()
    expect(s.ttsStatus).toBe('ready')
  })

  it('이미 ready인 TTS는 Gemma를 다시 올려도(경량 모델 전환) 다시 초기화하지 않는다', async () => {
    vi.mocked(getManifest).mockResolvedValue({ ...manifest, tts })
    const s = useModelStore()
    await s.loadManifest()
    await s.download()
    await s.useFallback()
    expect(initTts).toHaveBeenCalledTimes(1)
    expect(s.ready).toBe(true)
  })

  it('clearCache는 disposeTts하고 ttsStatus를 idle로', async () => {
    vi.mocked(getManifest).mockResolvedValue({ ...manifest, tts })
    const s = useModelStore()
    await s.loadManifest()
    await s.download()
    await s.clearCache()
    expect(disposeTts).toHaveBeenCalled()
    expect(s.ttsStatus).toBe('idle')
    expect(s.ttsReceived).toBe(0)
  })
})

describe('model store — TTS 재진입', () => {
  it('loadTts가 진행 중이면 retryTts는 겹쳐 부르지 않는다', async () => {
    vi.mocked(getManifest).mockResolvedValue({ ...manifest, tts })
    let release!: () => void
    vi.mocked(initTts).mockReturnValue(new Promise<void>((r) => (release = r)))
    const s = useModelStore()
    await s.loadManifest()
    const p = s.download()
    await vi.waitFor(() => expect(s.status).toBe('ready'))
    await s.retryTts()
    expect(initTts).toHaveBeenCalledTimes(1)
    release()
    await p
    expect(s.ttsStatus).toBe('ready')
  })
})

describe('model store — 다운로드 용량 (#27)', () => {
  it('ttsSize는 manifest.tts 파일 합, downloadSize는 모델 + TTS', async () => {
    vi.mocked(getManifest).mockResolvedValue({ ...manifest, tts })
    const s = useModelStore()
    await s.loadManifest()
    expect(s.ttsSize).toBe(100)
    expect(s.downloadSize).toBe(200)
  })
  it('tts가 없으면 ttsSize 0, downloadSize는 모델만', async () => {
    const s = useModelStore()
    await s.loadManifest()
    expect(s.ttsSize).toBe(0)
    expect(s.downloadSize).toBe(100)
  })
  it('경량 모델로 바꾸면 downloadSize도 따라간다', async () => {
    vi.mocked(getManifest).mockResolvedValue({ ...manifest, tts })
    const s = useModelStore()
    await s.loadManifest()
    s.setActive(manifest.fallback)
    expect(s.downloadSize).toBe(150)
  })
})

describe('model store — 옛 캐시 정리 (#22)', () => {
  it('매니페스트를 읽으면 현재 모델·폴백·TTS 파일 키만 남기도록 pruneModels를 부른다', async () => {
    vi.mocked(getManifest).mockResolvedValue({ ...manifest, tts })
    const s = useModelStore()
    await s.loadManifest()
    expect(pruneModels).toHaveBeenCalledWith([
      '/models-cache/e4b/models/e4b.litertlm',
      '/models-cache/e2b/models/e2b.litertlm',
      '/models-cache/supertonic-3/models/tts/supertonic-3/a.onnx',
      '/models-cache/supertonic-3/models/tts/supertonic-3/b.onnx',
    ])
  })
  it('정리가 실패해도 매니페스트 로드는 성공이다', async () => {
    vi.mocked(pruneModels).mockRejectedValueOnce(new Error('quota'))
    const s = useModelStore()
    await s.loadManifest()
    expect(s.manifest?.id).toBe('e4b')
    expect(s.manifestError).toBeNull()
  })
})

describe('model store — 전체 진행률 (#26)', () => {
  it('모델 다운로드 중: 모델 몫만 차오르고, TTS 몫은 처음부터 분모에 들어간다', async () => {
    vi.mocked(getManifest).mockResolvedValue({ ...manifest, tts }) // 모델 100 + TTS 100
    const s = useModelStore()
    await s.loadManifest()
    s.received = 50
    expect(s.overallTotal).toBe(200)
    expect(s.overallReceived).toBe(50)
    expect(s.overallProgress).toBe(25)
  })
  it('모델 완료 뒤 TTS 다운로드 중에는 0으로 되돌아가지 않고 이어서 오른다', async () => {
    vi.mocked(getManifest).mockResolvedValue({ ...manifest, tts })
    const s = useModelStore()
    await s.loadManifest()
    s.received = 100
    s.$patch({ ttsReceived: 40, ttsTotal: 100 })
    expect(s.overallProgress).toBe(70)
  })
  it('tts가 없으면 모델만으로 100', async () => {
    const s = useModelStore()
    await s.loadManifest()
    s.received = 100
    expect(s.overallProgress).toBe(100)
  })
})
