import { defineStore } from 'pinia'
import { getManifest } from '@/services/api'
import { clearModels, downloadModel, getModelBlob, hasModel } from '@/services/modelCache'
import { disposeEngine, initEngine } from '@/services/llm'
import type { Manifest, ModelRef } from '@/types/api'

export const MAX_NUM_TOKENS = 8192

export type ModelStatus =
  'idle' | 'loading-manifest' | 'downloading' | 'downloaded' | 'initializing' | 'ready' | 'error'

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
  }),
  getters: {
    progress: (s) => (s.total ? Math.min(100, Math.round((s.received / s.total) * 100)) : 0),
  },
  actions: {
    async loadManifest() {
      this.status = 'loading-manifest'
      this.manifestError = null
      try {
        this.manifest = await getManifest()
        this.setActive(this.manifest)
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
      } catch (e) {
        this.status = 'error'
        this.initFailed = true
        this.error = e instanceof Error ? e.message : String(e)
      }
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
      await clearModels()
      this.received = 0
      this.status = 'idle'
      this.error = null
      this.initFailed = false
    },
  },
})
