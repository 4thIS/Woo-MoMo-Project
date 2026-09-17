import { defineStore } from 'pinia'
import { getManifest } from '@/services/api'
import {
  cacheKey,
  clearModels,
  downloadModel,
  getModelBlob,
  hasModel,
  pruneModels,
} from '@/services/modelCache'
import { disposeEngine, initEngine } from '@/services/llm'
import { disposeTts, initTts, synthesize } from '@/services/tts'
import type { Manifest, ModelRef } from '@/types/api'

export const MAX_NUM_TOKENS = 8192

export type ModelStatus =
  'idle' | 'loading-manifest' | 'downloading' | 'downloaded' | 'initializing' | 'ready' | 'error'

export type TtsStatus = 'idle' | 'downloading' | 'initializing' | 'ready' | 'error'
/** 준비 단계에서 한 번 미리 합성해 두는 문장 — 첫 질문의 합성이 워밍업 비용을 물지 않게 (spec 6절) */
export const TTS_WARMUP_TEXT = '안녕하세요.'
export const TTS_WARMUP_TIMEOUT_MS = 15_000

/** 현재 매니페스트가 가리키는 파일들의 캐시 키(모델·폴백·TTS 파일 전부) */
function currentCacheKeys(m: Manifest): string[] {
  const keys = [cacheKey(m.id, m.url)]
  if (m.fallback) keys.push(cacheKey(m.fallback.id, m.fallback.url))
  if (m.tts) for (const f of m.tts.files) keys.push(cacheKey(m.tts.id, m.tts.baseUrl + f.path))
  return keys
}

export const useModelStore = defineStore('model', {
  state: () => ({
    status: 'idle' as ModelStatus,
    manifest: null as Manifest | null,
    active: null as ModelRef | null,
    received: 0,
    total: 0,
    error: null as string | null,
    manifestError: null as string | null,
    initFailed: false,
    ttsStatus: 'idle' as TtsStatus,
    ttsReceived: 0,
    ttsTotal: 0,
    ttsError: null as string | null,
  }),
  getters: {
    progress: (s) => (s.total ? Math.min(100, Math.round((s.received / s.total) * 100)) : 0),
    ttsEnabled: (s) => !!s.manifest?.tts,
    ttsProgress: (s) =>
      s.ttsTotal ? Math.min(100, Math.round((s.ttsReceived / s.ttsTotal) * 100)) : 0,
    /** 면접을 시작할 수 있는 상태: Gemma ready + (TTS가 있으면) TTS ready */
    ready: (s) => s.status === 'ready' && (!s.manifest?.tts || s.ttsStatus === 'ready'),
  },
  actions: {
    async loadManifest() {
      this.status = 'loading-manifest'
      this.manifestError = null
      try {
        this.manifest = await getManifest()
        this.setActive(this.manifest)
        // 주소·id가 바뀐 옛 모델 항목 정리 — 실패해도 매니페스트 로드는 성공으로 둔다
        await pruneModels(currentCacheKeys(this.manifest)).catch(() => undefined)
      } catch (e) {
        this.manifestError = e instanceof Error ? e.message : String(e)
      } finally {
        this.status = 'idle'
      }
    },
    setActive(ref: ModelRef) {
      this.active = { id: ref.id, url: ref.url, size: ref.size }
      this.total = ref.size
      this.received = 0
    },
    async download() {
      if (!this.active) {
        this.status = 'error'
        this.error = 'manifest not loaded'
        return
      }
      const { id, url, size } = this.active
      this.error = null
      this.initFailed = false
      // 캐시 조회 동안에도 준비 화면이 look_up(초기화) 장면을 보이도록 먼저 initializing으로 둔다.
      // 캐시 미스면 downloading으로 내려간다 (spec 4.2: 캐시 히트면 downloading을 건너뛴다)
      this.status = 'initializing'
      try {
        if (await hasModel(id, url)) {
          this.received = size
        } else {
          this.status = 'downloading'
          await downloadModel(id, url, size, (r) => (this.received = r), undefined)
        }
        this.status = 'downloaded'
      } catch (e) {
        this.status = 'error'
        this.error = e instanceof Error ? e.message : String(e)
        return
      }
      await this.init()
    },
    async init() {
      if (!this.active) return
      this.status = 'initializing'
      this.error = null
      try {
        const blob = await getModelBlob(this.active.id, this.active.url)
        if (!blob) throw new Error('cached model not found')
        await initEngine(blob, { maxNumTokens: MAX_NUM_TOKENS })
        this.status = 'ready'
        await this.loadTts()
      } catch (e) {
        this.status = 'error'
        this.initFailed = true
        this.error = e instanceof Error ? e.message : String(e)
      }
    },
    /** Gemma ready 뒤 TTS 파일을 받아 워커를 올리고 워밍업 한 문장을 돌린다. manifest.tts가 없으면 텍스트 전용으로 바로 ready */
    async loadTts() {
      const cfg = this.manifest?.tts
      if (!cfg) {
        this.ttsStatus = 'ready'
        return
      }
      // ready: 경량 모델 전환 등으로 Gemma만 다시 올릴 때 TTS는 그대로 둔다.
      // downloading/initializing: 다시 시도 연타 — 겹쳐 부르면 앞선 initTts가 superseded로 거부되며 error를 잠깐 덮어쓴다
      if (
        this.ttsStatus === 'ready' ||
        this.ttsStatus === 'downloading' ||
        this.ttsStatus === 'initializing'
      )
        return
      this.ttsStatus = 'initializing' // 캐시 조회 중에도 진행 창이 look_up을 유지하도록
      this.ttsError = null
      this.ttsReceived = 0
      this.ttsTotal = cfg.files.reduce((n, f) => n + f.size, 0)
      try {
        await initTts(cfg, (r, t) => {
          this.ttsReceived = r
          this.ttsTotal = t
          this.ttsStatus = r < t ? 'downloading' : 'initializing'
        })
        // 워밍업 실패·지연은 무시 — 실제 턴에서 다시 시도된다. 상한을 두어 첫 WebGPU 실행이 멈춰도 준비 화면이 갇히지 않게
        const warm = new AbortController()
        const t = setTimeout(() => warm.abort(), TTS_WARMUP_TIMEOUT_MS)
        await synthesize(TTS_WARMUP_TEXT, warm.signal)
          .catch(() => undefined)
          .finally(() => clearTimeout(t))
        this.ttsStatus = 'ready'
      } catch (e) {
        this.ttsStatus = 'error'
        this.ttsError = e instanceof Error ? e.message : String(e)
      }
    },
    retryTts() {
      return this.loadTts()
    },
    retry() {
      return this.download()
    },
    async useFallback() {
      if (!this.manifest?.fallback) return
      await disposeEngine()
      this.setActive(this.manifest.fallback)
      await this.download()
    },
    async clearCache() {
      await disposeEngine()
      disposeTts()
      await clearModels()
      this.received = 0
      this.status = 'idle'
      this.error = null
      this.initFailed = false
      this.ttsStatus = 'idle'
      this.ttsReceived = 0
      this.ttsError = null
    },
  },
})
