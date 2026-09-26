import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
vi.mock('@/services/tts', () => ({
  initTts: vi.fn(),
  synthesize: vi.fn(),
  disposeTts: vi.fn(),
  setTtsVoice: vi.fn(async () => {}),
}))

import { getManifest } from '@/services/api'
import { downloadModel, getModelBlob, hasModel, pruneModels } from '@/services/modelCache'
import { initEngine } from '@/services/llm'
import { disposeTts, initTts, setTtsVoice, synthesize } from '@/services/tts'
import { INIT_TIMEOUT_MS, TTS_WARMUP_TEXT, VOICE_SWITCH_TIMEOUT_MS, useModelStore } from './model'

const manifest = {
  id: 'e4b',
  url: '/models/e4b.litertlm',
  size: 100,
  template: { turnStart: '<|turn>', turnEnd: '<turn|>', roles: {} },
  systemPromptOverride: null,
  fallback: { id: 'e2b', url: '/models/e2b.litertlm', size: 50 },
}

beforeEach(() => {
  localStorage.clear()
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

describe('model store — 목소리 선택 (#36)', () => {
  beforeEach(() => localStorage.clear())
  it('기본은 목소리 포함. 해제하면 ttsEnabled·ttsSize·downloadSize가 모델만 기준이 된다', async () => {
    vi.mocked(getManifest).mockResolvedValue({ ...manifest, tts })
    const s = useModelStore()
    await s.loadManifest()
    expect(s.voiceWanted).toBe(true)
    expect(s.ttsEnabled).toBe(true)
    s.setVoiceWanted(false)
    expect(s.ttsEnabled).toBe(false)
    expect(s.ttsSize).toBe(0)
    expect(s.downloadSize).toBe(100)
    expect(s.overallTotal).toBe(100)
  })
  it('해제 상태면 Gemma만으로 ready이고 loadTts는 initTts 없이 텍스트 전용으로 끝난다', async () => {
    vi.mocked(getManifest).mockResolvedValue({ ...manifest, tts })
    const s = useModelStore()
    await s.loadManifest()
    s.setVoiceWanted(false)
    await s.download()
    expect(initTts).not.toHaveBeenCalled()
    expect(s.ttsStatus).toBe('ready')
    expect(s.ready).toBe(true)
  })
  it('선택은 localStorage momo.voice에 남고 새 스토어가 읽는다', async () => {
    const s = useModelStore()
    s.setVoiceWanted(false)
    expect(localStorage.getItem('momo.voice')).toBe('0')
    setActivePinia(createPinia())
    expect(useModelStore().voiceWanted).toBe(false)
  })
  it('manifest.tts가 없으면 선택과 무관하게 ttsEnabled false', async () => {
    const s = useModelStore()
    await s.loadManifest()
    expect(s.voiceWanted).toBe(true)
    expect(s.ttsEnabled).toBe(false)
  })
  it('해제해도 옛 캐시 정리 기준(currentCacheKeys)에는 TTS 파일이 남는다 — 다시 켤 때 재다운로드 방지', async () => {
    localStorage.setItem('momo.voice', '0')
    vi.mocked(getManifest).mockResolvedValue({ ...manifest, tts })
    const s = useModelStore()
    await s.loadManifest()
    expect(vi.mocked(pruneModels).mock.calls.at(-1)?.[0]).toContain(
      '/models-cache/supertonic-3/models/tts/supertonic-3/a.onnx',
    )
  })
})

describe('model store — 재방문 판정 (#33)', () => {
  it('매니페스트를 읽은 뒤 선택한 파일(모델 + TTS 전부)이 캐시에 있으면 cached=true', async () => {
    vi.mocked(getManifest).mockResolvedValue({ ...manifest, tts })
    vi.mocked(hasModel).mockResolvedValue(true)
    const s = useModelStore()
    expect(s.cached).toBeNull()
    await s.loadManifest()
    expect(s.cached).toBe(true)
    expect(hasModel).toHaveBeenCalledWith('e4b', '/models/e4b.litertlm')
    expect(hasModel).toHaveBeenCalledWith('supertonic-3', '/models/tts/supertonic-3/a.onnx')
    expect(hasModel).toHaveBeenCalledWith('supertonic-3', '/models/tts/supertonic-3/b.onnx')
  })
  it('모델만 있고 TTS 파일 하나라도 없으면 재방문이 아니다', async () => {
    vi.mocked(getManifest).mockResolvedValue({ ...manifest, tts })
    vi.mocked(hasModel).mockImplementation(async (_id, url) => !url.endsWith('b.onnx'))
    const s = useModelStore()
    await s.loadManifest()
    expect(s.cached).toBe(false)
  })
  it('목소리를 해제한 사람은 Gemma만 있어도 재방문이고, 다시 켜면 다시 판정한다', async () => {
    vi.mocked(getManifest).mockResolvedValue({ ...manifest, tts })
    vi.mocked(hasModel).mockImplementation(async (id) => id === 'e4b')
    const s = useModelStore()
    await s.loadManifest()
    expect(s.cached).toBe(false)
    s.setVoiceWanted(false)
    await vi.waitFor(() => expect(s.cached).toBe(true))
    s.setVoiceWanted(true)
    await vi.waitFor(() => expect(s.cached).toBe(false))
  })
  it('캐시 조회가 실패하면 첫 방문으로 본다', async () => {
    vi.mocked(hasModel).mockRejectedValue(new Error('no caches'))
    const s = useModelStore()
    await s.loadManifest()
    expect(s.cached).toBe(false)
  })
  it('clearCache 뒤에는 첫 방문 흐름', async () => {
    vi.mocked(hasModel).mockResolvedValue(true)
    const s = useModelStore()
    await s.loadManifest()
    expect(s.cached).toBe(true)
    await s.clearCache()
    expect(s.cached).toBe(false)
  })
})

describe('model store — 캐시 히트 시작 상태·진행률 갱신 빈도', () => {
  it('모델이 캐시에 있으면 download()는 hasModel을 기다리기 전에 received=size — 준비 화면이 0%로 마운트되지 않는다', async () => {
    vi.mocked(getManifest).mockResolvedValue({ ...manifest, tts })
    vi.mocked(hasModel).mockResolvedValue(true)
    const s = useModelStore()
    await s.loadManifest()
    expect(s.modelCached).toBe(true)
    const p = s.download()
    expect(s.received).toBe(100) // 동기: await 이전
    expect(s.ttsReceived).toBe(100) // TTS도 캐시에 있으니 전체 100%에서 시작
    await p
    expect(downloadModel).not.toHaveBeenCalled()
  })
  it('모델만 캐시에 있으면 모델 몫만 채워 시작하고 TTS는 0부터', async () => {
    vi.mocked(getManifest).mockResolvedValue({ ...manifest, tts })
    vi.mocked(hasModel).mockImplementation(async (id) => id === 'e4b')
    const s = useModelStore()
    await s.loadManifest()
    expect(s.modelCached).toBe(true)
    expect(s.cached).toBe(false)
    void s.download()
    expect(s.received).toBe(100)
    expect(s.ttsReceived).toBe(0)
  })
  it('진행률은 100ms에 한 번만 스토어에 반영한다(마지막 값은 항상) — 청크마다 재렌더하지 않게', async () => {
    vi.useFakeTimers()
    try {
      vi.mocked(downloadModel).mockImplementation(async (_id, _url, _size, onProgress) => {
        for (let r = 1; r <= 99; r++) onProgress(r) // 같은 순간에 99번
        vi.advanceTimersByTime(150)
        onProgress(100)
      })
      const s = useModelStore()
      await s.loadManifest()
      const seen: number[] = []
      s.$subscribe((_m, st) => seen.push(st.received), { detached: true, flush: 'sync' })
      await s.download()
      const received = seen.filter((v, i) => v !== seen[i - 1])
      expect(received.filter((v) => v > 0 && v < 100)).toHaveLength(1) // 1만 통과
      expect(s.received).toBe(100)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('model store — 초기화 상한 (#41)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('initEngine이 끝나지 않으면 INIT_TIMEOUT_MS 뒤 error로 보내 다시 시도·폴백이 열린다', async () => {
    vi.mocked(initEngine).mockReturnValue(new Promise(() => {}))
    const s = useModelStore()
    await s.loadManifest()
    const p = s.download()
    await vi.advanceTimersByTimeAsync(INIT_TIMEOUT_MS - 1)
    expect(s.status).toBe('initializing')
    await vi.advanceTimersByTimeAsync(1)
    await p
    expect(s.status).toBe('error')
    expect(s.initFailed).toBe(true)
    expect(s.error).toContain('초기화')
  })
  it('initTts(워커 로드)가 끝나지 않으면 INIT_TIMEOUT_MS 뒤 ttsStatus error + disposeTts', async () => {
    vi.mocked(getManifest).mockResolvedValue({ ...manifest, tts })
    // 실제 initTts처럼 다운로드(캐시 히트 포함)는 끝났다고 보고한 뒤 워커 로드에서 멈춘다 — 상한은 이 구간에만 건다
    vi.mocked(initTts).mockImplementation((_cfg, onProgress) => {
      onProgress?.(100, 100)
      return new Promise(() => {})
    })
    const s = useModelStore()
    await s.loadManifest()
    const p = s.download()
    await vi.advanceTimersByTimeAsync(INIT_TIMEOUT_MS + 1)
    await p
    expect(s.status).toBe('ready')
    expect(s.ttsStatus).toBe('error')
    expect(s.ttsError).toContain('초기화')
    expect(disposeTts).toHaveBeenCalled()
    expect(s.ready).toBe(false)
  })
  it('목소리를 해제하면 TTS가 실패·대기 중이어도 Gemma만으로 ready', async () => {
    vi.mocked(getManifest).mockResolvedValue({ ...manifest, tts })
    vi.mocked(initTts).mockReturnValue(new Promise(() => {}))
    const s = useModelStore()
    await s.loadManifest()
    void s.download()
    await vi.advanceTimersByTimeAsync(10)
    expect(s.ready).toBe(false)
    s.setVoiceWanted(false)
    expect(s.ready).toBe(true)
  })
})

import { interviewerById } from '@/interviewers'
import { useInterviewerStore } from './interviewer'

const VOICE_IDS = ['F1', 'F2', 'F3', 'F4', 'F5', 'M1', 'M2', 'M3', 'M4', 'M5']
/** 엔진 90 + 목소리(10 + 순번). M2 = 16 */
const ttsV = {
  id: 'supertonic-3',
  baseUrl: '/models/tts/supertonic-3/',
  files: [
    { path: 'onnx/a.onnx', size: 60 },
    { path: 'onnx/b.onnx', size: 30 },
    { path: 'voice_styles/M2.json', size: 16 },
  ],
  voice: 'M2',
  lang: 'ko',
  voices: VOICE_IDS.map((id, i) => ({ id, path: `voice_styles/${id}.json`, size: 10 + i })),
}
const voiceSize = (id: string) => ttsV.voices.find((v) => v.id === id)!.size
const gentleVoice = () => interviewerById('gentle')!.voiceId
const sharpVoice = () => interviewerById('sharp')!.voiceId

describe('model store — 면접관 목소리 (tts.voices)', () => {
  beforeEach(() => vi.mocked(getManifest).mockResolvedValue({ ...manifest, tts: ttsV }))

  it('선택이 없으면 기본 목소리(M2): 엔진 + M2, ttsSize = 90 + 16', async () => {
    const s = useModelStore()
    await s.loadManifest()
    expect(s.ttsSelection?.voice).toBe('M2')
    expect(s.ttsSelection?.files.map((f) => f.path)).toEqual([
      'onnx/a.onnx',
      'onnx/b.onnx',
      'voice_styles/M2.json',
    ])
    expect(s.ttsSize).toBe(106)
    expect(s.ttsVoiceSize).toBe(16)
  })
  it('면접관을 고르면 그 목소리 파일로 바뀌고 용량도 따라간다', async () => {
    const s = useModelStore()
    await s.loadManifest()
    await s.chooseInterviewer('gentle')
    expect(s.ttsSelection?.voice).toBe(gentleVoice())
    expect(s.ttsSelection?.files.at(-1)?.path).toBe(`voice_styles/${gentleVoice()}.json`)
    expect(s.ttsSize).toBe(90 + voiceSize(gentleVoice()))
  })
  it('initTts에는 엔진 + 고른 목소리만 넘긴다', async () => {
    const s = useModelStore()
    await s.loadManifest()
    await s.chooseInterviewer('sharp')
    await s.download()
    const cfg = vi.mocked(initTts).mock.calls[0][0]
    expect(cfg.voice).toBe(sharpVoice())
    expect(cfg.files.map((f) => f.path)).toEqual([
      'onnx/a.onnx',
      'onnx/b.onnx',
      `voice_styles/${sharpVoice()}.json`,
    ])
  })
  it('캐시 정리는 목소리 10개를 모두 남긴다(중복 없이)', async () => {
    const s = useModelStore()
    await s.loadManifest()
    const keys = vi.mocked(pruneModels).mock.calls[0][0]
    for (const id of VOICE_IDS)
      expect(keys).toContain(
        `/models-cache/supertonic-3/models/tts/supertonic-3/voice_styles/${id}.json`,
      )
    expect(new Set(keys).size).toBe(keys.length)
  })
  it('재방문 판정은 모델 + 엔진만 본다: 고른 목소리가 없어도 cached=true, voiceCached=false', async () => {
    localStorage.setItem('momo.interviewer', 'gentle')
    vi.mocked(hasModel).mockImplementation(async (_id, url) => !url.includes('voice_styles/'))
    const s = useModelStore()
    await s.loadManifest()
    expect(s.cached).toBe(true)
    expect(s.voiceCached).toBe(false)
  })
  it('재방문 + 고른 목소리 없음: 진행률은 엔진까지만 미리 채워 100% 미만에서 시작하고, 받으면 100%', async () => {
    localStorage.setItem('momo.interviewer', 'gentle')
    vi.mocked(hasModel).mockImplementation(async (_id, url) => !url.includes('voice_styles/'))
    let finish!: () => void
    vi.mocked(initTts).mockImplementation(async (cfg, onProgress) => {
      const total = cfg.files.reduce((n, f) => n + f.size, 0)
      onProgress?.(60, total) // 캐시 히트 파일도 누적으로 보고된다 — 뒤로 가면 안 된다
      await new Promise<void>((r) => (finish = r))
      onProgress?.(total, total)
    })
    const s = useModelStore()
    await s.loadManifest()
    const p = s.download()
    expect(s.ttsReceived).toBe(90) // 엔진만
    expect(s.overallProgress).toBeLessThan(100)
    await vi.waitFor(() => expect(initTts).toHaveBeenCalled())
    expect(s.ttsReceived).toBe(90) // 60을 보고받아도 뒤로 가지 않는다
    finish()
    await p
    expect(s.overallProgress).toBe(100)
  })
  it('재방문 + 목소리까지 캐시: 100%에서 시작', async () => {
    vi.mocked(hasModel).mockResolvedValue(true)
    const s = useModelStore()
    await s.loadManifest()
    void s.download()
    expect(s.ttsReceived).toBe(106)
  })
  it('재방문인데 저장된 선택이 없으면 기본 면접관을 자동 선택한다', async () => {
    vi.mocked(hasModel).mockResolvedValue(true)
    const s = useModelStore()
    await s.loadManifest()
    expect(useInterviewerStore().id).toBe('standard')
  })
  it('첫 방문(캐시 없음)이면 자동 선택하지 않는다', async () => {
    const s = useModelStore()
    await s.loadManifest()
    expect(useInterviewerStore().id).toBeNull()
  })
  it('TTS가 준비된 뒤 면접관을 바꾸면 목소리 파일만 받아 setTtsVoice로 교체한다', async () => {
    const s = useModelStore()
    await s.loadManifest()
    await s.download()
    expect(s.loadedVoice).toBe('M2')
    vi.mocked(downloadModel).mockClear()
    await s.chooseInterviewer('gentle')
    const url = `/models/tts/supertonic-3/voice_styles/${gentleVoice()}.json`
    expect(downloadModel).toHaveBeenCalledWith(
      'supertonic-3',
      url,
      voiceSize(gentleVoice()),
      expect.any(Function),
      expect.any(AbortSignal), // 교체 상한을 넘기면 중단한다
    )
    expect(setTtsVoice).toHaveBeenCalledWith(gentleVoice(), {
      path: `voice_styles/${gentleVoice()}.json`,
      size: voiceSize(gentleVoice()),
      url,
      cacheKey: `/models-cache/supertonic-3${url}`,
    })
    expect(s.loadedVoice).toBe(gentleVoice())
    expect(s.ready).toBe(true)
  })
  it('바꾸는 동안에는 ready가 false', async () => {
    const s = useModelStore()
    await s.loadManifest()
    await s.download()
    let release!: () => void
    vi.mocked(setTtsVoice).mockReturnValueOnce(new Promise<void>((r) => (release = r)))
    const p = s.chooseInterviewer('gentle')
    await vi.waitFor(() => expect(s.voiceSwitching).toBe(true))
    expect(s.ready).toBe(false)
    release()
    await p
    expect(s.ready).toBe(true)
  })
  it('교체에 실패하면 이전 목소리를 유지하고 선택도 되돌린다(voiceError)', async () => {
    const s = useModelStore()
    await s.loadManifest()
    await s.chooseInterviewer('standard')
    await s.download()
    vi.mocked(setTtsVoice).mockRejectedValueOnce(new Error('bad style'))
    await s.chooseInterviewer('sharp')
    expect(s.loadedVoice).toBe('M2')
    expect(s.voiceError).toContain('bad style')
    expect(useInterviewerStore().id).toBe('standard')
  })
  it('텍스트 전용(목소리 해제)이면 면접관을 바꿔도 목소리 교체를 하지 않는다', async () => {
    const s = useModelStore()
    await s.loadManifest()
    s.setVoiceWanted(false)
    await s.download()
    await s.chooseInterviewer('gentle')
    expect(setTtsVoice).not.toHaveBeenCalled()
  })
  it('TTS 로딩 중에 면접관을 바꾸면 로딩이 끝난 뒤 새 목소리로 맞춘다', async () => {
    let release!: () => void
    vi.mocked(initTts).mockReturnValueOnce(new Promise<void>((r) => (release = r)))
    const s = useModelStore()
    await s.loadManifest()
    const p = s.download()
    await vi.waitFor(() => expect(s.ttsStatus).toBe('initializing'))
    await s.chooseInterviewer('sharp')
    expect(setTtsVoice).not.toHaveBeenCalled()
    release()
    await p
    expect(setTtsVoice).toHaveBeenCalledWith(sharpVoice(), expect.anything())
    expect(s.loadedVoice).toBe(sharpVoice())
  })
  it('빠르게 두 번 고르고 두 번째 교체가 실패하면, 실제 로드된 목소리의 면접관으로 되돌린다', async () => {
    const s = useModelStore()
    await s.loadManifest()
    await s.download()
    expect(s.loadedVoice).toBe('M2')
    let release!: () => void
    vi.mocked(setTtsVoice).mockReturnValueOnce(new Promise((r) => (release = r)))
    vi.mocked(setTtsVoice).mockRejectedValueOnce(new Error('bad style'))
    const p1 = s.chooseInterviewer('gentle')
    await vi.waitFor(() => expect(s.voiceSwitching).toBe(true))
    const p2 = s.chooseInterviewer('sharp')
    release()
    await Promise.all([p1, p2])
    expect(s.loadedVoice).toBe(gentleVoice())
    expect(useInterviewerStore().id).toBe('gentle')
    expect(s.voiceError).toContain('bad style')
  })
  it('로딩 중에 고르고 로드 뒤 교체가 실패하면 기본 면접관으로 되돌린다', async () => {
    let release!: () => void
    vi.mocked(initTts).mockReturnValueOnce(new Promise<void>((r) => (release = r)))
    vi.mocked(setTtsVoice).mockRejectedValueOnce(new Error('bad style'))
    const s = useModelStore()
    await s.loadManifest()
    const p = s.download()
    await vi.waitFor(() => expect(s.ttsStatus).toBe('initializing'))
    await s.chooseInterviewer('sharp')
    release()
    await p
    expect(s.loadedVoice).toBe('M2')
    expect(useInterviewerStore().id).toBe('standard')
    expect(s.voiceError).toContain('bad style')
    expect(s.ready).toBe(true)
  })
  it('교체가 끝나면 전체 진행률은 100', async () => {
    const s = useModelStore()
    await s.loadManifest()
    await s.download()
    await s.chooseInterviewer('gentle')
    expect(s.overallProgress).toBe(100)
  })
  it('텍스트 전용으로 준비된 뒤(워커 없음) 목소리를 다시 켜고 골라도 오류가 나지 않는다', async () => {
    const s = useModelStore()
    await s.loadManifest()
    s.setVoiceWanted(false)
    await s.download()
    s.setVoiceWanted(true)
    await s.chooseInterviewer('gentle')
    expect(setTtsVoice).not.toHaveBeenCalled()
    expect(s.voiceError).toBeNull()
    expect(useInterviewerStore().id).toBe('gentle')
  })
  it('clearCache는 목소리 상태를 초기화한다', async () => {
    const s = useModelStore()
    await s.loadManifest()
    await s.download()
    await s.chooseInterviewer('gentle')
    await s.clearCache()
    expect(s.voiceCached).toBe(false)
    expect(s.loadedVoice).toBeNull()
    expect(s.loadedInterviewerId).toBeNull()
    expect(s.voiceSwitching).toBe(false)
    expect(s.voiceError).toBeNull()
  })
})

describe('model store — 목소리 교체 되돌림', () => {
  beforeEach(() => vi.mocked(getManifest).mockResolvedValue({ ...manifest, tts: ttsV }))

  it('목소리를 올린 면접관 id를 기억한다: 선택이 없으면 기본 면접관, 교체에 성공하면 새 면접관', async () => {
    const s = useModelStore()
    await s.loadManifest()
    expect(s.loadedInterviewerId).toBeNull()
    await s.download()
    expect(s.loadedInterviewerId).toBe('standard')
    await s.chooseInterviewer('gentle')
    expect(s.loadedInterviewerId).toBe('gentle')
  })
  it('로딩 중에 선택이 바뀌어도 실제로 올린 목소리의 면접관(cfg를 만들 때의 선택)을 기억한다', async () => {
    let release!: () => void
    vi.mocked(initTts).mockReturnValueOnce(new Promise<void>((r) => (release = r)))
    vi.mocked(setTtsVoice).mockRejectedValueOnce(new Error('bad style'))
    const s = useModelStore()
    await s.loadManifest()
    await s.chooseInterviewer('gentle')
    const p = s.download()
    await vi.waitFor(() => expect(s.ttsStatus).toBe('initializing'))
    await s.chooseInterviewer('sharp')
    release()
    await p
    expect(s.loadedVoice).toBe(gentleVoice())
    expect(s.loadedInterviewerId).toBe('gentle')
    expect(useInterviewerStore().id).toBe('gentle') // 교체 실패 → 로드된 면접관으로 되돌림
  })
  it('되돌리는 사이(캐시 확인 대기 중)에 다른 면접관을 고르면 끝난 뒤 그 목소리로 맞춘다', async () => {
    const s = useModelStore()
    await s.loadManifest()
    await s.download()
    expect(s.loadedVoice).toBe('M2')
    // 첫 교체(gentle)는 실패하고, 그 되돌림의 캐시 확인(hasModel)이 멈춰 있는 동안 sharp를 고른다
    let releaseCheck: (() => void) | null = null
    let blockNext = false
    vi.mocked(hasModel).mockImplementation(async () => {
      if (blockNext) {
        blockNext = false
        await new Promise<void>((r) => (releaseCheck = r))
      }
      return false
    })
    vi.mocked(setTtsVoice).mockImplementationOnce(async () => {
      blockNext = true
      throw new Error('bad style')
    })
    const p1 = s.chooseInterviewer('gentle')
    await vi.waitFor(() => expect(releaseCheck).not.toBeNull())
    expect(s.voiceSwitching).toBe(true)
    await s.chooseInterviewer('sharp') // 교체 중이라 syncVoice는 바로 돌아온다
    releaseCheck!()
    await p1
    expect(s.loadedVoice).toBe(sharpVoice())
    expect(useInterviewerStore().id).toBe('sharp')
    expect(s.voiceSwitching).toBe(false)
    expect(s.ready).toBe(true)
  })
  it('교체 실패 뒤 로드된 면접관을 다시 고르면 실패 안내가 사라진다', async () => {
    const s = useModelStore()
    await s.loadManifest()
    await s.download()
    vi.mocked(setTtsVoice).mockRejectedValueOnce(new Error('bad style'))
    await s.chooseInterviewer('sharp')
    expect(s.voiceError).toContain('bad style')
    await s.chooseInterviewer('standard')
    expect(s.voiceError).toBeNull()
  })
})

describe('model store — 목소리 교체 상한', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.mocked(getManifest).mockResolvedValue({ ...manifest, tts: ttsV })
  })
  afterEach(() => vi.useRealTimers())

  it('워커가 목소리 교체에 응답하지 않으면 상한 뒤 워커를 버리고 목소리 실패(error)로 — 선택은 그대로', async () => {
    const s = useModelStore()
    await s.loadManifest()
    await s.download()
    vi.mocked(disposeTts).mockClear()
    vi.mocked(setTtsVoice).mockReturnValueOnce(new Promise(() => {}))
    const p = s.chooseInterviewer('gentle')
    await vi.advanceTimersByTimeAsync(VOICE_SWITCH_TIMEOUT_MS - 1)
    expect(s.voiceSwitching).toBe(true)
    await vi.advanceTimersByTimeAsync(1)
    await p
    expect(s.voiceSwitching).toBe(false)
    expect(s.ttsStatus).toBe('error')
    expect(s.ttsError).toContain('목소리 교체')
    expect(disposeTts).toHaveBeenCalled()
    expect(s.loadedVoice).toBeNull()
    expect(s.loadedInterviewerId).toBeNull()
    expect(s.voiceError).toBeNull() // 실패는 진행 창(ttsError)이 보여 준다
    expect(useInterviewerStore().id).toBe('gentle')
    expect(s.ready).toBe(false)
    // 다시 시도는 고른 목소리로 새 워커를 올린다
    await s.retryTts()
    expect(vi.mocked(initTts).mock.calls.at(-1)?.[0].voice).toBe(gentleVoice())
    expect(s.ttsStatus).toBe('ready')
    expect(s.loadedVoice).toBe(gentleVoice())
    expect(s.loadedInterviewerId).toBe('gentle')
  })
  it('목소리 파일 다운로드가 끝나지 않으면 상한 뒤 중단하고 로드된 면접관으로 되돌린다(워커는 그대로)', async () => {
    const s = useModelStore()
    await s.loadManifest()
    await s.download()
    let signal: AbortSignal | undefined
    let finishDownload!: () => void
    // 중단 신호를 무시하고 늦게 끝나는 다운로드 — 포기한 교체가 뒤늦게 워커를 건드리지 않는지도 본다
    vi.mocked(downloadModel).mockImplementationOnce((_id, _url, _size, _onProgress, sig) => {
      signal = sig
      return new Promise<void>((r) => (finishDownload = r))
    })
    vi.mocked(disposeTts).mockClear()
    const p = s.chooseInterviewer('gentle')
    await vi.advanceTimersByTimeAsync(VOICE_SWITCH_TIMEOUT_MS)
    await p
    expect(signal?.aborted).toBe(true)
    expect(s.voiceSwitching).toBe(false)
    expect(useInterviewerStore().id).toBe('standard')
    expect(s.voiceError).toContain('목소리 교체')
    expect(s.ttsStatus).toBe('ready')
    expect(s.loadedVoice).toBe('M2')
    expect(disposeTts).not.toHaveBeenCalled()
    expect(s.ready).toBe(true)
    finishDownload()
    await vi.advanceTimersByTimeAsync(0)
    expect(setTtsVoice).not.toHaveBeenCalled()
  })
  it('목소리를 해제하면 교체 중이어도 Gemma만으로 ready — "목소리 없이 시작"이 막히지 않게', async () => {
    const s = useModelStore()
    await s.loadManifest()
    await s.download()
    vi.mocked(setTtsVoice).mockReturnValueOnce(new Promise(() => {}))
    void s.chooseInterviewer('gentle')
    await vi.advanceTimersByTimeAsync(10)
    expect(s.voiceSwitching).toBe(true)
    expect(s.ready).toBe(false)
    s.setVoiceWanted(false)
    expect(s.ready).toBe(true)
  })
})
